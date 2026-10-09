import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  checkRustcVerbose,
  inheritedWorkspaceManifest,
  manifestSdkPathValues,
  pinnedChannel,
  templateDeploymentTarget,
} from './builder.js'
import { ENGINE_ROOT } from './host.js'
import { BUILD_CONFIG_REL, ENGINE_TOOLCHAIN_REL } from './policy.js'

// spec: 31 §3 item 1 — the toolchain is pinned by native/rust-toolchain.toml.
test('pinnedChannel reads the engine toolchain pin', () => {
  const text = readFileSync(path.join(ENGINE_ROOT, ENGINE_TOOLCHAIN_REL), 'utf8')
  assert.match(pinnedChannel(text), /^\d+\.\d+\.\d+$/)
  assert.equal(pinnedChannel('[toolchain]\nchannel = "1.89.0"\n'), '1.89.0')
  assert.throws(
    () => pinnedChannel('[toolchain]\ncomponents = ["clippy"]\n'),
    /no toolchain\.channel/,
  )
})

const RUSTC_VV =
  'rustc 1.89.0 (29483883e 2025-08-04)\nbinary: rustc\nhost: aarch64-apple-darwin\nrelease: 1.89.0\nLLVM version: 20.1.7\n'

// spec: 31 §3 items 1-2 — the pinned toolchain, with the expected release and host.
test('checkRustcVerbose requires the pinned release and the aarch64-apple-darwin host', () => {
  assert.equal(checkRustcVerbose(RUSTC_VV, '1.89.0').rustcRelease, '1.89.0')
  assert.throws(() => checkRustcVerbose(RUSTC_VV, '1.90.0'), /pins 1\.90\.0/)
  assert.throws(
    () => checkRustcVerbose(RUSTC_VV.replace('host: aarch64', 'host: x86_64'), '1.89.0'),
    /rustc host is "x86_64-apple-darwin"/,
  )
})

// spec: 31 §5.2 — deploymentTarget is the value of 31 §4.2, read from the template.
test('templateDeploymentTarget reads env.MACOSX_DEPLOYMENT_TARGET from the template', () => {
  const template = readFileSync(path.join(ENGINE_ROOT, BUILD_CONFIG_REL), 'utf8')
  assert.equal(templateDeploymentTarget(template), '11.0')
  assert.equal(
    templateDeploymentTarget(
      '[env]\nMACOSX_DEPLOYMENT_TARGET = { value = "12.3", force = true }\n',
    ),
    '12.3',
  )
  assert.equal(templateDeploymentTarget('[env]\nMACOSX_DEPLOYMENT_TARGET = "13.0"\n'), '13.0')
  assert.throws(() => templateDeploymentTarget('[env]\n'), /sets no env\.MACOSX_DEPLOYMENT_TARGET/)
  assert.throws(
    () => templateDeploymentTarget('[env]\nMACOSX_DEPLOYMENT_TARGET = { force = true }\n'),
    /cannot read/,
  )
})

// spec: 31 §5.2 — engine crates inherit from the engine workspace manifest,
// so it joins the source hash with them.
test('inheritedWorkspaceManifest finds the nearest workspace root', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmb-ws-manifest-'))
  try {
    mkdirSync(path.join(root, 'native', 'crates', 'a'), { recursive: true })
    writeFileSync(path.join(root, 'native', 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n')
    writeFileSync(path.join(root, 'native', 'crates', 'a', 'Cargo.toml'), '[package]\nname = "a"\n')
    assert.equal(
      inheritedWorkspaceManifest(path.join(root, 'native', 'crates', 'a', 'Cargo.toml')),
      path.join(root, 'native', 'Cargo.toml'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('manifestSdkPathValues reads inline-table and dotted pmb-sdk paths', () => {
  assert.deepEqual(
    manifestSdkPathValues(
      '[dependencies]\npmb-sdk = { path = "../e/native/crates/pmb-sdk" }\n[dev-dependencies.pmb-sdk]\npath = "/abs"\nfeatures = ["testkit"]\n',
    ),
    ['../e/native/crates/pmb-sdk', '/abs'],
  )
})
