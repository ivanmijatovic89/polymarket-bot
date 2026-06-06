import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceIndexedMarketStats, computeExtendedFailureCount } from './backtests.js'
import type { MarketStats } from '../backtest/stats/marketStats.js'

function marketStats(slug: string): MarketStats {
  return {
    marketId: slug,
    slug,
    finalOutcome: 'UP',
    pnl: 1,
    tradeCount: 1,
    tradeAsMaker: 0,
    tradeAsTaker: 1,
    feesPaid: 0,
    avgEntryPriceUp: null,
    avgEntryPriceDown: null,
    upShares: 0,
    downShares: 0,
    mergableShares: 0,
    cost: 0,
    splitCost: 0,
    intentMeta: [],
  }
}

test('coerceIndexedMarketStats preserves explicit child indexes', () => {
  const rows = coerceIndexedMarketStats([
    { idx: 0, stats: marketStats('first') },
    { idx: 2, stats: marketStats('third') },
  ])

  assert.deepEqual(
    rows.map((row) => ({ idx: row.idx, slug: row.stats.slug })),
    [
      { idx: 0, slug: 'first' },
      { idx: 2, slug: 'third' },
    ],
  )
})

test('coerceIndexedMarketStats falls back to array position for legacy rows', () => {
  const rows = coerceIndexedMarketStats([marketStats('first'), marketStats('second')])

  assert.deepEqual(
    rows.map((row) => ({ idx: row.idx, slug: row.stats.slug })),
    [
      { idx: 0, slug: 'first' },
      { idx: 1, slug: 'second' },
    ],
  )
})

test('computeExtendedFailureCount subtracts failures resolved by successful retry', () => {
  assert.equal(computeExtendedFailureCount(3, 2, 1), 4)
  assert.equal(computeExtendedFailureCount(1, 0, 1), 0)
  assert.equal(computeExtendedFailureCount(0, 0, 2), 0)
})
