import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { ClobClient } from '@polymarket/clob-client'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PlaceLimitIntent,
  PortfolioSnapshot,
  Strategy,
} from '../strategy/Strategy.js'
import type { OrderBookSnapshot } from '../market/orderbook/index.js'
import { Portfolio } from './Portfolio.js'
import { OrderManager, type ExecutionAdapter } from './OrderManager.js'
import { StrategyRunner } from './StrategyRunner.js'
import { BacktestExecution } from './execution/BacktestExecution.js'
import { LiveExecution } from './execution/LiveExecution.js'

const market = `0x${'a'.repeat(64)}`
const nextMarket = `0x${'b'.repeat(64)}`

function buy(id: string, size = 800, price = 0.6): PlaceLimitIntent {
  return {
    kind: 'place_limit',
    clientOrderId: id,
    assetId: 'up',
    side: 'BUY',
    size,
    price,
    orderType: 'GTC',
  }
}

function tick(ts = 1000, ask = 0.6, askSize = 2000, m = market, assetId = 'up'): MarketTick {
  const book: OrderBookSnapshot = {
    market: m,
    assetId,
    timestamp: ts,
    bestBid: 0.6,
    bestAsk: ask,
    mid: (0.6 + ask) / 2,
    spread: ask - 0.6,
    bids: [{ price: 0.6, size: 2000 }],
    asks: [{ price: ask, size: askSize }],
    depthLevels: 1,
    bidsDepthByLevel: [2000],
    asksDepthByLevel: [askSize],
  }
  return {
    source: { kind: 'parquet', filePath: '/synthetic.parquet', ingestSeq: 1n, tsLocalMs: ts },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: { market: m, timestamp: ts, byAssetId: { [assetId]: book } },
  }
}

function stack(
  execution: ExecutionAdapter = new BacktestExecution(),
  startingCapital = 500,
  callback?: (event: AccountEvent, p: PortfolioSnapshot) => Intent[],
) {
  let intents: Intent[] = []
  const events: AccountEvent[] = []
  const snapshots: PortfolioSnapshot[] = []
  const strategy: Strategy = {
    name: 'capital-test',
    onMarketTick: (_tick, p) => {
      snapshots.push(p)
      const out = intents
      intents = []
      return out
    },
    onAccountEvent: (ev, p) => {
      events.push(ev)
      snapshots.push(p)
      return callback?.(ev, p) ?? []
    },
  }
  const manager = new OrderManager({ execution, minGtdOffsetMs: 0 })
  const runner = new StrategyRunner({
    strategy,
    orderManager: manager,
    startingCapital,
    intentExecutionMode: 'immediate',
  })
  return {
    runner,
    manager,
    events,
    snapshots,
    cash: () => runner.getPortfolio().snapshot().capital!,
    send: async (next: Intent[], t = tick()) => {
      intents = next
      await runner.onMarketTick(t)
    },
  }
}

function submit(p: Portfolio, id = 'a', size = 800, price = 0.6) {
  const o = {
    ...buy(id, size, price),
    market,
    remaining: size,
    filled: 0,
    state: 'requested' as const,
    createdAtMs: 1000,
    updatedAtMs: 1000,
  }
  p.apply({ kind: 'order_submitted', tsMs: 1000, order: o })
  p.apply({ kind: 'order_accepted', tsMs: 1000, clientOrderId: id, orderId: `ex-${id}` })
}

function fill(
  id: string,
  size: number,
  extra: Partial<Extract<AccountEvent, { kind: 'fill' }>['fill']> = {},
): AccountEvent {
  return {
    kind: 'fill',
    fill: {
      id,
      tsMs: 1100,
      market,
      assetId: 'up',
      side: 'BUY',
      price: 0.6,
      size,
      orderId: 'ex-a',
      clientOrderId: 'a',
      liquidity: 'TAKER',
      feeRateBps: 700,
      ...extra,
    },
  }
}

