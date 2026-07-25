import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginSet, type Plugin } from './PluginSet.js'
import { ExternalFeedsRequestPlugin } from './ExternalFeedsRequestPlugin.js'
import { DwellGatePlugin } from './DwellGatePlugin.js'
import { TimeWindowGatePlugin } from './TimeWindowGatePlugin.js'
import { TimeWindowVolatility } from './TimeWindowVolatility.js'
import { buildSyntheticFeedTick } from '../../market/syntheticTick.js'
import type { MarketTick } from '../Strategy.js'
import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../../market/orderbook/index.js'

function makeSnap(ts: number, bid: number): MarketOrderBooksSnapshot {
  return {
    market: 'm1',
    timestamp: ts,
    byAssetId: {
      A: {
        market: 'm1',
        assetId: 'A',
        timestamp: ts,
        bestBid: bid,
        bestAsk: bid + 0.01,
        mid: bid + 0.005,
      } as OrderBookSnapshot,
    },
  } as MarketOrderBooksSnapshot
}

function realTick(ts: number, bid = 0.4): MarketTick {
  return {
    source: { kind: 'live', attempt: 1 },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: makeSnap(ts, bid),
  }
}

function synTick(baseTs: number, visibilityMs: number, bid = 0.4): MarketTick {
  return buildSyntheticFeedTick({
    eventType: 'binance_agg_trade',
    symbol: 'btcusdt',
    visibilityMs,
    baseSnapshot: makeSnap(baseTs, bid),
    source: { kind: 'live', attempt: 1 },
  })
}

test('default-skip: unflagged plugins never see synthetic ticks; flagged ones do; snapshot always rebuilt', () => {
  const seenByUnflagged: string[] = []
  const seenByFlagged: string[] = []
  let unflaggedSnapshots = 0

  const unflagged: Plugin = {
    id: 'unflagged',
    onMarketTick: (t) => seenByUnflagged.push(t.msg.event_type),
    snapshot: () => {
      unflaggedSnapshots += 1
      return { n: seenByUnflagged.length }
    },
  }
  // Object literal (not a class instance) — the policy must be structural.
  const flagged: Plugin = {
    id: 'flagged',
    handlesSyntheticTicks: true,
    onMarketTick: (t) => seenByFlagged.push(t.msg.event_type),
    snapshot: () => ({ n: seenByFlagged.length }),
  }

  const set = new PluginSet()
  set.register(unflagged)
  set.register(flagged)

  set.onMarketTick(realTick(1_000))
  set.onMarketTick(synTick(1_000, 1_400))
  set.onMarketTick(realTick(2_000))

  assert.deepEqual(seenByUnflagged, ['price_change', 'price_change'])
  assert.deepEqual(seenByFlagged, ['price_change', 'binance_agg_trade', 'price_change'])
  // Snapshot rebuilt on every tick, including synthetic (3 ticks → 3 rebuilds).
  assert.equal(unflaggedSnapshots, 3)
  assert.deepEqual(set.snapshot()['flagged'], { n: 3 })
})

test('TimeWindowVolatility stats are byte-equal with and without interleaved synthetic ticks', () => {
  const run = (withSynthetic: boolean) => {
    const vol = new TimeWindowVolatility({ windows: { w: 10_000 }, trackPrice: 'bid' })
    const set = new PluginSet()
    set.register(vol)
    const prices = [0.4, 0.41, 0.42, 0.4, 0.43]
    prices.forEach((p, i) => {
      set.onMarketTick(realTick(1_000 + i * 1_000, p))
      if (withSynthetic) set.onMarketTick(synTick(1_000 + i * 1_000, 1_400 + i * 1_000, p))
    })
    return JSON.stringify(set.snapshot()['timeWindowVolatility'] ?? vol.snapshot())
  }
  assert.equal(run(true), run(false))
})

test('flag assignments: feeds + time gates opted in, volatility not', () => {
  const feeds = new ExternalFeedsRequestPlugin({})
  const dwell = new DwellGatePlugin({
    assetId: 'A',
    priceBand: { min: 0.4, max: 0.6 },
    dwellMs: 1000,
  } as never)
  const timeGate = new TimeWindowGatePlugin({} as never)
  const vol = new TimeWindowVolatility({ windows: { w: 1000 } })

  assert.equal(feeds.handlesSyntheticTicks, true)
  assert.equal(dwell.handlesSyntheticTicks, true)
  assert.equal(timeGate.handlesSyntheticTicks, true)
  assert.equal((vol as Plugin).handlesSyntheticTicks, undefined)
})

test('ExternalFeedsRequestPlugin records the synthetic tick as lastTick for its provider', () => {
  const feeds = new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: { tickOnUpdate: true } })
  const seenTicks: (MarketTick | undefined)[] = []
  feeds.fulfill((tick) => {
    seenTicks.push(tick)
    return { ok: true }
  })
  const set = new PluginSet()
  set.register(feeds)

  set.onMarketTick(realTick(1_000))
  set.onMarketTick(synTick(1_000, 1_400))

  assert.equal(seenTicks.length, 2)
  assert.equal(seenTicks[0]?.snapshot.timestamp, 1_000)
  // The provider was called with the SYNTHETIC tick (clamped ts 1400).
  assert.equal(seenTicks[1]?.snapshot.timestamp, 1_400)
  assert.equal(
    seenTicks[1] && 'event_type' in seenTicks[1].msg ? seenTicks[1].msg.event_type : '',
    'binance_agg_trade',
  )
})
