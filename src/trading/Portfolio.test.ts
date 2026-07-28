import test from 'node:test'
import assert from 'node:assert/strict'
import { Portfolio } from './Portfolio.js'
import { computeMarketStats } from '../backtest/stats/marketStats.js'
import type { Fill, OpenOrder, OrderSide } from '../strategy/Strategy.js'

function makeOrder(clientOrderId: string, tsMs: number, side: OrderSide = 'SELL'): OpenOrder {
  return {
    clientOrderId,
    assetId: `asset-${clientOrderId}`,
    side,
    price: 0.42,
    size: 10,
    remaining: 10,
    filled: 0,
    orderType: 'GTC',
    state: 'requested',
    createdAtMs: tsMs,
    updatedAtMs: tsMs,
    meta: { source: 'portfolio-test' },
  }
}

test('Portfolio.snapshot returns the same frozen object until the next apply()', () => {
  const portfolio = new Portfolio()

  portfolio.apply({ kind: 'order_submitted', tsMs: 1_000, order: makeOrder('cid-1', 1_000) })

  const first = portfolio.snapshot()
  assert.equal(Object.isFrozen(first), true)
  assert.equal(first.ordersByClientId['cid-1']?.lifecycleState, 'requested')

  // Repeated calls with no intervening state change return the exact same object.
  const second = portfolio.snapshot()
  assert.equal(second, first)

  // Any apply() invalidates the cache; the next snapshot is a fresh object.
  portfolio.apply({ kind: 'order_accepted', tsMs: 1_001, clientOrderId: 'cid-1', orderId: 'oid-1' })
  const third = portfolio.snapshot()
  assert.notEqual(third, first)
  assert.equal(third.ordersByClientId['cid-1']?.lifecycleState, 'open')
  assert.equal(third.ordersByClientId['cid-1']?.orderId, 'oid-1')

  // The earlier snapshot keeps its point-in-time order history (each upsert is a
  // fresh OrderSnapshot object, so `first` is not retroactively updated).
  assert.equal(first.ordersByClientId['cid-1']?.lifecycleState, 'requested')
})

test('Portfolio.snapshot content matches live state across event kinds', () => {
  const portfolio = new Portfolio()

  portfolio.apply({ kind: 'order_submitted', tsMs: 2_000, order: makeOrder('cid-a', 2_000, 'BUY') })
  portfolio.apply({ kind: 'order_accepted', tsMs: 2_001, clientOrderId: 'cid-a', orderId: 'oid-a' })
  portfolio.apply({
    kind: 'fill',
    fill: {
      id: 'fill-1',
      clientOrderId: 'cid-a',
      orderId: 'oid-a',
      assetId: 'asset-cid-a',
      side: 'BUY',
      price: 0.42,
      size: 10,
      tsMs: 2_002,
      liquidity: 'MAKER',
    },
  })

  const snap = portfolio.snapshot()
  // BUY fill of the full size opens a 10-share position.
  assert.equal(snap.positionsByAssetId['asset-cid-a']?.qty, 10)
  // Order fully filled -> no longer open, but retained in ordersByClientId history.
  assert.equal(snap.openOrdersByClientId['cid-a'], undefined)
  assert.ok(snap.ordersByClientId['cid-a'])
  assert.equal(snap.recentFills.length, 1)

  // Frozen + JSON-serializable.
  assert.equal(Object.isFrozen(snap), true)
  const json = JSON.parse(JSON.stringify(snap)) as { positionsByAssetId?: Record<string, unknown> }
  assert.ok(json.positionsByAssetId?.['asset-cid-a'])
})

test('taker fees are charged in USDC: BUY capitalizes into cost basis, SELL reduces proceeds', () => {
  const portfolio = new Portfolio()

  // TAKER BUY: 100 shares @ 0.5, fee = 0.07 × 0.5 × 0.5 × 100 = 1.75 USDC.
  const buy: Fill = {
    id: 'fee-fill-1',
    tsMs: 1_000,
    assetId: 'asset-up',
    side: 'BUY',
    price: 0.5,
    size: 100,
    liquidity: 'TAKER',
    feeRateBps: 700,
  }
  portfolio.apply({ kind: 'fill', fill: buy })

  const afterBuy = portfolio.snapshot()
  const pos = afterBuy.positionsByAssetId['asset-up']
  // Fee is NOT deducted in shares — full size is received.
  assert.equal(pos?.qty, 100)
  // Cost basis includes the USDC fee: 0.5 × 100 + 1.75.
  assert.equal(pos?.costBasis, 51.75)
  assert.equal(pos?.avgEntryPrice, 0.5175) // effective entry incl. fee

  // TAKER SELL: 100 shares @ 0.6, fee = 0.07 × 0.6 × 0.4 × 100 = 1.68 USDC.
  const sell: Fill = {
    id: 'fee-fill-2',
    tsMs: 2_000,
    assetId: 'asset-up',
    side: 'SELL',
    price: 0.6,
    size: 100,
    liquidity: 'TAKER',
    feeRateBps: 700,
  }
  portfolio.apply({ kind: 'fill', fill: sell })

  const afterSell = portfolio.snapshot()
  assert.equal(afterSell.positionsByAssetId['asset-up'], undefined)
  // Realized PnL = net proceeds − cost basis = (60 − 1.68) − 51.75 = 6.57.
  assert.equal(afterSell.realizedPnlTotal, 6.57)

  // marketStats agrees: feesPaid = 1.75 + 1.68 = 3.43, pnl = realized only.
  const stats = computeMarketStats({
    marketId: 'm1',
    slug: 'fee-test-market',
    trades: [buy, sell],
    finalPositions: { ...afterSell.positionsByAssetId },
    realizedPnl: afterSell.realizedPnlTotal ?? 0,
    finalOutcome: 'UP',
    tokenMap: { UP: 'asset-up', DOWN: 'asset-down' },
  })
  assert.equal(stats.feesPaid, 3.43)
  assert.equal(stats.pnl, 6.57)
})

test('maker fills pay exactly $0 in fees', () => {
  const portfolio = new Portfolio()
  portfolio.apply({
    kind: 'fill',
    fill: {
      id: 'maker-fill-1',
      tsMs: 1_000,
      assetId: 'asset-up',
      side: 'BUY',
      price: 0.4,
      size: 100,
      liquidity: 'MAKER',
      feeRateBps: 700, // even with a rate stamped, MAKER pays nothing
    },
  })

  const snap = portfolio.snapshot()
  const pos = snap.positionsByAssetId['asset-up']
  assert.equal(pos?.qty, 100)
  assert.equal(pos?.costBasis, 40) // exactly price × size, no fee
  assert.equal(pos?.avgEntryPrice, 0.4)
})
