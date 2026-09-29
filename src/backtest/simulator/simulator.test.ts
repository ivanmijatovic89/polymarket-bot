import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { StrategyRunner } from '../../trading/StrategyRunner.js'
import { BacktestExecution } from '../../trading/execution/BacktestExecution.js'
import { OrderManager } from '../../trading/OrderManager.js'
import { Portfolio } from '../../trading/Portfolio.js'
import { buildSyntheticFeedTick } from '../../market/syntheticTick.js'
import type { MarketTick, Strategy, Intent, AccountEvent } from '../../strategy/Strategy.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import { TraceWriter } from './traceWriter.js'
import { displayMetrics, type TraceChunk } from './contracts.js'

function tick(ts: number, ask = 0.7, size = 1000): MarketTick {
  const up = {
    market: 'market',
    assetId: 'up',
    timestamp: ts,
    bestBid: 0.3,
    bestAsk: ask,
    bids: [{ price: 0.3, size: 1000 }],
    asks: [{ price: ask, size }],
  } as OrderBookSnapshot
  return {
    source: { kind: 'parquet', filePath: 'test', ingestSeq: BigInt(ts), tsLocalMs: ts },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: {
      market: 'market',
      timestamp: ts,
      byAssetId: {
        up,
        down: { ...up, assetId: 'down', bestAsk: 0.2, asks: [{ price: 0.2, size: 1000 }] },
      },
    },
  }
}
function strategy(): Strategy {
  let placed = false,
    hedged = false
  return {
    name: 'trace parity',
    onMarketTick: (): Intent[] => {
      if (placed) return []
      placed = true
      return [
        {
          kind: 'place_limit',
          clientOrderId: 'up-order',
          assetId: 'up',
          side: 'BUY',
          price: 0.6,
          size: 10,
          orderType: 'GTC',
        },
      ]
    },
    onAccountEvent: (event): Intent[] => {
      if (event.kind !== 'fill' || hedged) return []
      hedged = true
      return [
        {
          kind: 'place_limit',
          clientOrderId: 'hedge',
          assetId: 'down',
          side: 'BUY',
          price: 0.2,
          size: 5,
          orderType: 'FOK',
        },
      ]
    },
  }
}
function readChunk(dir: string, id: number): TraceChunk {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(dir, `${id}.json.gz`))).toString(),
  ) as TraceChunk
}

