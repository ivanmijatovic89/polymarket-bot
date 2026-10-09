import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pinnedChannel } from './builder.js'
import { ENGINE_ROOT } from './host.js'
import { ENGINE_TOOLCHAIN_REL } from './policy.js'

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
