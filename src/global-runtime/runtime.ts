import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildRuntimeProcessToken,
  buildSessionPrompt,
  GLOBAL_RUNTIME_CONTRACT_VERSION,
  RUNTIME_PROCESS_TOKEN_ENV,
} from './contracts.js'
import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js'
import { CliProviderAdapter, type ProviderAdapter } from './providers.js'
import type { RuntimeStore } from './store.js'
import {
  appendInboxSchema,
  createRuntimeRunSchema,
  extendRunSchema,
  sessionResultSchema,
  type CreateRuntimeRunInput,
  type RuntimeFilesResponse,
  type RuntimeProvider,
  type RuntimeRun,
  type RuntimeRunDetail,
  type RuntimeRunSummary,
  type RuntimeRunStatus,
  type RuntimeSession,
  type TokenUsage,
} from './types.js'
import {
  appendInboxEntry,
  canonicalWorkspace,
  computeMissionHash,
  prepareSessionResultFile,
  readSessionResultFile,
  readRuntimeFiles,
  validateRunWorkspace,
} from './workspaceFiles.js'

const ACTIVE_STATUSES: RuntimeRunStatus[] = ['running', 'pause_requested', 'rate_limited']
const RESUMABLE_STATUSES: RuntimeRunStatus[] = [
  'paused',
  'waiting',
  'rate_limited',
  'stopped',
  'error',
]

interface ActiveRun {
  workspacePath: string
  abortController: AbortController
  pauseRequested: boolean
  stopRequested: boolean
  wakeDelay: (() => void) | null
  task: Promise<void>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error: unknown) => void
}

export interface GlobalRuntimeOptions {
  logRoot?: string
  rateLimitRetryMs?: number
  heartbeatMs?: number
  providers?: Partial<Record<RuntimeProvider, ProviderAdapter>>
  now?: () => Date
  terminateProcess?: (pid: number) => Promise<void>
  verifyProcess?: (pid: number, expectedToken: string) => Promise<boolean>
  onBackgroundError?: (runId: number, error: unknown) => void
  onFatalError?: (error: unknown) => void
}

export class GlobalRuntime {
  private readonly active = new Map<number, ActiveRun>()
  private readonly launching = new Set<number>()
  private readonly workspaceOwners = new Map<string, number>()
  private readonly logRoot: string
  private readonly rateLimitRetryMs: number
  private readonly heartbeatMs: number
  private readonly providers: Record<RuntimeProvider, ProviderAdapter>
  private readonly now: () => Date
  private readonly terminateProcess: (pid: number) => Promise<void>
  private readonly verifyProcess: (pid: number, expectedToken: string) => Promise<boolean>
  private readonly onBackgroundError: (runId: number, error: unknown) => void
  private readonly onFatalError: ((error: unknown) => void) | null
  private readonly runTransitions = new Map<number, Promise<void>>()
  private runtimeLeaseRelease: (() => Promise<void>) | null = null
  private runtimeLeasePending: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private shuttingDown = false

  constructor(
    private readonly store: RuntimeStore,
    options: GlobalRuntimeOptions = {},
  ) {
    const defaultAdapter = new CliProviderAdapter()
    this.providers = {
      claude: options.providers?.claude ?? defaultAdapter,
      codex: options.providers?.codex ?? defaultAdapter,
    }
    this.logRoot = path.resolve(options.logRoot ?? 'logs/global-runtime')
    this.rateLimitRetryMs = options.rateLimitRetryMs ?? 15 * 60 * 1000
    this.heartbeatMs = options.heartbeatMs ?? 5000
    this.now = options.now ?? (() => new Date())
    this.terminateProcess = options.terminateProcess ?? terminatePersistedProcess
    this.verifyProcess = options.verifyProcess ?? processHasRuntimeToken
    this.onBackgroundError =
      options.onBackgroundError ??
      ((runId, error) => console.error(`[global-runtime] run ${runId} task failed:`, error))
    this.onFatalError = options.onFatalError ?? null
  }

