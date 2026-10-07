import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readdir, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAdmissionEvidence, writeAdmissionEvidence } from './admissionCache.js'

test('admission cache is bounded and evicts only owned evidence within bounded bucket files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hash = (i: number) => `aa${i.toString(16).padStart(62, '0')}`
  const evidence = { websiteObserved: true, openingReasons: ['x'.repeat(3000)] }
  await writeAdmissionEvidence(root, hash(0), evidence)
  const unrelated = path.join(root, 'keep-this-file.json')
  await writeFile(unrelated, 'user file')
  for (let i = 1; i < 30; i++) await writeAdmissionEvidence(root, hash(i), evidence)
  assert.deepEqual((await readdir(root)).sort(), ['bucket-aa.json', 'keep-this-file.json'])
  const bucket = await readFile(path.join(root, 'bucket-aa.json'))
  assert.ok(bucket.byteLength <= 64 * 1024)
  assert.ok(JSON.parse(bucket.toString()).entries.length < 30)
  assert.equal(await readFile(unrelated, 'utf8'), 'user file')
  assert.deepEqual(await readAdmissionEvidence(root, hash(29)), evidence)
  assert.equal(await readAdmissionEvidence(root, hash(0)), null)
})

test('malformed or mismatched admission evidence is ignored and cache paths cannot escape', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hash = 'a'.repeat(64)
  await writeAdmissionEvidence(root, hash, { websiteObserved: false, openingReasons: ['missing'] })
  const file = path.join(root, 'bucket-aa.json')
  const modified = JSON.parse(await readFile(file, 'utf8'))
  modified.entries[0].evidence.websiteObserved = true
  await writeFile(file, JSON.stringify(modified))
  assert.equal(await readAdmissionEvidence(root, hash), null)
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      entries: [
        { manifestSha256: 'b'.repeat(64), evidence: { websiteObserved: true, openingReasons: [] } },
      ],
    }),
  )
  assert.equal(await readAdmissionEvidence(root, hash), null)
  await writeFile(file, '{')
  assert.equal(await readAdmissionEvidence(root, hash), null)
  await assert.rejects(readAdmissionEvidence(root, '../escape'), /Invalid/)
})

test('later admission writes reclaim only dead-PID owned regular temporary files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-cache-recovery-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const temporary = (pid: number, suffix: number) =>
    `bucket-aa.json.writer-${pid}-11111111-2222-4333-8444-${suffix.toString().padStart(12, '0')}.tmp`
  const dead = temporary(2_147_483_647, 1)
  const active = temporary(process.pid, 2)
  const denied = temporary(2_147_483_646, 3)
  const link = temporary(2_147_483_647, 4)
  const directory = temporary(2_147_483_647, 5)
  const unrelated = 'bucket-aa.json.unowned.tmp'
  await Promise.all(
    [dead, active, denied, unrelated].map((name) => writeFile(path.join(root, name), 'preserve')),
  )
  await symlink(unrelated, path.join(root, link))
  await mkdir(path.join(root, directory))
  const originalKill = process.kill.bind(process)
  t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
    if (pid === 2_147_483_646) throw Object.assign(new Error('Denied'), { code: 'EPERM' })
    return originalKill(pid, signal)
  })
  await writeAdmissionEvidence(root, 'a'.repeat(64), {
    websiteObserved: true,
    openingReasons: [],
  })
  assert.deepEqual(
    (await readdir(root)).sort(),
    [active, denied, link, directory, unrelated, 'bucket-aa.json'].sort(),
  )
  assert.equal(await readFile(path.join(root, link), 'utf8'), 'preserve')
})

test('failed admission-cache replacement removes only its own temporary file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-cache-failure-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // A directory at the committed path forces rename to fail after writing/syncing.
  const destination = path.join(root, 'bucket-aa.json')
  await mkdir(destination)
  await writeFile(path.join(destination, 'keep.txt'), 'user data')
  await assert.rejects(
    writeAdmissionEvidence(root, 'a'.repeat(64), { websiteObserved: true, openingReasons: [] }),
  )
  assert.deepEqual(await readdir(root), ['bucket-aa.json'])
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'user data')
})

test('concurrent admission-cache writers publish valid buckets without leaving temporary files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admission-cache-concurrent-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hashes = Array.from({ length: 8 }, (_, i) => `aa${i.toString(16).padStart(62, '0')}`)
  const evidence = { websiteObserved: true, openingReasons: [] }
  await Promise.all(hashes.map((hash) => writeAdmissionEvidence(root, hash, evidence)))
  assert.deepEqual(await readdir(root), ['bucket-aa.json'])
  const entries = await Promise.all(hashes.map((hash) => readAdmissionEvidence(root, hash)))
  assert.ok(entries.some((entry) => entry !== null))
  for (const entry of entries) if (entry) assert.deepEqual(entry, evidence)
})
