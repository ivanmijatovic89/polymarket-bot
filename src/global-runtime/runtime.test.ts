import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { link, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { RuntimeConflictError, RuntimeValidationError } from './errors.js'
import { MemoryRuntimeStore } from './memoryStore.js'
import type {
  ProviderAdapter,
  ProviderExecutionCallbacks,
  ProviderExecutionContext,
  ProviderExecutionResult,
} from './providers.js'
import { GlobalRuntime, type GlobalRuntimeOptions } from './runtime.js'
import {
  buildRuntimeProcessToken,
  RUNTIME_PROCESS_TOKEN_ENV,
  SESSION_RESULT_FILE,
} from './contracts.js'
import type { RuntimeRunPatch, RuntimeSessionPatch } from './types.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 }),
      ),
  )
})

test('runs fresh sessions until the provider reports completion', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([
    successfulResult('continue', 'first milestone', 10),
    successfulResult('complete', 'mission complete', 20),
  ])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.run.currentSession, 2)
  assert.equal(detail.run.lastResultSummary, 'mission complete')
  assert.deepEqual(provider.sessionNumbers, [1, 2])
  assert.equal(detail.totals.inputTokens, 30)

  const [summary] = await runtime.listRuns()
  assert.equal(summary?.resolvedModel, 'test-model')
  assert.equal(summary?.totals.inputTokens, 30)
})

test('pause is applied between sessions and resume starts a fresh session', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([
    successfulResult('continue', 'checkpoint', 1),
    successfulResult('complete', 'done after resume', 1),
  ])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun({ ...runInput(workspace), delaySeconds: 60 })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.currentSession === 1)
  await runtime.pause(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'paused')
  assert.equal(provider.sessionNumbers.length, 1)

  await runtime.resume(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')
  assert.deepEqual(provider.sessionNumbers, [1, 2])
})

test('pause cannot overwrite a concurrently completed terminal state', async () => {
  const workspace = await createWorkspace()
  const store = new DelayedCompletionStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'done', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await store.waitForCompletionWrite()
  const pause = runtime.pause(run.id)
  store.releaseCompletionWrite()

  await assert.rejects(pause, RuntimeConflictError)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')
  assert.equal((await store.getRun(run.id))?.status, 'completed')
})

test('stop cannot overwrite a concurrently completed terminal state', async () => {
  const workspace = await createWorkspace()
  const store = new DelayedSessionCompletionStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'done', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await store.waitForSessionCompletionWrite()
  const stop = runtime.stop(run.id)
  await new Promise((resolve) => setImmediate(resolve))
  store.releaseSessionCompletionWrite()

  const stopped = await stop
  assert.equal(stopped.status, 'completed')
  const persisted = await store.getRun(run.id)
  assert.equal(persisted?.status, 'completed')
  assert.equal(persisted?.lastResultSummary, 'done')
})

test('persists the running state before launching the provider task', async () => {
  const workspace = await createWorkspace()
  const store = new DelayedLaunchStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'done', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  const start = runtime.start(run.id)
  await store.waitForLaunchWrite()
  assert.deepEqual(provider.sessionNumbers, [])

  store.releaseLaunchWrite()
  await start
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')
  assert.deepEqual(provider.sessionNumbers, [1])
})

test('stop cancels a launch while the running state is being persisted', async () => {
  const workspace = await createWorkspace()
  const store = new DelayedLaunchStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'must not run', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  const start = runtime.start(run.id)
  await store.waitForLaunchWrite()
  const stop = runtime.stop(run.id)
  await new Promise((resolve) => setImmediate(resolve))
  store.releaseLaunchWrite()

  const [, stopped] = await Promise.all([start, stop])
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(provider.sessionNumbers, [])
  assert.equal((await store.getRun(run.id))?.status, 'stopped')
  assert.equal((await store.listSessions(run.id)).length, 0)
})

test('stop remains recoverable until the provider process has exited', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new SlowStoppingProvider()
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await provider.waitForStart()
  const stop = runtime.stop(run.id)
  await provider.waitForAbort()

  const stopping = await runtime.getRunDetail(run.id)
  assert.equal(stopping.run.status, 'running')
  assert.equal(stopping.run.processId, 12347)
  assert.equal(stopping.sessions[0]?.status, 'running')

  provider.release()
  const stopped = await stop
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.processId, null)
  assert.equal((await runtime.getRunDetail(run.id)).sessions[0]?.status, 'stopped')
})

test('stop finalizes a running session when provider cancellation throws', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ThrowingOnAbortProvider()
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await provider.waitForStart()
  const stopped = await runtime.stop(run.id)

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(stopped.status, 'stopped')
  assert.equal(detail.sessions[0]?.status, 'stopped')
  assert.ok(detail.sessions[0]?.finishedAt)
  assert.match(detail.sessions[0]?.error ?? '', /provider cleanup failed/iu)
})

test('moves directly to waiting when the final allowed session requests continuation', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([successfulResult('continue', 'more work remains', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun({
    ...runInput(workspace),
    maxSessions: 1,
    delaySeconds: 60,
  })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'waiting')

  const persisted = await store.getRun(run.id)
  assert.equal(persisted?.currentSession, 1)
  assert.match(persisted?.lastError ?? '', /session limit reached/iu)
})

test('extend raises the session limit and resume continues the same run', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([
    successfulResult('continue', 'first checkpoint', 1),
    successfulResult('complete', 'done after extension', 1),
  ])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun({ ...runInput(workspace), maxSessions: 1 })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'waiting')

  const extended = await runtime.extendMaxSessions(run.id, { maxSessions: 2 })
  assert.equal(extended.maxSessions, 2)

  await runtime.resume(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.run.currentSession, 2)
  assert.equal(detail.sessions.length, 2)
  assert.deepEqual(provider.sessionNumbers, [1, 2])
})

