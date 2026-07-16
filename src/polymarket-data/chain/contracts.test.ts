import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeEventTopics } from 'viem'
import { CTF_EVENTS, EXCHANGE_EVENTS } from './contracts.js'

test('event topics match known June 2026 Polygon receipts', () => {
  assert.equal(
    encodeEventTopics({ abi: [EXCHANGE_EVENTS.orderFilled], eventName: 'OrderFilled' })[0],
    '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee',
  )
  assert.equal(
    encodeEventTopics({ abi: [CTF_EVENTS.transferSingle], eventName: 'TransferSingle' })[0],
    '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  )
})
