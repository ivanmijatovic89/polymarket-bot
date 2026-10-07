import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  cleanStaleAdmissionTemporaryDirectories,
  withAdmissionTemporaryDirectory,
} from './admissionTemporary.js'

test('admission crash recovery removes only dead owned leases, preserving active and unrelated files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-temporary-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, pid] of [
    ['capture-dead', 2_147_483_647],
    ['capture-active', process.pid],
  ] as const) {
    const directory = path.join(root, name)
    await mkdir(directory)
    await writeFile(
      path.join(directory, 'admission-owner.json'),
      JSON.stringify({ owner: 'recorder-v4-admission', version: 1, pid, createdAtMs: Date.now() }),
    )
    await writeFile(path.join(directory, 'events.parquet'), 'data')
  }
  await mkdir(path.join(root, 'capture-unowned'))
  await writeFile(path.join(root, 'keep.txt'), 'unrelated')
  await cleanStaleAdmissionTemporaryDirectories(root)
  assert.deepEqual((await readdir(root)).sort(), ['capture-active', 'capture-unowned', 'keep.txt'])
})

test('admission temporary downloads are cleaned after success or failure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-temporary-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(
    await withAdmissionTemporaryDirectory(async (directory) => {
      await writeFile(path.join(directory, 'events.parquet'), 'data')
      return 'verified'
    }, root),
    'verified',
  )
  await assert.rejects(
    withAdmissionTemporaryDirectory(async () => {
      throw new Error('download interrupted')
    }, root),
    /download interrupted/,
  )
  assert.deepEqual(await readdir(root), [])
})