test('extend rejects limits that do not raise the current maximum', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))
  const run = await runtime.createRun({ ...runInput(workspace), maxSessions: 3 })

  await assert.rejects(
    runtime.extendMaxSessions(run.id, { maxSessions: 3 }),
    RuntimeValidationError,
  )
  await assert.rejects(
    runtime.extendMaxSessions(run.id, { maxSessions: 0 }),
    RuntimeValidationError,
  )
  await assert.rejects(
    runtime.extendMaxSessions(run.id, { maxSessions: 4, extra: true }),
    RuntimeValidationError,
  )
  assert.equal((await store.getRun(run.id))?.maxSessions, 3)
})

test('extend rejects a completed run', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'done', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')

  await assert.rejects(runtime.extendMaxSessions(run.id, { maxSessions: 10 }), RuntimeConflictError)
})

test('applies a pending pause before entering the rate-limit retry delay', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new BlockingRateLimitedProvider()
  const runtime = createRuntime(store, provider, { rateLimitRetryMs: 60_000 })
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(() => Promise.resolve(provider.started))
  await runtime.pause(run.id)
  provider.release()
  await waitFor(async () => (await store.getRun(run.id))?.status === 'paused')

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.sessions[0]?.status, 'rate_limited')
})

test('only one active run can own a workspace', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new BlockingProvider()
  const runtime = createRuntime(store, provider)
  const first = await runtime.createRun(runInput(workspace, 'first'))
  const second = await runtime.createRun(runInput(workspace, 'second'))

  await runtime.start(first.id)
  await waitFor(() => Promise.resolve(provider.started))
  await assert.rejects(() => runtime.start(second.id), RuntimeConflictError)
  await runtime.stop(first.id)
  await runtime.shutdown()
})

test('workspace lock is race-safe for simultaneous start requests', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new BlockingProvider()
  const runtime = createRuntime(store, provider)
  const first = await runtime.createRun(runInput(workspace, 'first'))
  const second = await runtime.createRun(runInput(workspace, 'second'))

  const results = await Promise.allSettled([runtime.start(first.id), runtime.start(second.id)])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const active = (await store.listRuns()).find((run) => run.status === 'running')
  assert.ok(active)
  await runtime.stop(active.id)
  await runtime.shutdown()
})

test('a store lease prevents separate runtime instances from launching concurrently', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const firstRuntime = createRuntime(store, new BlockingProvider())
  const secondRuntime = createRuntime(store, new BlockingProvider())
  const first = await firstRuntime.createRun(runInput(workspace, 'first'))
  const second = await secondRuntime.createRun(runInput(workspace, 'second'))

  await firstRuntime.start(first.id)
  await assert.rejects(() => secondRuntime.start(second.id), RuntimeConflictError)

  await firstRuntime.stop(first.id)
  await firstRuntime.shutdown()
  await secondRuntime.start(second.id)
  await secondRuntime.stop(second.id)
  await secondRuntime.shutdown()
})

test('shutdown releases a lease acquisition that is still pending', async () => {
  const workspace = await createWorkspace()
  const store = new DelayedLeaseStore()
  const firstRuntime = createRuntime(store, new BlockingProvider())
  const first = await firstRuntime.createRun(runInput(workspace, 'first'))

  const start = firstRuntime.start(first.id)
  await store.waitForLeaseRequest()
  const shutdown = firstRuntime.shutdown()
  store.releaseLeaseRequest()

  await assert.rejects(start, RuntimeConflictError)
  await shutdown

  const secondRuntime = createRuntime(store, new BlockingProvider())
  const second = await secondRuntime.createRun(runInput(workspace, 'second'))
  await secondRuntime.start(second.id)
  await secondRuntime.stop(second.id)
  await secondRuntime.shutdown()
})

test('lease loss invokes the fatal handler and permanently shuts down the runtime', async () => {
  const workspace = await createWorkspace()
  const store = new ControllableLeaseStore()
  let fatalError: unknown = null
  const runtime = createRuntime(store, new BlockingProvider(), {
    onBackgroundError: () => undefined,
    onFatalError: (error) => {
      fatalError = error
    },
  })
  const run = await runtime.createRun(runInput(workspace))

  await runtime.initialize()
  store.loseLease()
  await waitFor(() => Promise.resolve(fatalError !== null))

  assert.match(String(fatalError), /database lease was lost/iu)
  await assert.rejects(() => runtime.start(run.id), /runtime is shutting down/iu)
  await runtime.shutdown()
})

test('workspace lock rejects overlapping parent and child workspaces', async () => {
  const workspace = await createWorkspace()
  const nestedWorkspace = path.join(workspace, 'nested')
  await mkdir(nestedWorkspace)
  await writeFile(path.join(nestedWorkspace, 'MISSION.md'), '# Nested mission\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const provider = new BlockingProvider()
  const runtime = createRuntime(store, provider)
  const parent = await runtime.createRun(runInput(workspace, 'parent'))
  const nested = await runtime.createRun(runInput(nestedWorkspace, 'nested'))

  await runtime.start(parent.id)
  await waitFor(() => Promise.resolve(provider.started))
  await assert.rejects(() => runtime.start(nested.id), RuntimeConflictError)
  await runtime.stop(parent.id)
  await runtime.shutdown()
})

test('workspace lock rejects overlap with a persisted active owner', async () => {
  const workspace = await createWorkspace()
  const nestedWorkspace = path.join(workspace, 'nested')
  await mkdir(nestedWorkspace)
  await writeFile(path.join(nestedWorkspace, 'MISSION.md'), '# Nested mission\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new BlockingProvider())
  const parent = await runtime.createRun(runInput(workspace, 'persisted parent'))
  await store.updateRun(parent.id, { status: 'running' })
  const nested = await runtime.createRun(runInput(nestedWorkspace, 'nested'))

  await assert.rejects(() => runtime.start(nested.id), RuntimeConflictError)
  assert.equal((await store.getRun(nested.id))?.status, 'idle')
})

test('the same run cannot be launched twice by simultaneous requests', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new BlockingProvider())
  const run = await runtime.createRun(runInput(workspace))

  const results = await Promise.allSettled([runtime.start(run.id), runtime.start(run.id)])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  await runtime.stop(run.id)
  await runtime.shutdown()
})

