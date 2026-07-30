import assert from 'node:assert/strict'
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import type { RuntimeRun } from './types.js'
import { appendInboxEntry, readRuntimeFiles, validateRunWorkspace } from './workspaceFiles.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

test('rejects a dangling inbox symlink without creating its external target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-inbox-symlink-test-'))
  temporaryDirectories.push(root)
  const workspace = path.join(root, 'workspace')
  const externalTarget = path.join(root, 'outside.md')
  await mkdir(workspace)
  await symlink(externalTarget, path.join(workspace, 'INBOX.md'))

  await assert.rejects(
    () => appendInboxEntry(makeRun(workspace), 'must stay inside'),
    /must not be a symbolic link/iu,
  )
  await assert.rejects(
    () => stat(externalTarget),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
  )
})

test('rejects an inbox hard link without modifying its external peer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-inbox-hardlink-test-'))
  temporaryDirectories.push(root)
  const workspace = path.join(root, 'workspace')
  const externalTarget = path.join(root, 'outside.md')
  await mkdir(workspace)
  await writeFile(externalTarget, 'outside content\n', 'utf8')
  await link(externalTarget, path.join(workspace, 'INBOX.md'))

  await assert.rejects(
    () => appendInboxEntry(makeRun(workspace), 'must stay inside'),
    /must not be hard-linked/iu,
  )
  assert.equal(await readFile(externalTarget, 'utf8'), 'outside content\n')
})

test('rejects configured file reads through links outside the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-read-link-test-'))
  temporaryDirectories.push(root)
  const workspace = path.join(root, 'workspace')
  const externalTarget = path.join(root, 'outside.md')
  await mkdir(workspace)
  await writeFile(externalTarget, 'outside content\n', 'utf8')
  await symlink(externalTarget, path.join(workspace, 'STATUS.md'))

  await assert.rejects(
    () => readRuntimeFiles(makeRun(workspace)),
    /resolves outside the configured workspace/iu,
  )
})

test(
  'rejects state files that alias each other only by casing on case-insensitive filesystems',
  { skip: process.platform !== 'darwin' && process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-case-alias-test-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'workspace'))
    const workspace = await realpath(path.join(root, 'workspace'))
    await writeFile(path.join(workspace, 'MISSION.md'), '# Test mission\n', 'utf8')

    await assert.rejects(
      () => validateRunWorkspace({ ...makeRun(workspace), journalFile: 'status.MD' }),
      /overlaps/iu,
    )
    // APFS/HFS+ are normalization-insensitive too: NFC and NFD spellings of
    // the same name open one physical file.
    await assert.rejects(
      () =>
        validateRunWorkspace({
          ...makeRun(workspace),
          statusFile: 'caf\u00e9.md',
          journalFile: 'cafe\u0301.md',
        }),
      /overlaps/iu,
    )
    await assert.rejects(
      () =>
        validateRunWorkspace({
          ...makeRun(workspace),
          inboxFile: '.Global-Runtime/Session-Result.json',
        }),
      /reserved/iu,
    )
  },
)

function makeRun(workspacePath: string): RuntimeRun {
  const now = new Date()

  return {
    id: 1,
    name: 'workspace files test',
    provider: 'codex',
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    workspacePath,
    missionPath: 'MISSION.md',
    maxSessions: 1,
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
