import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  wrapWithSandbox,
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
  assert.equal(codex.args.includes('--output-last-message'), false)
  assert.ok(codex.args.includes('model_reasoning_effort="high"'))
  assert.equal(codex.env[RUNTIME_PROCESS_TOKEN_ENV], buildRuntimeProcessToken(codexRun.id, 1))
  assert.equal(claude.command, 'claude')
  assert.ok(claude.args.includes('--no-session-persistence'))
  assert.ok(claude.args.includes('acceptEdits'))
  assert.ok(claude.args.includes('--json-schema'))
  const settingsIndex = claude.args.indexOf('--settings')
  assert.notEqual(settingsIndex, -1)
  assert.deepEqual(JSON.parse(claude.args[settingsIndex + 1]!), {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      excludedCommands: [],
      filesystem: { disabled: false, allowWrite: [] },
      network: { allowUnixSockets: [] },
    },
  })
  assert.equal(claude.env[RUNTIME_PROCESS_TOKEN_ENV], buildRuntimeProcessToken(claudeRun.id, 2))

  const fullAccessRun = makeRun(workspace, 'claude')
  fullAccessRun.accessMode = 'full-access'
  const fullAccessClaude = await prepareProviderCommand({
    run: fullAccessRun,
    sessionNumber: 3,
    prompt: 'mission',
    logDirectory,
  })
  assert.ok(fullAccessClaude.args.includes('bypassPermissions'))
  assert.equal(fullAccessClaude.args.includes('--settings'), false)
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
    if (provider === 'codex') run.model = 'gpt-5.6-sol'
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
    assert.equal(result.usage.cacheCreationInputTokens, provider === 'codex' ? 3 : 6)
    assert.equal(result.usage.outputTokens, provider === 'codex' ? 7 : 9)
    assert.equal(result.usage.estimatedApiCostUsd, provider === 'codex' ? 0.00027475 : 0.125)
    assert.equal(result.resolvedModel, provider === 'codex' ? 'gpt-5.6-sol' : 'claude-test-model')
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

test(
  'counts rate-limit stderr text only when the CLI exits with a failure code',
  { skip: process.platform === 'win32' },
  async () => {
    const workspace = await createDirectory()
    const adapter = new CliProviderAdapter()

    const cases = [
      { exit: 0, expectedExitCode: 0, rateLimited: false },
      { exit: 1, expectedExitCode: 1, rateLimited: true },
      // A signal death has no exit code and is never the CLI reporting a
      // rate limit, even when the buffered stderr mentions quotas.
      { exit: 'signal', expectedExitCode: null, rateLimited: false },
    ] as const

    for (const [index, testCase] of cases.entries()) {
      process.env.GLOBAL_RUNTIME_CODEX_BIN = await createQuotaStderrCli(workspace, testCase.exit)
      const result = await adapter.execute(
        {
          run: makeRun(workspace, 'codex'),
          sessionNumber: 10 + index,
          prompt: 'test prompt',
          logDirectory: path.join(workspace, `logs-quota-${String(testCase.exit)}`),
        },
        new AbortController().signal,
        { onStarted: () => undefined, onActivity: () => undefined },
      )
      assert.equal(result.exitCode, testCase.expectedExitCode)
      assert.equal(result.rateLimited, testCase.rateLimited)
    }
  },
)

test('keeps the Claude result event when later error events flood the bounded buffer', async () => {
  const workspace = await createDirectory()
  process.env.GLOBAL_RUNTIME_CLAUDE_BIN = await createErrorFloodClaudeCli(workspace)
  const adapter = new CliProviderAdapter()

  const result = await adapter.execute(
    {
      run: makeRun(workspace, 'claude'),
      sessionNumber: 12,
      prompt: 'test prompt',
      logDirectory: path.join(workspace, 'logs-error-flood'),
    },
    new AbortController().signal,
    { onStarted: () => undefined, onActivity: () => undefined },
  )

  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.finalResult, { action: 'continue', summary: 'flooded' })
  assert.equal(result.usage.inputTokens, 11)
  assert.equal(result.usage.estimatedApiCostUsd, 0.5)
})

