import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { AccountEvent, MarketTick, PortfolioSnapshot } from '../../strategy/Strategy.js'
import type { RunSingleMarketOutput } from '../runSingleMarket.js'
import {
  ParityTraceRecorder,
  TRACE_FORMAT,
  TRACE_VERSION,
  num,
  parseTrace,
  readTrace,
  readTraceText,
  serializeTrace,
  writeTrace,
  type TraceLevel,
} from './trace.js'

const UP = '111'
const DOWN = '222'

function recorder(level: TraceLevel = 'feeds', outcome: 'UP' | 'DOWN' = 'UP') {
  return new ParityTraceRecorder(
    {
      engineVersion: 'ts',
      profile: 'ts-compat',
      slug: 'btc-updown-15m-1775417400',
      candidateKey: 'k',
      level,
    },
    { tokenMap: { UP, DOWN }, outcome },
  )
}

function tick(eventType: string, ts: number, localMs?: number): MarketTick {
  return {
    source: {
      kind: 'parquet',
      filePath: 'f',
      ingestSeq: 0n,
      ...(localMs !== undefined ? { tsLocalMs: localMs } : {}),
    },
    msg: { event_type: eventType, market: 'm', timestamp: String(ts) },
    snapshot: { market: 'm', timestamp: ts, byAssetId: {} },
  } as unknown as MarketTick
}

function portfolio(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    nowMs: 0,
    positionsByAssetId: {},
    openOrdersByClientId: {},
    ordersByClientId: {},
    recentFills: [],
    marketByAssetId: {},
    ...over,
  }
}

function output(stats: Record<string, unknown> | null, skipReason?: string): RunSingleMarketOutput {
  return {
    idx: 0,
    slug: 'btc-updown-15m-1775417400',
    marketStats: stats as never,
    eventsProcessed: 2,
    eventsByType: { price_change: 2 },
    durationMs: 1,
    ...(skipReason ? { skipReason: skipReason as never } : {}),
  }
}

