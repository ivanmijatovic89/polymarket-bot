import assert from 'node:assert/strict'
import test from 'node:test'
import type { Hex } from 'viem'
import { activityLogQueries } from './activityDiscovery.js'

const CONDITION = `0x${'12'.repeat(32)}` as Hex

test('standard CTF activity filters split/merge by indexed condition and redemption by signature', () => {
  const queries = activityLogQueries({
    conditionIds: [CONDITION],
    includeStandard: true,
    includeNegativeRisk: false,
  })
  assert.equal(queries.length, 2)
  assert.equal(queries[0]?.label, 'ctf-split-merge')
  assert.deepEqual(queries[0]?.topics[3], [CONDITION])
  assert.equal(queries[1]?.label, 'ctf-redemption')
})

test('negative-risk adapter uses its condition ID at topic position two', () => {
  const queries = activityLogQueries({
    conditionIds: [CONDITION],
    includeStandard: false,
    includeNegativeRisk: true,
  })
  assert.equal(queries.length, 2)
  assert.deepEqual(queries[0]?.topics[2], [CONDITION])
  assert.deepEqual(queries[1]?.topics[2], [CONDITION])
})
