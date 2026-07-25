import test from 'node:test'
import assert from 'node:assert/strict'
import { StrategyRunner } from './StrategyRunner.js'
import { OrderManager } from './OrderManager.js'
import { BacktestExecution } from './execution/BacktestExecution.js'
import { buildSyntheticFeedTick } from '../market/syntheticTick.js'
import type { MarketTick, Strategy, Intent, PlaceLimitIntent } from '../strategy/Strategy.js'
import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../market/orderbook/index.js'

/**
 * Execution-safety guarantees for synthetic feed ticks:
 * the execution simulator must never run on a synthetic tick (unchanged book
 * ⇒ any new fill would be one live never gives), while strategy intents ON
 * synthetic ticks still execute normally.
 */

const ASSET = 'assetA'

function makeBook(args: {
  ts: number
  bestAsk: number
  askSize: number
}): MarketOrderBooksSnapshot {
  const book: Partial<OrderBookSnapshot> = {
    market: 'm1',
    assetId: ASSET,
    timestamp: args.ts,
    bestBid: 0.3,
    bestAsk: args.bestAsk,
    bids: [{ price: 0.3, size: 1000 }],
    asks: [{ price: args.bestAsk, size: args.askSize }],
  }
  return {
    market: 'm1',
    timestamp: args.ts,
    byAssetId: { [ASSET]: book as OrderBookSnapshot },
  } as MarketOrderBooksSnapshot
}

function realTick(snapshot: MarketOrderBooksSnapshot): MarketTick {
  return {
    source: {
      kind: 'parquet',
      filePath: '/x.parquet',
      ingestSeq: 1n,
      tsLocalMs: snapshot.timestamp,
    },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot,
  }
}

function synTick(
  base: MarketOrderBooksSnapshot,
  visibilityMs: number,
  eventType: 'binance_agg_trade' | 'chainlink_round' = 'binance_agg_trade',
): MarketTick {
  return buildSyntheticFeedTick({
    eventType,
    symbol: eventType === 'chainlink_round' ? 'btc/usd' : 'btcusdt',
    visibilityMs,
    baseSnapshot: base,
    source: { kind: 'parquet', filePath: '/x.parquet', ingestSeq: 0n, tsLocalMs: visibilityMs },
  })
}

type Placer = { placeOnTickTs: number | null; intent: PlaceLimitIntent }

function makeStack(placer: Placer, mode: 'immediate' | 'queued' = 'immediate') {
  const strategy: Strategy = {
    name: 'synthetic-exec-test',
    onMarketTick: (tick): Intent[] =>
      placer.placeOnTickTs !== null && tick.snapshot.timestamp === placer.placeOnTickTs
        ? [placer.intent]
        : [],
    onAccountEvent: () => [],
  }
  const execution = new BacktestExecution() // latency 0, worst_queue
  const orderManager = new OrderManager({ execution, minGtdOffsetMs: 0 })
  const runner = new StrategyRunner({ strategy, orderManager, intentExecutionMode: mode })
  return runner
}

const buy40: PlaceLimitIntent = {
  kind: 'place_limit',
  clientOrderId: 'c1',
  assetId: ASSET,
  side: 'BUY',
  price: 0.4,
  size: 100,
  orderType: 'GTC',
}

test('REGRESSION: synthetic tick must not maker-fill a resting remainder on a stale crossed book', async () => {
  // Tick N: crossed book (ask 0.39 < limit 0.40) with only 40 size — taker
  // fills 40, remainder 60 rests. Today the remainder is next evaluated on the
  // REAL tick N+1 where the book moved away (ask 0.45) — no fill. A synthetic
  // tick between them carries tick N's stale crossed book; if the execution
  // simulator ran on it, it would fill the 60 that live never fills.
  const run = async (withSynthetic: boolean) => {
    const runner = makeStack({ placeOnTickTs: 1_000, intent: buy40 })
    const crossed = makeBook({ ts: 1_000, bestAsk: 0.39, askSize: 40 })
    await runner.onMarketTick(realTick(crossed))
    if (withSynthetic) await runner.onMarketTick(synTick(crossed, 1_400))
    await runner.onMarketTick(realTick(makeBook({ ts: 2_000, bestAsk: 0.45, askSize: 500 })))
    return runner.getPortfolio().snapshot()
  }

  const withSyn = await run(true)
  const withoutSyn = await run(false)

  // Position: exactly the tick-N taker fill (net of taker fee), in both runs.
  const qtyWithout = withoutSyn.positionsByAssetId[ASSET]?.qty ?? 0
  const qtyWith = withSyn.positionsByAssetId[ASSET]?.qty ?? 0
  assert.ok(qtyWithout > 39 && qtyWithout <= 40, String(qtyWithout))
  assert.equal(qtyWith, qtyWithout)
  // The remainder is still open (not spuriously filled) with the synthetic tick.
  assert.equal(Object.keys(withSyn.openOrdersByClientId).length, 1)
  assert.equal(withSyn.openOrdersByClientId['c1']?.remaining, 60)
  // Fill streams identical.
  assert.equal(withSyn.recentFills.length, withoutSyn.recentFills.length)
})

