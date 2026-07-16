import assert from 'node:assert/strict'
import test from 'node:test'
import type { DecodedChainEvent } from './decode.js'
import { fixed6, normalizeOrderFilled } from './normalize.js'

function event(side: bigint, makerAmount: bigint, takerAmount: bigint): DecodedChainEvent {
  return {
    eventName: 'OrderFilled',
    args: {
      orderHash: `0x${'11'.repeat(32)}`,
      maker: `0x${'22'.repeat(20)}`,
      taker: `0x${'33'.repeat(20)}`,
      side,
      tokenId: 123n,
      makerAmountFilled: makerAmount,
      takerAmountFilled: takerAmount,
      fee: 5n,
    },
    blockNumber: 1n,
    transactionHash: `0x${'44'.repeat(32)}`,
    transactionIndex: 2,
    logIndex: 3,
    contract: `0x${'55'.repeat(20)}`,
  }
}

test('normalizes BUY and SELL amounts without floating point', () => {
  const buy = normalizeOrderFilled(event(0n, 250_000n, 500_000n), new Set())
  assert.equal(fixed6(buy.sizeAtomic), '0.500000')
  assert.equal(fixed6(buy.usdcAtomic), '0.250000')
  assert.equal(fixed6(buy.priceMillionths), '0.500000')

  const sell = normalizeOrderFilled(event(1n, 500_000n, 250_000n), new Set())
  assert.equal(fixed6(sell.sizeAtomic), '0.500000')
  assert.equal(fixed6(sell.usdcAtomic), '0.250000')
  assert.equal(fixed6(sell.priceMillionths), '0.500000')
})