test('keeps the Codex usage and final message when error events flood the bounded buffer', async () => {
  const workspace = await createDirectory()
  process.env.GLOBAL_RUNTIME_CODEX_BIN = await createErrorFloodCodexCli(workspace)
  const adapter = new CliProviderAdapter()

  const result = await adapter.execute(
    {
      run: { ...makeRun(workspace, 'codex'), model: 'gpt-5.6-sol' },
      sessionNumber: 13,
      prompt: 'test prompt',
      logDirectory: path.join(workspace, 'logs-codex-error-flood'),
    },
    new AbortController().signal,
    { onStarted: () => undefined, onActivity: () => undefined },
  )

  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.finalResult, { action: 'continue', summary: 'flooded' })
  assert.equal(result.usage.outputTokens, 7)
  assert.equal(result.usage.cacheReadInputTokens, 2)
})

test('refuses symlinked provider artifacts without modifying their targets', async () => {
  const workspace = await createDirectory()
  const target = path.join(workspace, 'outside-artifact-target.txt')
  await writeFile(target, 'unchanged', 'utf8')

  const schemaLogDirectory = path.join(workspace, 'logs-symlinked-schema')
  await mkdir(schemaLogDirectory)
  await symlink(target, path.join(schemaLogDirectory, 'session-0008.schema.json'))
  await assert.rejects(
    () =>
      prepareProviderCommand({
        run: makeRun(workspace, 'codex'),
        sessionNumber: 8,
        prompt: 'test prompt',
        logDirectory: schemaLogDirectory,
      }),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST',
  )
  assert.equal(await readFile(target, 'utf8'), 'unchanged')

  const rawLogDirectory = path.join(workspace, 'logs-symlinked-raw')
  await mkdir(rawLogDirectory)
  await symlink(target, path.join(rawLogDirectory, 'session-0009.jsonl'))
  process.env.GLOBAL_RUNTIME_CODEX_BIN = await createFakeCli(workspace)
  const result = await new CliProviderAdapter().execute(
    {
      run: makeRun(workspace, 'codex'),
      sessionNumber: 9,
      prompt: 'test prompt',
      logDirectory: rawLogDirectory,
    },
    new AbortController().signal,
    { onStarted: () => undefined, onActivity: () => undefined },
  )
  assert.match(result.error ?? '', /raw log failed/iu)
  assert.equal(await readFile(target, 'utf8'), 'unchanged')
})

test(
  'escalates the provider process group after the CLI leader exits',
  { skip: process.platform === 'win32' },
  async () => {
    const workspace = await createDirectory()
    process.env.GLOBAL_RUNTIME_CODEX_BIN = await createStubbornProcessTreeCli(workspace)
    const adapter = new CliProviderAdapter(50)
    const controller = new AbortController()
    let activityObserved: (() => void) | null = null
    const activity = new Promise<void>((resolve) => {
      activityObserved = resolve
    })
    const execution = adapter.execute(
      {
        run: makeRun(workspace, 'codex'),
        sessionNumber: 7,
        prompt: 'test prompt',
        logDirectory: path.join(workspace, 'logs-stubborn-process-tree'),
      },
      controller.signal,
      {
        onStarted: () => undefined,
        onActivity: () => activityObserved?.(),
      },
    )

    await activity
    const abortedAt = Date.now()
    controller.abort()
    const result = await execution

    assert.ok(
      Date.now() - abortedAt < 2000,
      'provider descendants were not killed after escalation',
    )
    assert.equal(result.exitSignal, 'SIGTERM')
  },
)

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
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }))
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 14, cached_input_tokens: 2, cache_write_input_tokens: 3, output_tokens: 7, reasoning_output_tokens: 3 } }))
} else {
  console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.125, structured_output: result, usage: { input_tokens: 21, cache_read_input_tokens: 4, cache_creation_input_tokens: 6, output_tokens: 9 }, modelUsage: { 'claude-helper-model': { costUSD: 0.001 }, 'claude-test-model': { costUSD: 0.124 } } }))
}
`,
    'utf8',
  )
  await chmod(fakeCli, 0o700)
  return fakeCli
}

async function createQuotaStderrCli(workspace: string, exit: number | 'signal'): Promise<string> {
  const fakeCli = path.join(workspace, `quota-stderr-${String(exit)}-cli.mjs`)
  const finalStatement =
    exit === 'signal' ? `process.kill(process.pid, 'SIGKILL')` : `process.exit(${exit})`
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
console.error('backtest tool: provider quota snapshot logged; rate limit headroom ok')
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }))
${finalStatement}
`,
    'utf8',
  )
  await chmod(fakeCli, 0o700)
  return fakeCli
}

