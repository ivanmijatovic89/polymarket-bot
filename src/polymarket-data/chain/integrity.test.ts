import assert from 'node:assert/strict'
import test from 'node:test'
import type { Hex } from 'viem'
import { assertIdenticalLogSequences, logSequenceDigest } from './integrity.js'
import type { RpcLog } from './types.js'

function log(overrides: Partial<RpcLog> = {}): RpcLog {
  return {
    address: '0x1111111111111111111111111111111111111111',
    topics: [`0x${'22'.repeat(32)}` as Hex],
    data: '0x',
    blockNumber: '0x1',
    transactionHash: `0x${'33'.repeat(32)}` as Hex,
    transactionIndex: '0x0',
    blockHash: `0x${'44'.repeat(32)}` as Hex,
    logIndex: '0x0',
    removed: false,
    ...overrides,
  }
}

test('provider comparison is exact and order-sensitive', () => {
  const rows = [log(), log({ logIndex: '0x1' })]
  assert.equal(
    assertIdenticalLogSequences(rows, structuredClone(rows), 'test'),
    logSequenceDigest(rows),
  )
  assert.throws(
    () => assertIdenticalLogSequences(rows, [...rows].reverse(), 'test'),
    /disagree at ordered log/,
  )
  assert.throws(
    () => assertIdenticalLogSequences(rows, rows.slice(0, 1), 'test'),
    /disagree on log count/,
  )
})
