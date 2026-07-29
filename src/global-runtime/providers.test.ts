import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, test } from 'node:test'
import {
  buildRuntimeProcessToken,
  RUNTIME_PROCESS_TOKEN_ENV,
  SESSION_RESULT_FILE,
} from './contracts.js'
import {
  CliProviderAdapter,
  createBackpressureWriter,
  prepareProviderCommand,
} from './providers.js'
import type { RuntimeRun } from './types.js'

const temporaryDirectories: string[] = []
const originalCodexBin = process.env.GLOBAL_RUNTIME_CODEX_BIN
const originalClaudeBin = process.env.GLOBAL_RUNTIME_CLAUDE_BIN
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalDatabasePassword = process.env.DATABASE_PASSWORD
const originalPrivateKey = process.env.PRIVATE_KEY

afterEach(async () => {
  restoreEnv('GLOBAL_RUNTIME_CODEX_BIN', originalCodexBin)
  restoreEnv('GLOBAL_RUNTIME_CLAUDE_BIN', originalClaudeBin)
  restoreEnv('CLAUDE_CONFIG_DIR', originalClaudeConfigDir)
  restoreEnv('DATABASE_PASSWORD', originalDatabasePassword)
  restoreEnv('PRIVATE_KEY', originalPrivateKey)
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

test('builds shell-free Claude and Codex commands with the requested access and effort', async () => {
  const workspace = await createDirectory()
  const logDirectory = path.join(workspace, 'logs')
  const codexRun = makeRun(workspace, 'codex')
  const claudeRun = makeRun(workspace, 'claude')
  const codex = await prepareProviderCommand({
    run: codexRun,
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory,
  })
  const claude = await prepareProviderCommand({
    run: claudeRun,
    sessionNumber: 2,
    prompt: 'mission',
    logDirectory,
  })

  assert.equal(codex.command, 'codex')
  assert.deepEqual(codex.args.slice(0, 3), ['exec', '--json', '--ephemeral'])
  assert.ok(codex.args.includes('--skip-git-repo-check'))
  assert.ok(codex.args.includes('workspace-write'))
  assert.ok(codex.args.includes('model_reasoning_effort="high"'))
  assert.equal(codex.env[RUNTIME_PROCESS_TOKEN_ENV], buildRuntimeProcessToken(codexRun.id, 1))
  assert.equal(claude.command, 'claude')
  assert.ok(claude.args.includes('--no-session-persistence'))
  assert.ok(claude.args.includes('acceptEdits'))
  assert.ok(claude.args.includes('--json-schema'))
  assert.equal(claude.env[RUNTIME_PROCESS_TOKEN_ENV], buildRuntimeProcessToken(claudeRun.id, 2))
})

test('pauses provider output until a saturated log stream drains', async () => {
  const source = new PassThrough()
  const destination = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      setImmediate(callback)
    },
  })
  const write = createBackpressureWriter(source, destination)

  write(Buffer.alloc(64 * 1024))
  assert.equal(source.isPaused(), true)

  await once(destination, 'drain')
  assert.equal(source.isPaused(), false)

  destination.end()
  await once(destination, 'finish')
  source.destroy()
})

test('uses normal Claude authentication unless a separate profile is selected', async () => {
  const workspace = await createDirectory()
  process.env.CLAUDE_CONFIG_DIR = '/tmp/inherited-claude-profile'

  const defaultRun = makeRun(workspace, 'claude')
  const defaultClaude = await prepareProviderCommand({
    run: defaultRun,
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory: path.join(workspace, 'default-logs'),
  })
  assert.equal(defaultClaude.env.CLAUDE_CONFIG_DIR, undefined)

  const alternateRun = makeRun(workspace, 'claude')
  alternateRun.authHome = '~/.claude-balsa'
  const alternateClaude = await prepareProviderCommand({
    run: alternateRun,
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory: path.join(workspace, 'alternate-logs'),
  })
  assert.equal(alternateClaude.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude-balsa'))
})

test('does not expose repository secrets to provider processes', async () => {
  const workspace = await createDirectory()
  process.env.DATABASE_PASSWORD = 'database-secret'
  process.env.PRIVATE_KEY = 'wallet-secret'

  for (const provider of ['codex', 'claude'] as const) {
    const run = makeRun(workspace, provider)
    const prepared = await prepareProviderCommand({
      run,
      sessionNumber: 1,
      prompt: 'mission',
      logDirectory: path.join(workspace, `secret-logs-${provider}`),
    })
    assert.equal(prepared.env.DATABASE_PASSWORD, undefined)
    assert.equal(prepared.env.PRIVATE_KEY, undefined)
    assert.equal(prepared.env.PATH, process.env.PATH)
    assert.equal(prepared.env[RUNTIME_PROCESS_TOKEN_ENV], buildRuntimeProcessToken(run.id, 1))
  }
})

test('parses structured output and usage from fake Claude and Codex CLI processes', async () => {
  const workspace = await createDirectory()
  const fakeCli = await createFakeCli(workspace)
  process.env.GLOBAL_RUNTIME_CODEX_BIN = fakeCli
  process.env.GLOBAL_RUNTIME_CLAUDE_BIN = fakeCli
  const adapter = new CliProviderAdapter()

  for (const provider of ['codex', 'claude'] as const) {
    const run = makeRun(workspace, provider)
    const result = await adapter.execute(
      {
        run,
        sessionNumber: provider === 'codex' ? 3 : 4,
        prompt: 'test prompt',
        logDirectory: path.join(workspace, `logs-${provider}`),
      },
      new AbortController().signal,
      { onStarted: () => undefined, onActivity: () => undefined },
    )
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.finalResult, { action: 'complete', summary: `${provider} finished` })
    assert.equal(result.usage.inputTokens, provider === 'codex' ? 9 : 21)
    assert.equal(result.usage.cacheReadInputTokens, provider === 'codex' ? 2 : 4)
    assert.equal(result.usage.cacheCreationInputTokens, provider === 'codex' ? null : 6)
    assert.equal(result.usage.outputTokens, provider === 'codex' ? 7 : 9)
    assert.equal(result.usage.estimatedApiCostUsd, provider === 'codex' ? null : 0.125)
    assert.equal(result.resolvedModel, provider === 'codex' ? 'test-model' : 'claude-test-model')
  }
})

