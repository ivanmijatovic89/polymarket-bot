import path from 'node:path'
import { buildSessionPrompt } from './contracts.js'
import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js'
import { CliProviderAdapter, type ProviderAdapter } from './providers.js'
import type { RuntimeStore } from './store.js'
import {
  appendInboxSchema,
  createRuntimeRunSchema,
  sessionResultSchema,
  type CreateRuntimeRunInput,
  type RuntimeFilesResponse,
  type RuntimeProvider,
  type RuntimeRun,
  type RuntimeRunDetail,
  type RuntimeRunStatus,
  type RuntimeSession,
  type TokenUsage,
} from './types.js'
import {
  appendInboxEntry,
  canonicalWorkspace,
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

export interface GlobalRuntimeOptions {
  logRoot?: string
  rateLimitRetryMs?: number
  heartbeatMs?: number
  providers?: Partial<Record<RuntimeProvider, ProviderAdapter>>
  now?: () => Date
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
  }

  async initialize(): Promise<void> {
    const interrupted = await this.store.listRunsByStatuses(['running', 'pause_requested'])
    for (const run of interrupted) {
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
        lastError: 'Runtime restarted. Review the last session and resume when ready.',
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

  listRuns(): Promise<RuntimeRun[]> {
    return this.store.listRuns()
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

  async start(id: number): Promise<RuntimeRun> {
    const run = await this.requireRun(id)
    return this.launch(run, ['idle'])
  }

  async resume(id: number): Promise<RuntimeRun> {
    const run = await this.requireRun(id)
    return this.launch(run, RESUMABLE_STATUSES)
  }

  async pause(id: number): Promise<RuntimeRun> {
    const run = await this.requireRun(id)
    const control = this.active.get(id)
    if (!control || !ACTIVE_STATUSES.includes(run.status)) {
      throw new RuntimeConflictError('run is not active')
    }
    control.pauseRequested = true
    control.wakeDelay?.()
    return this.store.updateRun(id, {
      status: 'pause_requested',
      nextStartAt: null,
      lastError: null,
    })
  }

  async stop(id: number): Promise<RuntimeRun> {
    const run = await this.requireRun(id)
    const control = this.active.get(id)
    if (!control) {
      if (run.status === 'completed')
        throw new RuntimeConflictError('completed run cannot be stopped')
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
    return this.store.updateRun(id, { status: 'stopped', nextStartAt: null })
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const controls = [...this.active.values()]
    for (const control of controls) {
      control.stopRequested = true
      control.abortController.abort()
      control.wakeDelay?.()
    }
    await Promise.allSettled(controls.map((control) => control.task))
  }

  private async launch(
    run: RuntimeRun,
    allowedStatuses: RuntimeRunStatus[],
    initialDelayMs = 0,
  ): Promise<RuntimeRun> {
    if (this.shuttingDown) throw new RuntimeConflictError('runtime is shutting down')
    if (!allowedStatuses.includes(run.status)) {
      throw new RuntimeConflictError(`run cannot start from status ${run.status}`)
    }
    if (this.active.has(run.id) || this.launching.has(run.id)) {
      throw new RuntimeConflictError('run is already active')
    }
    this.launching.add(run.id)
    try {
      return await this.reserveAndLaunch(run, initialDelayMs)
    } finally {
      this.launching.delete(run.id)
    }
  }

  private async reserveAndLaunch(run: RuntimeRun, initialDelayMs: number): Promise<RuntimeRun> {
    await validateRunWorkspace(run)
    const localOwner = this.workspaceOwners.get(run.workspacePath)
    if (localOwner !== undefined && localOwner !== run.id) {
      throw new RuntimeConflictError(`workspace is already locked by run ${localOwner}`)
    }
    this.workspaceOwners.set(run.workspacePath, run.id)
    try {
      const conflict = await this.store.findWorkspaceConflict(run.workspacePath, run.id)
      if (conflict) {
        throw new RuntimeConflictError(
          `workspace is already locked by run ${conflict.id} (${conflict.name})`,
        )
      }
    } catch (error) {
      if (this.workspaceOwners.get(run.workspacePath) === run.id) {
        this.workspaceOwners.delete(run.workspacePath)
      }
      throw error
    }

    const control: ActiveRun = {
      workspacePath: run.workspacePath,
      abortController: new AbortController(),
      pauseRequested: false,
      stopRequested: false,
      wakeDelay: null,
      task: Promise.resolve(),
    }
    this.active.set(run.id, control)
    control.task = this.runManaged(run.id, control, initialDelayMs)

    if (initialDelayMs > 0) return run
    return this.store.updateRun(run.id, {
      status: 'running',
      startedAt: run.startedAt ?? this.now(),
      endedAt: null,
      lastError: null,
      nextStartAt: null,
    })
  }

  private async runManaged(
    runId: number,
    control: ActiveRun,
    initialDelayMs: number,
  ): Promise<void> {
    try {
      if (initialDelayMs > 0) await this.wait(control, initialDelayMs)
      await this.runLoop(runId, control)
    } catch (error) {
      if (!control.stopRequested) {
        const message = error instanceof Error ? error.message : String(error)
        await this.store.finishRunningSessions(runId, 'failed', message)
        await this.store.updateRun(runId, {
          status: 'error',
          processId: null,
          heartbeatAt: null,
          nextStartAt: null,
          endedAt: this.now(),
          lastError: message,
        })
      }
    } finally {
      this.active.delete(runId)
      if (this.workspaceOwners.get(control.workspacePath) === runId) {
        this.workspaceOwners.delete(control.workspacePath)
      }
    }
  }

  private async runLoop(runId: number, control: ActiveRun): Promise<void> {
    for (;;) {
      if (control.stopRequested) {
        await this.markStopped(runId)
        return
      }
      if (control.pauseRequested) {
        await this.markPaused(runId)
        return
      }

      const run = await this.requireRun(runId)
      if (run.currentSession >= run.maxSessions) {
        await this.store.updateRun(runId, {
          status: 'waiting',
          processId: null,
          heartbeatAt: null,
          nextStartAt: null,
          lastError: `Session limit reached (${run.maxSessions}).`,
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
      const session = await this.store.createSession({
        runId,
        sessionNumber,
        provider: run.provider,
        model: run.model,
        effort: run.effort,
        rawLogPath,
        startedAt,
      })
      await prepareSessionResultFile(run)
      await this.store.updateRun(runId, {
        status: 'running',
        currentSession: sessionNumber,
        processId: null,
        heartbeatAt: startedAt,
        lastActivityAt: startedAt,
        nextStartAt: null,
        startedAt: run.startedAt ?? startedAt,
        endedAt: null,
        lastError: null,
      })

      let lastActivityWrite = 0
      const updateHeartbeat = async () => {
        const at = this.now()
        await Promise.all([
          this.store.updateRun(runId, { heartbeatAt: at }),
          this.store.updateSession(session.id, { heartbeatAt: at }),
        ])
      }
      const heartbeat = setInterval(
        () => void updateHeartbeat().catch(() => undefined),
        this.heartbeatMs,
      )
      heartbeat.unref()

      const result = await this.providers[run.provider]
        .execute(
          {
            run,
            sessionNumber,
            prompt: buildSessionPrompt(run, sessionNumber),
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
        .finally(() => clearInterval(heartbeat))

      if (control.stopRequested) {
        await this.finishSession(session, 'stopped', result, null, 'Stopped by user.')
        await this.markStopped(runId)
        return
      }

      if (result.rateLimited) {
        await this.finishSession(session, 'rate_limited', result, null, result.error)
        const nextStartAt = new Date(this.now().getTime() + this.rateLimitRetryMs)
        await this.store.updateRun(runId, {
          status: 'rate_limited',
          processId: null,
          heartbeatAt: null,
          nextStartAt,
          lastError: result.error ?? 'Provider rate limit reached.',
        })
        await this.wait(control, this.rateLimitRetryMs)
        continue
      }

      if (result.error || result.exitCode !== 0) {
        const error = result.error ?? `CLI exited with code ${String(result.exitCode)}`
        await this.finishSession(session, 'failed', result, null, error)
        await this.store.updateRun(runId, {
          status: 'error',
          processId: null,
          heartbeatAt: null,
          endedAt: this.now(),
          lastError: error,
        })
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
        await this.store.updateRun(runId, {
          status: 'waiting',
          processId: null,
          heartbeatAt: null,
          lastError: error,
        })
        return
      }

      const sessionStatus = parsed.data.action === 'wait' ? 'waiting' : 'completed'
      await this.finishSession(session, sessionStatus, result, parsed.data, null)
      await this.store.updateRun(runId, {
        processId: null,
        heartbeatAt: null,
        lastResultSummary: parsed.data.summary,
      })

      if (parsed.data.action === 'complete') {
        await this.store.updateRun(runId, { status: 'completed', endedAt: this.now() })
        return
      }
      if (parsed.data.action === 'wait') {
        await this.store.updateRun(runId, { status: 'waiting', nextStartAt: null })
        return
      }
      if (control.pauseRequested) {
        await this.markPaused(runId)
        return
      }
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

  private wait(control: ActiveRun, delayMs: number): Promise<void> {
    if (delayMs <= 0) return Promise.resolve()
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
}

function totalUsage(sessions: RuntimeSession[]): TokenUsage {
  return {
    inputTokens: sumTokens(sessions, 'inputTokens'),
    cachedInputTokens: sumTokens(sessions, 'cachedInputTokens'),
    outputTokens: sumTokens(sessions, 'outputTokens'),
    reasoningOutputTokens: sumTokens(sessions, 'reasoningOutputTokens'),
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
