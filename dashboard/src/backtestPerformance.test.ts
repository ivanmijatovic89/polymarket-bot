import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPerformanceSeries,
  rollingMarketAverages,
  trailingMarketSummary,
  nearestPerformancePoint,
} from './lib/backtestPerformance.js'

const market = (index: number, pnl: number) => ({
  slug: `btc-updown-15m-${1780272000 + index * 900}`,
  pnl,
})

test('calendar order is independent of input order and retains zero-PnL markets', () => {
  const input = [market(2, -6), market(0, 10), market(1, 0), market(3, 4)]
  const { points, hasDates, maxDrawdown, drawdownIndex } = buildPerformanceSeries(input)
  assert.equal(hasDates, true)
  assert.deepEqual(
    points.map((p) => p.cumulative),
    [10, 10, 4, 8],
  )
  assert.deepEqual(rollingMarketAverages(points, 2), [null, 5, -3, -1])
  assert.deepEqual(trailingMarketSummary(points, 2), { total: -2, average: -1 })
  assert.equal(maxDrawdown, 6)
  assert.equal(drawdownIndex, 2)
  assert.equal(input[0].pnl, -6)
})

test('drawdown starts at zero and uses the previous peak, not the final peak', () => {
  const series = buildPerformanceSeries([-4, -6, 7, 20, -2].map((pnl, i) => market(i, pnl)))
  assert.equal(series.maxDrawdown, 10)
  assert.equal(series.drawdownPeak, 0)
  assert.equal(series.drawdownIndex, 1)
  assert.equal(series.peak, 17)
  assert.equal(series.peakIndex, 3)
  assert.equal(series.points.at(-1)!.drawdown, 2)
})

test('full rolling windows require enough data and cannot include future profits', () => {
  const { points } = buildPerformanceSeries([-5, -5, 0, 30].map((pnl, i) => market(i, pnl)))
  assert.deepEqual(rollingMarketAverages(points, 3), [null, null, -10 / 3, 25 / 3])
  assert.equal(trailingMarketSummary(points, 500), null)
  assert.deepEqual(rollingMarketAverages(points, 10), [null, null, null, null])
  assert.deepEqual(buildPerformanceSeries([]).points, [])
})

test('underwater duration resets at recovery and uses the latest equal peak', () => {
  const { points } = buildPerformanceSeries(
    [10, -4, 0, 4, 0, -2, 5].map((pnl, i) => market(i, pnl)),
  )
  assert.deepEqual(
    points.map((p) => p.drawdown),
    [0, 4, 4, 0, 0, 2, 0],
  )
  assert.deepEqual(
    points.map((p) => p.underwaterMarkets),
    [0, 1, 2, 0, 0, 1, 0],
  )
  assert.deepEqual(
    points.map((p) => p.underwaterMs),
    [0, 900_000, 1_800_000, 0, 0, 900_000, 0],
  )
})

test('initial and unrecovered losses retain their duration, without inventing missing dates', () => {
  const { points } = buildPerformanceSeries([market(0, -4), market(4, 1)])
  assert.deepEqual(
    points.map((p) => p.underwaterMarkets),
    [1, 2],
  )
  assert.deepEqual(
    points.map((p) => p.underwaterMs),
    [0, 3_600_000],
  )
  assert.equal(points.at(-1)!.drawdown, 3)
  const fallback = buildPerformanceSeries([{ slug: null, pnl: -4 }, market(4, 1)])
  assert.deepEqual(
    fallback.points.map((p) => p.underwaterMarkets),
    [1, 2],
  )
  assert.deepEqual(
    fallback.points.map((p) => p.underwaterMs),
    [null, null],
  )
})

test('stored dates take precedence; missing dates preserve all rows in saved order', () => {
  const series = buildPerformanceSeries([
    { ...market(0, 5), marketStartMs: 1780273800000 },
    market(1, -2),
  ])
  assert.deepEqual(
    series.points.map((p) => p.pnl),
    [-2, 5],
  )
  const fallback = buildPerformanceSeries([market(1, 2), { slug: null, pnl: -3 }, market(0, 4)])
  assert.equal(fallback.hasDates, false)
  assert.deepEqual(
    fallback.points.map((p) => p.cumulative),
    [2, -1, 3],
  )
  assert.equal(nearestPerformancePoint(fallback.points, -10), 0)
  assert.equal(nearestPerformancePoint(fallback.points, 2.7), 2)
})
