import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  STAGED_PACKAGE_DIR,
  materializeStage,
  planStage,
  removeStage,
  splitDependencyPath,
} from './stage.js'

// spec: 31 §2.2 (relative path dependency, sibling convention), §4.3, D17.
test('splitDependencyPath separates the climb from the tail', () => {
  assert.deepEqual(splitDependencyPath('../crates/pmb-sdk'), { up: 1, tail: ['crates', 'pmb-sdk'] })
  assert.deepEqual(splitDependencyPath('../../polymarket-bot/native/crates/pmb-sdk'), {
    up: 2,
    tail: ['polymarket-bot', 'native', 'crates', 'pmb-sdk'],
  })
  assert.deepEqual(splitDependencyPath('./../x/../crates/pmb-sdk'), {
    up: 1,
    tail: ['crates', 'pmb-sdk'],
  })
  assert.equal(splitDependencyPath('vendor/pmb-sdk').up, 0)
  assert.throws(() => splitDependencyPath('/abs/pmb-sdk'), /not a relative/)
})

test('planStage mirrors the climbed directory and chains the package at the same depth', () => {
  const list = (dir: string): string[] => {
    assert.equal(dir, '/h/Sites')
    return ['polymarket-bot', 'protocols-repo', 'other']
  }
  const plan = planStage({
    stageRoot: '/s',
    realPackageRoot: '/h/Sites/protocols-repo/pkg',
    sdkRelPath: '../../polymarket-bot/native/crates/pmb-sdk',
    listDir: list,
  })
  assert.equal(plan.stagedPackageRoot, `/s/${STAGED_PACKAGE_DIR}/${STAGED_PACKAGE_DIR}`)
  assert.deepEqual(plan.dirs, ['/s', `/s/${STAGED_PACKAGE_DIR}`])
  assert.deepEqual(plan.links, [
    ['/s/other', '/h/Sites/other'],
    ['/s/polymarket-bot', '/h/Sites/polymarket-bot'],
    ['/s/protocols-repo', '/h/Sites/protocols-repo'],
    [plan.stagedPackageRoot, '/h/Sites/protocols-repo/pkg'],
  ])
  // The staged dependency path is the same string wherever the host keeps things.
  assert.equal(
    path.posix.join(plan.stagedPackageRoot, '../../polymarket-bot/native/crates/pmb-sdk'),
    '/s/polymarket-bot/native/crates/pmb-sdk',
  )
  const none = planStage({
    stageRoot: '/s',
    realPackageRoot: '/p',
    sdkRelPath: null,
    listDir: list,
  })
  assert.deepEqual(none.links, [[`/s/${STAGED_PACKAGE_DIR}`, '/p']])
  assert.throws(
    () =>
      planStage({
        stageRoot: '/s',
        realPackageRoot: '/p/q',
        sdkRelPath: 'v/pmb-sdk',
        listDir: list,
      }),
    /inside the package/,
  )
  assert.throws(
    () =>
      planStage({
        stageRoot: '/s',
        realPackageRoot: '/h/Sites/x',
        sdkRelPath: '../e/pmb-sdk',
        listDir: () => [STAGED_PACKAGE_DIR],
      }),
    /collides/,
  )
})

test('materializeStage and removeStage never touch the link targets', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmb-stage-test-'))
  try {
    const real = path.join(root, 'real')
    mkdirSync(path.join(real, 'engine', 'native'), { recursive: true })
    mkdirSync(path.join(real, 'pkg'), { recursive: true })
    writeFileSync(path.join(real, 'engine', 'native', 'Cargo.toml'), 'ws')
    const stage = path.join(root, 'stage')
    const plan = planStage({
      stageRoot: stage,
      realPackageRoot: path.join(real, 'pkg'),
      sdkRelPath: '../engine/native/crates/pmb-sdk',
      listDir: (d) => (d === real ? ['engine', 'pkg'] : []),
    })
    materializeStage(plan)
    assert.equal(readFileSync(path.join(stage, 'engine', 'native', 'Cargo.toml'), 'utf8'), 'ws')
    assert.equal(existsSync(path.join(plan.stagedPackageRoot)), true)
    materializeStage(plan) // replaces an earlier stage
    removeStage(stage)
    assert.equal(existsSync(stage), false)
    assert.equal(readFileSync(path.join(real, 'engine', 'native', 'Cargo.toml'), 'utf8'), 'ws')
    symlinkSync(real, stage)
    assert.throws(() => removeStage(stage), /not a directory/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
