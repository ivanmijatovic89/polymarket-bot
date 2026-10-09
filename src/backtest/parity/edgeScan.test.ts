import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketOrderBooksSnapshot } from '../../market/orderbook/index.js'
import { EdgeCounter, pickEdgeMarkets, type EdgeCounters } from './edgeScan.js'

const UP = 'u'
const DOWN = 'd'
const snap = (
  ts: number,
  books: Record<string, [number | null, number | null]>,
): MarketOrderBooksSnapshot =>
  ({
    market: 'm',
    timestamp: ts,
    byAssetId: Object.fromEntries(
      Object.entries(books).map(([a, [bestBid, bestAsk]]) => [a, { bestBid, bestAsk }]),
    ),
  }) as unknown as MarketOrderBooksSnapshot
const raw = (msg: Record<string, unknown>, tsLocalMs?: number) =>
  ({
    msg,
    source: {
      kind: 'parquet',
      filePath: 'f',
      ingestSeq: 0n,
      ...(tsLocalMs !== undefined ? { tsLocalMs } : {}),
    },
  }) as never

describe('MS-3 edge scan (60 §4.2, 15 §8 counters)', () => {
  it('counts crossed books, clocks going backwards, deltas before the first book and a missing best price at start', () => {
    const c = new EdgeCounter(1000, [UP, DOWN])
    c.observe(
      snap(900, {}),
      raw({ event_type: 'price_change', timestamp: '900', price_changes: [{ asset_id: UP }] }, 950),
    )
    c.observe(
      snap(901, { [UP]: [0.5, 0.52] }),
      raw({ event_type: 'book', asset_id: UP, timestamp: '901' }, 940),
    )
    c.observe(
      snap(899, { [UP]: [0.53, 0.52] }),
      raw({ event_type: 'price_change', timestamp: '899', price_changes: [{ asset_id: UP }] }, 960),
    )
    c.observe(
      snap(1000, { [UP]: [0.5, 0.52] }),
      raw(
        { event_type: 'price_change', timestamp: '1000', price_changes: [{ asset_id: UP }] },
        1001,
      ),
    )
    assert.deepEqual(c.c, {
      events: 4,
      crossedBookTicks: 1,
      localClockBackwards: 1,
      exchangeClockBackwards: 1,
      deltaBeforeBook: 1,
      missingBestAtStart: true,
    })
  })

  it('picks distinct markets per criterion, most extreme first', () => {
    const base: EdgeCounters = {
      events: 10,
      crossedBookTicks: 0,
      localClockBackwards: 0,
      exchangeClockBackwards: 0,
      deltaBeforeBook: 0,
      missingBestAtStart: false,
    }
    const scanned = [
      { slug: 'a', counters: { ...base, events: 100 } },
      { slug: 'b', counters: { ...base, events: 1, crossedBookTicks: 3 } },
      { slug: 'c', counters: { ...base, events: 50, crossedBookTicks: 9 } },
      { slug: 'd', counters: { ...base, missingBestAtStart: true } },
    ]
    const picked = pickEdgeMarkets(scanned, 1, new Set(['x']))
    assert.deepEqual(
      picked.map((p) => [p.slug, p.criterion]),
      [
        ['a', 'most events'],
        ['b', 'fewest events'],
        ['c', 'crossed-book ticks'],
        ['d', 'missing best bid or ask at window start'],
      ],
    )
    assert.equal(pickEdgeMarkets(scanned, 1, new Set(['a', 'b', 'c', 'd'])).length, 0)
  })
})
