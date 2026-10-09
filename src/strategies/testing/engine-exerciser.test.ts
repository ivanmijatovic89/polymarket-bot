import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Intent, MarketTick, PortfolioSnapshot } from '../../strategy/Strategy.js'
import {
  EXERCISER_ID,
  EXERCISER_SCHEDULE_VERSION,
  createExerciser,
  snapPrice,
} from './engine-exerciser.js'

const UP = 'up'
const DOWN = 'down'
const ctx = { market: { upAssetId: UP, downAssetId: DOWN } } as never
const portfolio = (over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  nowMs: 0,
  positionsByAssetId: {},
  openOrdersByClientId: {},
  ordersByClientId: {},
  recentFills: [],
  marketByAssetId: {},
  ...over,
})
type Book = { bestBid: number | null; bestAsk: number | null }
const tick = (ts: number, books: Record<string, Book>, eventType = 'price_change'): MarketTick =>
  ({
    source: { kind: 'parquet', filePath: 'f', ingestSeq: 0n },
    msg: { event_type: eventType, market: 'm', timestamp: String(ts) },
    snapshot: { market: 'm', timestamp: ts, byAssetId: books },
  }) as unknown as MarketTick
const books = { [UP]: { bestBid: 0.5, bestAsk: 0.52 }, [DOWN]: { bestBid: 0.47, bestAsk: 0.49 } }

/** Drive `n` real ticks and collect the intents per tick index. */
async function drive(n: number, pf = portfolio(), b: Record<string, Book> = books) {
  const s = createExerciser()
  const out = new Map<number, Intent[]>()
  for (let i = 0; i < n; i++) {
    const intents = await s.onMarketTick(tick(1000 + i, b), pf, ctx)
    if (intents.length > 0) out.set(i, intents)
  }
  return { s, out }
}

const cids = (xs: Intent[] | undefined) =>
  (xs ?? []).map((i) => ('clientOrderId' in i ? i.clientOrderId : i.kind))

describe('engine exerciser v1 (60 §5.1, §5.2, §5.4)', () => {
  it('is the TS twin with schedule version 1 (60 §5.7)', () => {
    assert.equal(EXERCISER_ID, 'engine-exerciser')
    assert.equal(EXERCISER_SCHEDULE_VERSION, 1)
  })

  it('snaps prices on the 1e-6 grid, down for BUY and up for SELL, clamped to [0.01, 0.99]', () => {
    // spec: 60 §5.1
    assert.equal(snapPrice(0.4999999999, 'BUY'), 0.5)
    assert.equal(snapPrice(0.527, 'BUY'), 0.52)
    assert.equal(snapPrice(0.521, 'SELL'), 0.53)
    assert.equal(snapPrice(-0.03, 'BUY'), 0.01)
    assert.equal(snapPrice(1.2, 'SELL'), 0.99)
  })

  it('fires the v1 schedule at its tick indexes', async () => {
    // spec: 60 §5.2
    const { out } = await drive(501)
    assert.deepEqual(cids(out.get(50)), ['x1'])
    assert.deepEqual(cids(out.get(60)), ['x2'])
    assert.deepEqual(cids(out.get(70)), ['split_positions'])
    assert.deepEqual(cids(out.get(90)), ['x3'])
    assert.deepEqual(cids(out.get(100)), ['place_batch'])
    assert.deepEqual(cids(out.get(120)), ['x1'])
    assert.deepEqual(cids(out.get(150)), ['x5'])
    assert.deepEqual(cids(out.get(220)), ['cancel_batch'])
    assert.deepEqual(cids(out.get(300)), ['cancel_market'])
    assert.deepEqual(cids(out.get(500)), ['cancel_all'])
    // merge and x8 skip without positions
    assert.equal(out.get(260), undefined)
    assert.equal(out.get(400), undefined)
    const x3 = out.get(90)![0] as { price: number; expireAtMs: number; orderType: string }
    assert.deepEqual([x3.price, x3.expireAtMs, x3.orderType], [0.48, 1090 + 120_000, 'GTD'])
  })

  it('retries an action whose best price is missing on every following tick', async () => {
    // spec: 60 §5.1 (pending until it fires)
    const s = createExerciser()
    const noBid = { [UP]: { bestBid: null, bestAsk: 0.52 }, [DOWN]: books[DOWN] }
    let fired = -1
    for (let i = 0; i < 56 && fired < 0; i++) {
      const out = await s.onMarketTick(tick(1000 + i, i < 55 ? noBid : books), portfolio(), ctx)
      if (cids(out).includes('x1')) fired = i
    }
    assert.equal(fired, 55)
  })

  it('synthetic feed ticks never advance n', async () => {
    // spec: 60 §5.1 (synthetic feed ticks never count)
    const s = createExerciser()
    for (let i = 0; i < 50; i++) {
      await s.onMarketTick(tick(i, books, 'binance_agg_trade'), portfolio(), ctx)
      await s.onMarketTick(tick(i, books), portfolio(), ctx)
    }
    assert.deepEqual(cids(await s.onMarketTick(tick(99, books), portfolio(), ctx)), ['x1'])
  })

  it('periodic slots place when no orders are open and cancel 40 ticks later', async () => {
    // spec: 60 §5.2 (600 + 100k), §5.1 periodic slots
    const { out } = await drive(741)
    assert.deepEqual(cids(out.get(600)), ['r600'])
    assert.deepEqual(cids(out.get(640)), ['r600'])
    assert.equal((out.get(640)![0] as { kind: string }).kind, 'cancel_order')
    assert.deepEqual(cids(out.get(700)), ['r700'])
    const open = portfolio({ openOrdersByClientId: { z: {} as never } })
    const busy = await drive(601, open)
    assert.equal(busy.out.get(600), undefined)
  })

  it('A0: the first fill of x2 returns a SELL at fill price + 0.05 for the fill size', async () => {
    // spec: 60 §5.4 A0
    const s = createExerciser()
    const ev = {
      kind: 'fill',
      fill: {
        id: 'f',
        tsMs: 1,
        assetId: DOWN,
        side: 'BUY',
        price: 0.49,
        size: 5,
        clientOrderId: 'x2',
      },
    } as const
    const first = await s.onAccountEvent(ev as never, portfolio())
    assert.deepEqual(cids(first), ['x2-exit'])
    const exit = first[0] as { side: string; price: number; size: number; assetId: string }
    assert.deepEqual([exit.side, exit.price, exit.size, exit.assetId], ['SELL', 0.54, 5, DOWN])
    assert.deepEqual(await s.onAccountEvent(ev as never, portfolio()), [])
  })
})