  async initialize(): Promise<void> {
    await this.ensureRuntimeLease()
    if (this.shuttingDown) throw new RuntimeConflictError('runtime is shutting down')
    const interrupted = await this.store.listRunsByStatuses(['running', 'pause_requested'])
    for (const run of interrupted) {
      let recoveryError = 'Runtime restarted. Review the last session and resume when ready.'
      if (run.processId !== null) {
        const sessions = await this.store.listSessions(run.id)
        const currentSession = sessions.find(
          (session) => session.status === 'running' && session.sessionNumber === run.currentSession,
        )
        if (currentSession) {
          const expectedToken = buildRuntimeProcessToken(run.id, currentSession.sessionNumber)
          if (await this.verifyProcess(run.processId, expectedToken)) {
            await this.terminateProcess(run.processId)
          } else {
            recoveryError =
              'Runtime restarted, but the recorded process identity could not be verified. Confirm that no previous provider process remains before resuming.'
          }
        } else {
          recoveryError =
            'Runtime restarted without a verifiable running session. Confirm that no previous provider process remains before resuming.'
        }
      }
      await this.store.finishRunningSessions(
        run.id,
        'failed',
        'The Global Runtime restarted while this session was active.',
      )
      await this.store.updateRun(run.id, {
        status: 'waiting',
        processId: null,
        heartbeatAt: null,
        nextStartAt: null,
        lastError: recoveryError,
      })
    }

    const incompleteStops = await this.store.listRunsByStatuses(['stopped'])
    for (const run of incompleteStops) {
      const sessions = await this.store.listSessions(run.id)
      const runningSession = sessions.find((session) => session.status === 'running')
      if (run.processId === null && !runningSession) continue

      let recoveryError = 'Runtime restarted while stop completion was still pending.'
      if (run.processId !== null && runningSession) {
        const expectedToken = buildRuntimeProcessToken(run.id, runningSession.sessionNumber)
        if (await this.verifyProcess(run.processId, expectedToken)) {
          await this.terminateProcess(run.processId)
        } else {
          recoveryError =
            'Runtime restarted during stop, but the recorded process identity could not be verified. Confirm that no previous provider process remains before resuming.'
        }
      } else if (run.processId !== null) {
        recoveryError =
          'Runtime restarted during stop without a verifiable running session. Confirm that no previous provider process remains before resuming.'
      }
      await this.store.finishRunningSessions(
        run.id,
        'stopped',
        'The Global Runtime restarted while stop completion was pending.',
      )
      await this.store.updateRun(run.id, {
        status: 'stopped',
        processId: null,
        heartbeatAt: null,
        nextStartAt: null,
        endedAt: this.now(),
        lastError: recoveryError,
      })
    }

    const rateLimited = await this.store.listRunsByStatuses(['rate_limited'])
    for (const run of rateLimited) {
      const delayMs = Math.max(
        0,
        (run.nextStartAt?.getTime() ?? this.now().getTime()) - this.now().getTime(),
      )
      await this.launch(run, ['rate_limited'], delayMs)
    }
  }

  async createRun(value: unknown): Promise<RuntimeRun> {
    const parsed = createRuntimeRunSchema.safeParse(value)
    if (!parsed.success)
      throw new RuntimeValidationError(parsed.error.issues[0]?.message ?? 'invalid run')
    const input: CreateRuntimeRunInput = {
      ...parsed.data,
      workspacePath: await canonicalWorkspace(parsed.data.workspacePath),
    }
    await validateRunWorkspace(asValidationRun(input))
    return this.store.createRun(input)
  }

  async listRuns(): Promise<RuntimeRunSummary[]> {
    const runs = await this.store.listRuns()
    return Promise.all(
      runs.map(async (run) => {
        const sessions = await this.store.listSessions(run.id)
        return {
          ...run,
          resolvedModel: sessions.find((session) => session.resolvedModel)?.resolvedModel ?? null,
          totals: totalUsage(sessions),
        }
      }),
    )
  }

  async getRunDetail(id: number): Promise<RuntimeRunDetail> {
    const run = await this.requireRun(id)
    const sessions = await this.store.listSessions(id)
    return { run, sessions, totals: totalUsage(sessions) }
  }

  async getFiles(id: number): Promise<RuntimeFilesResponse> {
    return readRuntimeFiles(await this.requireRun(id))
  }

  async appendInbox(id: number, value: unknown): Promise<{ id: string; appendedAt: string }> {
    const parsed = appendInboxSchema.safeParse(value)
    if (!parsed.success) {
      throw new RuntimeValidationError(parsed.error.issues[0]?.message ?? 'invalid inbox entry')
    }
    return appendInboxEntry(await this.requireRun(id), parsed.data.message)
  }

