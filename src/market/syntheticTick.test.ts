import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSyntheticFeedTick,
  isSyntheticFeedTick,
  type SyntheticFeedTickMessage,
} from './syntheticTick.js'
import type { AnyMarketMessage, MarketOrderBooksSnapshot } from './orderbook/index.js'

const baseSnapshot: MarketOrderBooksSnapshot = {
  market: 'm1',
  timestamp: 1_000,
  byAssetId: {
    A: { bestBid: 0.4, bestAsk: 0.41 } as never,
  },
} as MarketOrderBooksSnapshot

test('isSyntheticFeedTick: true for both synthetic types, false for everything else', () => {
  assert.equal(isSyntheticFeedTick({ event_type: 'binance_agg_trade' }), true)
  assert.equal(isSyntheticFeedTick({ event_type: 'chainlink_round' }), true)
  for (const t of [
    'book',
    'price_change',
    'tick_size_change',
    'last_trade_price',
    // recorder markers (unrelated set — must not classify as synthetic feed ticks)
    'disconnect',
    'window_end',
    'writer_lag_disconnect',
    '',
  ]) {
    assert.equal(isSyntheticFeedTick({ event_type: t }), false, t)
  }
})

test('builder clamps time forward, never backward', () => {
  const late = buildSyntheticFeedTick({
    eventType: 'binance_agg_trade',
    symbol: 'btcusdt',
    visibilityMs: 2_000,
    baseSnapshot,
    source: { kind: 'live', attempt: 1 },
  })
  assert.equal(late.snapshot.timestamp, 2_000)
  assert.equal(late.msg.timestamp, '2000')

  const early = buildSyntheticFeedTick({
    eventType: 'binance_agg_trade',
    symbol: 'btcusdt',
    visibilityMs: 500, // before the last book event — clamp to it
    baseSnapshot,
    source: { kind: 'live', attempt: 1 },
  })
  assert.equal(early.snapshot.timestamp, 1_000)
  assert.equal(early.msg.timestamp, '1000')
})

test('builder carries market/symbol/source and shares the book without mutating the base', () => {
  const source = {
    kind: 'parquet',
    filePath: '/f.parquet',
    ingestSeq: 0n,
    tsLocalMs: 2_000,
  } as const
  const tick = buildSyntheticFeedTick({
    eventType: 'chainlink_round',
    symbol: 'btc/usd',
    visibilityMs: 2_000,
    baseSnapshot,
    source,
  })
  assert.equal(tick.msg.market, 'm1')
  assert.equal(tick.msg.symbol, 'btc/usd')
  assert.equal(tick.msg.event_type, 'chainlink_round')
  assert.equal(tick.source, source)
  // book shared by reference (unchanged by definition), base snapshot untouched
  assert.equal(tick.snapshot.byAssetId, baseSnapshot.byAssetId)
  assert.equal(baseSnapshot.timestamp, 1_000)
  assert.notEqual(tick.snapshot, baseSnapshot)
})

test('type-level: a synthetic message is NOT assignable to AnyMarketMessage', () => {
  const synthetic: SyntheticFeedTickMessage = {
    event_type: 'binance_agg_trade',
    market: 'm1',
    timestamp: '1000',
    symbol: 'btcusdt',
  }
  // @ts-expect-error — the unions are deliberately disjoint so the orderbook
  // engine's applyAny(msg: AnyMarketMessage) can never receive a synthetic
  // tick without an explicit (reviewable) cast.
  const asEngineMsg: AnyMarketMessage = synthetic
  void asEngineMsg
  assert.ok(synthetic)
})