test('GTD expiry fires on the next REAL tick, not on a synthetic tick', async () => {
  const gtd: PlaceLimitIntent = {
    ...buy40,
    clientOrderId: 'c2',
    price: 0.2, // resting (not crossed)
    orderType: 'GTD',
    expireAtMs: 1_500,
  }
  const runner = makeStack({ placeOnTickTs: 1_000, intent: gtd })
  const book = makeBook({ ts: 1_000, bestAsk: 0.45, askSize: 100 })
  await runner.onMarketTick(realTick(book))
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 1)

  // Synthetic tick past the expiry time: order must remain open.
  await runner.onMarketTick(synTick(book, 1_800))
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 1)

  // Next real tick expires it.
  await runner.onMarketTick(realTick(makeBook({ ts: 2_000, bestAsk: 0.45, askSize: 100 })))
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 0)
})

test('queued-mode intents do not dispatch on synthetic ticks', async () => {
  const runner = makeStack(
    { placeOnTickTs: 1_000, intent: { ...buy40, clientOrderId: 'c3', price: 0.2 } },
    'queued',
  )
  const book = makeBook({ ts: 1_000, bestAsk: 0.45, askSize: 100 })
  await runner.onMarketTick(realTick(book)) // intent queued, not yet executed
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 0)

  await runner.onMarketTick(synTick(book, 1_400)) // must NOT dispatch the queue
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 0)

  await runner.onMarketTick(realTick(makeBook({ ts: 2_000, bestAsk: 0.45, askSize: 100 })))
  assert.equal(Object.keys(runner.getPortfolio().snapshot().openOrdersByClientId).length, 1)
})

test('a strategy CAN take liquidity on a synthetic tick (immediate mode), stamped with the clamped time', async () => {
  // Strategy places on the synthetic tick's clamped timestamp.
  const runner = makeStack({
    placeOnTickTs: 1_400,
    intent: { ...buy40, clientOrderId: 'c4', price: 0.5, size: 10 },
  })
  const book = makeBook({ ts: 1_000, bestAsk: 0.45, askSize: 100 })
  await runner.onMarketTick(realTick(book))
  await runner.onMarketTick(synTick(book, 1_400))
  const snap = runner.getPortfolio().snapshot()
  const fill = snap.recentFills.at(-1)
  assert.equal(fill?.size, 10)
  assert.equal(fill?.tsMs, 1_400)
  assert.equal(fill?.liquidity, 'TAKER')
})

test('synthetic tick does not trigger a spurious market-change plugin reset', async () => {
  let resets = 0
  const pluginSet = {
    list: () => [],
    listIds: () => [],
    reset: () => {
      resets += 1
    },
    onMarketTick: () => {},
    snapshot: () => ({}),
    refreshSnapshot: () => ({}),
  } as never
  const strategy: Strategy = { name: 't', onMarketTick: () => [], onAccountEvent: () => [] }
  const runner = new StrategyRunner({
    strategy,
    orderManager: new OrderManager({ execution: new BacktestExecution() }),
    intentExecutionMode: 'immediate',
    pluginSet,
  })
  const book = makeBook({ ts: 1_000, bestAsk: 0.45, askSize: 100 })
  await runner.onMarketTick(realTick(book))
  await runner.onMarketTick(synTick(book, 1_400))
  await runner.onMarketTick(realTick(makeBook({ ts: 2_000, bestAsk: 0.45, askSize: 100 })))
  assert.equal(resets, 0)
  // The clamped synthetic snapshot is what account-event handlers would reuse.
  assert.equal(runner.getLastMarketSnapshot()?.timestamp, 2_000)
})

test('REGRESSION also holds for chainlink_round synthetic ticks', async () => {
  const runner = makeStack({ placeOnTickTs: 1_000, intent: { ...buy40, clientOrderId: 'c5' } })
  const crossed = makeBook({ ts: 1_000, bestAsk: 0.39, askSize: 40 })
  await runner.onMarketTick(realTick(crossed))
  await runner.onMarketTick(synTick(crossed, 1_400, 'chainlink_round'))
  await runner.onMarketTick(realTick(makeBook({ ts: 2_000, bestAsk: 0.45, askSize: 500 })))
  const snap = runner.getPortfolio().snapshot()
  // Remainder not spuriously maker-filled by the chainlink synthetic tick.
  assert.equal(snap.openOrdersByClientId['c5']?.remaining, 60)
})
