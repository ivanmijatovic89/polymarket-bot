import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { resolveParquetFilesFromDirs } from './resolveParquetFilesFromDirs.js'

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('resolveParquetFilesFromDirs returns only parquet files (non-recursive)', async () => {
  const dir = await mkTmpDir('bt-dir-')
  const nested = path.join(dir, 'nested')
  await fs.mkdir(nested)
  const a = path.join(dir, 'a.parquet')
  const b = path.join(dir, 'b.txt')
  const c = path.join(nested, 'c.parquet')
  await fs.writeFile(a, 'a')
  await fs.writeFile(b, 'b')
  await fs.writeFile(c, 'c')

  const files = await resolveParquetFilesFromDirs([dir])

  assert.deepEqual(files, [a])
})

test('resolveParquetFilesFromDirs combines multiple dirs', async () => {
  const dirA = await mkTmpDir('bt-dir-a-')
  const dirB = await mkTmpDir('bt-dir-b-')
  const a = path.join(dirA, 'a.parquet')
  const b = path.join(dirB, 'b.parquet')
  await fs.writeFile(a, 'a')
  await fs.writeFile(b, 'b')

  const files = await resolveParquetFilesFromDirs([dirA, dirB])

  assert.deepEqual(files, [a, b])
})
