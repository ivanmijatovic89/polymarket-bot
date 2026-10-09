import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalJson,
  classifyDepInfo,
  computeEngineSourceHash,
  computeSourceHash,
  isEngineSourcePath,
  normalizeFileEntries,
  parseDepInfo,
  sha256Hex,
  type SourceHashInput,
} from './sourceHash.js'

// spec: 31 §5.2 — canonical JSON: keys sorted, no whitespace.
test('canonicalJson sorts keys recursively and emits no whitespace', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [true, null, 'x y'], c: 'q' } }),
    '{"a":{"c":"q","d":[true,null,"x y"]},"b":1}',
  )
  assert.equal(canonicalJson('line1\nline2'), '"line1\\nline2"')
  assert.throws(() => canonicalJson({ a: undefined }), /undefined/)
  assert.throws(() => canonicalJson(Number.NaN), /non-finite/)
})

test('parseDepInfo handles escaped spaces and line continuations', () => {
  const d = parseDepInfo('/t/x/bin: /a/src/lib.rs /a/my\\ dir/x.rs \\\n  /b/c.rs\n')
  assert.equal(d.target, '/t/x/bin')
  assert.deepEqual(d.deps, ['/a/src/lib.rs', '/a/my dir/x.rs', '/b/c.rs'])
  assert.throws(() => parseDepInfo(''), /empty/)
  assert.throws(() => parseDepInfo('no colon here'), /malformed/)
})

// spec: 31 §5.2 — roles: engine root vs package root; registry and toolchain excluded; anything else fails.
test('classifyDepInfo assigns roles and reports files outside the allowed roots', () => {
  const roots = {
    engineRoot: '/e',
    packageRoot: '/e/native/strategies',
    excludedRoots: ['/h/.cargo/registry', '/h/.rustup'],
  }
  const r = classifyDepInfo(
    [
      '/e/native/strategies/src/bin/x.rs',
      '/e/native/crates/pmb-sdk/src/lib.rs',
      '/h/.cargo/registry/src/index/serde-1.0.219/src/lib.rs',
      '/h/.rustup/toolchains/x/lib/rustlib/src/rust/library/core/src/lib.rs',
      '/h/.cache/pmb/target/out/generated.rs',
      'relative.rs',
    ],
    roots,
  )
  assert.deepEqual(r.files, [
    ['strategy', 'src/bin/x.rs', '/e/native/strategies/src/bin/x.rs'],
    ['engine', 'native/crates/pmb-sdk/src/lib.rs', '/e/native/crates/pmb-sdk/src/lib.rs'],
  ])
  assert.deepEqual(r.outside, ['/h/.cache/pmb/target/out/generated.rs', 'relative.rs'])
})

const INPUT: SourceHashInput = {
  v: 1,
  target: 'aarch64-apple-darwin',
  profile: 'artifact',
  rustc: 'rustc 1.89.0 (29483883e 2025-08-04)\nrelease: 1.89.0',
  deploymentTarget: '11.0',
  buildConfig: sha256Hex('config'),
  lock: sha256Hex('lock'),
  files: [
    ['strategy', 'src/bin/x.rs', sha256Hex('x')],
    ['engine', 'native/crates/pmb-sdk/src/lib.rs', sha256Hex('sdk')],
    ['strategy', 'Cargo.toml', sha256Hex('manifest')],
  ],
}

// spec: 31 §5.2 — source_hash = sha256 of the canonical JSON of the input.
test('computeSourceHash equals sha256 of the canonical JSON with sorted files', () => {
  const expected = sha256Hex(canonicalJson({ ...INPUT, files: normalizeFileEntries(INPUT.files) }))
  assert.equal(computeSourceHash(INPUT), expected)
  // File order does not matter; content, profile and rustc do.
  assert.equal(computeSourceHash({ ...INPUT, files: [...INPUT.files].reverse() }), expected)
  assert.notEqual(computeSourceHash({ ...INPUT, profile: 'iterate' }), expected)
  assert.notEqual(computeSourceHash({ ...INPUT, rustc: `${INPUT.rustc} ` }), expected)
  assert.notEqual(
    computeSourceHash({
      ...INPUT,
      files: [...INPUT.files.slice(1), ['strategy', 'src/bin/x.rs', sha256Hex('y')]],
    }),
    expected,
  )
  // Known-answer vector, recomputed independently with Python
  // (json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)):
  // pins the serialization so a refactor cannot change it silently.
  assert.equal(expected, 'afff0885df7c0aac01c5ab2e71ae1d16e566cbf64a55ccc7998017fca74b325a')
})

test('normalizeFileEntries dedupes identical entries and rejects conflicting hashes', () => {
  const e = INPUT.files[0]!
  assert.equal(normalizeFileEntries([e, e]).length, 1)
  assert.throws(() => normalizeFileEntries([e, [e[0], e[1], sha256Hex('other')]]), /conflicting/)
})

// spec: 31 §5.3 — the engine source set.
test('isEngineSourcePath follows the engine source set of 31 §5.3', () => {
  const yes = [
    'native/Cargo.toml',
    'native/Cargo.lock',
    'native/rust-toolchain.toml',
    'native/build/artifact-build.toml',
    'native/build/clippy/clippy.toml',
    'native/build/pgo/x.profdata',
    'native/crates/pmb-core/src/lib.rs',
    'native/crates/pmb-core/Cargo.toml',
    'native/crates/pmb-core/src/tests/inline.rs',
  ]
  const no = [
    'native/crates/pmb-core/tests/fixed.rs',
    'native/crates/pmb-core/benches/b.rs',
    'native/crates/pmb-core/README.md',
    'native/crates/pmb-core/src/notes.MD',
    'native/STATUS.md',
    'native/spec/00-README.md',
    'native/strategies/src/bin/x.rs',
    'native/fixtures/a.json',
    'src/native/x.ts',
  ]
  for (const p of yes) assert.equal(isEngineSourcePath(p), true, p)
  for (const p of no) assert.equal(isEngineSourcePath(p), false, p)
})

test('computeEngineSourceHash is order independent and rejects duplicates', () => {
  const a: Array<[string, string]> = [
    ['native/Cargo.toml', sha256Hex('a')],
    ['native/build/x', sha256Hex('b')],
  ]
  assert.equal(computeEngineSourceHash(a), computeEngineSourceHash([...a].reverse()))
  assert.equal(computeEngineSourceHash(a), sha256Hex(canonicalJson([...a].sort())))
  assert.throws(() => computeEngineSourceHash([a[0]!, a[0]!]), /duplicate/)
})