  async extendMaxSessions(id: number, value: unknown): Promise<RuntimeRun> {
    const parsed = extendRunSchema.safeParse(value)
    if (!parsed.success) {
      throw new RuntimeValidationError(parsed.error.issues[0]?.message ?? 'invalid extension')
    }
    return this.withRunTransition(id, async () => {
      const run = await this.requireRun(id)
      if (run.status === 'completed') {
        throw new RuntimeConflictError('completed run cannot be extended')
      }
      if (parsed.data.maxSessions <= run.maxSessions) {
        throw new RuntimeValidationError(
          `maxSessions must be greater than the current limit (${run.maxSessions})`,
        )
      }
      return this.store.updateRun(id, { maxSessions: parsed.data.maxSessions })
    })
  }

  async start(id: number): Promise<RuntimeRun> {
    return this.withRunTransition(id, async () => {
      const run = await this.requireRun(id)
      return this.launch(run, ['idle'])
    })
  }

  async resume(id: number): Promise<RuntimeRun> {
    return this.withRunTransition(id, async () => {
      const run = await this.requireRun(id)
      return this.launch(run, RESUMABLE_STATUSES)
    })
  }

  async pause(id: number): Promise<RuntimeRun> {
    return this.withRunTransition(id, async () => {
      const run = await this.requireRun(id)
      const control = this.active.get(id)
      if (!control || !ACTIVE_STATUSES.includes(run.status)) {
        throw new RuntimeConflictError('run is not active')
      }
      if (control.stopRequested) throw new RuntimeConflictError('run is stopping')
      control.pauseRequested = true
      control.wakeDelay?.()
      return this.store.updateRun(id, {
        status: 'pause_requested',
        nextStartAt: null,
        lastError: null,
      })
    })
  }

  async stop(id: number): Promise<RuntimeRun> {
    let task: Promise<void> | null = null
    const stopped = await this.withRunTransition(id, async () => {
      const run = await this.requireRun(id)
      if (run.status === 'completed') {
        throw new RuntimeConflictError('completed run cannot be stopped')
      }
      const control = this.active.get(id)
      if (!control) {
        if (ACTIVE_STATUSES.includes(run.status)) {
          throw new RuntimeConflictError('active run is not owned by this runtime')
        }
        return this.store.updateRun(id, {
          status: 'stopped',
          processId: null,
          heartbeatAt: null,
          nextStartAt: null,
          endedAt: this.now(),
        })
      }
      control.stopRequested = true
      control.abortController.abort()
      control.wakeDelay?.()
      task = control.task
      return null
    })
    if (stopped) return stopped
    await task
    return this.requireRun(id)
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true
    if (!this.shutdownPromise) this.shutdownPromise = this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    await this.runtimeLeasePending?.catch(() => undefined)
    const controls = [...this.active.values()]
    for (const control of controls) {
      control.stopRequested = true
      control.abortController.abort()
      control.wakeDelay?.()
    }
    try {
      await Promise.allSettled(controls.map((control) => control.task))
    } finally {
      const release = this.runtimeLeaseRelease
      this.runtimeLeaseRelease = null
      if (release) {
        try {
          await release()
        } catch (error) {
          this.reportBackgroundError(0, error)
        }
      }
    }
  }

  private async launch(
    run: RuntimeRun,
    allowedStatuses: RuntimeRunStatus[],
    initialDelayMs = 0,
  ): Promise<RuntimeRun> {
    if (this.shuttingDown) throw new RuntimeConflictError('runtime is shutting down')
    await this.ensureRuntimeLease()
    if (this.shuttingDown) throw new RuntimeConflictError('runtime is shutting down')
    if (!allowedStatuses.includes(run.status)) {
      throw new RuntimeConflictError(`run cannot start from status ${run.status}`)
    }
    if (this.active.has(run.id) || this.launching.has(run.id)) {
      throw new RuntimeConflictError('run is already active')
    }
    this.launching.add(run.id)
    const launchReady = createDeferred<void>()
    const control: ActiveRun = {
      workspacePath: run.workspacePath,
      abortController: new AbortController(),
      pauseRequested: false,
      stopRequested: false,
      wakeDelay: null,
      task: Promise.resolve(),
    }
    this.active.set(run.id, control)
    control.task = this.runManaged(run.id, control, initialDelayMs, launchReady.promise).catch(
      (error) => this.recoverBackgroundFailure(run.id, control, error),
    )
    try {
      return await this.reserveAndLaunch(run, initialDelayMs, launchReady)
    } catch (error) {
      launchReady.reject(error)
      await Promise.allSettled([control.task])
      throw error
    } finally {
      this.launching.delete(run.id)
    }
  }

