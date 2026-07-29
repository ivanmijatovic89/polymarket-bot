import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { SESSION_RESULT_FILE } from './contracts.js'
import { CliProviderAdapter, prepareProviderCommand } from './providers.js'
import type { RuntimeRun } from './types.js'

const temporaryDirectories: string[] = []
const originalCodexBin = process.env.GLOBAL_RUNTIME_CODEX_BIN
const originalClaudeBin = process.env.GLOBAL_RUNTIME_CLAUDE_BIN

afterEach(async () => {
  restoreEnv('GLOBAL_RUNTIME_CODEX_BIN', originalCodexBin)
  restoreEnv('GLOBAL_RUNTIME_CLAUDE_BIN', originalClaudeBin)
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

test('builds shell-free Claude and Codex commands with the requested access and effort', async () => {
  const workspace = await createDirectory()
  const logDirectory = path.join(workspace, 'logs')
  const codex = await prepareProviderCommand({
    run: makeRun(workspace, 'codex'),
    sessionNumber: 1,
    prompt: 'mission',
    logDirectory,
  })
  const claude = await prepareProviderCommand({
    run: makeRun(workspace, 'claude'),
    sessionNumber: 2,
    prompt: 'mission',
    logDirectory,
  })

  assert.equal(codex.command, 'codex')
  assert.deepEqual(codex.args.slice(0, 3), ['exec', '--json', '--ephemeral'])
  assert.ok(codex.args.includes('--skip-git-repo-check'))
  assert.ok(codex.args.includes('workspace-write'))
  assert.ok(codex.args.includes('model_reasoning_effort="high"'))
  assert.equal(claude.command, 'claude')
  assert.ok(claude.args.includes('--no-session-persistence'))
  assert.ok(claude.args.includes('acceptEdits'))
  assert.ok(claude.args.includes('--json-schema'))
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
    assert.equal(result.usage.inputTokens, provider === 'codex' ? 11 : 21)
    assert.equal(result.usage.outputTokens, provider === 'codex' ? 7 : 9)
  }
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
  console.log(JSON.stringify({ type: 'result', structured_output: result, usage: { input_tokens: 21, cache_read_input_tokens: 4, output_tokens: 9 } }))
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
