import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSessionPrompt,
  GLOBAL_RUNTIME_CONTRACT_VERSION,
  SESSION_RESULT_FILE,
} from './contracts.js'
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
  const prompt = buildSessionPrompt(exampleRun(), 2)

  assert.doesNotMatch(prompt, /\{\{/u)
  assert.match(prompt, /session 2 of at most 5/u)
  assert.match(prompt, /"Contract test loop"/u)
  assert.match(prompt, new RegExp(`Contract v${GLOBAL_RUNTIME_CONTRACT_VERSION}\\b`, 'u'))
  assert.ok(prompt.includes('MISSION.md'))
  assert.ok(prompt.includes('STATUS.md'))
  assert.ok(prompt.includes('JOURNAL.md'))
  assert.ok(prompt.includes('INBOX.md'))
  assert.ok(prompt.includes(SESSION_RESULT_FILE))
  assert.match(prompt, /continue:/u)
  assert.match(prompt, /complete:/u)
  assert.match(prompt, /wait:/u)
})

test('session prompt lists configured read-only files or none', () => {
  assert.match(buildSessionPrompt(exampleRun(), 1), /None\./u)
  const prompt = buildSessionPrompt(
    exampleRun({ readOnlyFiles: ['RESULT.md', 'data/notes.md'] }),
    1,
  )
  assert.match(prompt, /- RESULT\.md/u)
  assert.match(prompt, /- data\/notes\.md/u)
})

test('session prompt uses per-run state file paths', () => {
  const prompt = buildSessionPrompt(
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
