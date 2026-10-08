// Golden fixture generator for the Rust market-stats port (pmb-core/src/stats.rs).
// From the repo root:
//   npx tsx native/crates/pmb-core/tests/fixtures/stats_gen.ts > native/crates/pmb-core/tests/fixtures/stats_golden.json
import { computeMarketStats } from '../../../../../src/backtest/stats/marketStats.js'
import { computePolymarketTakerFee } from '../../../../../src/trading/fees.js'
import type { Fill, Position, PositionsSplit } from '../../../../../src/strategy/Strategy.js'

const UP = 'UPTOKEN'
const DOWN = 'DOWNTOKEN'

type TradeIn = Omit<Fill, 'tsMs' | 'id'> & { fee?: number }

function fills(trades: TradeIn[]): Fill[] {
  return trades.map((t, i) => {
    const { fee: _fee, ...rest } = t
    return { id: `f${i}`, tsMs: 1_000 + i, ...rest }
  })
}

function withFees(trades: TradeIn[]): TradeIn[] {
  return trades.map((t) => ({
    ...t,
    fee:
      t.liquidity === 'TAKER' && typeof t.feeRateBps === 'number'
        ? computePolymarketTakerFee({ feeRateBps: t.feeRateBps, price: t.price, size: t.size })
        : 0,
  }))
}

type Case = {
  name: string
  trades: TradeIn[]
  splits: Array<{ size: number; splitCost: number }>
  positions: Record<string, { qty: number; costBasis: number }>
  realizedPnl: number
  finalOutcome: 'UP' | 'DOWN'
}

const cases: Case[] = [
  {
    name: 'two_sided_up',
    trades: [
      { assetId: UP, side: 'BUY', price: 0.53, size: 10, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'a', intentMeta: { k: 1 } },
      { assetId: UP, side: 'BUY', price: 0.55, size: 7.5, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'a', intentMeta: { k: 1 } },
      { assetId: DOWN, side: 'BUY', price: 0.41, size: 12, liquidity: 'MAKER', clientOrderId: 'b', intentMeta: { side: 'down', edge: 0.0412 } },
      { assetId: UP, side: 'SELL', price: 0.6, size: 4, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'c' },
    ],
    splits: [],
    positions: { [UP]: { qty: 13.5, costBasis: 7.24 }, [DOWN]: { qty: 12, costBasis: 4.92 } },
    realizedPnl: 0.27,
    finalOutcome: 'UP',
  },
  {
    name: 'split_then_sell_down',
    trades: [
      { assetId: UP, side: 'SELL', price: 0.47, size: 10, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 's1', intentMeta: { why: 'exit' } },
      { assetId: DOWN, side: 'SELL', price: 0.6, size: 3, liquidity: 'MAKER', clientOrderId: 's2', intentMeta: { why: 'tp' } },
    ],
    splits: [{ size: 10, splitCost: 10 }],
    positions: { [DOWN]: { qty: 7, costBasis: 0 } },
    realizedPnl: 6.5,
    finalOutcome: 'DOWN',
  },
  {
    name: 'no_activity',
    trades: [],
    splits: [],
    positions: {},
    realizedPnl: 0,
    finalOutcome: 'DOWN',
  },
  {
    name: 'meta_dedup_and_losing_side',
    trades: [
      { assetId: DOWN, side: 'BUY', price: 0.37, size: 5, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'x' },
      { assetId: DOWN, side: 'BUY', price: 0.38, size: 5, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'x', intentMeta: { n: 2 } },
      { assetId: DOWN, side: 'BUY', price: 0.39, size: 5, feeRateBps: 700, liquidity: 'TAKER', clientOrderId: 'x', intentMeta: { n: 3 } },
      { assetId: UP, side: 'BUY', price: 0.12, size: 33.33, liquidity: 'MAKER', intentMeta: { nocid: true } },
      { assetId: UP, side: 'BUY', price: 0.13, size: 6.67, liquidity: 'MAKER', intentMeta: { nocid: true } },
    ],
    splits: [],
    positions: { [UP]: { qty: 40, costBasis: 4.8667 }, [DOWN]: { qty: 15, costBasis: 5.7 } },
    realizedPnl: -1.234567,
    finalOutcome: 'UP',
  },
]

const out = cases.map((c) => {
  const trades = withFees(c.trades)
  const finalPositions: Record<string, Position> = {}
  for (const [assetId, p] of Object.entries(c.positions)) {
    finalPositions[assetId] = { assetId, qty: p.qty, costBasis: p.costBasis, avgEntryPrice: null }
  }
  const splits: PositionsSplit[] = c.splits.map((s, i) => ({
    id: `s${i}`,
    tsMs: 500,
    assetIdA: UP,
    assetIdB: DOWN,
    size: s.size,
    splitCost: s.splitCost,
  }))
  const expected = computeMarketStats({
    marketId: '0xmarket',
    slug: 'btc-updown-15m-1760140800',
    trades: fills(trades),
    splits,
    finalPositions,
    realizedPnl: c.realizedPnl,
    finalOutcome: c.finalOutcome,
    tokenMap: { UP, DOWN },
  })
  return { ...c, trades, expected }
})

process.stdout.write(JSON.stringify({ upAsset: UP, downAsset: DOWN, cases: out }, null, 1) + '\n')
