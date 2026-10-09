import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
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