  private async reserveAndLaunch(
    run: RuntimeRun,
    initialDelayMs: number,
    launchReady: Deferred<void>,
  ): Promise<RuntimeRun> {
    await validateRunWorkspace(run)
    const localConflict = [...this.workspaceOwners].find(
      ([workspacePath, owner]) =>
        owner !== run.id && workspacesOverlap(workspacePath, run.workspacePath),
    )
    if (localConflict) {
      throw new RuntimeConflictError(`workspace is already locked by run ${localConflict[1]}`)
    }
    this.workspaceOwners.set(run.workspacePath, run.id)
    try {
      const conflict = (await this.store.listRunsByStatuses(ACTIVE_STATUSES)).find(
        (candidate) =>
          candidate.id !== run.id && workspacesOverlap(candidate.workspacePath, run.workspacePath),
      )
      if (conflict) {
        throw new RuntimeConflictError(
          `workspace is already locked by run ${conflict.id} (${conflict.name})`,
        )
      }

      let launchedRun = run
      if (initialDelayMs <= 0) {
        launchedRun = await this.store.updateRun(run.id, {
          status: 'running',
          startedAt: run.startedAt ?? this.now(),
          endedAt: null,
          lastError: null,
          nextStartAt: null,
        })
      }
      launchReady.resolve()
      return launchedRun
    } catch (error) {
      if (this.workspaceOwners.get(run.workspacePath) === run.id) {
        this.workspaceOwners.delete(run.workspacePath)
      }
      throw error
    }
  }

  private async runManaged(
    runId: number,
    control: ActiveRun,
    initialDelayMs: number,
    launchReady: Promise<void>,
  ): Promise<void> {
    let launched = false
    try {
      await launchReady
      launched = true
      if (initialDelayMs > 0) await this.wait(control, initialDelayMs)
      await this.runLoop(runId, control)
    } catch (error) {
      if (launched) {
        const message = error instanceof Error ? error.message : String(error)
        if (control.stopRequested) {
          await this.store.finishRunningSessions(
            runId,
            'stopped',
            `Stopped while provider cleanup failed: ${message}`,
          )
        } else {
          await this.store.finishRunningSessions(runId, 'failed', message)
          await this.withRunTransition(runId, () =>
            this.store.updateRun(runId, {
              status: 'error',
              processId: null,
              heartbeatAt: null,
              nextStartAt: null,
              endedAt: this.now(),
              lastError: message,
            }),
          )
        }
      }
    } finally {
      try {
        if (control.stopRequested) {
          await this.withRunTransition(runId, () => this.markStopped(runId))
        }
      } finally {
        this.active.delete(runId)
        if (this.workspaceOwners.get(control.workspacePath) === runId) {
          this.workspaceOwners.delete(control.workspacePath)
        }
      }
    }
  }

