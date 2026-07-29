import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildRuntimeApi } from './api.js'
import { MemoryRuntimeStore } from './memoryStore.js'
import { GlobalRuntime } from './runtime.js'

test('local API creates a loop and returns persisted Mission Control state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'runtime-api-test-'))
  await writeFile(path.join(workspace, 'MISSION.md'), '# API test\n', 'utf8')
  const runtime = new GlobalRuntime(new MemoryRuntimeStore())
  const app = buildRuntimeApi(runtime)
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: {
        name: 'API loop',
        provider: 'codex',
        model: 'test-model',
        effort: 'high',
        accessMode: 'workspace-write',
        authHome: null,
        workspacePath: workspace,
        missionPath: 'MISSION.md',
        maxSessions: 3,
        delaySeconds: 0,
        statusFile: 'STATUS.md',
        journalFile: 'JOURNAL.md',
        inboxFile: 'INBOX.md',
        readOnlyFiles: [],
      },
    })
    assert.equal(created.statusCode, 201)
    const runId = created.json<{ run: { id: number } }>().run.id

    const listed = await app.inject({ method: 'GET', url: '/runs' })
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.json<{ runs: unknown[] }>().runs.length, 1)

    const detail = await app.inject({ method: 'GET', url: `/runs/${runId}` })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json<{ run: { name: string } }>().run.name, 'API loop')

    const extended = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/extend`,
      payload: { maxSessions: 8 },
    })
    assert.equal(extended.statusCode, 200)
    assert.equal(extended.json<{ run: { maxSessions: number } }>().run.maxSessions, 8)

    const rejectedExtension = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/extend`,
      payload: { maxSessions: 8 },
    })
    assert.equal(rejectedExtension.statusCode, 400)

    const inbox = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/inbox`,
      payload: { message: 'Use the narrower hypothesis.' },
    })
    assert.equal(inbox.statusCode, 201)
    const files = await app.inject({ method: 'GET', url: `/runs/${runId}/files` })
    assert.match(files.body, /Use the narrower hypothesis/u)
  } finally {
    await app.close()
    await runtime.shutdown()
    await rm(workspace, { recursive: true })
  }
})

test('local API gives each run an isolated server-generated state directory', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'runtime-api-state-test-'))
  await writeFile(path.join(workspace, 'MISSION.md'), '# API state test\n', 'utf8')
  const runtime = new GlobalRuntime(new MemoryRuntimeStore())
  const app = buildRuntimeApi(runtime)
  const payload = {
    name: 'Isolated API loop',
    provider: 'codex',
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    workspacePath: workspace,
    missionPath: 'MISSION.md',
    maxSessions: 3,
    delaySeconds: 0,
    isolatedStateFiles: true,
    readOnlyFiles: [],
  }
  try {
    const first = await app.inject({ method: 'POST', url: '/runs', payload })
    const second = await app.inject({ method: 'POST', url: '/runs', payload })
    const sharedDefaults = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { ...payload, isolatedStateFiles: false },
    })
    const ambiguous = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { ...payload, statusFile: 'STATUS.md' },
    })
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(sharedDefaults.statusCode, 201)
    assert.equal(ambiguous.statusCode, 400)

    const firstRun = first.json<{
      run: { statusFile: string; journalFile: string; inboxFile: string }
    }>().run
    const secondRun = second.json<{
      run: { statusFile: string; journalFile: string; inboxFile: string }
    }>().run
    const firstDirectory = path.posix.dirname(firstRun.statusFile)

    assert.match(firstDirectory, /^\.global-runtime\/runs\/[0-9a-f-]{36}$/u)
    assert.equal(path.posix.dirname(firstRun.journalFile), firstDirectory)
    assert.equal(path.posix.dirname(firstRun.inboxFile), firstDirectory)
    assert.notEqual(path.posix.dirname(secondRun.statusFile), firstDirectory)
    assert.equal(sharedDefaults.json<{ run: { statusFile: string } }>().run.statusFile, 'STATUS.md')
  } finally {
    await app.close()
    await runtime.shutdown()
    await rm(workspace, { recursive: true })
  }
})

test('local API reports invalid workspace configuration as a client error', async () => {
  const runtime = new GlobalRuntime(new MemoryRuntimeStore())
  const app = buildRuntimeApi(runtime)
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: {
        name: 'Invalid loop',
        provider: 'codex',
        model: 'test-model',
        effort: 'high',
        accessMode: 'workspace-write',
        authHome: null,
        workspacePath: '/path/that/does/not/exist',
        missionPath: 'MISSION.md',
        maxSessions: 3,
        delaySeconds: 0,
        statusFile: 'STATUS.md',
        journalFile: 'JOURNAL.md',
        inboxFile: 'INBOX.md',
        readOnlyFiles: [],
      },
    })
    assert.equal(response.statusCode, 400)
  } finally {
    await app.close()
    await runtime.shutdown()
  }
})

test('local API rejects control requests until runtime initialization completes', async () => {
  const runtime = new GlobalRuntime(new MemoryRuntimeStore())
  let ready = false
  const app = buildRuntimeApi(runtime, { isReady: () => ready })
  try {
    const unavailable = await app.inject({ method: 'GET', url: '/runs' })
    assert.equal(unavailable.statusCode, 503)
    assert.deepEqual(unavailable.json(), { error: 'runtime is initializing' })

    const health = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(health.statusCode, 503)
    assert.deepEqual(health.json(), { ok: false })

    ready = true
    const available = await app.inject({ method: 'GET', url: '/runs' })
    assert.equal(available.statusCode, 200)
  } finally {
    await app.close()
    await runtime.shutdown()
  }
})

test('local API preserves Fastify client errors for malformed and oversized bodies', async () => {
  const runtime = new GlobalRuntime(new MemoryRuntimeStore())
  const app = buildRuntimeApi(runtime)
  try {
    const malformed = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    })
    assert.equal(malformed.statusCode, 400)
    assert.match(malformed.json<{ error: string }>().error, /not valid JSON/iu)

    const oversized = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { value: 'x'.repeat(33 * 1024) },
    })
    assert.equal(oversized.statusCode, 413)
    assert.match(oversized.json<{ error: string }>().error, /too large/iu)
  } finally {
    await app.close()
    await runtime.shutdown()
  }
})
