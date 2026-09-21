import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { AccountEvent, MarketTick, PlaceLimitIntent } from '../strategy/Strategy.js'
import { OrderManager } from './OrderManager.js'
import { StrategyRunner } from './StrategyRunner.js'
import { BacktestExecution } from './execution/BacktestExecution.js'
import { resolveMaxEventsPerDrain } from './runnerConfig.js'
import { DEFAULT_RISK_LIMITS } from './riskLimits.js'

function preserveEnv(t: TestContext) {
  const previous = process.env.MAX_EVENTS_PER_DRAIN
  t.after(() => {
    if (previous === undefined) delete process.env.MAX_EVENTS_PER_DRAIN
    else process.env.MAX_EVENTS_PER_DRAIN = previous
  })
}

function tick(timestamp: number, ask = 0.6): MarketTick {
  return {
    source: { kind: 'live', attempt: 1 },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: {
      market: 'market',
      timestamp,
      byAssetId: {
        up: {
          market: 'market',
          assetId: 'up',
          timestamp,
          bestBid: ask - 0.01,
          bestAsk: ask,
          mid: ask - 0.005,
          spread: 0.01,
          bids: [{ price: ask - 0.01, size: 1000 }],
          asks: [{ price: ask, size: 1000 }],
          depthLevels: 1,
          bidsDepthByLevel: [1000],
          asksDepthByLevel: [1000],
        },
      },
    },
  }
}

function makeRunner(args: {
  count: number
  mode: 'immediate' | 'queued'
  orderType: 'GTC' | 'FOK'
  batch?: boolean
  liveConfig?: boolean
}) {
  let placed = false
  const events: AccountEvent[] = []
  const dropped: unknown[] = []
  const runner = new StrategyRunner({
    strategy: {
      name: 'global-limits-fixture',
      onMarketTick: () => {
        if (placed) return []
        placed = true
        const orders = Array.from(
          { length: args.count },
          (_, i): PlaceLimitIntent => ({
            kind: 'place_limit',
            clientOrderId: `order-${i}`,
            assetId: 'up',
            side: 'BUY',
            price: args.orderType === 'FOK' ? 0.7 : 0.5,
            size: 5,
            orderType: args.orderType,
            ...(args.orderType === 'GTC' ? { postOnly: true } : {}),
          }),
        )
        return args.batch ? [{ kind: 'place_batch', orders }] : orders
      },
      onAccountEvent: (event) => {
        events.push(event)
        return []
      },
    },
    orderManager: new OrderManager({
      execution: new BacktestExecution({ latencyMs: 140, jitterMs: 0 }),
    }),
    intentExecutionMode: args.mode,
    // Live resolves the setting for its startup log; backtests use the runner default.
    ...(args.liveConfig ? { maxEventsPerDrain: resolveMaxEventsPerDrain() } : {}),
    log: (message, details) => {
      if (message.includes('maxEventsPerDrain exceeded')) dropped.push(details)
    },
  })
  return { runner, events, dropped }
}

test('event budget has one default, validates env values, and preserves explicit overrides', (t) => {
  preserveEnv(t)
  delete process.env.MAX_EVENTS_PER_DRAIN
  assert.equal(resolveMaxEventsPerDrain(), 4200)
  process.env.MAX_EVENTS_PER_DRAIN = ' '
  assert.equal(resolveMaxEventsPerDrain(), 4200)
  process.env.MAX_EVENTS_PER_DRAIN = ' 6000 '
  assert.equal(resolveMaxEventsPerDrain(), 6000)
  assert.equal(resolveMaxEventsPerDrain(250), 250)
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', 'invalid', '9007199254740992']) {
    process.env.MAX_EVENTS_PER_DRAIN = value
    assert.throws(() => resolveMaxEventsPerDrain(), /MAX_EVENTS_PER_DRAIN/)
  }
  for (const value of [0, -1, 1.5, Infinity, NaN])
    assert.throws(() => resolveMaxEventsPerDrain(value), /MAX_EVENTS_PER_DRAIN/)
})

test('live and backtest configuration drain the same 42-order fill burst in both execution modes', async (t) => {
  preserveEnv(t)
  t.mock.method(Date, 'now', () => 1_780_272_000_000)
  for (const budget of [undefined, '250', '6000']) {
    if (budget === undefined) delete process.env.MAX_EVENTS_PER_DRAIN
    else process.env.MAX_EVENTS_PER_DRAIN = budget
    for (const mode of ['immediate', 'queued'] as const) {
      const snapshots = []
      for (const liveConfig of [false, true]) {
        const h = makeRunner({ count: 42, mode, orderType: 'FOK', liveConfig })
        for (const ts of [1000, 1140, 1280]) await h.runner.onMarketTick(tick(ts))
        const snapshot = h.runner.getPortfolio().snapshot()
        assert.equal(snapshot.positionsByAssetId.up?.qty, 210)
        assert.deepEqual(snapshot.openOrdersByClientId, {})
        assert.deepEqual(h.dropped, [])
        snapshots.push(snapshot)
      }
      assert.deepEqual(snapshots[0], snapshots[1])
    }
  }
})

test('an explicit low env budget is honored identically by live and backtest configuration', async (t) => {
  preserveEnv(t)
  t.mock.method(Date, 'now', () => 1_780_272_000_000)
  process.env.MAX_EVENTS_PER_DRAIN = '100'
  const outputs = []
  for (const liveConfig of [false, true]) {
    const h = makeRunner({ count: 42, mode: 'immediate', orderType: 'FOK', liveConfig })
    for (const ts of [1000, 1140, 1280]) await h.runner.onMarketTick(tick(ts))
    assert.equal(h.dropped.length, 1)
    outputs.push({ snapshot: h.runner.getPortfolio().snapshot(), dropped: h.dropped })
  }
  assert.deepEqual(outputs[0], outputs[1])
})

test('global capacity accepts 100 orders, rejects order 101, and accounts for every fill', async (t) => {
  preserveEnv(t)
  delete process.env.MAX_EVENTS_PER_DRAIN
  assert.equal(DEFAULT_RISK_LIMITS.maxOpenOrders, 100)
  for (const mode of ['immediate', 'queued'] as const) {
    for (const batch of [false, true]) {
      const h = makeRunner({ count: 101, mode, orderType: 'GTC', batch })
      for (const ts of [1000, 1140, 1280]) await h.runner.onMarketTick(tick(ts))
      assert.equal(Object.keys(h.runner.getPortfolio().snapshot().openOrdersByClientId).length, 100)
      assert.deepEqual(
        h.events.filter((event) => event.kind === 'order_rejected').map((event) => event.reason),
        ['risk_max_open_orders(max=100)'],
      )
      await h.runner.onMarketTick(tick(1420, 0.4))
      const snapshot = h.runner.getPortfolio().snapshot()
      assert.equal(snapshot.positionsByAssetId.up?.qty, 500)
      assert.deepEqual(snapshot.openOrdersByClientId, {})
      assert.deepEqual(h.dropped, [])
    }
  }
})
