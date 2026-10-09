import assert from 'node:assert/strict'
import test from 'node:test'
import { duplicateIds, gate6, unimplementedGate } from './pipeline.js'

const PRE_SDK = { loaded: { sdkAvailable: false } }
const WITH_SDK = { loaded: { sdkAvailable: true } }

// spec: 31 §7.1 (gates 6 and 7 not skippable), 00 R14 — an unimplemented
// required gate is pending only before pmb-sdk exists, and fails after.
test('unimplemented gates are pending before pmb-sdk and fail once it exists', () => {
  assert.equal(unimplementedGate(PRE_SDK, 7, 'smoke', 'run-group').status, 'pending')
  const after = unimplementedGate(WITH_SDK, 7, 'smoke', 'run-group')
  assert.equal(after.status, 'fail')
  assert.match(after.detail.join('\n'), /not implemented/)
  const ids = [{ strategyId: 'a.v1', bin: 'a' }]
  assert.equal(gate6(PRE_SDK, ids).status, 'pass')
  assert.match(gate6(PRE_SDK, ids).detail.join('\n'), /pending pmb-sdk: paramsSchema/)
  assert.equal(gate6(WITH_SDK, ids).status, 'fail')
})

// spec: 31 §2.2 row 6 — strategy ids are unique within the package.
test('duplicateIds names every id declared by several bins', () => {
  assert.deepEqual(
    duplicateIds([
      { strategyId: 'x.v1', bin: 'b' },
      { strategyId: 'y.v1', bin: 'c' },
      { strategyId: 'x.v1', bin: 'a' },
    ]),
    ['strategy id x.v1 is declared by several bins: a, b'],
  )
  assert.equal(
    gate6(PRE_SDK, [
      { strategyId: 'x', bin: 'a' },
      { strategyId: 'x', bin: 'b' },
    ]).status,
    'fail',
  )
})