async function createErrorFloodClaudeCli(workspace: string): Promise<string> {
  const fakeCli = path.join(workspace, 'error-flood-claude-cli.mjs')
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const result = { action: 'continue', summary: 'flooded' }
await mkdir(path.join(process.cwd(), '.global-runtime'), { recursive: true })
await writeFile(path.join(process.cwd(), ${JSON.stringify(SESSION_RESULT_FILE)}), JSON.stringify(result))
console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.5, structured_output: result, usage: { input_tokens: 11, output_tokens: 3 } }))
for (let index = 0; index < 150; index += 1) {
  console.log(JSON.stringify({ type: 'error', message: 'noise ' + index }))
}
`,
    'utf8',
  )
  await chmod(fakeCli, 0o700)
  return fakeCli
}

async function createErrorFloodCodexCli(workspace: string): Promise<string> {
  const fakeCli = path.join(workspace, 'error-flood-codex-cli.mjs')
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
const result = { action: 'continue', summary: 'flooded' }
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }))
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 14, cached_input_tokens: 2, cache_write_input_tokens: 3, output_tokens: 7 } }))
for (let index = 0; index < 150; index += 1) {
  console.log(JSON.stringify({ type: 'error', message: 'noise ' + index }))
}
`,
    'utf8',
  )
  await chmod(fakeCli, 0o700)
  return fakeCli
}