test('initialization reconciles an interrupted session to waiting', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const run = await store.createRun(runRecord(workspace))
  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'running', currentSession: 1, processId: 43210 })
  await store.createSession({
    runId: run.id,
    sessionNumber: 1,
    provider: run.provider,
    model: run.model,
    effort: run.effort,
    prompt: 'test prompt',
    contractVersion: 1,
    missionHash: null,
    rawLogPath: 'test.jsonl',
    startedAt,
  })

  const terminatedProcessIds: number[] = []
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    verifyProcess: (processId, expectedToken) => {
      assert.equal(processId, 43210)
      assert.equal(expectedToken, `run-${run.id}-session-1`)
      return Promise.resolve(true)
    },
    terminateProcess: (processId) => {
      terminatedProcessIds.push(processId)
      return Promise.resolve()
    },
  })
  await runtime.initialize()

  const detail = await runtime.getRunDetail(run.id)
  assert.deepEqual(terminatedProcessIds, [43210])
  assert.equal(detail.run.status, 'waiting')
  assert.equal(detail.sessions[0]?.status, 'failed')
  assert.match(detail.run.lastError ?? '', /restarted/iu)
})

test('does not terminate an interrupted PID when process identity cannot be verified', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const run = await store.createRun(runRecord(workspace))
  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'running', currentSession: 1, processId: 43210 })
  await store.createSession({
    runId: run.id,
    sessionNumber: 1,
    provider: run.provider,
    model: run.model,
    effort: run.effort,
    prompt: 'test prompt',
    contractVersion: 1,
    missionHash: null,
    rawLogPath: 'test.jsonl',
    startedAt,
  })

  const terminatedProcessIds: number[] = []
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    verifyProcess: () => Promise.resolve(false),
    terminateProcess: (processId) => {
      terminatedProcessIds.push(processId)
      return Promise.resolve()
    },
  })
  await runtime.initialize()

  assert.deepEqual(terminatedProcessIds, [])
  const recovered = await store.getRun(run.id)
  assert.equal(recovered?.status, 'waiting')
  assert.match(recovered?.lastError ?? '', /could not be verified/iu)
})

test('initialization finishes a stopped run that still has a live session', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const run = await store.createRun(runRecord(workspace))
  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'stopped', currentSession: 1, processId: 43211 })
  await store.createSession({
    runId: run.id,
    sessionNumber: 1,
    provider: run.provider,
    model: run.model,
    effort: run.effort,
    prompt: 'test prompt',
    contractVersion: 1,
    missionHash: null,
    rawLogPath: 'test.jsonl',
    startedAt,
  })

  const terminatedProcessIds: number[] = []
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    verifyProcess: () => Promise.resolve(true),
    terminateProcess: (processId) => {
      terminatedProcessIds.push(processId)
      return Promise.resolve()
    },
  })
  await runtime.initialize()

  const detail = await runtime.getRunDetail(run.id)
  assert.deepEqual(terminatedProcessIds, [43211])
  assert.equal(detail.run.status, 'stopped')
  assert.equal(detail.run.processId, null)
  assert.equal(detail.sessions[0]?.status, 'stopped')
})

test('initialization marks an unrelaunchable rate-limited run as error instead of failing startup', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))
  const run = await runtime.createRun(runInput(workspace))
  await store.updateRun(run.id, { status: 'rate_limited', nextStartAt: new Date() })
  await rm(workspace, { recursive: true, force: true })

  await runtime.initialize()

  const recovered = await store.getRun(run.id)
  assert.equal(recovered?.status, 'error')
  assert.match(recovered?.lastError ?? '', /could not restart/iu)
})

test('stopping an already-stopped run does not rewrite its recorded end time', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))
  const run = await runtime.createRun(runInput(workspace))
  const endedAt = new Date(Date.now() - 60_000)
  await store.updateRun(run.id, { status: 'stopped', endedAt })

  const stopped = await runtime.stop(run.id)

  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.endedAt?.getTime(), endedAt.getTime())
})

test('effort validation is provider-specific for ultracode and ultra', async () => {
  const workspace = await createWorkspace()
  const runtime = createRuntime(new MemoryRuntimeStore(), new ScriptedProvider([]))

  const claudeUltracode = await runtime.createRun({
    ...runInput(workspace, 'claude ultracode'),
    provider: 'claude',
    effort: 'ultracode',
  })
  assert.equal(claudeUltracode.effort, 'ultracode')

  await assert.rejects(
    runtime.createRun({ ...runInput(workspace, 'codex ultracode'), effort: 'ultracode' }),
    RuntimeValidationError,
  )
  await assert.rejects(
    runtime.createRun({
      ...runInput(workspace, 'claude ultra'),
      provider: 'claude',
      effort: 'ultra',
    }),
    RuntimeValidationError,
  )
})

test('stopping an errored run leaves its error state untouched', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))
  const run = await runtime.createRun(runInput(workspace))
  const endedAt = new Date(Date.now() - 60_000)
  await store.updateRun(run.id, { status: 'error', endedAt, lastError: 'CLI exploded' })

  const stopped = await runtime.stop(run.id)

  assert.equal(stopped.status, 'error')
  assert.equal(stopped.endedAt?.getTime(), endedAt.getTime())
  assert.equal(stopped.lastError, 'CLI exploded')
})

test(
  'verifies the runtime token before terminating an interrupted process',
  { skip: process.platform === 'win32' },
  async () => {
    const workspace = await createWorkspace()
    const store = new MemoryRuntimeStore()
    const run = await store.createRun(runRecord(workspace))
    const token = buildRuntimeProcessToken(run.id, 1)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: { ...process.env, [RUNTIME_PROCESS_TOKEN_ENV]: token },
      stdio: 'ignore',
    })
    await once(child, 'spawn')
    assert.ok(child.pid)

    try {
      const startedAt = new Date()
      await store.updateRun(run.id, {
        status: 'running',
        currentSession: 1,
        processId: child.pid,
      })
      await store.createSession({
        runId: run.id,
        sessionNumber: 1,
        provider: run.provider,
        model: run.model,
        effort: run.effort,
        prompt: 'test prompt',
        contractVersion: 1,
        missionHash: null,
        rawLogPath: 'test.jsonl',
        startedAt,
      })

      const terminatedProcessIds: number[] = []
      const runtime = createRuntime(store, new ScriptedProvider([]), {
        terminateProcess: (processId) => {
          terminatedProcessIds.push(processId)
          return Promise.resolve()
        },
      })
      await runtime.initialize()

      assert.deepEqual(terminatedProcessIds, [child.pid])
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  },
)

