import test from 'node:test'
import assert from 'node:assert/strict'
import { createBacktestExternalFeedsProvider } from './backtestExternalFeedsProvider.js'
import type { TwoClockAsOfSeries } from './chainlinkCryptoPricesSource.js'
import type { AsOfSeries } from './binanceAggTradesSource.js'

/**
 * Chainlink rounds fixture — the two-clock shape. Broadcast (`visibleAtMs`)
 * lags each round (`tsMs`) by ~1s, and one late re-broadcast makes the round
 * clock step BACKWARDS across monotone broadcast order (row 3: round 3000
 * broadcast after round 4000's broadcast — the live re-broadcast case).
 */
function chainlinkFixture(): TwoClockAsOfSeries {
  return {
    tsMs: Float64Array.of(1000, 2000, 4000, 3000, 5000),
    visibleAtMs: Float64Array.of(2000, 3050, 5100, 5200, 6100),
    value: Float64Array.of(10.5, 11.25, 13.0, 12.0, 14.5),
    length: 5,
  }
}

function binanceFixture(): AsOfSeries {
  return {
    tsMs: Float64Array.of(1500, 2500, 3500),
    value: Float64Array.of(100, 101, 102),
    length: 3,
  }
}

test('chainlink: nothing visible before the first broadcast + offset', () => {
  const p = createBacktestExternalFeedsProvider({
    rtdsChainlink: { symbol: 'btc/usd', series: chainlinkFixture(), latencyOffsetMs: 100 },
  })
  // Round 1000 broadcast at 2000, visible from 2100 — not at 2099.
  assert.equal(p.snapshotAt(2099).rtdsPolymarketCryptoPrices?.chainlink, undefined)
  const at = p.snapshotAt(2100).rtdsPolymarketCryptoPrices?.chainlink
  assert.equal(at?.value, 10.5)
})

test('chainlink: emitted tsMs is the ROUND time; receivedAtMs is broadcast + offset', () => {
  const p = createBacktestExternalFeedsProvider({
    rtdsChainlink: { symbol: 'btc/usd', series: chainlinkFixture(), latencyOffsetMs: 100 },
  })
  const pt = p.snapshotAt(3150).rtdsPolymarketCryptoPrices?.chainlink
  assert.equal(pt?.tsMs, 2000) // round time, NOT broadcast (3050)
  assert.equal(pt?.receivedAtMs, 3150) // 3050 + 100
  assert.equal(pt?.value, 11.25)
  assert.equal(pt?.symbol, 'btc/usd')
})

test('chainlink: visibility follows BROADCAST order even when round time steps backwards', () => {
  const p = createBacktestExternalFeedsProvider({
    rtdsChainlink: { symbol: 'btc/usd', series: chainlinkFixture(), latencyOffsetMs: 0 },
  })
  // At 5100: round 4000 (broadcast 5100) is the latest visible.
  assert.equal(p.snapshotAt(5100).rtdsPolymarketCryptoPrices?.chainlink?.tsMs, 4000)
  // At 5200: the LATE re-broadcast of round 3000 wins (last-write-wins in
  // broadcast order) — the emitted round clock legally steps backwards.
  const late = p.snapshotAt(5200).rtdsPolymarketCryptoPrices?.chainlink
  assert.equal(late?.tsMs, 3000)
  assert.equal(late?.value, 12.0)
})

test('chainlink: backwards tick binary-search + monotone clock clamp', () => {
  const p = createBacktestExternalFeedsProvider({
    rtdsChainlink: { symbol: 'btc/usd', series: chainlinkFixture(), latencyOffsetMs: 0 },
  })
  assert.equal(p.snapshotAt(6100).rtdsPolymarketCryptoPrices?.chainlink?.value, 14.5)
  // A tick that goes backwards must NOT rewind the feed: live wall clocks are
  // monotone, so the clamp holds the last value.
  assert.equal(p.snapshotAt(2100).rtdsPolymarketCryptoPrices?.chainlink?.value, 14.5)
})

test('chainlink + binance cursors are independent', () => {
  const p = createBacktestExternalFeedsProvider({
    binanceWsSpotPrice: { symbol: 'btcusdt', series: binanceFixture(), latencyOffsetMs: 0 },
    rtdsChainlink: { symbol: 'btc/usd', series: chainlinkFixture(), latencyOffsetMs: 0 },
  })
  const snap = p.snapshotAt(3060)
  assert.equal(snap.binanceWsSpotPrice?.value, 101) // trade 2500 visible, 3500 not
  assert.equal(snap.rtdsPolymarketCryptoPrices?.chainlink?.value, 11.25) // broadcast 3050
  // rtds.binance has no backtest source and must stay absent.
  assert.equal(snap.rtdsPolymarketCryptoPrices?.binance, undefined)
})

test('chainlink: same-visibility-ms ties resolve to the later row (last-write-wins)', () => {
  const series: TwoClockAsOfSeries = {
    tsMs: Float64Array.of(1000, 1001),
    visibleAtMs: Float64Array.of(2000, 2000),
    value: Float64Array.of(1.0, 2.0),
    length: 2,
  }
  const p = createBacktestExternalFeedsProvider({
    rtdsChainlink: { symbol: 'btc/usd', series, latencyOffsetMs: 0 },
  })
  assert.equal(p.snapshotAt(2000).rtdsPolymarketCryptoPrices?.chainlink?.value, 2.0)
})

test('provider without chainlink arg leaves the key absent (bit-identity for old callers)', () => {
  const p = createBacktestExternalFeedsProvider({
    binanceWsSpotPrice: { symbol: 'btcusdt', series: binanceFixture(), latencyOffsetMs: 0 },
  })
  const snap = p.snapshotAt(3000)
  assert.deepEqual(Object.keys(snap.rtdsPolymarketCryptoPrices ?? {}), [])
  assert.equal(snap.binanceWsSpotPrice?.value, 101)
})