function mockedLive(t: TestContext) {
  t.mock.method(console, 'log', () => {})
  const create = t.mock.method(ClobClient.prototype, 'createOrder', async () => ({}))
  const post = t.mock.method(ClobClient.prototype, 'postOrder', async () => ({
    success: true,
    orderID: 'ex-a',
  }))
  const execution = new LiveExecution({
    config: {
      privateKey: `0x${'1'.repeat(64)}`,
      creds: { apiKey: 'test', secret: 'test', passphrase: 'test' },
      clob: { host: 'https://clob.invalid', chainId: 137, pollIntervalMs: 1000, signatureType: 0 },
      ws: { marketUrl: 'wss://market.invalid', userUrl: 'wss://user.invalid' },
      gamma: { baseUrl: 'https://gamma.invalid' },
    },
  })
  return { execution, create, post }
}

test('500 USDC rejects 616.80 before either execution adapter; affordable BUY succeeds', async (t) => {
  for (const mode of ['backtest', 'live'] as const) {
    await t.test(mode, async (t) => {
      const live = mode === 'live' ? mockedLive(t) : null
      const execution = live?.execution ?? new BacktestExecution({ latencyMs: 140, jitterMs: 20 })
      const place = t.mock.method(execution, 'placeLimit')
      const s = stack(execution)
      await s.send([buy('too-large', 1000)])
      assert.equal(place.mock.callCount(), 0)
      assert.ok(
        s.events.some(
          (e) => e.kind === 'order_rejected' && e.reason.startsWith('insufficient_capital'),
        ),
      )
      await s.send([buy('a')], tick(1001))
      assert.equal(place.mock.callCount(), 1)
      assert.equal(s.cash().reservedCash, 493.44)
      if (mode === 'backtest') {
        await s.send([], tick(1100))
        assert.equal(s.cash().cash, 500)
        await s.send([], tick(1200))
      } else {
        assert.equal(live!.create.mock.callCount(), 1)
        await s.runner.onAccountEvent(fill('trade-a', 800))
      }
      assert.deepEqual(s.cash(), {
        startingCapital: 500,
        cash: 6.56,
        reservedCash: 0,
        availableCash: 6.56,
      })
    })
  }
})

test('batches and separate intents reserve each accepted BUY before dispatch', async () => {
  for (const batch of [false, true]) {
    const s = stack()
    const orders = [buy('a', 600), buy('b', 600)]
    await s.send(batch ? [{ kind: 'place_batch', orders }] : orders, tick(1000, 0.8))
    assert.deepEqual(Object.keys(s.runner.getPortfolio().snapshot().openOrdersByClientId), ['a'])
    assert.equal(s.cash().availableCash, 129.92)
    assert.ok(s.events.some((e) => e.kind === 'order_rejected' && e.clientOrderId === 'b'))
  }
})

test('account callbacks observe and enforce still-unapplied submissions without double counting', async () => {
  let available: number | undefined
  const s = stack(new BacktestExecution(), 500, (ev, p) => {
    if (ev.kind !== 'order_submitted' || ev.order.clientOrderId !== 'a') return []
    available = p.capital!.availableCash
    return [buy('callback', 15)]
  })
  await s.send([buy('a', 400), buy('b', 400)], tick(1000, 0.8))
  assert.equal(available, 6.56)
  assert.equal(s.cash().availableCash, 6.56)
  assert.ok(s.events.some((e) => e.kind === 'order_rejected' && e.clientOrderId === 'callback'))
})

test('partial fills spend part of reservation; delayed cancellation releases only confirmed unused shares', async () => {
  const s = stack(new BacktestExecution({ latencyMs: 140 }))
  await s.send([buy('a')])
  await s.send([], tick(1200, 0.6, 300))
  assert.deepEqual(s.cash(), {
    startingCapital: 500,
    cash: 314.96,
    reservedCash: 308.4,
    availableCash: 6.56,
  })
  await s.send([{ kind: 'cancel_order', clientOrderId: 'a' }], tick(1201, 0.8))
  assert.equal(s.cash().reservedCash, 308.4)
  await s.send([], tick(1400, 0.8))
  assert.equal(s.cash().availableCash, 314.96)
  assert.equal(s.cash().reservedCash, 0)
})