  private async runLoop(runId: number, control: ActiveRun): Promise<void> {
    for (;;) {
      if (await this.applyPendingControl(runId, control)) return

      const run = await this.requireRun(runId)
      if (run.currentSession >= run.maxSessions) {
        await this.withRunTransition(runId, async () => {
          if (await this.applyPendingControlUnlocked(runId, control)) return
          await this.store.updateRun(runId, {
            status: 'waiting',
            processId: null,
            heartbeatAt: null,
            nextStartAt: null,
            lastError: `Session limit reached (${run.maxSessions}).`,
          })
        })
        return
      }

      const sessionNumber = run.currentSession + 1
      const rawLogPath = path.join(
        this.logRoot,
        `run-${run.id}`,
        `session-${String(sessionNumber).padStart(4, '0')}.jsonl`,
      )
      const startedAt = this.now()
      const prompt = buildSessionPrompt(run, sessionNumber)
      await prepareSessionResultFile(run)
      const missionHash = await computeMissionHash(run)
      const session = await this.withRunTransition(runId, async () => {
        if (await this.applyPendingControlUnlocked(runId, control)) return null
        return this.store.startSession(
          {
            runId,
            sessionNumber,
            provider: run.provider,
            model: run.model,
            effort: run.effort,
            prompt,
            contractVersion: GLOBAL_RUNTIME_CONTRACT_VERSION,
            missionHash,
            rawLogPath,
            startedAt,
          },
          {
            status: 'running',
            currentSession: sessionNumber,
            processId: null,
            heartbeatAt: startedAt,
            lastActivityAt: startedAt,
            nextStartAt: null,
            startedAt: run.startedAt ?? startedAt,
            endedAt: null,
            lastError: null,
          },
        )
      })
      if (!session) return

      if (control.stopRequested) {
        await this.store.updateSession(session.id, {
          status: 'stopped',
          processId: null,
          error: 'Stopped before the provider process was launched.',
          finishedAt: this.now(),
        })
        return
      }

      let lastActivityWrite = 0
      let heartbeatWrite: Promise<void> | null = null
      const updateHeartbeat = async () => {
        const at = this.now()
        await Promise.all([
          this.store.updateRun(runId, { heartbeatAt: at }),
          this.store.updateSession(session.id, { heartbeatAt: at }),
        ])
      }
      const heartbeat = setInterval(() => {
        if (heartbeatWrite) return
        heartbeatWrite = updateHeartbeat()
          .catch(() => undefined)
          .finally(() => {
            heartbeatWrite = null
          })
      }, this.heartbeatMs)
      heartbeat.unref()

      const result = await this.providers[run.provider]
        .execute(
          {
            run,
            sessionNumber,
            prompt,
            logDirectory: path.dirname(rawLogPath),
          },
          control.abortController.signal,
          {
            onStarted: async (pid) => {
              await Promise.all([
                this.store.updateRun(runId, { processId: pid }),
                this.store.updateSession(session.id, { processId: pid }),
              ])
            },
            onActivity: async (at) => {
              if (at.getTime() - lastActivityWrite < 2000) return
              lastActivityWrite = at.getTime()
              await Promise.all([
                this.store.updateRun(runId, { lastActivityAt: at }),
                this.store.updateSession(session.id, { lastActivityAt: at }),
              ])
            },
          },
        )
        .finally(async () => {
          clearInterval(heartbeat)
          await heartbeatWrite
        })

      if (control.stopRequested) {
        await this.finishSession(session, 'stopped', result, null, 'Stopped by user.')
        return
      }

      if (result.rateLimited) {
        await this.finishSession(session, 'rate_limited', result, null, result.error)
        const pausedOrStopped = await this.withRunTransition(runId, async () => {
          if (await this.applyPendingControlUnlocked(runId, control)) return true
          const nextStartAt = new Date(this.now().getTime() + this.rateLimitRetryMs)
          await this.store.updateRun(runId, {
            status: 'rate_limited',
            processId: null,
            heartbeatAt: null,
            nextStartAt,
            lastError: result.error ?? 'Provider rate limit reached.',
          })
          return false
        })
        if (pausedOrStopped) return
        await this.wait(control, this.rateLimitRetryMs)
        continue
      }

      if (result.error || result.exitCode !== 0) {
        const error = result.error ?? `CLI exited with code ${String(result.exitCode)}`
        await this.finishSession(session, 'failed', result, null, error)
        await this.withRunTransition(runId, () =>
          this.store.updateRun(runId, {
            status: 'error',
            processId: null,
            heartbeatAt: null,
            endedAt: this.now(),
            lastError: error,
          }),
        )
        return
      }

      let controlResult: unknown = null
      try {
        controlResult = await readSessionResultFile(run)
      } catch {
        // Missing, unreadable, or invalid JSON is handled by the safe waiting path below.
      }
      const parsed = sessionResultSchema.safeParse(controlResult)
      if (!parsed.success) {
        const error = 'Provider did not return a valid Global Runtime session result.'
        await this.finishSession(session, 'invalid_result', result, null, error)
        await this.withRunTransition(runId, () =>
          this.store.updateRun(runId, {
            status: 'waiting',
            processId: null,
            heartbeatAt: null,
            lastError: error,
          }),
        )
        return
      }

      const sessionStatus = parsed.data.action === 'wait' ? 'waiting' : 'completed'
      await this.finishSession(session, sessionStatus, result, parsed.data, null)
      const terminal = await this.withRunTransition(runId, async () => {
        if (parsed.data.action === 'complete') {
          await this.store.updateRun(runId, {
            status: 'completed',
            processId: null,
            heartbeatAt: null,
            nextStartAt: null,
            endedAt: this.now(),
            lastResultSummary: parsed.data.summary,
          })
          return true
        }
        if (parsed.data.action === 'wait') {
          await this.store.updateRun(runId, {
            status: 'waiting',
            processId: null,
            heartbeatAt: null,
            nextStartAt: null,
            lastResultSummary: parsed.data.summary,
          })
          return true
        }
        await this.store.updateRun(runId, {
          processId: null,
          heartbeatAt: null,
          lastResultSummary: parsed.data.summary,
        })
        return this.applyPendingControlUnlocked(runId, control)
      })
      if (terminal) return
      // Re-read the run so an extension applied during this session takes effect immediately.
      const limitReached = await this.withRunTransition(runId, async () => {
        if (await this.applyPendingControlUnlocked(runId, control)) return true
        const latest = await this.requireRun(runId)
        if (sessionNumber < latest.maxSessions) return false
        await this.store.updateRun(runId, {
          status: 'waiting',
          processId: null,
          heartbeatAt: null,
          nextStartAt: null,
          lastError: `Session limit reached (${latest.maxSessions}).`,
        })
        return true
      })
      if (limitReached) return
      await this.wait(control, run.delaySeconds * 1000)
    }
  }

