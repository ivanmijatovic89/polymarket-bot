import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiActivity } from './activityApi.js'
import type { ApiTrade } from './dataApi.js'
import { reconstructOverflowWalletTrades } from './overflowWalletTrades.js'

const CID = '0xc'
const WALLET = '0xaaa'

function trade(over: Partial<ApiTrade> = {}): ApiTrade {
  return {
    proxyWallet: WALLET,
    side: 'BUY',
    asset: 'token',
    conditionId: CID,
    size: 1,
    price: 0.5,
    timestamp: 100,
    outcomeIndex: 0,
    transactionHash: '0xtx',
    ...over,
  }
}

function activity(over: Partial<ApiActivity> = {}): ApiActivity {
  return {
    proxyWallet: WALLET,
    type: 'TRADE',
    side: 'BUY',
    asset: 'token',
    conditionId: CID,
    size: 1,
    price: 0.5,
    usdcSize: 0.5,
    timestamp: 100,
    outcomeIndex: 0,
    transactionHash: '0xtx',
    ...over,
  }
}

test('visible trades are retained verbatim and identical hidden maker fills survive', () => {
  const visible = trade({ name: 'visible profile' })
  const out = reconstructOverflowWalletTrades({
    wallet: WALLET,
    conditionId: CID,
    activities: [activity(), activity()],
    visibleTrades: [visible],
    takerTrades: [],
  })
  assert.equal(out.length, 2)
  assert.equal(out[0], visible)
})

test('aggregated taker activity is replaced by per-fill taker rows', () => {
  const takers = [
    trade({ size: 4, transactionHash: '0xtaker' }),
    trade({ size: 6, transactionHash: '0xtaker' }),
  ]
  const out = reconstructOverflowWalletTrades({
    wallet: WALLET,
    conditionId: CID,
    activities: [
      activity({ size: 10, transactionHash: '0xtaker' }),
      activity({ side: 'SELL', transactionHash: '0xmaker' }),
    ],
    visibleTrades: [],
    takerTrades: takers,
  })
  assert.equal(out.length, 3)
  assert.equal(out.filter((row) => row.transactionHash === '0xtaker').length, 2)
})

test('fails if time-sliced activity cannot reproduce the visible capped prefix', () => {
  assert.throws(
    () =>
      reconstructOverflowWalletTrades({
        wallet: WALLET,
        conditionId: CID,
        activities: [activity({ transactionHash: '0xother' })],
        visibleTrades: [trade()],
        takerTrades: [],
      }),
    /does not contain visible \/trades row/,
  )
})