test('REST cancellation acknowledgement and failed cancellation cannot release unknown fills', () => {
  const p = new Portfolio()
  submit(p)
  p.apply({
    kind: 'cancel_failed',
    tsMs: 1100,
    operation: 'cancel_order',
    clientOrderId: 'a',
    reason: 'offline',
  })
  p.apply({ kind: 'order_done', tsMs: 1101, orderId: 'ex-a', reason: 'canceled' })
  assert.equal(p.snapshot().capital!.reservedCash, 493.44)
  p.apply({
    kind: 'ws_order_update',
    tsMs: 1102,
    order: { orderId: 'ex-a', event: 'CANCELLATION', sizeMatched: 300 },
  })
  assert.equal(p.snapshot().capital!.reservedCash, 185.04)
  p.apply(fill('late', 300))
  p.apply(fill('late', 300))
  assert.deepEqual(p.snapshot().capital, {
    startingCapital: 500,
    cash: 314.96,
    reservedCash: 0,
    availableCash: 314.96,
  })
})

test('filled status before fills and duplicate/late events preserve committed cash', () => {
  const p = new Portfolio()
  submit(p)
  p.apply({ kind: 'order_done', tsMs: 1100, orderId: 'ex-a', reason: 'filled' })
  assert.equal(p.snapshot().capital!.availableCash, 6.56)
  p.apply(fill('one', 300))
  assert.equal(p.snapshot().capital!.availableCash, 6.56)
  p.apply(fill('two', 500))
  p.apply(fill('one', 300))
  p.apply({ kind: 'order_done', tsMs: 1200, orderId: 'ex-a', reason: 'filled' })
  assert.equal(p.snapshot().capital!.cash, 6.56)
  assert.equal(p.snapshot().capital!.reservedCash, 0)
})

test('fill before acknowledgement and client ID reuse keep separate obligations', () => {
  const p = new Portfolio()
  submit(p)
  p.apply({ kind: 'order_done', tsMs: 1100, orderId: 'ex-a', reason: 'canceled', filledSize: 300 })
  p.apply({
    kind: 'order_submitted',
    tsMs: 1200,
    order: {
      ...buy('a', 100),
      remaining: 100,
      filled: 0,
      state: 'requested',
      createdAtMs: 1200,
      updatedAtMs: 1200,
    },
  })
  p.apply(fill('old', 300))
  p.apply(fill('new', 100, { orderId: 'ex-new' }))
  p.apply({ kind: 'order_accepted', tsMs: 1300, clientOrderId: 'a', orderId: 'ex-new' })
  p.apply({ kind: 'order_open', tsMs: 1301, clientOrderId: 'a', orderId: 'ex-a' })
  assert.equal(p.snapshot().capital!.cash, 253.28)
  assert.equal(p.snapshot().capital!.reservedCash, 0)
})

test('rejection, FOK kill, and expiry release unused capital', async () => {
  const s = stack()
  await s.send([{ ...buy('fok'), orderType: 'FOK' }], tick(1000, 0.8))
  assert.equal(s.cash().availableCash, 500)
  await s.send([{ ...buy('expire'), orderType: 'GTD', expireAtMs: 1100 }], tick(1001, 0.8))
  await s.send([], tick(1100, 0.8))
  assert.equal(s.cash().availableCash, 500)
  await s.send([{ ...buy('post'), postOnly: true }], tick(1200))
  assert.equal(s.cash().availableCash, 500)
})

test('late acknowledgement cannot merge a closed replacement with an older unaccounted fill', () => {
  const p = new Portfolio({ startingCapital: 1000 })
  submit(p, 'a', 500)
  p.apply({ kind: 'order_done', tsMs: 1100, orderId: 'ex-a', reason: 'filled' })
  p.apply({
    kind: 'order_submitted',
    tsMs: 1200,
    order: {
      ...buy('a', 100),
      remaining: 100,
      filled: 0,
      state: 'requested',
      createdAtMs: 1200,
      updatedAtMs: 1200,
    },
  })
  p.apply({ kind: 'order_accepted', tsMs: 1200, clientOrderId: 'a', orderId: 'ex-new' })
  p.apply(fill('replacement', 100, { orderId: 'ex-new' }))
  p.apply({ kind: 'order_done', tsMs: 1201, orderId: 'ex-new', reason: 'filled' })
  const expected = p.snapshot().capital
  assert.equal(expected!.reservedCash, 308.4)
  p.apply({ kind: 'order_accepted', tsMs: 1300, clientOrderId: 'a', orderId: 'ex-a' })
  p.apply({ kind: 'order_open', tsMs: 1301, clientOrderId: 'a', orderId: 'ex-a' })
  assert.deepEqual(p.snapshot().capital, expected)
  p.apply(fill('original', 500))
  assert.equal(p.snapshot().capital!.reservedCash, 0)
  assert.equal(p.snapshot().capital!.cash, 629.92)
})

