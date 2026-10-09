import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cargoConfigTextViolations,
  cargoConfigViolations,
  defaultBuildJobs,
  resolveBuildJobs,
} from './host.js'

// spec: 31 §2.2 ("compiling strategy code executes no strategy-authored
// code"), §3 item 3, §4.2 — a cargo config may not change the build policy
// or swap the sources of engine-pinned crates.
test('cargoConfigTextViolations allows only harmless roots', () => {
  assert.deepEqual(
    cargoConfigTextViolations(
      'c',
      '[alias]\nb = "build"\n[term]\nverbose = true\n[net]\noffline = true\n[http]\ntimeout = 30\n',
    ),
    [],
  )
  const refused: Array<[string, RegExp]> = [
    ['[patch.crates-io]\nserde = { path = "x" }\n', /patch\.crates-io/],
    ['paths = ["../serde"]\n', /sets paths/],
    [
      '[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "vendor"\n',
      /source\.crates-io/,
    ],
    ['[registries.mine]\nindex = "sparse+https://x"\n', /registries\.mine/],
    ['[registry]\nglobal-credential-providers = ["x"]\n', /registry/],
    ['credential-provider = "x"\n', /credential-provider/],
    ['[build]\nrustflags = ["-Ctarget-cpu=native"]\n', /build/],
    ['[target.aarch64-apple-darwin]\nlinker = "x"\n', /target\.aarch64-apple-darwin/],
    ['[profile.artifact]\nlto = false\n', /profile\.artifact/],
    ['[env]\nPMB_ENGINE_DIRTY = "false"\n', /env/],
    ['[unstable]\nbuild-std = ["std"]\n', /unstable/],
    ['include = ["other.toml"]\n', /include/],
  ]
  for (const [text, re] of refused) {
    const v = cargoConfigTextViolations('c', text)
    assert.equal(v.length, 1, text)
    assert.match(v[0]!, re)
  }
  assert.match(cargoConfigTextViolations('c', 'a = """x"""\n')[0]!, /unreadable cargo config/)
})

test('cargoConfigViolations walks the package ancestors and CARGO_HOME', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmb-cargo-config-'))
  try {
    const pkg = path.join(root, 'repo', 'pkg')
    const home = path.join(root, 'cargo-home')
    mkdirSync(path.join(pkg, '.cargo'), { recursive: true })
    mkdirSync(path.join(root, 'repo', '.cargo'), { recursive: true })
    mkdirSync(home, { recursive: true })
    writeFileSync(path.join(pkg, '.cargo', 'config.toml'), '[alias]\nx = "build"\n')
    assert.deepEqual(cargoConfigViolations(pkg, home), [])
    writeFileSync(path.join(root, 'repo', '.cargo', 'config'), '[patch.crates-io]\na = "1"\n')
    writeFileSync(path.join(home, 'config.toml'), '[source.crates-io]\nreplace-with = "v"\n')
    const v = cargoConfigViolations(pkg, home).join('\n')
    assert.match(v, /repo\/\.cargo\/config: sets patch\.crates-io/)
    assert.match(v, /cargo-home\/config\.toml: sets source\.crates-io/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// spec: 31 §4.5 (builds MUST cap jobs), 40 §17 item 3 (4 on M4, 2 on M1 Pro,
// inventory override), 00 R14 (an unknown host class is an error).
test('build jobs follow the host class, an explicit value, or the interactive opt-out', () => {
  assert.equal(defaultBuildJobs('Apple M4'), 4)
  assert.equal(defaultBuildJobs('Apple M1 Pro'), 2)
  assert.equal(defaultBuildJobs('Apple M4 Pro'), null)
  assert.equal(defaultBuildJobs('Apple M2'), null)
  const m4 = (): string => 'Apple M4'
  const other = (): string => 'Intel(R) Xeon(R)'
  assert.equal(resolveBuildJobs('background', undefined, m4), 4)
  assert.equal(resolveBuildJobs('background', '3', other), 3)
  assert.equal(resolveBuildJobs('interactive', '3', other), 3)
  assert.equal(resolveBuildJobs('interactive', undefined, other), null)
  assert.throws(() => resolveBuildJobs('background', undefined, other), /--qos default/)
  assert.throws(() => resolveBuildJobs('background', 'four', m4), /positive integer/)
  assert.throws(() => resolveBuildJobs('background', '0', m4), /positive integer/)
})
