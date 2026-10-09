import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ENGINE_ROOT } from './host.js'
import type { BuildManifest } from './manifest.js'
import { publishNativeLocalOnly, runNativeCheck } from './pipeline.js'
import { computeSourceHash, sha256Hex } from './sourceHash.js'

// End-to-end runs of the real toolchain on the std-only proof package of
// scripts/native/build-proof-package.sh. They need macOS on Apple Silicon
// with the pinned toolchain and the Xcode tools, so they are skipped
// elsewhere (Linux CI). The local cache and target directories are temporary.
const hasToolchain =
  process.platform === 'darwin' &&
  process.arch === 'arm64' &&
  spawnSync('cargo', ['-V']).status === 0 &&
  spawnSync('codesign', ['-h']).error === undefined
const skip = hasToolchain ? false : 'needs aarch64-apple-darwin with cargo and codesign'

function proofPackage(root: string): string {
  const r = spawnSync(path.join(ENGINE_ROOT, 'scripts/native/build-proof-package.sh'), [root], {
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  return path.join(root, 'strategies')
}

const quiet = (): void => {}

// spec: 31 §4.3, §5.1, D17 — identical bytes from two package locations and two
// target directories of different path lengths; 31 §6.1 cache layout; 31 §5.4 manifest.
test('local-only publish is reproducible across package and target paths', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const a = proofPackage(path.join(work, 'a'))
    const b = proofPackage(path.join(work, 'b', 'deeper', 'nested'))
    const cacheDir = path.join(work, 'cache')
    const common = {
      bin: 'builder-proof',
      allowDirty: false,
      skipChecks: false,
      parityCheck: false,
      cacheDir,
      log: quiet,
    }
    const [ra] = publishNativeLocalOnly({
      ...common,
      packageDir: a,
      targetDir: path.join(work, 't1'),
    })
    const [rb] = publishNativeLocalOnly({
      ...common,
      packageDir: b,
      targetDir: path.join(work, 'b', 'a-much-longer-target-directory'),
    })
    assert.ok(ra && rb)
    assert.equal(ra.reusedFor, null)
    assert.equal(rb.reusedFor, null, 'the second build produced different bytes')
    assert.equal(rb.sha256, ra.sha256)
    assert.equal(rb.alreadyCached, true)
    assert.equal(ra.binaryPath, path.join(cacheDir, ra.sha256))
    const bytes = readFileSync(ra.binaryPath)
    assert.equal(sha256Hex(bytes), ra.sha256)
    const m = JSON.parse(readFileSync(ra.manifestPath, 'utf8')) as BuildManifest
    assert.equal(m.artifact.profile, 'artifact')
    assert.equal(m.artifact.strategyId, 'builder-proof.v1')
    assert.equal(computeSourceHash(m.sourceHashInput), m.sourceHash)
    assert.ok(
      !JSON.stringify(m.build).includes(os.homedir()),
      'host paths must be remapped in the manifest',
    )
    const sign = spawnSync('codesign', ['-dv', ra.binaryPath], { encoding: 'utf8' })
    assert.match(sign.stderr, /Identifier=pmb\.builder-proof\.v1/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §4.4 step 4 — a binary embedding the package root fails the build.
test('the path-leak gate fails a binary that embeds its package root', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'leak'))
    const lib = path.join(pkg, 'src', 'lib.rs')
    writeFileSync(
      lib,
      `${readFileSync(lib, 'utf8')}\n/// Leaks the package root.\npub const ROOT: &str = env!("CARGO_MANIFEST_DIR");\n`,
    )
    const bin = path.join(pkg, 'src', 'bin', 'builder-proof.rs')
    // Print the root from selftest, so describe (and the id) stay valid and
    // the build reaches the path-leak gate.
    const src = readFileSync(bin, 'utf8')
    const selftest = 'println!("{{\\"type\\":\\"selftest\\",\\"ok\\":true,\\"checks\\":[]}}")'
    assert.ok(src.includes(selftest))
    writeFileSync(
      bin,
      src.replace(
        selftest,
        'println!("{{\\"type\\":\\"selftest\\",\\"ok\\":true,\\"checks\\":[],\\"root\\":\\"{}\\"}}", proof_strategies::ROOT)',
      ),
    )
    assert.throws(
      () =>
        publishNativeLocalOnly({
          packageDir: pkg,
          bin: 'builder-proof',
          allowDirty: true,
          skipChecks: true,
          parityCheck: false,
          cacheDir: path.join(work, 'cache'),
          targetDir: path.join(work, 't'),
          log: quiet,
        }),
      /path-leak gate failed[\s\S]*\/private\/tmp\/pmb-native-e2e-/,
    )
    assert.equal(existsSync(path.join(work, 'cache')), false)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// spec: 31 §7.1 — the Rust strategy:check gates on a clean package.
test('strategy:check passes the proof package with pre-SDK pending gates', { skip }, () => {
  const work = mkdtempSync(path.join('/private/tmp', 'pmb-native-e2e-'))
  try {
    const pkg = proofPackage(path.join(work, 'p'))
    const { ok, gates } = runNativeCheck({
      packageDir: pkg,
      targetDir: path.join(work, 't'),
      log: quiet,
    })
    assert.equal(ok, true)
    assert.deepEqual(
      gates.map((g) => [g.gate, g.status]),
      [
        [1, 'pass'],
        [2, 'pass'],
        [3, 'pass'],
        [4, 'pending'],
        [5, 'pass'],
        [6, 'pass'],
        [7, 'pending'],
      ],
    )
    // Gate 2 fails on unformatted code; gate 1 on a forbidden section.
    writeFileSync(path.join(pkg, 'src', 'lib.rs'), 'pub const ID: &str="builder-proof.v1";\n')
    const manifest = path.join(pkg, 'Cargo.toml')
    writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[profile.release]\nlto = false\n`)
    const bad = runNativeCheck({ packageDir: pkg, targetDir: path.join(work, 't'), log: quiet })
    assert.equal(bad.ok, false)
    assert.equal(bad.gates.find((g) => g.gate === 1)?.status, 'fail')
    assert.equal(bad.gates.find((g) => g.gate === 2)?.status, 'fail')
    assert.equal(bad.gates.find((g) => g.gate === 5)?.status, 'skipped')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