test('missing session result pauses safely for human attention', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'ignored', 1)], false)
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'waiting')

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.sessions[0]?.status, 'invalid_result')
  assert.match(detail.run.lastError ?? '', /valid Global Runtime session result/iu)
})

test('provider crashes are persisted on the run and session', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ThrowingProvider())
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'error')

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.sessions[0]?.status, 'failed')
  assert.match(detail.sessions[0]?.error ?? '', /fake provider crash/iu)
})

test('background persistence failures are observed instead of becoming unhandled', async () => {
  const workspace = await createWorkspace()
  const store = new FailingErrorPersistenceStore()
  let observed: unknown = null
  const runtime = createRuntime(store, new ThrowingProvider(), {
    onBackgroundError: (_runId, error) => {
      observed = error
    },
  })
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(() => Promise.resolve(observed !== null))

  assert.ok(observed instanceof AggregateError)
  assert.ok(observed.errors.some((error) => /database unavailable/iu.test(String(error))))
  await runtime.shutdown()
})

test('a result-path preparation failure does not consume or poison a session number', async () => {
  const workspace = await createWorkspace()
  const resultDirectory = path.join(workspace, '.global-runtime')
  await writeFile(resultDirectory, 'blocks directory creation', 'utf8')
  const store = new MemoryRuntimeStore()
  const provider = new ScriptedProvider([successfulResult('complete', 'recovered', 1)])
  const runtime = createRuntime(store, provider)
  const run = await runtime.createRun(runInput(workspace))

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'error')

  let detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.run.currentSession, 0)
  assert.equal(detail.sessions.length, 0)

  await rm(resultDirectory)
  await runtime.resume(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'completed')

  detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.run.currentSession, 1)
  assert.equal(detail.sessions.length, 1)
  assert.equal(detail.sessions[0]?.sessionNumber, 1)
})

test('rejects runtime file roles that overlap each other or the reserved result path', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))

  await assert.rejects(
    () => runtime.createRun({ ...runInput(workspace), statusFile: 'MISSION.md' }),
    RuntimeValidationError,
  )

  await symlink('MISSION.md', path.join(workspace, 'mission-alias.md'))
  await assert.rejects(
    () => runtime.createRun({ ...runInput(workspace), statusFile: 'mission-alias.md' }),
    RuntimeValidationError,
  )

  const hardLink = path.join(workspace, 'mission-hardlink.md')
  await link(path.join(workspace, 'MISSION.md'), hardLink)
  await assert.rejects(
    () => runtime.createRun({ ...runInput(workspace), statusFile: 'mission-hardlink.md' }),
    RuntimeValidationError,
  )
  await unlink(hardLink)

  const resultDirectory = path.join(workspace, '.global-runtime')
  await symlink('.global-runtime', path.join(workspace, 'result-alias'))
  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace),
        statusFile: 'result-alias/session-result.json',
      }),
    RuntimeValidationError,
  )
  await mkdir(resultDirectory)
  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace),
        statusFile: 'result-alias/session-result.json',
      }),
    RuntimeValidationError,
  )
  await writeFile(path.join(resultDirectory, 'session-result.json'), '{}', 'utf8')
  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace),
        missionPath: '.global-runtime/session-result.json',
      }),
    RuntimeValidationError,
  )
})

test('different workspaces can run concurrently', async () => {
  const firstWorkspace = await createWorkspace()
  const secondWorkspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const provider = new ConcurrentProvider()
  const runtime = createRuntime(store, provider)
  const first = await runtime.createRun(runInput(firstWorkspace, 'first'))
  const second = await runtime.createRun(runInput(secondWorkspace, 'second'))

  await Promise.all([runtime.start(first.id), runtime.start(second.id)])
  await waitFor(async () => {
    const runs = await store.listRuns()
    return runs.every((run) => run.status === 'completed')
  })
  assert.equal(provider.maximumActive, 2)
})

class ScriptedProvider implements ProviderAdapter {
  readonly sessionNumbers: number[] = []

  constructor(
    private readonly results: ProviderExecutionResult[],
    private readonly writeResults = true,
  ) {}

  async execute(
    context: ProviderExecutionContext,
    _signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    this.sessionNumbers.push(context.sessionNumber)
    await callbacks.onStarted(10_000 + context.sessionNumber)
    await callbacks.onActivity(new Date())
    const result = this.results.shift()
    if (!result) throw new Error('no scripted provider result')
    if (this.writeResults) await writeControlResult(context, result.finalResult)
    return result
  }
}

async function writeControlResult(
  context: ProviderExecutionContext,
  value: unknown,
): Promise<void> {
  await writeFile(
    path.join(context.run.workspacePath, SESSION_RESULT_FILE),
    JSON.stringify(value),
    'utf8',
  )
}

class BlockingProvider implements ProviderAdapter {
  started = false

  async execute(
    _context: ProviderExecutionContext,
    signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    this.started = true
    await callbacks.onStarted(12345)
    if (!signal.aborted) {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    }
    return {
      exitCode: null,
      exitSignal: 'SIGTERM',
      finalResult: null,
      usage: emptyUsage(),
      resolvedModel: null,
      rateLimited: false,
      error: null,
      rawLogPath: 'blocked.jsonl',
    }
  }
}

class BlockingRateLimitedProvider implements ProviderAdapter {
  started = false
  private releaseExecution: (() => void) | null = null

  release(): void {
    this.releaseExecution?.()
  }

