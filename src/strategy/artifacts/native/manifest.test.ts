import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cachePaths,
  findSameSourceInCache,
  makeManifest,
  writeToLocalCache,
  type BuildManifest,
} from './manifest.js'
import { computeSourceHash, sha256Hex, type SourceHashInput } from './sourceHash.js'

const INPUT: SourceHashInput = {
  v: 1,
  target: 'aarch64-apple-darwin',
  profile: 'artifact',
  rustc: 'release: 1.89.0',
  deploymentTarget: '11.0',
  buildConfig: sha256Hex('c'),
  lock: sha256Hex('l'),
  files: [['strategy', 'src/bin/x.rs', sha256Hex('x')]],
}

function manifestFor(bytes: Buffer, input: SourceHashInput = INPUT): BuildManifest {
  return makeManifest({
    artifact: {
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
      kind: 'native',
      variant: 'standard',
      target: 'aarch64-apple-darwin',
      profile: 'artifact',
      formatVersion: 1,
      strategyId: 'demo.v1',
    },
    package: { name: 'demo', bin: 'x', entrypoint: 'pkg/src/bin/x.rs', engineRelPath: null },
    sourceHash: computeSourceHash(input),
    sourceHashInput: input,
    build: {
      command: ['cargo', 'build'],
      env: { PMB_BUILD_PROFILE: 'artifact' },
      renderedConfig: '[build]\n',
      backgroundQos: false,
      buildJobs: null,
      wallTimeMs: { cargo: 1, total: 2 },
    },
    toolchain: {
      rustc: 'r',
      cargo: 'c',
      macosSdk: '26.5',
      ld: 'ld',
      cc: 'cc',
      clt: '1',
      host: 'h',
    },
    git: {
      strategy: { repo: 'r', commit: 'c'.repeat(40), dirty: false, allowDirty: false },
      engine: { commit: 'e'.repeat(40), dirty: false, sourceHash: 'f'.repeat(64) },
    },
    describe: { type: 'describe' },
    pendingChecks: [],
    builtAt: '2026-10-09T00:00:00.000Z',
  })
}

// spec: 31 §5.4 — the manifest carries a source hash that its own input recomputes.
test('makeManifest refuses a source hash that its input does not reproduce', () => {
  const m = manifestFor(Buffer.from('bin'))
  assert.equal(m.manifestVersion, 1)
  assert.equal(computeSourceHash(m.sourceHashInput), m.sourceHash)
  assert.throws(() => makeManifest({ ...m, sourceHash: 'f'.repeat(64) }), /does not match/)
})

// spec: 31 §6.1 — data/strategy-artifacts/native/<sha> (0755) and <sha>.build.json.
test('writeToLocalCache writes binary and manifest atomically and is idempotent', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-cache-test-'))
  try {
    const bytes = Buffer.from('fake binary bytes')
    const m = manifestFor(bytes)
    const first = writeToLocalCache(dir, bytes, m)
    const sha = sha256Hex(bytes)
    const expected = cachePaths(dir, sha)
    assert.deepEqual(first, {
      binaryPath: expected.binary,
      manifestPath: expected.manifest,
      alreadyCached: false,
    })
    assert.equal(expected.binary, path.join(dir, sha))
    assert.equal(expected.manifest, path.join(dir, `${sha}.build.json`))
    assert.equal(statSync(first.binaryPath).mode & 0o777, 0o755)
    assert.deepEqual(readFileSync(first.binaryPath), bytes)
    assert.equal(
      (JSON.parse(readFileSync(first.manifestPath, 'utf8')) as BuildManifest).artifact.sha256,
      sha,
    )
    // No temp files left behind.
    assert.deepEqual(readdirSync(dir).sort(), [sha, `${sha}.build.json`].sort())
    // Second write: same bytes, cache untouched, first manifest kept.
    const again = writeToLocalCache(dir, bytes, { ...m, builtAt: '2030-01-01T00:00:00.000Z' })
    assert.equal(again.alreadyCached, true)
    assert.match(readFileSync(first.manifestPath, 'utf8'), /2026-10-09/)
    // A corrupt cached file is replaced.
    writeFileSync(first.binaryPath, 'corrupt')
    assert.equal(writeToLocalCache(dir, bytes, m).alreadyCached, false)
    assert.deepEqual(readFileSync(first.binaryPath), bytes)
    assert.throws(() => writeToLocalCache(dir, Buffer.from('other'), m), /does not match the bytes/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// spec: 31 §5.6 step 2 with --local-only (§7.2): same source hash, target, variant and profile.
test('findSameSourceInCache finds an earlier sha with the same source hash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-cache-test-'))
  try {
    const old = Buffer.from('old bytes')
    const m = manifestFor(old)
    writeToLocalCache(dir, old, m)
    const key = {
      sourceHash: m.sourceHash,
      target: 'aarch64-apple-darwin',
      variant: 'standard',
      profile: 'artifact',
      sha256: sha256Hex('new bytes'),
      dirty: false,
    }
    assert.equal(findSameSourceInCache(dir, key), sha256Hex(old))
    assert.equal(findSameSourceInCache(dir, { ...key, sha256: sha256Hex(old) }), null)
    assert.equal(findSameSourceInCache(dir, { ...key, profile: 'parity-check' }), null)
    assert.equal(findSameSourceInCache(dir, { ...key, sourceHash: 'f'.repeat(64) }), null)
    rmSync(path.join(dir, sha256Hex(old)))
    assert.equal(findSameSourceInCache(dir, key), null)
    assert.equal(findSameSourceInCache(path.join(dir, 'missing'), key), null)
    assert.equal(existsSync(dir), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// spec: 31 §5.6 step 2, 00 R14 — no silent skip of a corrupt manifest, no reuse
// of a binary that no longer matches its name, no dirty build reused for a clean one.
test('findSameSourceInCache fails loud on corrupt entries and keeps clean builds clean', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pmb-native-cache-test-'))
  try {
    const old = Buffer.from('dirty bytes')
    const base = manifestFor(old)
    const m: BuildManifest = {
      ...base,
      git: { ...base.git, engine: { ...base.git.engine, dirty: true } },
    }
    writeToLocalCache(dir, old, m)
    const key = {
      sourceHash: m.sourceHash,
      target: 'aarch64-apple-darwin',
      variant: 'standard',
      profile: 'artifact',
      sha256: sha256Hex('new bytes'),
      dirty: false,
    }
    assert.equal(
      findSameSourceInCache(dir, key),
      null,
      'a dirty build is not reused for a clean one',
    )
    assert.equal(findSameSourceInCache(dir, { ...key, dirty: true }), sha256Hex(old))
    writeFileSync(path.join(dir, sha256Hex(old)), 'tampered')
    assert.throws(() => findSameSourceInCache(dir, { ...key, dirty: true }), /hashes to/)
    writeFileSync(path.join(dir, `${'a'.repeat(64)}.build.json`), '{not json')
    assert.throws(() => findSameSourceInCache(dir, key), /unreadable build manifest/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cachePaths rejects a non-sha name', () => {
  assert.throws(() => cachePaths('/x', '../etc/passwd'), /not a sha256/)
})