  private async finishSession(
    session: RuntimeSession,
    status: RuntimeSession['status'],
    result: Awaited<ReturnType<ProviderAdapter['execute']>>,
    parsed: { action: RuntimeSession['action']; summary: string } | null,
    error: string | null,
  ): Promise<void> {
    await this.store.updateSession(session.id, {
      status,
      processId: null,
      action: parsed?.action ?? null,
      summary: parsed?.summary ?? null,
      error,
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
      resolvedModel: result.resolvedModel,
      ...result.usage,
      finishedAt: this.now(),
    })
  }

  private async markPaused(runId: number): Promise<void> {
    await this.store.updateRun(runId, {
      status: 'paused',
      processId: null,
      heartbeatAt: null,
      nextStartAt: null,
    })
  }

  private async markStopped(runId: number): Promise<void> {
    await this.store.updateRun(runId, {
      status: 'stopped',
      processId: null,
      heartbeatAt: null,
      nextStartAt: null,
      endedAt: this.now(),
    })
  }

  private async applyPendingControl(runId: number, control: ActiveRun): Promise<boolean> {
    return this.withRunTransition(runId, () => this.applyPendingControlUnlocked(runId, control))
  }

  private async applyPendingControlUnlocked(runId: number, control: ActiveRun): Promise<boolean> {
    if (control.stopRequested) {
      return true
    }
    if (control.pauseRequested) {
      await this.markPaused(runId)
      return true
    }
    return false
  }