test('observes a fast CLI exit while the started callback is still pending', async () => {
  const workspace = await createDirectory()
  process.env.GLOBAL_RUNTIME_CODEX_BIN = await createFakeCli(workspace)
  const adapter = new CliProviderAdapter()
  let timeout: NodeJS.Timeout | undefined

  const result = await Promise.race([
    adapter.execute(
      {
        run: makeRun(workspace, 'codex'),
        sessionNumber: 5,
        prompt: 'test prompt',
        logDirectory: path.join(workspace, 'logs-fast-exit'),
      },
      new AbortController().signal,
      {
        onStarted: () => new Promise((resolve) => setTimeout(resolve, 100)),
        onActivity: () => undefined,
      },
    ),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 2000)
      timeout.unref()
    }),
  ])
  if (timeout) clearTimeout(timeout)

  assert.ok(result, 'provider execution timed out after the child had already exited')
  assert.equal(result.exitCode, 0)
})

test('reports log stream failures without crashing the runtime process', async () => {
  const workspace = await createDirectory()
  const logDirectory = path.join(workspace, 'logs-invalid-stream')
  await mkdir(path.join(logDirectory, 'session-0006.jsonl'), { recursive: true })
  process.env.GLOBAL_RUNTIME_CODEX_BIN = await createFakeCli(workspace)
  const adapter = new CliProviderAdapter()

  const result = await adapter.execute(
    {
      run: makeRun(workspace, 'codex'),
      sessionNumber: 6,
      prompt: 'test prompt',
      logDirectory,
    },
    new AbortController().signal,
    { onStarted: () => undefined, onActivity: () => undefined },
  )

  assert.match(result.error ?? '', /raw log failed/iu)
  assert.equal(result.rateLimited, false)
})

async function createFakeCli(workspace: string): Promise<string> {
  const fakeCli = path.join(workspace, 'fake-cli.mjs')
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const args = process.argv.slice(2)
const provider = args[0] === 'exec' ? 'codex' : 'claude'
const result = { action: 'complete', summary: provider + ' finished' }
await mkdir(path.join(process.cwd(), '.global-runtime'), { recursive: true })
await writeFile(path.join(process.cwd(), ${JSON.stringify(SESSION_RESULT_FILE)}), JSON.stringify(result))
if (provider === 'codex') {
  const outputIndex = args.indexOf('--output-last-message')
  await writeFile(args[outputIndex + 1], JSON.stringify(result))
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 7, reasoning_output_tokens: 3 } }))
} else {
  console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.125, structured_output: result, usage: { input_tokens: 21, cache_read_input_tokens: 4, cache_creation_input_tokens: 6, output_tokens: 9 }, modelUsage: { 'claude-helper-model': { costUSD: 0.001 }, 'claude-test-model': { costUSD: 0.124 } } }))
}
`,
    'utf8',
  )
  await chmod(fakeCli, 0o700)
  return fakeCli
}

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-provider-test-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, '.global-runtime'), { recursive: true })
  return directory
}

function makeRun(workspacePath: string, provider: 'claude' | 'codex'): RuntimeRun {
  const now = new Date()
  return {
    id: provider === 'codex' ? 1 : 2,
    name: `${provider} test`,
    provider,
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    workspacePath,
    missionPath: 'MISSION.md',
    maxSessions: 5,
    delaySeconds: 0,
    statusFile: 'STATUS.md',
    journalFile: 'JOURNAL.md',
    inboxFile: 'INBOX.md',
    readOnlyFiles: [],
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
