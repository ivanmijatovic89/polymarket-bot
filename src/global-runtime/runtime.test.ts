import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { RuntimeConflictError } from './errors.js'
import { MemoryRuntimeStore } from './memoryStore.js'
import type {
  ProviderAdapter,
  ProviderExecutionCallbacks,
  ProviderExecutionContext,
  ProviderExecutionResult,
} from './providers.js'
import { GlobalRuntime } from './runtime.js'
import { SESSION_RESULT_FILE } from './contracts.js'

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
  const run = await store.createRun(runInput(workspace))
  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'running', currentSession: 1 })
  await store.createSession({
    runId: run.id,
    sessionNumber: 1,
    provider: run.provider,
    model: run.model,
    effort: run.effort,
    rawLogPath: 'test.jsonl',
    startedAt,
  })

  const runtime = createRuntime(store, new ScriptedProvider([]))
  await runtime.initialize()

  const detail = await runtime.getRunDetail(run.id)
  assert.equal(detail.run.status, 'waiting')
  assert.equal(detail.sessions[0]?.status, 'failed')
  assert.match(detail.run.lastError ?? '', /restarted/iu)
})

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
      rateLimited: false,
      error: null,
      rawLogPath: 'blocked.jsonl',
    }
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

function createRuntime(store: MemoryRuntimeStore, provider: ProviderAdapter): GlobalRuntime {
  return new GlobalRuntime(store, {
    providers: { codex: provider },
    rateLimitRetryMs: 10,
    heartbeatMs: 10,
  })
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'global-runtime-test-'))
  temporaryDirectories.push(workspace)
  await writeFile(path.join(workspace, 'MISSION.md'), '# Test mission\n', 'utf8')
  return workspace
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
    rateLimited: false,
    error: null,
    rawLogPath: 'test.jsonl',
  }
}

function emptyUsage() {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
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
