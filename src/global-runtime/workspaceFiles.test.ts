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
  unlink,
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

test('reports the protocol OWNER when the workspace has one, null otherwise', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-owner-test-'))
  temporaryDirectories.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(path.join(workspace, 'MISSION.md'), '# Test mission\n', 'utf8')

  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, null)

  await writeFile(path.join(workspace, 'OWNER'), 'worker-1\n', 'utf8')
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, 'worker-1')

  // Garbage (oversized) owner values are treated as absent, not surfaced.
  await writeFile(path.join(workspace, 'OWNER'), 'x'.repeat(65), 'utf8')
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, null)

  // Only the first line is read; CRLF endings are tolerated.
  await writeFile(path.join(workspace, 'OWNER'), 'worker-2\r\nsecond line\n', 'utf8')
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, 'worker-2')

  // Control/escape characters never reach clients.
  await writeFile(path.join(workspace, 'OWNER'), 'worker[31m-1\n', 'utf8')
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, null)
})

test('never dereferences a hostile OWNER (symlink out of the workspace, directory)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-owner-hostile-test-'))
  temporaryDirectories.push(root)
  const workspace = path.join(root, 'workspace')
  const secret = path.join(root, 'secret.txt')
  await mkdir(workspace)
  await writeFile(path.join(workspace, 'MISSION.md'), '# Test mission\n', 'utf8')
  await writeFile(secret, 'machine host login user password hunter2\n', 'utf8')

  // A sandboxed mission can write its own OWNER file; a symlink pointing at a
  // host file must not leak that file's first line through the endpoint.
  await symlink(secret, path.join(workspace, 'OWNER'))
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, null)

  await unlink(path.join(workspace, 'OWNER'))
  await mkdir(path.join(workspace, 'OWNER'))
  assert.equal((await readRuntimeFiles(makeRun(workspace))).protocolOwner, null)
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
    machineId: 'workspace-machine',
    name: 'workspace files test',
    provider: 'codex',
    model: 'test-model',
    effort: 'high',
    accessMode: 'workspace-write',
    authHome: null,
    sandboxSettingsPath: null,
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
