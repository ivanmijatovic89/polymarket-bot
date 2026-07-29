import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import type { RuntimeRun } from './types.js'
import { appendInboxEntry } from './workspaceFiles.js'

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

function makeRun(workspacePath: string): RuntimeRun {
  return {
    workspacePath,
    inboxFile: 'INBOX.md',
  } as RuntimeRun
}
