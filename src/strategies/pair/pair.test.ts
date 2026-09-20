import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigSchema, generateLadder, repairFraction, repairTarget } from './config.js'
import type { Config } from './config.js'
import { createPairStrategy } from './engine.js'
import { variants } from './variants.js'
import type { AccountEvent, MarketTick, PlaceLimitIntent } from '../../strategy/Strategy.js'
import type { GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import { Portfolio } from '../../trading/Portfolio.js'
import { OrderManager } from '../../trading/OrderManager.js'
import { StrategyRunner } from '../../trading/StrategyRunner.js'
import { BacktestExecution } from '../../trading/execution/BacktestExecution.js'

const market: GammaMarketMeta = {
  slug: 'btc-updown-15m-1780272000',
  outcomes: ['Up', 'Down'],
  clobTokenIds: ['up', 'down'],
  outcomeTokenMap: { up: 'up', down: 'down' },
  upAssetId: 'up',
  downAssetId: 'down',
}
const config = (overrides: Partial<Config> = {}) =>
  ConfigSchema.parse({
    sizeMultiplier: 1,
    minOrderSize: 1,
    minOrderNotional: 0,
    logMode: 'off',
    ...overrides,
  })

function tick(up: number, down = 1 - up, time = 10000, depth = 1000, spread = 0): MarketTick {
  const book = (assetId: string, mid: number): OrderBookSnapshot => ({
    market: 'm1',
    assetId,
    timestamp: time,
    bestBid: mid - spread / 2,
    bestAsk: mid + spread / 2,
    mid,
    spread,
    bids: [{ price: mid - spread / 2, size: depth }],
    asks: [{ price: mid + spread / 2, size: depth }],
    depthLevels: 1,
    bidsDepthByLevel: [depth],
    asksDepthByLevel: [depth],
  })
  return {
    source: { kind: 'live', attempt: 1 },
    msg: {
      event_type: 'book',
      market: 'm1',
      asset_id: 'up',
      bids: [],
      asks: [],
      timestamp: String(time),
      hash: '',
    },
    snapshot: {
      market: 'm1',
      timestamp: time,
      byAssetId: { up: book('up', up), down: book('down', down) },
    },
  }
}

function direct(variant = variants[6]!, overrides: Partial<Config> = {}) {
  const strategy = createPairStrategy(config(overrides), variant)
  const portfolio = new Portfolio()
  const events: AccountEvent[] = []
  let seq = 0
  const deliver = async (event: AccountEvent) => {
    portfolio.apply(event)
    events.push(event)
    await strategy.onAccountEvent(event, portfolio.snapshot(), undefined, { market })
  }
  const quote = async (t: MarketTick) =>
    (await strategy.onMarketTick(t, portfolio.snapshot(), { market })) as PlaceLimitIntent[]
  const fill = async (
    o: PlaceLimitIntent,
    size = o.size,
    price = o.price,
    id = `fill-${seq++}`,
  ) => {
    const event: AccountEvent = {
      kind: 'fill',
      fill: {
        id,
        tsMs: 10000 + seq,
        assetId: o.assetId,
        side: 'BUY',
        price,
        size,
        clientOrderId: o.clientOrderId,
        liquidity: 'MAKER',
      },
    }
    await deliver(event)
    return event
  }
  return { strategy, portfolio, quote, deliver, fill, events }
}

test('illustrative ladder reproduces the .72 inventory and complete ladder', () => {
  const levels = generateLadder(config())
  assert.equal(levels.length, 21)
  const partial = levels.slice(0, 13)
  assert.equal(
    partial.reduce((n, l) => n + l.directional, 0),
    234,
  )
  assert.equal(
    partial.reduce((n, l) => n + l.opposite, 0),
    130,
  )
  assert.ok(Math.abs(partial.reduce((n, l) => n + l.directional * l.price, 0) - 152.62) < 1e-8)
  assert.ok(Math.abs(partial.reduce((n, l) => n + l.opposite * (1 - l.price), 0) - 42.38) < 1e-8)
  assert.equal(
    levels.reduce((n, l) => n + l.directional, 0),
    294,
  )
  assert.equal(
    levels.reduce((n, l) => n + l.opposite, 0),
    294,
  )
})

test('strict parameters reject invalid ranges, allocations, and unknown keys', () => {
  for (const value of [
    { rangeStart: 0.8, rangeEnd: 0.6 },
    { priceStep: 0.03 },
    { sizeLow: 30 },
    { typo: 1 },
    { sizeMultiplier: 0.1 },
  ])
    assert.equal(ConfigSchema.safeParse(value).success, false)
})

test('repair curves are monotonic, bounded, and distinct', () => {
  for (const v of variants) {
    let previous = 0
    for (let i = 0; i <= 100; i++) {
      const fraction = repairFraction(i / 1000, v)
      assert.ok(fraction >= previous - 1e-8 && fraction <= 1)
      previous = fraction
    }
  }
  assert.ok(repairFraction(0.06, variants[4]!) < repairFraction(0.06, variants[2]!))
  assert.ok(repairFraction(0.06, variants[5]!) > repairFraction(0.06, variants[2]!))
})

for (const mirror of [false, true]) {
  test(`stepped repair reproduces 25/35/44 and repeated touches do not buy again (mirror=${mirror})`, async () => {
    const h = direct()
    let now = 10000
    const move = async (price: number) =>
      h.quote(tick(mirror ? 1 - price : price, mirror ? price : 1 - price, (now += 1000)))
    for (let cents = 60; cents <= 72; cents++)
      for (const order of await move(cents / 100)) await h.fill(order)
    const overweight = mirror ? 'down' : 'up'
    const missing = mirror ? 'up' : 'down'
    assert.equal(h.portfolio.snapshot().positionsByAssetId[overweight]?.qty, 234)
    assert.equal(h.portfolio.snapshot().positionsByAssetId[missing]?.qty, 130)
    for (const [price, expected] of [
      [0.68, 25],
      [0.7, 0],
      [0.68, 0],
      [0.66, 35],
      [0.7, 0],
      [0.66, 0],
      [0.64, 44],
    ] as const) {
      const orders = await move(price)
      assert.equal(orders.length, expected ? 1 : 0)
      if (expected) {
        assert.equal(orders[0]!.assetId, missing)
        assert.equal(orders[0]!.size, expected)
        await h.fill(orders[0]!)
      }
    }
    const p = h.portfolio.snapshot()
    assert.equal(p.positionsByAssetId.up?.qty, 234)
    assert.equal(p.positionsByAssetId.down?.qty, 234)
    assert.ok(
      Math.abs(
        (p.positionsByAssetId.up?.costBasis ?? 0) +
          (p.positionsByAssetId.down?.costBasis ?? 0) -
          230.74,
      ) < 1e-6,
    )
    assert.equal((await move(0.64)).length, 0)
  })
}

test('new highs retain repair credit while new normal fills change the baseline', () => {
  const normal = { UP: 245, DOWN: 147 }
  const repairs = { UP: 0, DOWN: 25 }
  assert.deepEqual(repairTarget(normal, repairs, 'UP', 1), {
    baseline: 98,
    desired: 98,
    actual: 25,
    additional: 73,
  })
  assert.equal(repairTarget(normal, repairs, 'UP', 0).additional, 0)
  assert.equal(repairTarget({ UP: 294, DOWN: 294 }, repairs, 'DOWN', 1).additional, 25)
})

test('repair is retained through a new high and never changes later normal targets', async () => {
  const h = direct()
  let time = 10000
  const move = async (price: number) => h.quote(tick(price, 1 - price, (time += 1000)))
  for (let cents = 60; cents <= 72; cents++) {
    for (const order of await move(cents / 100)) await h.fill(order)
  }
  const repair = await move(0.68)
  await h.fill(repair[0]!)
  for (let cents = 73; cents <= 80; cents++) {
    for (const order of await move(cents / 100)) {
      assert.equal(order.reason, 'pair_normal_taker')
      await h.fill(order)
    }
  }
  assert.equal(h.portfolio.snapshot().positionsByAssetId.up?.qty, 294)
  assert.equal(h.portfolio.snapshot().positionsByAssetId.down?.qty, 319)
})

test('reported matched shares remain reserved after cancellation until their fills arrive', async () => {
  const h = direct(variants[0]!)
  const initial = await h.quote(tick(0.6))
  const up = initial.find((o) => o.assetId === 'up')!
  await h.deliver({
    kind: 'order_accepted',
    clientOrderId: up.clientOrderId,
    orderId: 'ex-up',
    tsMs: 10000,
  })
  await h.deliver({
    kind: 'ws_order_update',
    tsMs: 10001,
    order: {
      orderId: 'ex-up',
      assetId: 'up',
      side: 'BUY',
      originalSize: 24,
      sizeMatched: 10,
      status: 'CANCELED',
      event: 'CANCELLATION',
    },
  })
  await h.deliver({
    kind: 'order_done',
    tsMs: 10001,
    clientOrderId: up.clientOrderId,
    reason: 'canceled',
  })
  await h.fill(initial.find((o) => o.assetId === 'down')!)
  assert.equal((await h.quote(tick(0.6, 0.4, 12000))).length, 0)
  await h.fill(up, 10)
  const retry = await h.quote(tick(0.6, 0.4, 13000))
  assert.equal(retry.length, 1)
  assert.equal(retry[0]!.size, 14)
})

test('market rotation isolates old pending orders and late fills', async () => {
  const h = direct(variants[0]!)
  const old = await h.quote(tick(0.6))
  const next = tick(0.6, 0.4, 12000)
  next.snapshot.market = 'm2'
  const fresh = await h.quote(next)
  assert.equal(fresh.length, 2)
  assert.ok(fresh.every((order) => order.clientOrderId.includes(':m2:')))
  for (const order of old) await h.fill(order)
  assert.equal((await h.quote(next)).length, 0, 'new market reservations survive old fills')
})

test('partial fills, duplicate fills, delayed completion and rejected orders preserve allocations', async () => {
  const h = direct(variants[0]!)
  const orders = await h.quote(tick(0.6))
  const up = orders.find((o) => o.assetId === 'up')!
  const down = orders.find((o) => o.assetId === 'down')!
  const first = await h.fill(up, 10)
  await h.deliver(first)
  await h.deliver({
    kind: 'order_done',
    clientOrderId: up.clientOrderId,
    tsMs: 11000,
    reason: 'filled',
  })
  await h.deliver({
    kind: 'order_rejected',
    clientOrderId: down.clientOrderId,
    tsMs: 11000,
    reason: 'test',
  })
  assert.equal((await h.quote(tick(0.6, 0.4, 12000))).length, 0, 'wait for delayed matched fills')
  await h.fill(up, 14)
  const retry = await h.quote(tick(0.6, 0.4, 13000))
  assert.equal(retry.length, 1)
  assert.equal(retry[0]!.assetId, 'down')
  assert.equal(retry[0]!.size, 4)
  await h.fill(retry[0]!)
  assert.equal((await h.quote(tick(0.6, 0.4, 14000))).length, 0)
  assert.equal(h.portfolio.snapshot().positionsByAssetId.up?.qty, 24)
})

test('fills received before exchange acknowledgement are correlated once', async () => {
  const h = direct(variants[0]!)
  const orders = await h.quote(tick(0.6))
  const up = orders.find((o) => o.assetId === 'up')!
  const event: AccountEvent = {
    kind: 'fill',
    fill: {
      id: 'early',
      tsMs: 10000,
      orderId: 'exchange-up',
      assetId: 'up',
      side: 'BUY',
      price: 0.6,
      size: 24,
    },
  }
  await h.deliver(event)
  await h.deliver({
    kind: 'order_accepted',
    clientOrderId: up.clientOrderId,
    orderId: 'exchange-up',
    tsMs: 10001,
  })
  await h.deliver(event)
  await h.fill(orders.find((o) => o.assetId === 'down')!)
  assert.equal((await h.quote(tick(0.6, 0.4, 12000))).length, 0)
})

test('actual opposite ask and depth are used; missed levels are not backfilled', async () => {
  const h = direct(variants[0]!)
  const orders = await h.quote(tick(0.72, 0.31, 10000, 8))
  assert.equal(orders.length, 2)
  assert.equal(orders.find((o) => o.assetId === 'down')!.price, 0.31)
  assert.ok(orders.every((o) => o.size === 8))
  const info = orders[0]!.meta?.pair as { level: number }
  assert.equal(info.level, 0.72)
})

test('capital includes pending orders and fees; low capital cannot oversubscribe', async () => {
  const h = direct(variants[0]!, { maxCapital: 10 })
  const orders = await h.quote(tick(0.6))
  assert.ok(orders.reduce((sum, o) => sum + o.size * (o.price + 0.0175), 0) <= 10)
  assert.equal((await h.quote(tick(0.61, 0.39, 12000))).length, 0)
})

test('maker cancellation keeps reservations until confirmed and tolerates a racing partial fill', async () => {
  const h = direct(variants[8]!)
  const orders = await h.quote(tick(0.6, 0.4, 10000, 1000, 0.02))
  for (const o of orders) {
    assert.equal(o.postOnly, true)
    assert.equal(o.orderType, 'GTC')
    await h.deliver({
      kind: 'order_accepted',
      clientOrderId: o.clientOrderId,
      orderId: `ex-${o.assetId}`,
      tsMs: 10000,
    })
  }
  const cancels = await h.strategy.onMarketTick(
    tick(0.62, 0.38, 11000, 1000, 0.02),
    h.portfolio.snapshot(),
    { market },
  )
  assert.ok(cancels.every((o) => o.kind === 'cancel_order'))
  assert.equal(cancels.length, 2)
  assert.equal((await h.quote(tick(0.62, 0.38, 11100, 1000, 0.02))).length, 0)
  await h.fill(orders[0]!, 10)
  for (const o of orders)
    await h.deliver({
      kind: 'order_done',
      clientOrderId: o.clientOrderId,
      tsMs: 11200,
      reason: 'canceled',
    })
  const revisit = await h.quote(tick(0.6, 0.4, 13000, 1000, 0.02))
  assert.equal(revisit.find((o) => o.assetId === 'up')!.size, 14)
})

test('stale books and synthetic ticks do not create orders', async () => {
  const h = direct()
  const stale = tick(0.6)
  stale.snapshot.byAssetId.down!.timestamp = 1
  assert.deepEqual(await h.quote(stale), [])
  const synthetic = tick(0.6)
  synthetic.msg = {
    event_type: 'binance_agg_trade',
    market: 'm1',
    timestamp: '10000',
    symbol: 'btcusdt',
  }
  assert.deepEqual(await h.quote(synthetic), [])
})

test('all ten variants replay identically with live and parquet source labels through shared execution', async () => {
  for (const variant of variants) {
    const results = []
    for (const source of ['live', 'parquet'] as const) {
      const strategy = createPairStrategy(config(), variant)
      const portfolio = new Portfolio()
      const manager = new OrderManager({
        execution: new BacktestExecution({ latencyMs: 100, jitterMs: 0 }),
      })
      const runner = new StrategyRunner({
        strategy,
        portfolio,
        orderManager: manager,
        getMarket: () => market,
      })
      let time = 10000
      let seq = 0n
      for (const price of [
        ...Array.from({ length: 13 }, (_, i) => 0.6 + i * 0.01),
        0.68,
        0.7,
        0.68,
        0.66,
        0.64,
        0.73,
        0.8,
        0.4,
      ]) {
        for (let repeat = 0; repeat < 5; repeat++) {
          const t = tick(price, 1 - price, (time += 600), 1000, 0.02)
          if (source === 'parquet')
            t.source = { kind: 'parquet', filePath: 'fixture.parquet', ingestSeq: seq++ }
          await runner.onMarketTick(t)
        }
      }
      const p = portfolio.snapshot()
      results.push({ positions: p.positionsByAssetId, fills: p.recentFills })
    }
    assert.deepEqual(results[0], results[1], variant.id)
  }
})