test('confirmed sale proceeds can be reused; turnover may exceed initial capital', async () => {
  const s = stack()
  await s.send([buy('a')])
  await s.send([{ ...buy('sell'), side: 'SELL' }], tick(1100))
  assert.equal(s.cash().cash, 473.12)
  await s.send([buy('again', 700)], tick(1200))
  assert.equal(s.cash().cash, 41.36)
  assert.equal(s.events.filter((e) => e.kind === 'fill').length, 3)
})

test('post-only BUY reserves no taker fee; unexecuted SELL does not create cash', async () => {
  const s = stack()
  await s.send([{ ...buy('maker', 1000, 0.5), postOnly: true }], tick(1000, 0.8))
  assert.equal(s.cash().reservedCash, 500)
  await s.send([{ ...buy('sell', 100, 0.9), side: 'SELL' }], tick(1100, 0.8))
  assert.equal(s.cash().cash, 500)
  assert.equal(s.cash().availableCash, 0)
})

test('splits consume funding before dispatch and merges return actual collateral once', async () => {
  const s = stack()
  const split: Intent = { kind: 'split_positions', assetIdA: 'up', assetIdB: 'down', size: 300 }
  await s.send([split, split, buy('blocked', 400)])
  assert.equal(s.events.filter((e) => e.kind === 'positions_split').length, 1)
  assert.equal(s.events.filter((e) => e.kind === 'split_failed').length, 1)
  assert.equal(s.cash().cash, 200)
  const splitEvent = s.events.find((e) => e.kind === 'positions_split')!
  await s.runner.onAccountEvent(splitEvent)
  assert.equal(s.cash().cash, 200)
  await s.send(
    [{ kind: 'merge_positions', assetIdA: 'up', assetIdB: 'down', size: 300 }],
    tick(1100),
  )
  const merged = s.events.find((e) => e.kind === 'positions_merged')!
  await s.runner.onAccountEvent(merged)
  assert.equal(s.cash().cash, 500)
  await s.send([buy('reuse')], tick(1200))
  assert.equal(s.cash().cash, 6.56)
})

test('failed split does not debit cash and same-timestamp successful operations have distinct IDs', async (t) => {
  const execution = new BacktestExecution()
  const fail = t.mock.method(execution, 'splitPositions', async () => ({
    events: [
      {
        kind: 'split_failed' as const,
        tsMs: 1000,
        assetIdA: 'up',
        assetIdB: 'down',
        requestedSize: 100,
        reason: 'failed',
      },
    ],
  }))
  const s = stack(execution)
  const split: Intent = { kind: 'split_positions', assetIdA: 'up', assetIdB: 'down', size: 100 }
  await s.send([split])
  assert.equal(s.cash().availableCash, 500)
  fail.mock.restore()
  await s.send([split, split])
  assert.equal(s.cash().cash, 300)
  assert.equal(s.runner.getPortfolio().snapshot().positionsByAssetId.up!.qty, 200)
})

test('pending split cash is visible to earlier account callbacks and merges cannot reuse pending pairs', async () => {
  let observed: number | undefined
  const s = stack(new BacktestExecution(), 500, (ev, p) => {
    if (ev.kind !== 'order_submitted') return []
    observed = p.capital!.availableCash
    return [buy('callback', 400)]
  })
  await s.send(
    [buy('resting', 100), { kind: 'split_positions', assetIdA: 'up', assetIdB: 'down', size: 300 }],
    tick(1000, 0.8),
  )
  assert.equal(observed, 138.32)
  assert.equal(s.cash().availableCash, 138.32)
  const merge: Intent = { kind: 'merge_positions', assetIdA: 'up', assetIdB: 'down', size: 300 }
  await s.send([merge, merge], tick(1100, 0.8))
  assert.equal(s.events.filter((e) => e.kind === 'positions_merged').length, 1)
  assert.equal(s.cash().cash, 500)
})

