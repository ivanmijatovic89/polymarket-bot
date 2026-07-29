import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderSessionContract, SESSION_RESULT_FILE } from './contracts.js'
import type { RuntimeRun } from './types.js'

function exampleRun(overrides: Partial<RuntimeRun> = {}): RuntimeRun {
  const now = new Date(0)
  return {
    id: 1,
    name: 'Contract test loop',
    provider: 'codex',
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    workspacePath: '/tmp/workspace',
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
    ...overrides,
  }
}

test('session prompt renders the template with every placeholder resolved', () => {
  const { prompt, version } = renderSessionContract(exampleRun(), 2)

  assert.ok(Number.isSafeInteger(version) && version >= 1)
  assert.doesNotMatch(prompt, /\{\{/u)
  assert.doesNotMatch(prompt, /contract-version:/u)
  assert.match(prompt, /^You are session 2 of at most 5/u)
  assert.match(prompt, /"Contract test loop"/u)
  assert.match(prompt, new RegExp(`Contract v${version}\\b`, 'u'))
  assert.ok(prompt.includes('MISSION.md'))
  assert.ok(prompt.includes('STATUS.md'))
  assert.ok(prompt.includes('JOURNAL.md'))
  assert.ok(prompt.includes('INBOX.md'))
  assert.ok(prompt.includes(SESSION_RESULT_FILE))
  assert.match(prompt, /continue:/u)
  assert.match(prompt, /complete:/u)
  assert.match(prompt, /wait:/u)
})

test('contract version comes from the template file, not a code constant', () => {
  const raw = readFileSync(new URL('./session-contract.md', import.meta.url), 'utf8')
  const declared = /^<!--\s*contract-version:\s*(\d+)\s*-->/u.exec(raw)
  assert.ok(declared, 'session-contract.md must declare its contract version')
  assert.equal(renderSessionContract(exampleRun(), 1).version, Number(declared[1]))
})

test('session prompt lists configured read-only files or none', () => {
  assert.match(renderSessionContract(exampleRun(), 1).prompt, /None\./u)
  const { prompt } = renderSessionContract(
    exampleRun({ readOnlyFiles: ['RESULT.md', 'data/notes.md'] }),
    1,
  )
  assert.match(prompt, /- RESULT\.md/u)
  assert.match(prompt, /- data\/notes\.md/u)
})

test('session prompt uses per-run state file paths', () => {
  const { prompt } = renderSessionContract(
    exampleRun({
      statusFile: '.global-runtime/runs/x/STATUS.md',
      journalFile: '.global-runtime/runs/x/JOURNAL.md',
      inboxFile: '.global-runtime/runs/x/INBOX.md',
    }),
    1,
  )
  assert.ok(prompt.includes('.global-runtime/runs/x/STATUS.md'))
  assert.ok(prompt.includes('.global-runtime/runs/x/JOURNAL.md'))
  assert.ok(prompt.includes('.global-runtime/runs/x/INBOX.md'))
})