  async execute(
    _context: ProviderExecutionContext,
    _signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    this.started = true
    await callbacks.onStarted(12346)
    await new Promise<void>((resolve) => {
      this.releaseExecution = resolve
    })
    return {
      exitCode: 1,
      exitSignal: null,
      finalResult: null,
      usage: emptyUsage(),
      resolvedModel: null,
      rateLimited: true,
      error: 'Provider rate limit reached.',
      rawLogPath: 'rate-limited.jsonl',
    }
  }
}

class SlowStoppingProvider implements ProviderAdapter {
  private startObserved: (() => void) | null = null
  private abortObserved: (() => void) | null = null
  private releaseExecution: (() => void) | null = null
  private readonly started = new Promise<void>((resolve) => {
    this.startObserved = resolve
  })
  private readonly aborted = new Promise<void>((resolve) => {
    this.abortObserved = resolve
  })
  private readonly released = new Promise<void>((resolve) => {
    this.releaseExecution = resolve
  })

  waitForStart(): Promise<void> {
    return this.started
  }

  waitForAbort(): Promise<void> {
    return this.aborted
  }

  release(): void {
    this.releaseExecution?.()
  }

  async execute(
    _context: ProviderExecutionContext,
    signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    await callbacks.onStarted(12347)
    this.startObserved?.()
    if (signal.aborted) this.abortObserved?.()
    else signal.addEventListener('abort', () => this.abortObserved?.(), { once: true })
    await this.released
    return {
      exitCode: null,
      exitSignal: 'SIGTERM',
      finalResult: null,
      usage: emptyUsage(),
      resolvedModel: null,
      rateLimited: false,
      error: null,
      rawLogPath: 'slow-stop.jsonl',
    }
  }
}

class ThrowingOnAbortProvider implements ProviderAdapter {
  private startObserved: (() => void) | null = null
  private readonly started = new Promise<void>((resolve) => {
    this.startObserved = resolve
  })

  waitForStart(): Promise<void> {
    return this.started
  }

  async execute(
    _context: ProviderExecutionContext,
    signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    await callbacks.onStarted(12348)
    this.startObserved?.()
    if (!signal.aborted) {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    }
    throw new Error('provider cleanup failed')
  }
}

class ThrowingProvider implements ProviderAdapter {
  async execute(): Promise<ProviderExecutionResult> {
    throw new Error('fake provider crash')
  }
}

class ConcurrentProvider implements ProviderAdapter {
  private active = 0
  maximumActive = 0

  async execute(
    context: ProviderExecutionContext,
    _signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    this.active += 1
    this.maximumActive = Math.max(this.maximumActive, this.active)
    await callbacks.onStarted(20_000 + context.run.id)
    const result = successfulResult('complete', 'done', 1)
    await writeControlResult(context, result.finalResult)
    await new Promise((resolve) => setTimeout(resolve, 30))
    this.active -= 1
    return result
  }
}

const TEST_MACHINE_ID = 'test-machine'

function createRuntime(
  store: MemoryRuntimeStore,
  provider: ProviderAdapter,
  options: GlobalRuntimeOptions = {},
): GlobalRuntime {
  return new GlobalRuntime(store, {
    machineId: TEST_MACHINE_ID,
    // Each runtime gets its own log root: run ids restart at 1 per
    // MemoryRuntimeStore, and the launch anchor is keyed by run id, so a
    // shared root would leak one test's anchor into another's run 1.
    logRoot: createLogRoot(),
    ...options,
    providers: { codex: provider },
    rateLimitRetryMs: options.rateLimitRetryMs ?? 10,
    heartbeatMs: options.heartbeatMs ?? 10,
  })
}

function createLogRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'global-runtime-logs-'))
  temporaryDirectories.push(root)
  return root
}

class DelayedLaunchStore extends MemoryRuntimeStore {
  private launchWriteStarted: (() => void) | null = null
  private releaseLaunch: (() => void) | null = null
  private readonly launchStarted = new Promise<void>((resolve) => {
    this.launchWriteStarted = resolve
  })
  private readonly launchReleased = new Promise<void>((resolve) => {
    this.releaseLaunch = resolve
  })

  waitForLaunchWrite(): Promise<void> {
    return this.launchStarted
  }

  releaseLaunchWrite(): void {
    this.releaseLaunch?.()
  }

  override async updateRun(id: number, patch: RuntimeRunPatch) {
    if (patch.status === 'running' && patch.currentSession === undefined) {
      this.launchWriteStarted?.()
      await this.launchReleased
    }
    return super.updateRun(id, patch)
  }
}

class DelayedCompletionStore extends MemoryRuntimeStore {
  private completionWriteStarted: (() => void) | null = null
  private releaseCompletion: (() => void) | null = null
  private readonly completionStarted = new Promise<void>((resolve) => {
    this.completionWriteStarted = resolve
  })
  private readonly completionReleased = new Promise<void>((resolve) => {
    this.releaseCompletion = resolve
  })

  waitForCompletionWrite(): Promise<void> {
    return this.completionStarted
  }

  releaseCompletionWrite(): void {
    this.releaseCompletion?.()
  }

  override async updateRun(id: number, patch: RuntimeRunPatch) {
    if (patch.status === 'completed') {
      this.completionWriteStarted?.()
      await this.completionReleased
    }
    return super.updateRun(id, patch)
  }
}

class DelayedSessionCompletionStore extends MemoryRuntimeStore {
  private sessionCompletionWriteStarted: (() => void) | null = null
  private releaseSessionCompletion: (() => void) | null = null
  private readonly sessionCompletionStarted = new Promise<void>((resolve) => {
    this.sessionCompletionWriteStarted = resolve
  })
  private readonly sessionCompletionReleased = new Promise<void>((resolve) => {
    this.releaseSessionCompletion = resolve
  })

  waitForSessionCompletionWrite(): Promise<void> {
    return this.sessionCompletionStarted
  }

  releaseSessionCompletionWrite(): void {
    this.releaseSessionCompletion?.()
  }

  override async updateSession(id: number, patch: RuntimeSessionPatch) {
    if (patch.status === 'completed') {
      this.sessionCompletionWriteStarted?.()
      await this.sessionCompletionReleased
    }
    return super.updateSession(id, patch)
  }
}