async function createStubbornProcessTreeCli(workspace: string): Promise<string> {
  const fakeCli = path.join(workspace, 'stubborn-process-tree-cli.mjs')
  await writeFile(
    fakeCli,
    `#!/usr/bin/env node
import { spawn } from 'node:child_process'
const descendant = spawn(process.execPath, ['-e', \`process.on('SIGTERM', () => {}); process.send?.('ready'); setTimeout(() => process.exit(0), 3000)\`], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
descendant.once('message', () => {
  console.log(JSON.stringify({ type: 'descendant.ready' }))
})
setInterval(() => {}, 1000)
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
    machineId: 'provider-machine',
    name: `${provider} test`,
    provider,
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    sandboxSettingsPath: null,
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

// ---------------------------------------------------------------------------
// srt sandbox wrapping (issue #213)
// ---------------------------------------------------------------------------

test('wrapWithSandbox is a byte-identical no-op for unsandboxed runs', async () => {
  const workspace = await createDirectory()
  const prepared = await prepareProviderCommand({
    run: makeRun(workspace, 'claude'),
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory: path.join(workspace, 'logs-nosandbox'),
  })
  const wrapped = wrapWithSandbox(prepared, { sandboxSettingsPath: null }, process.env, null)
  assert.equal(wrapped, prepared)
})

test('wrapWithSandbox wraps the command in srt and reroutes DB/Redis at the tunnels', () => {
  const prepared = {
    command: 'claude',
    args: ['-p', '--model', 'test'],
    cwd: '/workspace',
    env: {
      PATH: '/usr/bin',
      BOT_ENV: 'bot1',
      DATABASE_HOST: '100.107.149.100',
      DATABASE_PORT: '3306',
    } as NodeJS.ProcessEnv,
    rawLogPath: '/logs/raw.jsonl',
    stderrLogPath: '/logs/raw.stderr.log',
  }
  const ports = { mysqlPort: 51234, redisPort: 51235 }
  const wrapped = wrapWithSandbox(
    prepared,
    { sandboxSettingsPath: '/etc/srt.json' },
    {
      REDIS_URL: 'redis://:s3cret@100.107.149.100:6379/2',
    },
    ports,
  )
  assert.equal(wrapped.command, 'srt')
  assert.deepEqual(wrapped.args, ['--settings', '/etc/srt.json', 'claude', '-p', '--model', 'test'])
  assert.equal(wrapped.env.DATABASE_HOST, '127.0.0.1')
  assert.equal(wrapped.env.DATABASE_PORT, '51234')
  assert.equal(wrapped.env.REDIS_URL, 'redis://:s3cret@127.0.0.1:51235/2')
  assert.equal(wrapped.env.BOT_ENV, undefined)
  assert.equal(wrapped.env.PATH, '/usr/bin')
  assert.equal(wrapped.cwd, '/workspace')

  const customBin = wrapWithSandbox(
    prepared,
    { sandboxSettingsPath: '/etc/srt.json' },
    {
      GLOBAL_RUNTIME_SRT_BIN: '/opt/bin/srt-custom',
    },
    ports,
  )
  assert.equal(customBin.command, '/opt/bin/srt-custom')

  const badRedis = wrapWithSandbox(
    { ...prepared, env: { ...prepared.env, REDIS_URL: 'redis://old' } },
    { sandboxSettingsPath: '/etc/srt.json' },
    { REDIS_URL: 'not a url' },
    ports,
  )
  assert.equal(badRedis.env.REDIS_URL, undefined)

  // Without live tunnel ports a sandboxed session has no DB path at all —
  // refuse rather than launch a session that cannot reach MySQL/Redis.
  assert.throws(
    () => wrapWithSandbox(prepared, { sandboxSettingsPath: '/etc/srt.json' }, {}, null),
    /tunnel ports/u,
  )
})

test('sandboxed runs disable the provider CLIs own sandboxes (srt is the boundary)', async () => {
  const workspace = await createDirectory()
  const settingsPath = path.join(workspace, 'srt.json')
  await writeFile(settingsPath, '{}\n', 'utf8')

  const claude = await prepareProviderCommand({
    run: { ...makeRun(workspace, 'claude'), sandboxSettingsPath: settingsPath },
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory: path.join(workspace, 'logs-sbx-claude'),
    sandboxTunnelPorts: { mysqlPort: 51234, redisPort: 51235 },
  })
  assert.ok(claude.args.includes('bypassPermissions'))
  // The srt --settings pair is present; claude's inline seatbelt one is not.
  assert.deepEqual(claude.args.slice(0, 2), ['--settings', settingsPath])
  assert.equal(
    claude.args.filter((value) => value === '--settings').length,
    1,
    'the inner claude must not carry its own seatbelt settings under srt',
  )

  const codex = await prepareProviderCommand({
    run: { ...makeRun(workspace, 'codex'), sandboxSettingsPath: settingsPath },
    sessionNumber: 2,
    prompt: 'mission',
    logDirectory: path.join(workspace, 'logs-sbx-codex'),
    sandboxTunnelPorts: { mysqlPort: 51234, redisPort: 51235 },
  })
  assert.ok(codex.args.includes('danger-full-access'))
  assert.equal(codex.args.includes('workspace-write'), false)
})

test('fake-srt end-to-end: the adapter executes through the wrapper transparently', async () => {
  const workspace = await createDirectory()
  const settingsPath = path.join(workspace, 'srt.json')
  await writeFile(settingsPath, '{}\n', 'utf8')
  const fakeSrt = path.join(workspace, 'fake-srt.mjs')
  await writeFile(
    fakeSrt,
    `#!/usr/bin/env node
import { spawn } from 'node:child_process'
const args = process.argv.slice(2)
if (args[0] !== '--settings') {
  console.error('fake srt: expected --settings first, got ' + args[0])
  process.exit(64)
}
const child = spawn(args[2], args.slice(3), { stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
`,
    'utf8',
  )
  await chmod(fakeSrt, 0o700)
  const previousSrtBin = process.env.GLOBAL_RUNTIME_SRT_BIN
  process.env.GLOBAL_RUNTIME_SRT_BIN = fakeSrt
  process.env.GLOBAL_RUNTIME_CLAUDE_BIN = await createFakeCli(workspace)
  try {
    const adapter = new CliProviderAdapter()
    const result = await adapter.execute(
      {
        run: { ...makeRun(workspace, 'claude'), sandboxSettingsPath: settingsPath },
        sessionNumber: 7,
        prompt: 'test prompt',
        logDirectory: path.join(workspace, 'logs-srt-e2e'),
        sandboxTunnelPorts: { mysqlPort: 51234, redisPort: 51235 },
      },
      new AbortController().signal,
      { onStarted: () => undefined, onActivity: () => undefined },
    )
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.finalResult, { action: 'complete', summary: 'claude finished' })
  } finally {
    restoreEnv('GLOBAL_RUNTIME_SRT_BIN', previousSrtBin)
  }
})
