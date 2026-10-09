import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkPackageRules,
  countStrategyMain,
  gitignoreHasTargetRule,
  type CargoMetadataDependency,
  type CargoMetadataPackage,
  type PackageRuleInput,
} from './packageRules.js'

const ROOT = '/repo/pkg'
const TOOLCHAIN = '[toolchain]\nchannel = "1.89.0"\ncomponents = ["rustfmt", "clippy"]\n'
const REG = 'registry+https://github.com/rust-lang/crates.io-index'

const MANIFEST = `[package]
name = "demo-strategies"
edition = "2021"
version = "0.0.0"
publish = false

[workspace]

[package.metadata.pmb]
format = 1

[dependencies]
pmb-sdk = { path = "../engine/native/crates/pmb-sdk" }

[dev-dependencies]
pmb-sdk = { path = "../engine/native/crates/pmb-sdk", features = ["testkit"] }

[lints.rust]
unsafe_code = "forbid"
`

function dep(over: Partial<CargoMetadataDependency>): CargoMetadataDependency {
  return {
    name: 'pmb-sdk',
    source: null,
    kind: null,
    rename: null,
    optional: false,
    uses_default_features: true,
    features: [],
    target: null,
    ...over,
  }
}

function pkg(over: Partial<CargoMetadataPackage> = {}): CargoMetadataPackage {
  return {
    name: 'demo-strategies',
    version: '0.0.0',
    id: 'path+file:///repo/pkg#demo-strategies@0.0.0',
    source: null,
    manifest_path: `${ROOT}/Cargo.toml`,
    dependencies: [dep({}), dep({ kind: 'dev', features: ['testkit'] })],
    targets: [
      { name: 'demo_strategies', kind: ['lib'], src_path: `${ROOT}/src/lib.rs` },
      { name: 'lag-v1', kind: ['bin'], src_path: `${ROOT}/src/bin/lag-v1.rs` },
    ],
    features: {},
    links: null,
    metadata: { pmb: { format: 1 } },
    ...over,
  }
}

function input(over: Partial<PackageRuleInput> = {}): PackageRuleInput {
  return {
    packageRoot: ROOT,
    manifestText: MANIFEST,
    pkg: pkg(),
    workspaceRoot: ROOT,
    sdkManifest: '/repo/engine/native/crates/pmb-sdk/Cargo.toml',
    resolvedSdkManifest: '/repo/engine/native/crates/pmb-sdk/Cargo.toml',
    packageToolchain: TOOLCHAIN,
    engineToolchain: TOOLCHAIN,
    packageLock: [{ name: 'serde', version: '1.0.219', source: REG, checksum: 'aa' }],
    engineLock: [{ name: 'serde', version: '1.0.219', source: REG, checksum: 'aa' }],
    packageGitignoresTarget: true,
    repoRootIgnoresTarget: true,
    binSources: new Map([['lag-v1', 'use pmb_sdk::prelude::*;\npmb_sdk::strategy_main!(Lag);\n']]),
    ...over,
  }
}

// spec: 31 §2.2 — the template package passes every rule.
test('the template package of 31 §2.2 passes', () => {
  assert.deepEqual(checkPackageRules(input()), { violations: [], pending: [] })
})

// spec: 31 §2.2 row 2 — no [profile], [patch], [replace], [target], [features], build.rs, links, proc-macro.
test('forbidden manifest sections and keys are violations', () => {
  for (const extra of [
    '[profile.release]\nlto = false',
    '[patch.crates-io]\nserde = { path = "x" }',
    '[replace]\n"serde:1.0.0" = { path = "x" }',
    '[target.aarch64-apple-darwin.dependencies]\nlibc = "0.2"',
    '[features]\nreal = ["pmb-sdk/real-orders"]',
    '[build-dependencies]\ncc = "1"',
    'profile.release.lto = false',
  ]) {
    const text = extra.startsWith('profile.') ? `${extra}\n${MANIFEST}` : `${MANIFEST}\n${extra}\n`
    const r = checkPackageRules(input({ manifestText: text }))
    assert.ok(
      r.violations.some((v) => v.includes('forbidden')),
      extra,
    )
  }
  const withBuild = checkPackageRules(
    input({
      pkg: pkg({
        targets: [
          ...pkg().targets,
          { name: 'build-script-build', kind: ['custom-build'], src_path: `${ROOT}/build.rs` },
        ],
      }),
    }),
  )
  assert.ok(withBuild.violations.some((v) => v.includes('build.rs')))
  assert.ok(
    checkPackageRules(input({ pkg: pkg({ links: 'z' }) })).violations.some((v) =>
      v.includes('links'),
    ),
  )
  assert.ok(
    checkPackageRules(input({ pkg: pkg({ features: { x: [] } }) })).violations.some((v) =>
      v.includes('[features]'),
    ),
  )
})

// spec: 31 §2.2 row 3, 30 §11 — unsafe_code = "forbid".
test('a missing or weakened unsafe_code forbid is a violation', () => {
  for (const text of [
    MANIFEST.replace('unsafe_code = "forbid"', 'unsafe_code = "deny"'),
    MANIFEST.replace(/\[lints\.rust\][\s\S]*$/, ''),
  ]) {
    assert.ok(
      checkPackageRules(input({ manifestText: text })).violations.some((v) =>
        v.includes('unsafe_code'),
      ),
    )
  }
})