  private wait(control: ActiveRun, delayMs: number): Promise<void> {
    if (delayMs <= 0 || control.stopRequested || control.pauseRequested) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(finish, delayMs)
      timer.unref()
      function finish() {
        clearTimeout(timer)
        control.wakeDelay = null
        resolve()
      }
      control.wakeDelay = finish
    })
  }

  private async requireRun(id: number): Promise<RuntimeRun> {
    const run = await this.store.getRun(id)
    if (!run) throw new RuntimeNotFoundError(`runtime run ${id} was not found`)
    return run
  }

  private async ensureRuntimeLease(): Promise<void> {
    if (this.runtimeLeaseRelease) return
    if (!this.runtimeLeasePending) {
      this.runtimeLeasePending = (async () => {
        const release = await this.store.acquireRuntimeLease((error) => {
          const leaseError = new Error('Global Runtime database lease was lost', { cause: error })
          this.reportBackgroundError(0, leaseError)
          try {
            this.onFatalError?.(leaseError)
          } catch (callbackError) {
            this.reportBackgroundError(
              0,
              new AggregateError(
                [leaseError, callbackError],
                'Global Runtime fatal-error callback failed',
              ),
            )
          }
          void this.shutdown().catch((shutdownError: unknown) => {
            this.reportBackgroundError(0, shutdownError)
          })
        })
        if (!release) {
          throw new RuntimeConflictError('another Global Runtime instance already owns this store')
        }
        this.runtimeLeaseRelease = release
      })().finally(() => {
        this.runtimeLeasePending = null
      })
    }
    await this.runtimeLeasePending
  }

  private async recoverBackgroundFailure(
    runId: number,
    control: ActiveRun,
    error: unknown,
  ): Promise<void> {
    let reportedError = error
    const message = error instanceof Error ? error.message : String(error)
    try {
      if (control.stopRequested) {
        await this.store.finishRunningSessions(runId, 'stopped', message)
        await this.withRunTransition(runId, () => this.markStopped(runId))
      } else {
        await this.store.finishRunningSessions(runId, 'failed', message)
        await this.withRunTransition(runId, () =>
          this.store.updateRun(runId, {
            status: 'error',
            processId: null,
            heartbeatAt: null,
            nextStartAt: null,
            endedAt: this.now(),
            lastError: message,
          }),
        )
      }
    } catch (recoveryError) {
      reportedError = new AggregateError(
        [error, recoveryError],
        'Global Runtime task and its persistence recovery both failed',
      )
    }
    this.reportBackgroundError(runId, reportedError)
  }

  private reportBackgroundError(runId: number, error: unknown): void {
    try {
      this.onBackgroundError(runId, error)
    } catch {
      // Reporting must never recreate the unhandled rejection being reported.
    }
  }

  private async withRunTransition<T>(id: number, action: () => Promise<T>): Promise<T> {
    const previous = this.runTransitions.get(id) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.runTransitions.set(id, current)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.runTransitions.get(id) === current) this.runTransitions.delete(id)
    }
  }
}

function totalUsage(sessions: RuntimeSession[]): TokenUsage {
  return {
    inputTokens: sumTokens(sessions, 'inputTokens'),
    cachedInputTokens: sumTokens(sessions, 'cachedInputTokens'),
    cacheReadInputTokens: sumTokens(sessions, 'cacheReadInputTokens'),
    cacheCreationInputTokens: sumTokens(sessions, 'cacheCreationInputTokens'),
    outputTokens: sumTokens(sessions, 'outputTokens'),
    reasoningOutputTokens: sumTokens(sessions, 'reasoningOutputTokens'),
    estimatedApiCostUsd: sumTokens(sessions, 'estimatedApiCostUsd'),
  }
}

function sumTokens(sessions: RuntimeSession[], key: keyof TokenUsage): number | null {
  const values = sessions
    .map((session) => session[key])
    .filter((value): value is number => value !== null)
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
}

function asValidationRun(input: CreateRuntimeRunInput): RuntimeRun {
  const now = new Date(0)
  return {
    ...input,
    id: 0,
    status: 'idle',
    currentSession: 0,
    processId: null,
    heartbeatAt: null,
    lastActivityAt: null,
    nextStartAt: null,
    startedAt: null,
    endedAt: null,
    lastError: null,
    lastResultSummary: null,
    createdAt: now,
    updatedAt: now,
  }
}

function workspacesOverlap(first: string, second: string): boolean {
  return isSameOrAncestor(first, second) || isSameOrAncestor(second, first)
}

function isSameOrAncestor(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function processHasRuntimeToken(pid: number, expectedToken: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform === 'win32') return false
  const marker = `${RUNTIME_PROCESS_TOKEN_ENV}=${expectedToken}`

  if (process.platform === 'linux') {
    try {
      const environment = await readFile(`/proc/${pid}/environ`)
      return environment.toString('utf8').split('\0').includes(marker)
    } catch {
      return false
    }
  }

  return new Promise((resolve) => {
    execFile(
      'ps',
      ['eww', '-p', String(pid), '-o', 'command='],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(!error && stdout.split(/\s+/u).includes(marker)),
    )
  })
}

async function terminatePersistedProcess(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  if (!sendProcessSignal(pid, 'SIGTERM')) return

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!sendProcessSignal(pid, 0)) return
  }
  sendProcessSignal(pid, 'SIGKILL')
}

function sendProcessSignal(pid: number, signal: NodeJS.Signals | 0): boolean {
  const target = process.platform === 'win32' ? pid : -pid
  try {
    process.kill(target, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