class FailingErrorPersistenceStore extends MemoryRuntimeStore {
  override async updateRun(id: number, patch: RuntimeRunPatch) {
    if (patch.status === 'error') throw new Error('database unavailable while persisting error')
    return super.updateRun(id, patch)
  }
}

class DelayedLeaseStore extends MemoryRuntimeStore {
  private leaseRequested: (() => void) | null = null
  private releaseLease: (() => void) | null = null
  private readonly requested = new Promise<void>((resolve) => {
    this.leaseRequested = resolve
  })
  private readonly released = new Promise<void>((resolve) => {
    this.releaseLease = resolve
  })

  waitForLeaseRequest(): Promise<void> {
    return this.requested
  }

  releaseLeaseRequest(): void {
    this.releaseLease?.()
  }

  override async acquireRuntimeLease(machineId: string, onLost: (error: unknown) => void) {
    this.leaseRequested?.()
    await this.released
    return super.acquireRuntimeLease(machineId, onLost)
  }
}

class ControllableLeaseStore extends MemoryRuntimeStore {
  private onLost: ((error: unknown) => void) | null = null

  override async acquireRuntimeLease(machineId: string, onLost: (error: unknown) => void) {
    this.onLost = onLost
    return super.acquireRuntimeLease(machineId, onLost)
  }

  loseLease(): void {
    this.onLost?.(new Error('simulated lease connection failure'))
  }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'global-runtime-test-'))
  temporaryDirectories.push(workspace)
  await writeFile(path.join(workspace, 'MISSION.md'), '# Test mission\n', 'utf8')
  return workspace
}

/** Store-level record for tests that seed runs behind the runtime's back. */
function runRecord(workspacePath: string, name = 'test run') {
  return { ...runInput(workspacePath, name), machineId: TEST_MACHINE_ID, sandboxSettingsPath: null }
}

function runInput(workspacePath: string, name = 'test run') {
  return {
    name,
    provider: 'codex' as const,
    model: 'test-model',
    effort: 'high' as const,
    accessMode: 'workspace-write' as const,
    authHome: null,
    workspacePath,
    missionPath: 'MISSION.md',
    maxSessions: 5,
    delaySeconds: 0,
    statusFile: 'STATUS.md',
    journalFile: 'JOURNAL.md',
    inboxFile: 'INBOX.md',
    readOnlyFiles: [],
  }
}

function successfulResult(
  action: 'continue' | 'complete' | 'wait',
  summary: string,
  inputTokens: number,
): ProviderExecutionResult {
  return {
    exitCode: 0,
    exitSignal: null,
    finalResult: { action, summary },
    usage: { ...emptyUsage(), inputTokens },
    resolvedModel: 'test-model',
    rateLimited: false,
    error: null,
    rawLogPath: 'test.jsonl',
  }
}

function emptyUsage() {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    estimatedApiCostUsd: null,
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

// ---------------------------------------------------------------------------
// Multi-machine ownership (issue #213)
// ---------------------------------------------------------------------------

class FakeTunnels {
  ensureStartedCalls = 0
  closeCalls = 0
  failNextStart = false

  async ensureStarted(): Promise<{ mysqlPort: number; redisPort: number }> {
    this.ensureStartedCalls += 1
    if (this.failNextStart) throw new Error('simulated tunnel bind failure')
    return { mysqlPort: 51234, redisPort: 51235 }
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }
}

test('createRun stamps the daemon machine id; clients cannot supply one', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))
  const run = await runtime.createRun(runInput(workspace))
  assert.equal(run.machineId, TEST_MACHINE_ID)
  await assert.rejects(
    () => runtime.createRun({ ...runInput(workspace), machineId: 'attacker' }),
    RuntimeValidationError,
  )
  await runtime.shutdown()
})

test('two machines hold independent leases on the same store', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtimeA = createRuntime(
    store,
    new ScriptedProvider([successfulResult('complete', 'a', 1)]),
  )
  const runtimeB = createRuntime(
    store,
    new ScriptedProvider([successfulResult('complete', 'b', 1)]),
    {
      machineId: 'machine-b',
    },
  )
  const nestedWorkspace = await createWorkspace()

  const runA = await runtimeA.createRun(runInput(workspace, 'machine A run'))
  const runB = await runtimeB.createRun(runInput(nestedWorkspace, 'machine B run'))

  // Both daemons acquire their machine's lease and run concurrently.
  await runtimeA.start(runA.id)
  await runtimeB.start(runB.id)
  await waitFor(async () => (await store.getRun(runA.id))?.status === 'completed')
  await waitFor(async () => (await store.getRun(runB.id))?.status === 'completed')

  await runtimeA.shutdown()
  await runtimeB.shutdown()
})

test('the same workspace path on two machines does not conflict', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const providerA = new BlockingProvider()
  const runtimeA = createRuntime(store, providerA)
  const runtimeB = createRuntime(
    store,
    new ScriptedProvider([successfulResult('complete', 'b', 1)]),
    {
      machineId: 'machine-b',
    },
  )

  const runA = await runtimeA.createRun(runInput(workspace, 'machine A run'))
  const runB = await runtimeB.createRun(runInput(workspace, 'machine B run'))

  await runtimeA.start(runA.id)
  await waitFor(async () => providerA.started)
  // Same canonical path, different machine — different filesystem, no conflict.
  await runtimeB.start(runB.id)
  await waitFor(async () => (await store.getRun(runB.id))?.status === 'completed')

  await runtimeA.stop(runA.id)
  await runtimeA.shutdown()
  await runtimeB.shutdown()
})