describe('ParityTraceRecorder (pmb-parity-trace/2, 22 §3)', () => {
  it('starts with a v2 header and ends with final', () => {
    // spec: 22 §3.1, §3.2 header
    const r = recorder('decisions')
    r.finish(output(null, 'no_activity'))
    assert.deepEqual(r.records[0], {
      t: 'header',
      format: TRACE_FORMAT,
      version: TRACE_VERSION,
      engine: 'ts',
      engineVersion: 'ts',
      profile: 'ts-compat',
      slug: 'btc-updown-15m-1775417400',
      candidateKey: 'k',
      level: 'decisions',
    })
    const last = r.records.at(-1)!
    assert.equal(last.t, 'final')
    assert.equal(last.skipReason, 'no_activity')
    assert.equal(last.unrounded, null)
  })

  it('writes tick records with xts on real ticks, vts as the feed clock, and none on synthetic ticks for xts', () => {
    // spec: 22 §3.2 tick (xts/vts), 14 F-7 feed clock max(L, E)
    const r = recorder()
    r.observer.onTickStart(tick('price_change', 1000, 1040))
    r.observer.onTickStart(tick('binance_agg_trade', 1100, 1100))
    assert.deepEqual(r.records[1], {
      t: 'tick',
      seq: 0,
      ts: 1000,
      cause: 'price_change',
      xts: 1000,
      vts: 1040,
    })
    assert.deepEqual(r.records[2], {
      t: 'tick',
      seq: 1,
      ts: 1100,
      cause: 'binance_agg_trade',
      vts: 1100,
    })
  })

  it('writes the feeds record at level feeds only, with outcome-indexed plugin snapshots', () => {
    // spec: 22 §3.2 feeds; 22 §3.3 assets as outcome index
    const ctx = {
      plugins: {
        externalFeeds: {
          binanceWsSpotPrice: { symbol: 'btcusdt', tsMs: 1, value: 67465.22, receivedAtMs: 111 },
          rtdsPolymarketCryptoPrices: {
            chainlink: { symbol: 'btc/usd', tsMs: 2, value: 67450.0784363083, receivedAtMs: 1322 },
          },
          polymarketPriceToBeat: {
            symbol: 'BTC',
            eventStartTimeIso: 'a',
            endDateIso: 'b',
            openPrice: 68110.02906982866,
            receivedAtMs: 2700,
          },
        },
        timeWindowVolatility: {
          byAssetId: { [UP]: { std: 0.1 }, [DOWN]: { std: undefined, n: 3 } },
          asset: DOWN,
        },
      },
    }
    const r = recorder('feeds')
    r.observer.onTickStart(tick('book', 1000))
    r.observer.onContext!(ctx as never)
    assert.deepEqual(r.records[2], {
      t: 'feeds',
      seq: 0,
      binance: { tsMs: 1, value: 67465.22, receivedAtMs: 111 },
      chainlink: { tsMs: 2, value: 67450.0784363083, receivedAtMs: 1322 },
      priceToBeat: { value: 68110.02906982866, receivedAtMs: 2700 },
      plugins: {
        timeWindowVolatility: { byAssetId: { '0': { std: 0.1 }, '1': { n: 3 } }, asset: 1 },
      },
    })
    const d = recorder('decisions')
    d.observer.onTickStart(tick('book', 1000))
    d.observer.onContext!(ctx as never)
    assert.equal(d.records.length, 2)
  })

  it('absent feeds are null and absent plugins are omitted (14 P-7)', () => {
    const r = recorder('feeds')
    r.observer.onTickStart(tick('book', 1000))
    r.observer.onContext!(undefined)
    assert.deepEqual(r.records[2], {
      t: 'feeds',
      seq: 0,
      binance: null,
      chainlink: null,
      priceToBeat: null,
      plugins: {},
    })
  })

  it('traces intents and account events in delivery order with cid resolution', () => {
    // spec: 22 §3.2 intent/event, §3.3 ordering contract and cid resolution
    const r = recorder('decisions')
    r.observer.onTickStart(tick('book', 1000))
    r.observer.onDecision!('market', [
      {
        kind: 'place_limit',
        clientOrderId: 'x1',
        assetId: UP,
        side: 'BUY',
        price: 0.52,
        size: 10,
        orderType: 'GTC',
        postOnly: true,
      },
    ])
    const events: AccountEvent[] = [
      { kind: 'order_accepted', tsMs: 1000, clientOrderId: 'x1', orderId: 'o1' } as AccountEvent,
      {
        kind: 'ws_order_update',
        tsMs: 1000,
        order: { orderId: 'o1', status: 'MATCHED', sizeMatched: 0, event: 'UPDATE' },
      },
      {
        kind: 'ws_order_update',
        tsMs: 1000,
        order: { orderId: 'o1', status: 'CANCELED', event: 'CANCELLATION' },
      },
      { kind: 'order_open', tsMs: 1000, orderId: 'o1' } as AccountEvent,
      {
        kind: 'fill',
        fill: {
          id: 'f1',
          tsMs: 1001,
          assetId: UP,
          side: 'BUY',
          price: 0.5,
          size: 10.02,
          feeRateBps: 700,
          orderId: 'o1',
          liquidity: 'TAKER',
        },
      },
    ]
    for (const e of events) r.observer.onAccountEvent!(e, portfolio())
    r.observer.onDecision!('account', [{ kind: 'cancel_order', orderId: 'o1' } as never])
    const body = r.records.slice(1)
    assert.deepEqual(
      body.map((x) => `${x.t}:${String(x.kind ?? '')}`),
      [
        'tick:',
        'intent:place_limit',
        'event:order_accepted',
        'event:settlement_update',
        'event:order_open',
        'event:fill',
        'intent:cancel_order',
      ],
    )
    assert.deepEqual(body[1], {
      t: 'intent',
      seq: 0,
      src: 'tick',
      kind: 'place_limit',
      cid: 'x1',
      asset: 0,
      side: 'BUY',
      price: 0.52,
      size: 10,
      orderType: 'GTC',
      postOnly: true,
      expireAtMs: null,
    })
    // spec: 22 §3.2 settlement_update (only statuses mapping to a SettlementStatus)
    assert.deepEqual(body[3], {
      t: 'event',
      seq: 0,
      kind: 'settlement_update',
      ts: 1000,
      cid: 'x1',
      status: 'MATCHED',
      sizeMatched: 0,
    })
    assert.equal(body[4]!.cid, 'x1')
    // fee = 0.07 * 0.5 * 0.5 * 10.02 rounded by the TS fee function
    assert.equal(body[5]!.fee, 0.1754)
    assert.equal(body[5]!.cid, 'x1')
    assert.equal(body[6]!.cid, 'x1')
    assert.equal(body[6]!.src, 'account')
  })

  it('final.unrounded recomputes the TS money values and must round to the stats', () => {
    // spec: 22 §3.2 final.unrounded
    const r = recorder('decisions', 'UP')
    r.observer.onTickStart(tick('book', 1000))
    const fill: AccountEvent = {
      kind: 'fill',
      fill: {
        id: 'f1',
        tsMs: 1001,
        assetId: UP,
        side: 'BUY',
        price: 0.5,
        size: 10,
        feeRateBps: 700,
        liquidity: 'TAKER',
      },
    }
    const pf = portfolio({
      realizedPnlTotal: 0,
      positionsByAssetId: { [UP]: { assetId: UP, qty: 10, avgEntryPrice: 0.5, costBasis: 5.175 } },
    })
    r.observer.onAccountEvent!(fill, pf)
    const stats = {
      slug: 'btc-updown-15m-1775417400',
      marketId: 'm',
      finalOutcome: 'UP',
      pnl: 4.83,
      tradeCount: 1,
      tradeAsMaker: 0,
      tradeAsTaker: 1,
      feesPaid: 0.18,
      avgEntryPriceUp: 0.5,
      avgEntryPriceDown: null,
      upShares: 10,
      downShares: 0,
      mergableShares: 0,
      cost: 5.18,
      splitCost: 0,
      intentMeta: [],
    }
    r.finish(output(stats))
    const fin = r.records.at(-1)!
    assert.deepEqual(fin.unrounded, {
      pnl: 4.825,
      cost: 5.175,
      feesPaid: 0.175,
      splitCost: 0,
      upShares: 10,
      downShares: 0,
    })
    const bad = recorder('decisions', 'UP')
    bad.observer.onAccountEvent!(fill, pf)
    assert.throws(
      () => bad.finish(output({ ...stats, pnl: 9.99 })),
      /does not round to the TS stat/,
    )
  })

  it('num() rounds to 1e-9 and normalizes -0', () => {
    // spec: 22 §3.3 (TS rounds to 1e-9)
    assert.equal(num(0.1 + 0.2), 0.3)
    assert.equal(Object.is(num(-0), 0), true)
  })

  it('writes atomically, gzip by suffix, and reads back identically', () => {
    // spec: 22 §3.1 (gzip JSONL, atomic)
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-trace-'))
    const r = recorder('decisions')
    r.observer.onTickStart(tick('book', 1000))
    r.finish(output(null, 'no_activity'))
    for (const name of ['a.jsonl', 'a.jsonl.gz']) {
      const f = path.join(dir, name)
      writeTrace(f, r.records)
      assert.deepEqual(readTrace(f), r.records)
      assert.equal(readTraceText(f), serializeTrace(r.records))
    }
    assert.throws(() => parseTrace('{"t":"tick"}\n{bad', 'x'), /x:2: invalid JSON/)
  })
})