// spec: 31 §2.2 row 1, D16, §5.5 — only pmb-sdk; no features; dev-dependency with exactly testkit.
test('dependencies other than plain pmb-sdk are violations', () => {
  const cases: Array<[CargoMetadataDependency[], RegExp]> = [
    [[dep({}), dep({ name: 'serde', source: REG })], /only allowed dependency is pmb-sdk/],
    [[dep({ features: ['real-orders'] })], /MUST NOT enable features/],
    [[dep({}), dep({ kind: 'dev', features: [] })], /exactly the "testkit" feature/],
    [
      [dep({}), dep({ kind: 'dev', features: ['testkit', 'real-orders'] })],
      /exactly the "testkit" feature/,
    ],
    [[dep({ uses_default_features: false })], /default features/],
    [[dep({ source: REG })], /path dependency/],
    [[dep({ kind: 'build' })], /build-dependencies are forbidden/],
    [[dep({ rename: 'sdk' })], /only allowed dependency/],
    [[], /pmb-sdk \(path\) is required/],
  ]
  for (const [deps, re] of cases) {
    const r = checkPackageRules(input({ pkg: pkg({ dependencies: deps }) }))
    assert.match(r.violations.join('\n'), re)
  }
  const other = checkPackageRules(
    input({ resolvedSdkManifest: '/elsewhere/native/crates/pmb-sdk/Cargo.toml' }),
  )
  assert.match(other.violations.join('\n'), /not this engine checkout/)
})

// Pre-SDK phase: native/crates/pmb-sdk does not exist yet; the SDK rules are reported as pending.
test('before pmb-sdk exists a dependency-free package passes with pending rules', () => {
  const r = checkPackageRules(
    input({
      sdkManifest: null,
      resolvedSdkManifest: null,
      pkg: pkg({ dependencies: [] }),
      binSources: new Map([['lag-v1', 'fn main() {}']]),
    }),
  )
  assert.deepEqual(r.violations, [])
  assert.equal(r.pending.length, 2)
  const withSdk = checkPackageRules(input({ sdkManifest: null }))
  assert.match(withSdk.violations.join('\n'), /does not exist in this engine checkout/)
})

// spec: 31 §2.2 row 6, 30 §4 rule 1 — strategy_main! exactly once; bins under src/bin.
test('bins must live in src/bin and call strategy_main! exactly once', () => {
  assert.equal(countStrategyMain('pmb_sdk::strategy_main!(A);'), 1)
  assert.equal(
    countStrategyMain('// strategy_main!(A);\n/* strategy_main!(B); */\nstrategy_main!(C);'),
    1,
  )
  assert.equal(countStrategyMain('strategy_main!(A);\nstrategy_main!{B}'), 2)
  const twice = checkPackageRules(
    input({ binSources: new Map([['lag-v1', 'strategy_main!(A);\nstrategy_main!(B);']]) }),
  )
  assert.match(twice.violations.join('\n'), /2 times/)
  const misplaced = checkPackageRules(
    input({
      pkg: pkg({ targets: [{ name: 'lag-v1', kind: ['bin'], src_path: `${ROOT}/src/main.rs` }] }),
    }),
  )
  assert.match(misplaced.violations.join('\n'), /MUST be src\/bin\/lag-v1\.rs/)
  const none = checkPackageRules(input({ pkg: pkg({ targets: [] }) }))
  assert.match(none.violations.join('\n'), /no bin target/)
})

// spec: 31 §2.2 rows 4-5, §3 item 3.
test('toolchain, gitignore, workspace, metadata and lock rules', () => {
  const v = (over: Partial<PackageRuleInput>): string =>
    checkPackageRules(input(over)).violations.join('\n')
  assert.match(v({ packageToolchain: null }), /rust-toolchain\.toml is missing/)
  assert.match(
    v({ packageToolchain: TOOLCHAIN.replace('1.89.0', '1.90.0') }),
    /differs from the engine/,
  )
  assert.match(v({ packageGitignoresTarget: false }), /package \.gitignore/)
  assert.match(v({ repoRootIgnoresTarget: false }), /repository root \.gitignore/)
  assert.match(v({ workspaceRoot: '/repo' }), /captured by the workspace/)
  assert.match(v({ pkg: pkg({ metadata: null }) }), /format = 1/)
  assert.match(v({ packageLock: null }), /Cargo\.lock is missing/)
  assert.match(
    v({ packageLock: [{ name: 'serde', version: '1.0.219', source: REG, checksum: 'bb' }] }),
    /checksum bb differs/,
  )
})

test('gitignoreHasTargetRule recognizes the usual target rules', () => {
  for (const t of ['target/', '/target', 'target', '**/target/', 'node_modules\n  target/  \n'])
    assert.equal(gitignoreHasTargetRule(t), true, t)
  for (const t of ['', 'targets/', '# target/', 'build/'])
    assert.equal(gitignoreHasTargetRule(t), false, t)
})