test('control, steering, and file endpoints reject runs owned by another machine', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const runtimeA = createRuntime(store, new BlockingProvider())
  const runtimeB = createRuntime(store, new BlockingProvider(), {
    machineId: 'machine-b',
    machineLabel: (id) => (id === TEST_MACHINE_ID ? 'alpha' : id),
  })
  const run = await runtimeA.createRun(runInput(workspace))

  const foreign = /belongs to alpha \(test-machine\)/u
  await assert.rejects(() => runtimeB.start(run.id), foreign)
  await assert.rejects(() => runtimeB.pause(run.id), foreign)
  await assert.rejects(() => runtimeB.resume(run.id), foreign)
  await assert.rejects(() => runtimeB.stop(run.id), foreign)
  await assert.rejects(() => runtimeB.extendMaxSessions(run.id, { maxSessions: 99 }), foreign)
  await assert.rejects(() => runtimeB.appendInbox(run.id, { message: 'hi' }), foreign)
  await assert.rejects(() => runtimeB.getFiles(run.id), foreign)

  // The foreign stop above must not have rewritten the run's end state.
  const persisted = await store.getRun(run.id)
  assert.equal(persisted?.status, 'idle')
  assert.equal(persisted?.maxSessions, run.maxSessions)

  await runtimeA.shutdown()
  await runtimeB.shutdown()
})

test('recovery passes ignore runs owned by other machines', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()

  const foreign = (name: string) => ({
    ...runInput(workspace, name),
    machineId: 'machine-elsewhere',
    sandboxSettingsPath: null,
  })
  // Pass 1 target: an interrupted active run with a recorded process.
  const interrupted = await store.createRun(foreign('foreign interrupted'))
  await store.updateRun(interrupted.id, { status: 'running', currentSession: 1, processId: 4242 })
  // Pass 2 target: a stop that never finished (stopped but with a PID).
  const incompleteStop = await store.createRun(foreign('foreign incomplete stop'))
  await store.updateRun(incompleteStop.id, { status: 'stopped', processId: 4243 })
  // Pass 3 target: a rate-limited run whose retry timer died with the daemon.
  const rateLimited = await store.createRun(foreign('foreign rate limited'))
  await store.updateRun(rateLimited.id, {
    status: 'rate_limited',
    nextStartAt: new Date(Date.now() - 60_000),
  })

  const terminated: number[] = []
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    terminateProcess: async (pid) => {
      terminated.push(pid)
    },
    verifyProcess: async () => true,
  })
  await runtime.initialize()

  assert.deepEqual(terminated, [])
  assert.equal((await store.getRun(interrupted.id))?.status, 'running')
  assert.equal((await store.getRun(interrupted.id))?.processId, 4242)
  assert.equal((await store.getRun(incompleteStop.id))?.processId, 4243)
  assert.equal((await store.getRun(rateLimited.id))?.status, 'rate_limited')

  await runtime.shutdown()
})

test('createRun validates the sandbox settings path and stores its real path', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]))

  const sandboxed = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })
  assert.ok(sandboxed.sandboxSettingsPath?.endsWith('srt-settings.json'))

  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace, 'missing settings'),
        sandboxSettingsPath: path.join(workspace, 'nope.json'),
      }),
    RuntimeValidationError,
  )
  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace, 'relative settings'),
        sandboxSettingsPath: 'relative/path.json',
      }),
    RuntimeValidationError,
  )
  await assert.rejects(
    () =>
      runtime.createRun({
        ...runInput(workspace, 'directory settings'),
        sandboxSettingsPath: workspace,
      }),
    RuntimeValidationError,
  )
  await runtime.shutdown()
})

test('sandboxed runs start the tunnels before executing; unsandboxed runs never do', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const tunnels = new FakeTunnels()
  const runtime = createRuntime(
    store,
    new ScriptedProvider([
      successfulResult('complete', 'plain done', 1),
      successfulResult('complete', 'sandboxed done', 1),
    ]),
    { sandboxTunnels: tunnels },
  )

  const plain = await runtime.createRun(runInput(workspace, 'plain'))
  await runtime.start(plain.id)
  await waitFor(async () => (await store.getRun(plain.id))?.status === 'completed')
  assert.equal(tunnels.ensureStartedCalls, 0)

  const nested = await createWorkspace()
  await writeFile(path.join(nested, 'srt-settings.json'), '{}\n', 'utf8')
  const sandboxed = await runtime.createRun({
    ...runInput(nested, 'sandboxed'),
    sandboxSettingsPath: path.join(nested, 'srt-settings.json'),
  })
  await runtime.start(sandboxed.id)
  await waitFor(async () => (await store.getRun(sandboxed.id))?.status === 'completed')
  assert.ok(tunnels.ensureStartedCalls >= 1)

  await runtime.shutdown()
  assert.ok(tunnels.closeCalls >= 1)
})

test('a tunnel start failure fails the sandboxed session instead of running unsandboxed', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const tunnels = new FakeTunnels()
  tunnels.failNextStart = true
  const provider = new ScriptedProvider([successfulResult('complete', 'must not run', 1)])
  const runtime = createRuntime(store, provider, {
    sandboxTunnels: tunnels,
    onBackgroundError: () => undefined,
  })

  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })
  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'error')
  assert.deepEqual(provider.sessionNumbers, [])
  assert.match((await store.getRun(run.id))?.lastError ?? '', /tunnel bind failure/u)

  await runtime.shutdown()
})

test('a mid-run change to an immutable field stops the loop instead of downgrading it', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const tunnels = new FakeTunnels()
  const provider = new ScriptedProvider([
    successfulResult('continue', 'session one done', 1),
    successfulResult('complete', 'must not run unsandboxed', 1),
  ])
  const runtime = createRuntime(store, provider, {
    sandboxTunnels: tunnels,
    onBackgroundError: () => undefined,
  })
  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    // A delay between sessions gives the tamper a window, the way a real
    // session would have while its successor waits.
    delaySeconds: 1,
    sandboxSettingsPath: settingsPath,
  })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.currentSession === 1)
  // Simulates a session with DB write access clearing its own sandbox — the
  // daemon must refuse rather than launch session 2 unsandboxed.
  await store.updateRun(run.id, { sandboxSettingsPath: null } as RuntimeRunPatch)

  await waitFor(async () => (await store.getRun(run.id))?.status === 'error')
  assert.deepEqual(provider.sessionNumbers, [1])
  assert.match((await store.getRun(run.id))?.lastError ?? '', /immutable sandboxSettingsPath/u)

  await runtime.shutdown()
})

