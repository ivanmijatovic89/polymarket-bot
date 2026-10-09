import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ENGINE_ROOT } from './host.js'
import {
  BUILD_CONFIG_REL,
  BUILD_PROFILES,
  remapHostPaths,
  remapPairs,
  renderBuildConfig,
  type BuildConfigValues,
} from './policy.js'
import { scanToml } from './toml.js'

const VALUES: BuildConfigValues = {
  CARGO_HOME: '/Users/a/.cargo',
  RUSTUP_HOME: '/Users/a/.rustup',
  ENGINE_ROOT: '/Users/a/Sites/bot',
  ENGINE_ROOT_REALPATH: '/Users/a/Sites/bot',
  TARGET_DIR: '/Users/a/.cache/pmb/target/1.89.0',
  STAGE_ROOT: '/tmp/pmb-stage',
  PMB_ENGINE_SOURCE_HASH: 'a'.repeat(64),
  PMB_ENGINE_COMMIT: 'b'.repeat(40),
  PMB_ENGINE_DIRTY: 'false',
  PMB_RUSTC: '1.89.0',
}

const template = readFileSync(path.join(ENGINE_ROOT, BUILD_CONFIG_REL), 'utf8')

function entry(rendered: string, key: string): string | undefined {
  return scanToml(rendered).entries.find((e) => e.path === key)?.value
}

// spec: 31 §4.2 — every pinned setting of the profiles and configuration.
test('the committed artifact-build.toml pins every setting of 31 §4.2', () => {
  const r = renderBuildConfig(template, VALUES)
  const expected: Array<[string, string]> = [
    ['build.target', '"aarch64-apple-darwin"'],
    ['profile.iterate.inherits', '"release"'],
    ['profile.iterate.opt-level', '3'],
    ['profile.iterate.lto', 'false'],
    ['profile.iterate.codegen-units', '16'],
    ['profile.iterate.panic', '"unwind"'],
    ['profile.iterate.overflow-checks', 'true'],
    ['profile.iterate.debug', 'false'],
    ['profile.iterate.strip', '"symbols"'],
    ['profile.iterate.incremental', 'false'],
    ['profile.artifact.inherits', '"iterate"'],
    ['profile.artifact.lto', '"thin"'],
    ['profile.artifact.codegen-units', '1'],
    ['profile.parity-check.inherits', '"artifact"'],
    ['profile.parity-check.debug-assertions', 'true'],
    ['profile.profiling.inherits', '"artifact"'],
    ['profile.profiling.debug', '"line-tables-only"'],
    ['profile.profiling.strip', 'false'],
    ['env.MACOSX_DEPLOYMENT_TARGET', '{ value = "11.0", force = true }'],
    ['env.PMB_ENGINE_SOURCE_HASH', `{ value = "${'a'.repeat(64)}", force = true }`],
    ['env.PMB_ENGINE_COMMIT', `{ value = "${'b'.repeat(40)}", force = true }`],
    ['env.PMB_ENGINE_DIRTY', '{ value = "false", force = true }'],
    ['env.PMB_RUSTC', '{ value = "1.89.0", force = true }'],
  ]
  for (const [k, v] of expected) assert.equal(entry(r, k), v, k)
  const flags = entry(r, 'target.aarch64-apple-darwin.rustflags') ?? ''
  for (const f of [
    '"--remap-path-prefix=/Users/a/.cargo=/cargo"',
    '"--remap-path-prefix=/Users/a/.rustup=/rustup"',
    '"--remap-path-prefix=/Users/a/Sites/bot=/pmb/engine"',
    '"--remap-path-prefix=/Users/a/.cache/pmb/target/1.89.0=/pmb/target"',
    // Engine sources reach rustc under the fixed staging root (stage.ts).
    '"--remap-path-prefix=/tmp/pmb-stage=/pmb/src"',
    // The linker debug map must not depend on the target directory (see the template).
    '"-Clink-arg=-Wl,-oso_prefix,/Users/a/.cache/pmb/target/1.89.0/"',
  ]) {
    assert.ok(flags.includes(f), `missing ${f} in ${flags}`)
  }
  // spec: 31 §4.2 / 16 BP-1 — target-cpu stays the target default.
  assert.ok(!r.includes('target-cpu'))
  assert.ok(!r.includes('{{'))
  // Comments never reach the rendered file.
  assert.ok(!r.includes('#'))
})

// spec: 31 §4.1 — the rendered file is identical for every command on one host:
// it holds every profile and nothing that depends on the command or profile.
test('the rendered file holds every profile and no per-command value', () => {
  const r = renderBuildConfig(template, VALUES)
  assert.equal(r, renderBuildConfig(template, { ...VALUES }))
  const tables = scanToml(r).tables
  for (const p of BUILD_PROFILES) assert.ok(tables.includes(`profile.${p}`), p)
  // The profile name reaches the binary through PMB_BUILD_PROFILE on the
  // cargo process (builder.ts), never through this file.
  assert.ok(!r.includes('PMB_BUILD_PROFILE'))
})

// spec: 00 R14 — unknown placeholders and unusable values fail loud.
test('renderBuildConfig rejects unknown placeholders, unused values and unsafe values', () => {
  assert.throws(() => renderBuildConfig('a = "{{NOPE}}"\n', VALUES), /unknown placeholder/)
  assert.throws(() => renderBuildConfig('a = "{{CARGO_HOME}}"\n', VALUES), /not used/)
  assert.throws(
    () => renderBuildConfig(template, { ...VALUES, CARGO_HOME: '/Users/a "x"' }),
    /cannot be embedded/,
  )
  assert.throws(
    () => renderBuildConfig(template, { ...VALUES, PMB_RUSTC: '' }),
    /cannot be embedded/,
  )
})

test('a placeholder inside a comment is not substituted', () => {
  const all = Object.keys(VALUES)
    .map((k) => `${k.toLowerCase()} = "{{${k}}}"`)
    .join('\n')
  const r = renderBuildConfig(`# {{UNKNOWN}} in a comment\n${all}\n`, VALUES)
  assert.ok(r.startsWith('cargo_home = "/Users/a/.cargo"'))
})

// spec: 31 §5.4 — rendered flags are recorded with host paths replaced by remap targets.
test('remapHostPaths replaces host paths by their remap targets, longest first', () => {
  const r = renderBuildConfig(template, VALUES)
  const remapped = remapHostPaths(r, remapPairs(VALUES))
  assert.ok(!remapped.includes('/Users/'))
  assert.ok(remapped.includes('"--remap-path-prefix=/cargo=/cargo"'))
  assert.ok(remapped.includes('"--remap-path-prefix=/pmb/target=/pmb/target"'))
  assert.equal(
    remapHostPaths('/a/b/c /a/x', [
      ['/a', '/A'],
      ['/a/b', '/B'],
    ]),
    '/B/c /A/x',
  )
})