test('observer preserves execution, including partial fills, synthetic ticks and account-triggered intents', async (t) => {
  t.mock.method(Date, 'now', () => 10_000)
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-parity-'))
  try {
    const writer = new TraceWriter(dir, { UP: 'up', DOWN: 'down' }, undefined, 2)
    const run = async (observed: boolean) => {
      const runner = new StrategyRunner({
        strategy: strategy(),
        intentExecutionMode: 'immediate',
        orderManager: new OrderManager({
          execution: new BacktestExecution({
            latencyMs: 10,
            jitterMs: 0,
            makerFillMode: 'worst_queue',
          }),
        }),
        ...(observed ? { observer: writer.observer } : {}),
      })
      const crossed = tick(1050, 0.7, 1000)
      const synthetic = buildSyntheticFeedTick({
        baseSnapshot: crossed.snapshot,
        eventType: 'binance_agg_trade',
        symbol: 'btcusdt',
        visibilityMs: 1060,
        source: { kind: 'parquet', filePath: 'test', ingestSeq: 0n, tsLocalMs: 1060 },
      })
      for (const t of [
        tick(1000),
        tick(1020, 0.5, 4),
        crossed,
        synthetic,
        tick(1100, 0.5),
        tick(1150, 0.7),
      ]) {
        if (observed) writer.observer.onTickStart(t)
        await runner.onMarketTick(t)
        if (observed) writer.observer.onTickEnd()
      }
      return runner.getPortfolio().snapshot()
    }
    const plain = await run(false),
      observed = await run(true)
    assert.deepEqual(observed, plain)
    writer.finish()
    assert.ok(
      writer.actions.some((a) => a.kind === 'intent:place_limit' && a.label.startsWith('account:')),
    )
    assert.ok(writer.actions.filter((a) => a.kind === 'fill').length >= 3)
    assert.equal(writer.chunks.length, 3)
    const chunks = writer.chunks.map((c) => readChunk(dir, c.id))
    const frames = chunks.flatMap((c) => c.frames)
    assert.deepEqual(
      frames.map((f) => f.tick),
      [0, 1, 2, 3, 4, 5],
    )
    assert.equal(frames[3]!.kind, 'binance_agg_trade')
    assert.equal(frames[3]!.actions.filter((a) => a.kind === 'fill').length, 0)
    const previous = chunks[0]!,
      next = chunks[1]!
    assert.deepEqual(next.states[0], previous.states[previous.frames.at(-1)!.state])
    // A display checkpoint is independent of the later terminal order state.
    assert.equal(chunks[0]!.states[0]!.up.qty, 0)
    assert.equal(chunks[2]!.states.at(-1)!.up.qty, 10)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cash ledger includes fees, splits and actual merges; duplicate fills do not charge twice', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-cash-'))
  try {
    const writer = new TraceWriter(dir, { UP: 'up', DOWN: 'down' })
    const portfolio = new Portfolio()
    const fill: AccountEvent = {
      kind: 'fill',
      fill: {
        id: 'f',
        tsMs: 1000,
        assetId: 'up',
        side: 'BUY',
        price: 0.5,
        size: 10,
        liquidity: 'TAKER',
        feeRateBps: 700,
      },
    }
    const events: AccountEvent[] = [
      fill,
      fill,
      {
        kind: 'positions_split',
        split: { id: 's', tsMs: 1000, assetIdA: 'up', assetIdB: 'down', size: 5, splitCost: 5 },
      },
      {
        kind: 'positions_merged',
        id: 'merge',
        tsMs: 1000,
        assetIdA: 'up',
        assetIdB: 'down',
        size: 100,
      },
      {
        kind: 'fill',
        fill: {
          id: 'sell',
          tsMs: 1000,
          assetId: 'up',
          side: 'SELL',
          price: 0.8,
          size: 4,
          liquidity: 'TAKER',
          feeRateBps: 700,
        },
      },
    ]
    writer.observer.onTickStart(tick(1000))
    for (const event of events) {
      portfolio.apply(event)
      writer.observer.onAccountEvent!(event, portfolio.snapshot())
    }
    writer.observer.onTickEnd()
    writer.finish()
    const state = readChunk(dir, 0).states.at(-1)!
    assert.equal(state.fills, 2)
    assert.equal(state.up.qty, 6)
    assert.equal(state.down.qty, 0)
    assert.ok(Math.abs(state.fees - 0.2198) < 1e-8)
    assert.ok(Math.abs(state.cashDelta - -2.0198) < 1e-8)
    assert.ok(Math.abs(displayMetrics(state, 100).cash - 97.9802) < 1e-8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chart compression preserves first, last and extrema through a frozen clock', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-chart-'))
  try {
    const writer = new TraceWriter(dir, { UP: 'up', DOWN: 'down' })
    for (let i = 0; i < 100; i++) {
      writer.observer.onTickStart(tick(1000, i === 42 ? 0.99 : i === 72 ? 0.01 : 0.5))
      writer.observer.onTickEnd()
    }
    writer.finish()
    assert.equal(writer.chart[0]!.tick, 0)
    assert.equal(writer.chart.at(-1)!.tick, 99)
    assert.ok(writer.chart.some((p) => p.upAsk === 0.99))
    assert.ok(writer.chart.some((p) => p.upAsk === 0.01))
    assert.ok(writer.chart.length <= 10)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('backward timestamps keep ingest order and account events retain the context they saw', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-clock-'))
  try {
    const writer = new TraceWriter(dir, { UP: 'up', DOWN: 'down' })
    writer.observer.onTickStart(tick(2000))
    writer.observer.onContext!({ plugins: { externalFeeds: { price: 20 } } })
    writer.observer.onTickEnd()
    writer.observer.onTickStart(tick(1000))
    writer.observer.onDecision!('account', [{ kind: 'cancel_all' }])
    writer.observer.onContext!({ plugins: { externalFeeds: { price: 30 } } })
    writer.observer.onTickEnd()
    writer.finish()
    const chunk = readChunk(dir, 0),
      frame = chunk.frames[1]!
    assert.equal(frame.time, 2000)
    assert.equal(frame.exchangeTime, 1000)
    assert.deepEqual(chunk.contexts[frame.actions[0]!.context], { price: 20 })
    assert.deepEqual(chunk.contexts[frame.context], { price: 30 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