test('a downgrade cannot be laundered by parking the run and resuming it', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const tunnels = new FakeTunnels()
  const provider = new ScriptedProvider([
    // Session 1 tampers, then parks the loop with an ordinary 'wait'.
    successfulResult('wait', 'waiting for input', 1),
    successfulResult('complete', 'must not run unsandboxed', 1),
  ])
  const runtime = createRuntime(store, provider, {
    sandboxTunnels: tunnels,
    onBackgroundError: () => undefined,
  })
  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'waiting')
  // The run is parked, so the in-memory pin is gone; only the on-disk anchor
  // still knows this run was created sandboxed.
  await store.updateRun(run.id, { sandboxSettingsPath: null } as RuntimeRunPatch)

  await assert.rejects(() => runtime.resume(run.id), /immutable sandboxSettingsPath/u)
  assert.deepEqual(provider.sessionNumbers, [1])

  await runtime.shutdown()
})

test('a tunnel failure does not leave a heartbeat writing to the errored run', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const tunnels = new FakeTunnels()
  tunnels.failNextStart = true
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    sandboxTunnels: tunnels,
    onBackgroundError: () => undefined,
    heartbeatMs: 5,
  })
  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })

  await runtime.start(run.id)
  await waitFor(async () => (await store.getRun(run.id))?.status === 'error')
  assert.equal((await store.getRun(run.id))?.heartbeatAt, null)

  // An orphaned interval would resurrect heartbeatAt on a run that is done.
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(
    (await store.getRun(run.id))?.heartbeatAt,
    null,
    'heartbeat kept running after the failure',
  )

  await runtime.shutdown()
})

test('pre-anchor runs are adopted once at startup instead of becoming unresumable', async () => {
  // Canonical form: runRecord goes straight to the store, bypassing the
  // canonicalization createRun would do.
  const workspace = await realpath(await createWorkspace())
  const store = new MemoryRuntimeStore()
  const logRoot = createLogRoot()
  // A run that already started, exactly as an upgrade would find it.
  const legacy = await store.createRun(runRecord(workspace, 'legacy'))
  await store.updateRun(legacy.id, { status: 'paused', startedAt: new Date(), currentSession: 1 })

  const runtime = createRuntime(
    store,
    new ScriptedProvider([successfulResult('complete', 'ok', 1)]),
    {
      logRoot,
    },
  )
  await runtime.initialize()
  const anchor = JSON.parse(
    await readFile(path.join(logRoot, 'anchors', `run-${legacy.id}.json`), 'utf8'),
  ) as { workspacePath: string }
  assert.equal(anchor.workspacePath, workspace)

  // Resume must work rather than reporting a missing anchor.
  await runtime.resume(legacy.id)
  await waitFor(async () => (await store.getRun(legacy.id))?.status === 'completed')
  await runtime.shutdown()

  // After adoption the directory exists, so a later missing anchor is an anomaly.
  const second = await store.createRun(runRecord(workspace, 'later'))
  await store.updateRun(second.id, { status: 'paused', startedAt: new Date(), currentSession: 1 })
  const restarted = createRuntime(store, new ScriptedProvider([]), { logRoot })
  await restarted.initialize()
  await assert.rejects(() => restarted.resume(second.id), /already started/u)
  await restarted.shutdown()
})

test('a tamper reports itself on every retry rather than wedging the run', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    onBackgroundError: () => undefined,
  })
  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })
  await runtime.start(run.id)
  await runtime.stop(run.id)
  await store.updateRun(run.id, { sandboxSettingsPath: null } as RuntimeRunPatch)

  // Both attempts must name the tamper; the first must not leave the run
  // stuck reporting "already active".
  await assert.rejects(() => runtime.resume(run.id), /immutable sandboxSettingsPath/u)
  await assert.rejects(() => runtime.resume(run.id), /immutable sandboxSettingsPath/u)
  await runtime.shutdown()
})

test('rewriting the sandbox settings file is refused, not just clearing the column', async () => {
  const workspace = await createWorkspace()
  const settingsPath = path.join(workspace, 'srt-settings.json')
  await writeFile(settingsPath, JSON.stringify({ filesystem: { denyRead: ['/secrets'] } }), 'utf8')
  const store = new MemoryRuntimeStore()
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    sandboxTunnels: new FakeTunnels(),
    onBackgroundError: () => undefined,
  })
  const run = await runtime.createRun({
    ...runInput(workspace, 'sandboxed'),
    sandboxSettingsPath: settingsPath,
  })
  await runtime.start(run.id)
  await runtime.stop(run.id)

  // The path is unchanged; only the policy behind it was weakened.
  await writeFile(settingsPath, JSON.stringify({ filesystem: {} }), 'utf8')
  await assert.rejects(() => runtime.resume(run.id), /sandbox settings file .* changed/u)
  await runtime.shutdown()
})

test('a falsy or partial anchor is rejected instead of silently re-pinning', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  const logRoot = createLogRoot()
  const runtime = createRuntime(store, new ScriptedProvider([]), { logRoot })
  const run = await runtime.createRun(runInput(workspace))
  await runtime.start(run.id)
  await runtime.stop(run.id)

  const anchorPath = path.join(logRoot, 'anchors', `run-${run.id}.json`)
  for (const body of ['null', '0', '""', '{"provider":"codex"}', '']) {
    await writeFile(anchorPath, body, 'utf8')
    await assert.rejects(() => runtime.resume(run.id), /launch anchor/u, `body: ${body}`)
  }
  await runtime.shutdown()
})

test('a workspace overlapping the daemon log root is refused', async () => {
  const workspace = await createWorkspace()
  const store = new MemoryRuntimeStore()
  // Log root inside the workspace: a session could then reach its own anchor.
  const runtime = createRuntime(store, new ScriptedProvider([]), {
    logRoot: path.join(workspace, 'logs'),
  })
  const run = await runtime.createRun(runInput(workspace))
  await assert.rejects(() => runtime.start(run.id), /overlaps the runtime log root/u)
  await runtime.shutdown()
})
