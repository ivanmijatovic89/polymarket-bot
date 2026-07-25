import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSyntheticTickSchedule,
  createSyntheticFlusher,
  type SyntheticTickEvent,
} from './syntheticTickSchedule.js'
import type { AsOfSeries } from './binanceAggTradesSource.js'
import type { TwoClockAsOfSeries } from './chainlinkCryptoPricesSource.js'

function binSeries(ts: number[]): AsOfSeries {
  return {
    tsMs: Float64Array.from(ts),
    value: Float64Array.from(ts.map(() => 1)),
    length: ts.length,
  }
}

function clSeries(visibleAt: number[]): TwoClockAsOfSeries {
  return {
    tsMs: Float64Array.from(visibleAt.map((v) => v - 1_000)),
    visibleAtMs: Float64Array.from(visibleAt),
    value: Float64Array.from(visibleAt.map(() => 1)),
    length: visibleAt.length,
  }
}

test('schedule maps event time + latency to visibility, window-bounded inclusive, series order kept', () => {
  const sched = buildSyntheticTickSchedule({
    binance: {
      series: binSeries([900, 1_000, 1_500, 1_500, 2_000, 2_500]),
      latencyOffsetMs: 100,
      symbol: 'btcusdt',
    },
    windowStartMs: 1_100,
    windowEndMs: 2_100,
  })
  // visibilities: 1000(out) 1100(in) 1600 1600 2100(in) 2600(out)
  assert.deepEqual(
    sched.map((e) => e.visibilityMs),
    [1_100, 1_600, 1_600, 2_100],
  )
  assert.ok(sched.every((e) => e.eventType === 'binance_agg_trade' && e.symbol === 'btcusdt'))
})

test('empty series → empty schedule; merged feeds sort by visibility with binance-first tie-break', () => {
  assert.deepEqual(
    buildSyntheticTickSchedule({
      binance: { series: binSeries([]), latencyOffsetMs: 0, symbol: 'x' },
      windowStartMs: 0,
      windowEndMs: 10,
    }),
    [],
  )
  const merged = buildSyntheticTickSchedule({
    binance: { series: binSeries([1_000, 3_000]), latencyOffsetMs: 0, symbol: 'btcusdt' },
    chainlink: { series: clSeries([1_000, 2_000]), latencyOffsetMs: 0, symbol: 'btc/usd' },
    windowStartMs: 0,
    windowEndMs: 10_000,
  })
  assert.deepEqual(
    merged.map((e) => `${e.visibilityMs}:${e.eventType}`),
    [
      '1000:binance_agg_trade',
      '1000:chainlink_round',
      '2000:chainlink_round',
      '3000:binance_agg_trade',
    ],
  )
})

function makeFlusher(
  schedule: SyntheticTickEvent[] | null,
  opts?: { noBase?: boolean; stopAfter?: number },
) {
  const dispatched: number[] = []
  let base = !(opts?.noBase ?? false)
  const flusher = createSyntheticFlusher({
    schedule,
    hasBaseSnapshot: () => base,
    dispatch: async (ev) => {
      dispatched.push(ev.visibilityMs)
    },
    ...(opts?.stopAfter !== undefined
      ? { shouldStop: () => dispatched.length >= opts.stopAfter! }
      : {}),
  })
  return { flusher, dispatched, setBase: (b: boolean) => (base = b) }
}

function ev(v: number): SyntheticTickEvent {
  return { visibilityMs: v, eventType: 'binance_agg_trade', symbol: 'btcusdt' }
}

test('flusher: strict inequality — event at exactly the real clock dispatches AFTER that real tick', async () => {
  const { flusher, dispatched } = makeFlusher([ev(1_400), ev(2_000), ev(2_050)])
  await flusher.flushUpTo(1_000) // C0: nothing scheduled before
  assert.deepEqual(dispatched, [])
  await flusher.flushUpTo(2_000) // C1: flush 1400 only — 2000 == C1 stays (orderbook first)
  assert.deepEqual(dispatched, [1_400])
  await flusher.flushUpTo(2_100) // C2: 2000 and 2050 now flush, in order
  assert.deepEqual(dispatched, [1_400, 2_000, 2_050])
})

test('flusher: events before the first real snapshot are consumed but never dispatched', async () => {
  const { flusher, dispatched, setBase } = makeFlusher([ev(500), ev(900), ev(1_500)], {
    noBase: true,
  })
  await flusher.flushUpTo(1_000) // no base yet → 500, 900 dropped
  assert.deepEqual(dispatched, [])
  setBase(true)
  await flusher.flushUpTo(2_000)
  assert.deepEqual(dispatched, [1_500])
})

test('flusher: backwards real clock flushes nothing and never re-dispatches', async () => {
  const { flusher, dispatched } = makeFlusher([ev(1_100), ev(1_900)])
  await flusher.flushUpTo(1_500)
  assert.deepEqual(dispatched, [1_100])
  await flusher.flushUpTo(1_200) // clock went backwards (exchange_time reorder)
  assert.deepEqual(dispatched, [1_100])
  await flusher.flushUpTo(2_000)
  assert.deepEqual(dispatched, [1_100, 1_900])
})

test('flusher: flushTail dispatches the remainder exactly once; null schedule is inert', async () => {
  const { flusher, dispatched } = makeFlusher([ev(1_100), ev(9_000)])
  await flusher.flushUpTo(1_500)
  await flusher.flushTail()
  await flusher.flushTail()
  assert.deepEqual(dispatched, [1_100, 9_000])

  const inert = makeFlusher(null)
  await inert.flusher.flushUpTo(10_000)
  await inert.flusher.flushTail()
  assert.deepEqual(inert.dispatched, [])
})

test('flusher: shouldStop halts mid-flush without advancing further', async () => {
  const { flusher, dispatched } = makeFlusher([ev(1_000), ev(1_100), ev(1_200)], { stopAfter: 1 })
  await flusher.flushUpTo(5_000)
  assert.deepEqual(dispatched, [1_000])
})
