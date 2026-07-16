import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeReceipt } from './receiptProof.js'
import type { RpcReceipt } from './types.js'

const ZERO_BLOOM = `0x${'00'.repeat(256)}` as const

test('legacy and typed receipts use distinct canonical envelopes', () => {
  const base: RpcReceipt = {
    type: '0x0',
    status: '0x1',
    cumulativeGasUsed: '0x5208',
    logsBloom: ZERO_BLOOM,
    logs: [],
    transactionHash: `0x${'11'.repeat(32)}`,
    transactionIndex: '0x0',
    blockHash: `0x${'22'.repeat(32)}`,
    blockNumber: '0x1',
  }
  const legacy = serializeReceipt(base)
  const typed = serializeReceipt({ ...base, type: '0x2' })
  assert.notDeepEqual(typed, legacy)
  assert.equal(typed[0], 2)
  assert.equal(legacy[0]! >= 0xc0, true)
})
