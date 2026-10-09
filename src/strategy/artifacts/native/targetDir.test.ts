import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chooseEviction, enforceTargetBudget, profileDirs, withBuilderLock } from './targetDir.js'

// spec: 31 §4.5 — above the budget, delete the least recently used profile directory.
test('chooseEviction picks the least recently used other profile only when over budget', () => {
  const usage = [
    { profile: 'artifact' as const, lastUsedMs: 300 },
    { profile: 'iterate' as const, lastUsedMs: 100 },
    { profile: 'parity-check' as const, lastUsedMs: 200 },
  ]
  assert.equal(
    chooseEviction({ usage, totalBytes: 10, budgetBytes: 10, building: 'artifact' }),
    null,
  )
  assert.equal(
    chooseEviction({ usage, totalBytes: 11, budgetBytes: 10, building: 'artifact' }),
    'iterate',
  )
  assert.equal(
    chooseEviction({ usage, totalBytes: 11, budgetBytes: 10, building: 'iterate' }),
    'parity-check',
  )
  assert.equal(
    chooseEviction({
      usage: [{ profile: 'artifact', lastUsedMs: 1 }],
      totalBytes: 11,
      budgetBytes: 10,
      building: 'artifact',
    }),
    null,
  )
  // Ties break by name, so the choice is deterministic.
  assert.equal(
    chooseEviction({
      usage: [
        { profile: 'profiling', lastUsedMs: 0 },
        { profile: 'iterate', lastUsedMs: 0 },
      ],
      totalBytes: 11,
      budgetBytes: 10,
      building: 'artifact',
    }),
    'iterate',
  )
})

test('enforceTargetBudget deletes both directories of the LRU profile and marks the building one', () => {
  const t = mkdtempSync(path.join(os.tmpdir(), 'pmb-target-test-'))
  try {
    for (const p of ['iterate', 'artifact'] as const) {
      for (const d of profileDirs(t, p)) {
        mkdirSync(d, { recursive: true })
        writeFileSync(path.join(d, 'blob'), Buffer.alloc(64 * 1024))
      }
    }
    mkdirSync(path.join(t, '.pmb-profile-used'))
    writeFileSync(path.join(t, '.pmb-profile-used', 'iterate'), '')
    utimesSync(path.join(t, '.pmb-profile-used', 'iterate'), new Date(1000), new Date(1000))
    const logs: string[] = []
    assert.equal(
      enforceTargetBudget(t, 'artifact', 1024 ** 3, (m) => logs.push(m)),
      null,
    )
    assert.equal(
      enforceTargetBudget(t, 'artifact', 1024, (m) => logs.push(m)),
      'iterate',
    )
    for (const d of profileDirs(t, 'iterate')) assert.equal(existsSync(d), false)
    for (const d of profileDirs(t, 'artifact')) assert.equal(existsSync(d), true)
    assert.equal(existsSync(path.join(t, '.pmb-profile-used', 'artifact')), true)
    assert.match(logs.join('\n'), /least recently used profile iterate/)
  } finally {
    rmSync(t, { recursive: true, force: true })
  }
})

// spec: 31 §4.5 — the builder runs one build at a time per host.
test('withBuilderLock serializes, releases on error and takes over a stale lock', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-lock-test-'))
  const lock = path.join(dir, 'builder.lock')
  try {
    const logs: string[] = []
    assert.equal(
      withBuilderLock(
        lock,
        (m) => logs.push(m),
        () => {
          assert.equal(existsSync(lock), true)
          return 7
        },
      ),
      7,
    )
    assert.equal(existsSync(lock), false)
    assert.throws(
      () =>
        withBuilderLock(
          lock,
          () => {},
          () => {
            throw new Error('boom')
          },
        ),
      /boom/,
    )
    assert.equal(existsSync(lock), false)
    // A lock held by a process that no longer exists is stale.
    const dead = spawnSync('true').pid
    assert.ok(dead)
    writeFileSync(lock, `${dead}\n`)
    assert.equal(
      withBuilderLock(
        lock,
        (m) => logs.push(m),
        () => 'ok',
      ),
      'ok',
    )
    assert.match(logs.join('\n'), /stale builder lock/)
    assert.equal(existsSync(lock), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const TARGET_DIR_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'targetDir.ts')

function waitFor(cond: () => boolean, timeoutMs: number): void {
  const until = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > until) throw new Error('timed out')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
}

// spec: 31 §4.5 — one build at a time per host, across processes: a second
// builder waits until the first one releases the lock.
test('withBuilderLock excludes a second process until the holder releases', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-lock-2p-'))
  const lock = path.join(dir, 'builder.lock')
  const entered = path.join(dir, 'child-entered')
  const released = path.join(dir, 'child-released')
  const script = path.join(dir, 'child.mts')
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs'
import { withBuilderLock } from ${JSON.stringify(TARGET_DIR_MODULE)}
withBuilderLock(${JSON.stringify(lock)}, () => {}, () => {
  writeFileSync(${JSON.stringify(entered)}, '')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200)
  writeFileSync(${JSON.stringify(released)}, '')
})
`,
  )
  const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit' })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  try {
    waitFor(() => existsSync(entered), 30_000)
    const logs: string[] = []
    const sawRelease = withBuilderLock(
      lock,
      (m) => logs.push(m),
      () => existsSync(released),
      { pollMs: 50 },
    )
    assert.equal(sawRelease, true, 'entered while the other process held the lock')
    assert.match(logs.join('\n'), /waiting for the builder lock held by pid \d+/)
    assert.equal(await exited, 0)
    assert.equal(existsSync(lock), false)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

// spec: 31 §4.5 — an empty lock (a writer between create and write) is held,
// not stale, until it is older than the grace period.
test('withBuilderLock treats an empty lock as held during the grace period', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-lock-empty-'))
  const lock = path.join(dir, 'builder.lock')
  try {
    writeFileSync(lock, '')
    const logs: string[] = []
    const t0 = Date.now()
    withBuilderLock(
      lock,
      (m) => logs.push(m),
      () => assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`),
      { graceMs: 400, pollMs: 25 },
    )
    assert.ok(Date.now() - t0 >= 380, 'took over an empty lock before the grace period')
    assert.match(logs.join('\n'), /waiting for the builder lock held by an unreadable holder/)
    assert.match(logs.join('\n'), /stale builder lock \(pid unreadable\)/)
    assert.equal(existsSync(lock), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