test('queued mode applies the same capital gate when dispatching, without changing tick timing', async () => {
  const strategy: Strategy = {
    name: 'queued-capital',
    onMarketTick: () => [buy('overspend', 1000)],
    onAccountEvent: () => [],
  }
  const execution = new BacktestExecution()
  const manager = new OrderManager({ execution })
  const runner = new StrategyRunner({
    strategy,
    orderManager: manager,
    intentExecutionMode: 'queued',
  })
  await runner.onMarketTick(tick())
  assert.deepEqual(runner.getPortfolio().snapshot().openOrdersByClientId, {})
  await runner.onMarketTick(tick(1200))
  assert.equal(runner.getPortfolio().snapshot().capital!.cash, 500)
  assert.equal(runner.getPortfolio().snapshot().recentFills.length, 0)
})

test('rotation discards undispatched decisions from the previous market', async () => {
  const createStrategy = () => {
    let submitted = false
    const strategy: Strategy = {
      name: 'queued-rotation',
      onMarketTick: (tick) => {
        if (submitted) return []
        submitted = true
        return [
          {
            ...buy(`buy-${tick.snapshot.market}`, 100),
            assetId: Object.keys(tick.snapshot.byAssetId)[0]!,
          },
        ]
      },
      onAccountEvent: () => [],
    }
    return { strategy }
  }
  const runner = new StrategyRunner({
    ...createStrategy(),
    createStrategy,
    orderManager: new OrderManager({ execution: new BacktestExecution() }),
    intentExecutionMode: 'queued',
  })
  await runner.onMarketTick(tick())
  await runner.onMarketTick(tick(2000, 0.6, 2000, nextMarket, 'new-up'))
  assert.equal(runner.getPortfolio().snapshot().capital!.cash, 500)
  await runner.onMarketTick(tick(3000, 0.6, 2000, nextMarket, 'new-up'))
  assert.deepEqual(Object.keys(runner.getPortfolio().snapshot().positionsByAssetId), ['new-up'])
  assert.equal(runner.getPortfolio().snapshot().capital!.cash, 438.32)
})

test('old-market events arriving before the first book cannot fund the new allowance', async () => {
  const s = stack()
  await s.runner.onAccountEvent(
    fill('startup-old-sale', 100, { market: nextMarket, side: 'SELL', assetId: 'old-up' }),
  )
  await s.send([])
  assert.equal(s.cash().cash, 500)
  assert.deepEqual(s.runner.getPortfolio().snapshot().positionsByAssetId, {})
  assert.equal(
    s.events.some((e) => e.kind === 'fill'),
    false,
  )
})

test('new market recreates strategy and allowance, ignoring old-market sale/split/merge callbacks', async () => {
  let created = 0
  let oldCallbacks = 0
  const createStrategy = () => {
    created++
    let traded = false
    const strategy: Strategy = {
      name: 'reset-test',
      onMarketTick: (tick, p) => {
        assert.equal(p.capital!.cash, 500)
        assert.deepEqual(p.positionsByAssetId, {})
        if (traded) return []
        traded = true
        return [
          {
            ...buy(`buy-${tick.snapshot.market}`, 100),
            assetId: Object.keys(tick.snapshot.byAssetId)[0]!,
          },
        ]
      },
      onAccountEvent: (ev) => {
        if (ev.kind === 'fill' && ev.fill.id === 'old-sale') oldCallbacks++
        return []
      },
    }
    return { strategy }
  }
  const runner = new StrategyRunner({
    ...createStrategy(),
    createStrategy,
    orderManager: new OrderManager({ execution: new BacktestExecution() }),
    intentExecutionMode: 'immediate',
  })
  await runner.onMarketTick(tick())
  await runner.onMarketTick(tick(2000, 0.6, 2000, nextMarket, 'new-up'))
  assert.equal(created, 2)
  assert.equal(runner.getPortfolio().snapshot().capital!.cash, 438.32)
  await runner.onAccountEvent(
    fill('old-sale', 100, { side: 'SELL', orderId: 'old-ex', clientOrderId: 'old-sale' }),
  )
  await runner.onAccountEvent({
    kind: 'positions_merged',
    id: 'old-merge',
    market,
    tsMs: 2100,
    assetIdA: 'up',
    assetIdB: 'down',
    size: 100,
  })
  assert.equal(runner.getPortfolio().snapshot().capital!.cash, 438.32)
  assert.equal(oldCallbacks, 0)
})
