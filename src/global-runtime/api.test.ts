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
