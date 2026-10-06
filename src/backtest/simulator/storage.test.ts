import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simulatorDirectoryBytes, simulatorWorkerAlive } from './storage.js'

test('session accounting includes nested interrupted downloads but never follows dataset symlinks', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sim-storage-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const session = path.join(directory, 'session')
  mkdirSync(path.join(session, 'input', 'recording'), { recursive: true })
  writeFileSync(path.join(session, 'trace.json.gz'), '123')
  writeFileSync(path.join(session, 'input', 'recording', 'events.parquet.partial'), '12345')
  const original = path.join(directory, 'original.parquet')
  writeFileSync(original, '0'.repeat(10_000))
  const link = path.join(session, 'input', 'original')
  symlinkSync(original, link)
  assert.equal(simulatorDirectoryBytes(session), 8 + lstatSync(link).size)
  assert.equal(simulatorDirectoryBytes(path.join(directory, 'removed')), 0)
  assert.equal(lstatSync(original).size, 10_000)
})

test('active child leases protect live processes and reject invalid PIDs', () => {
  assert.equal(simulatorWorkerAlive(process.pid), true)
  for (const pid of [undefined, null, '1', 0, -1, 1.5, Number.NaN])
    assert.equal(simulatorWorkerAlive(pid), false)
})
