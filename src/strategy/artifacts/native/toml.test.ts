import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ENGINE_ROOT } from './host.js'
import { ENGINE_LOCK_REL } from './policy.js'
import {
  definedPaths,
  lockSubsetViolations,
  parseCargoLock,
  scanToml,
  splitDottedKey,
  tomlStringValue,
  type LockPackage,
} from './toml.js'

test('scanToml reads headers, dotted keys, comments and multi-line arrays', () => {
  const scan = scanToml(
    [
      'top.level.key = 1 # comment',
      '[package]',
      'name = "x" # trailing',
      'version = "0.0.0"',
      '[package.metadata."pmb"]',
      'format = 1',
      '[[bin]]',
      'name = "a#b"',
      '[target.aarch64-apple-darwin]',
      'rustflags = [',
      '  "--x", # inside',
      '  "--y",',
      ']',
      'lints.rust.unsafe_code = "forbid"',
    ].join('\n'),
  )
  assert.deepEqual(scan.tables, [
    'package',
    'package.metadata.pmb',
    'bin',
    'target.aarch64-apple-darwin',
  ])
  const byPath = new Map(scan.entries.map((e) => [e.path, e.value]))
  assert.equal(byPath.get('top.level.key'), '1')
  assert.equal(byPath.get('package.name'), '"x"')
  assert.equal(byPath.get('package.metadata.pmb.format'), '1')
  assert.equal(byPath.get('bin.name'), '"a#b"')
  assert.equal(byPath.get('target.aarch64-apple-darwin.rustflags'), '[ "--x", "--y", ]')
  assert.equal(byPath.get('target.aarch64-apple-darwin.lints.rust.unsafe_code'), '"forbid"')
  assert.ok(definedPaths(scan).includes('package.metadata.pmb'))
})

test('scanToml rejects what it cannot read instead of guessing (00 R14)', () => {
  assert.throws(() => scanToml('a = """\nx\n"""'), /multi-line strings/)
  assert.throws(() => scanToml('just text'), /cannot read/)
  assert.throws(() => scanToml('a = [1,\n2'), /unterminated/)
  assert.throws(() => splitDottedKey('a..b'), /empty segment/)
})

test('tomlStringValue decodes basic and literal strings only', () => {
  assert.equal(tomlStringValue('"forbid"'), 'forbid')
  assert.equal(tomlStringValue("'forbid'"), 'forbid')
  assert.equal(tomlStringValue('"a\\"b"'), 'a"b')
  assert.equal(tomlStringValue('forbid'), null)
  assert.equal(tomlStringValue('{ value = "x" }'), null)
})

// spec: 31 §3 item 3 — the engine lock is the reference for the subset rule.
test('parseCargoLock reads every [[package]] of native/Cargo.lock', () => {
  const text = readFileSync(path.join(ENGINE_ROOT, ENGINE_LOCK_REL), 'utf8')
  const pkgs = parseCargoLock(text)
  assert.equal(pkgs.length, (text.match(/^\[\[package\]\]$/gm) ?? []).length)
  const serde = pkgs.find((p) => p.name === 'serde')
  assert.ok(serde)
  assert.match(serde.source ?? '', /^registry\+/)
  assert.match(serde.checksum ?? '', /^[0-9a-f]{64}$/)
  const core = pkgs.find((p) => p.name === 'pmb-core')
  assert.ok(core)
  assert.equal(core.source, null)
  assert.equal(core.checksum, null)
})

// spec: 31 §3 item 3 — same name, version, source and checksum as the engine lock.
test('lockSubsetViolations flags missing packages and checksum differences, ignores path packages', () => {
  const reg = 'registry+https://github.com/rust-lang/crates.io-index'
  const engine: LockPackage[] = [
    { name: 'serde', version: '1.0.219', source: reg, checksum: 'aa' },
    { name: 'pmb-sdk', version: '0.1.0', source: null, checksum: null },
  ]
  assert.deepEqual(
    lockSubsetViolations(
      [
        { name: 'serde', version: '1.0.219', source: reg, checksum: 'aa' },
        { name: 'my-strategies', version: '0.0.0', source: null, checksum: null },
      ],
      engine,
    ),
    [],
  )
  const v = lockSubsetViolations(
    [
      { name: 'serde', version: '1.0.219', source: reg, checksum: 'bb' },
      { name: 'serde', version: '1.0.218', source: reg, checksum: 'aa' },
      { name: 'rand', version: '0.8.5', source: reg, checksum: 'cc' },
    ],
    engine,
  )
  assert.equal(v.length, 3)
  assert.match(v[0]!, /checksum bb differs/)
  assert.match(v[1]!, /serde 1\.0\.218 .* is not in native\/Cargo\.lock/)
  assert.match(v[2]!, /rand 0\.8\.5/)
})

test('a lock is always a subset of itself', () => {
  const text = readFileSync(path.join(ENGINE_ROOT, ENGINE_LOCK_REL), 'utf8')
  const pkgs = parseCargoLock(text)
  assert.deepEqual(lockSubsetViolations(pkgs, pkgs), [])
})
