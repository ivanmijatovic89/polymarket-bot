import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isNativeCheckInvocation,
  isNativePublishInvocation,
  isRustStrategyPackage,
  parseNativeCheckArgs,
  parseNativePublishArgs,
} from './cli.js'

function tempPackage(manifest: string | null): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-cli-test-'))
  if (manifest !== null) writeFileSync(path.join(dir, 'Cargo.toml'), manifest)
  return dir
}

// spec: 31 §7 — detection from a Cargo.toml with [package.metadata.pmb] or a .rs entrypoint.
test('Rust packages are detected by [package.metadata.pmb]; everything else stays on the TS path', () => {
  const rust = tempPackage('[package]\nname = "a"\n\n[package.metadata.pmb]\nformat = 1\n')
  const plainCargo = tempPackage('[package]\nname = "a"\n')
  const ts = tempPackage(null)
  try {
    mkdirSync(path.join(ts, 'strategies'))
    assert.equal(isRustStrategyPackage(rust), true)
    assert.equal(isRustStrategyPackage(plainCargo), false)
    assert.equal(isRustStrategyPackage(ts), false)
    // The TS publish invocation of docs/strategy/external-artifacts.md is untouched.
    assert.equal(
      isNativePublishInvocation(['--repo', ts, '--entrypoint', 'strategies/my.v1.ts']),
      false,
    )
    assert.equal(
      isNativePublishInvocation(['--repo', ts, '--entrypoint', 'strategies/my.v1.ts', '--dry-run']),
      false,
    )
    assert.equal(isNativePublishInvocation(['--repo', rust, '--bin', 'x']), true)
    assert.equal(isNativePublishInvocation(['--repo', rust]), true)
    assert.equal(isNativePublishInvocation(['--local-only', '--repo', ts]), true)
    assert.equal(isNativePublishInvocation(['--repo=x', '--entrypoint=src/bin/a.rs']), true)
    assert.equal(isNativeCheckInvocation(['--repo', rust]), true)
    assert.equal(isNativeCheckInvocation([`--repo=${rust}`]), true)
    assert.equal(isNativeCheckInvocation(['--repo', ts]), false)
    assert.equal(isNativeCheckInvocation(['--repo', plainCargo]), false)
  } finally {
    for (const d of [rust, plainCargo, ts]) rmSync(d, { recursive: true, force: true })
  }
})

// spec: 01 §6 M1 proof — npm run strategy:publish -- --local-only --repo native/strategies --bin engine-exerciser
test('parseNativePublishArgs reads the M1 proof command', () => {
  const a = parseNativePublishArgs([
    '--local-only',
    '--repo',
    'native/strategies',
    '--bin',
    'engine-exerciser',
  ])
  assert.equal(a.bin, 'engine-exerciser')
  assert.equal(a.repo, path.resolve('native/strategies'))
  assert.equal(a.localOnly, true)
  assert.equal(a.allowDirty, false)
  assert.equal(a.skipChecks, false)
  assert.equal(a.parityCheck, false)
  assert.equal(a.backgroundQos, false)
  assert.equal(a.targetDir, null)
  const b = parseNativePublishArgs([
    '--repo=p',
    '--entrypoint=src/bin/lag-v15.rs',
    '--qos',
    'background',
    '--target-dir',
    '/t',
  ])
  assert.equal(b.bin, 'lag-v15')
  assert.equal(b.backgroundQos, true)
  assert.equal(b.targetDir, '/t')
})

// spec: 31 §7.2 step 3 — any other profile and the real-orders feature are refused; 00 R14 unknown flags.
test('parseNativePublishArgs refuses profiles, features, unknown flags and bad entrypoints', () => {
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--bin', 'x', '--profile', 'iterate']),
    /refused/,
  )
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--bin', 'x', '--features=pmb-sdk/real-orders']),
    /refused/,
  )
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--bin', 'x', '--dry-run']),
    /unknown argument/,
  )
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--entrypoint', '../x/src/bin/a.rs']),
    /src\/bin\/<name>\.rs/,
  )
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--entrypoint', 'src/bin/a.ts']),
    /src\/bin\/<name>\.rs/,
  )
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--bin', 'a', '--entrypoint', 'src/bin/a.rs']),
    /mutually exclusive/,
  )
  assert.throws(() => parseNativePublishArgs(['--repo', 'p']), /usage/)
  assert.throws(
    () => parseNativePublishArgs(['--repo', 'p', '--bin', 'x', '--qos', 'fast']),
    /--qos/,
  )
  assert.throws(() => parseNativePublishArgs(['--repo', 'p', '--bin']), /needs a value/)
})

test('parseNativeCheckArgs accepts --repo and refuses unknown flags', () => {
  assert.equal(parseNativeCheckArgs(['--repo', 'p']).repo, path.resolve('p'))
  assert.throws(() => parseNativeCheckArgs(['--repo', 'p', '--fix']), /unknown argument/)
  assert.throws(() => parseNativeCheckArgs([]), /usage/)
})
