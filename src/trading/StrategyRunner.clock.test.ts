import test from 'node:test'
import assert from 'node:assert/strict'
import { StrategyRunner } from './StrategyRunner.js'
import { OrderManager } from './OrderManager.js'
import { BacktestExecution } from './execution/BacktestExecution.js'
import { definition as basicFak } from '../strategies/basicFak.v1.js'
import type { MarketTick, PortfolioSnapshot, Intent, Strategy } from '../strategy/Strategy.js'
import type { OrderBookSnapshot } from '../market/orderbook/index.js'

function tick(timestamp: number, market = 'market', live = false): MarketTick {
  const book = (assetId: string, bestBid: number, bestAsk: number): OrderBookSnapshot => ({
    market,
    assetId,
    timestamp,
    bestBid,
    bestAsk,
    mid: (bestBid + bestAsk) / 2,
    spread: bestAsk - bestBid,
    bids: [{ price: bestBid, size: 100 }],
    asks: [{ price: bestAsk, size: 100 }],
    depthLevels: 1,
    bidsDepthByLevel: [100],
    asksDepthByLevel: [100],
  })
  return {
    source: live
      ? { kind: 'live', attempt: 1 }
      : { kind: 'parquet', filePath: '/clock.parquet', ingestSeq: 1n, tsLocalMs: timestamp },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: {
      market,
      timestamp,
      byAssetId: { a: book('a', 0.29, 0.3), b: book('b', 0.69, 0.7) },
    },
  }
}

test('basicFak account snapshots and order IDs depend on the tick stream, not host time', async (t) => {
  let hostNow = 2_000_000_000_000
  t.mock.method(Date, 'now', () => hostNow)
  t.mock.method(console, 'log', () => {})
  const run = async (live: boolean) => {
    const snapshots: PortfolioSnapshot[] = []
    const decisions: Intent[][] = []
    const { strategy } = basicFak.create(basicFak.schema.parse({}))
    const runner = new StrategyRunner({
      strategy,
      orderManager: new OrderManager({ execution: new BacktestExecution() }),
      intentExecutionMode: 'immediate',
      observer: {
        onAccountEvent: (_event, portfolio) => snapshots.push(structuredClone(portfolio)),
        onDecision: (_origin, intents) => decisions.push(structuredClone([...intents])),
      },
    })
    await runner.onMarketTick(tick(1_000, 'market', live))
    const ids = Object.keys(runner.getPortfolio().snapshot().ordersByClientId).sort()
    assert.deepEqual(ids, ['basic_fak:a:buy:1000', 'basic_fak:a:sell:1000'])
    assert.ok(snapshots.length > 0)
    assert.ok(snapshots.every((snapshot) => snapshot.nowMs === 1_000))
    return { snapshots, decisions, ids }
  }
  const first = await run(false)
  hostNow += 86_400_000
  assert.deepEqual(await run(false), first)
  assert.deepEqual(await run(true), first)
})

test('first market ticks initialize each episode while subsequent ticks reuse the cached snapshot', async () => {
  const snapshots: PortfolioSnapshot[] = []
  const createStrategy = (): { strategy: Strategy } => ({
    strategy: {
      name: 'clock-probe',
      onMarketTick: (_tick, portfolio) => {
        snapshots.push(portfolio)
        return []
      },
      onAccountEvent: () => [],
    },
  })
  const runner = new StrategyRunner({
    ...createStrategy(),
    createStrategy,
    orderManager: new OrderManager({ execution: new BacktestExecution() }),
  })
  await runner.onMarketTick(tick(1_000))
  await runner.onMarketTick(tick(2_000))
  await runner.onMarketTick(tick(3_000, 'next-market'))
  assert.equal(snapshots[0]?.nowMs, 1_000)
  assert.equal(snapshots[1], snapshots[0])
  assert.equal(snapshots[2]?.nowMs, 3_000)
})

test('an account event arriving before the first tick establishes the clock', async () => {
  const snapshots: PortfolioSnapshot[] = []
  const strategy: Strategy = {
    name: 'account-first-clock',
    onMarketTick: (_tick, portfolio) => {
      snapshots.push(portfolio)
      return []
    },
    onAccountEvent: (_event, portfolio) => {
      snapshots.push(portfolio)
      return []
    },
  }
  const runner = new StrategyRunner({
    strategy,
    orderManager: new OrderManager({ execution: new BacktestExecution() }),
  })
  await runner.onAccountEvent({
    kind: 'account_stream_status',
    source: 'user_ws',
    status: 'connected',
    tsMs: 1_500,
  })
  await runner.onMarketTick(tick(1_000, 'market', true))
  assert.equal(snapshots[0]?.nowMs, 1_500)
  assert.equal(snapshots[1], snapshots[0])
})
