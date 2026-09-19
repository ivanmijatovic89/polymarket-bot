import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createServer } from 'node:http'
import { ClobClient } from '@polymarket/clob-client'
import type { OrderBookSnapshot } from '../market/orderbook/index.js'
import type {
  AccountEvent,
  CancelMarketIntent,
  Intent,
  PlaceLimitIntent,
} from '../strategy/Strategy.js'
import { OrderManager, type OrderManagerContext, type ExecutionAdapter } from './OrderManager.js'
import { Portfolio } from './Portfolio.js'
import { BacktestExecution } from './execution/BacktestExecution.js'
import { LiveExecution } from './execution/LiveExecution.js'
import { enforceRiskLimits } from './riskLimits.js'

const marketA = `0x${'a'.repeat(64)}`
const marketB = `0x${'b'.repeat(64)}`
const up = '101'
const down = '102'
const other = '201'

function order(
  clientOrderId = 'buy-up',
  assetId = up,
  side: 'BUY' | 'SELL' = 'BUY',
): PlaceLimitIntent {
  return {
    kind: 'place_limit',
    clientOrderId,
    assetId,
    side,
    price: 0.5,
    size: 10,
    orderType: 'GTC',
  }
}

function context(nowMs = 1000, market = marketA, ask = 0.6): OrderManagerContext {
  const book: OrderBookSnapshot = {
    market,
    assetId: up,
    timestamp: nowMs,
    bestBid: 0.4,
    bestAsk: ask,
    mid: (0.4 + ask) / 2,
    spread: ask - 0.4,
    bids: [{ price: 0.4, size: 2 }],
    asks: [{ price: ask, size: 2 }],
    depthLevels: 1,
    bidsDepthByLevel: [2],
    asksDepthByLevel: [2],
  }
  return { nowMs, lastMarket: { market, timestamp: nowMs, byAssetId: { [up]: book } } }
}

function harness(execution: ExecutionAdapter, dryRun = false) {
  const portfolio = new Portfolio()
  const manager = new OrderManager({ execution, dryRun })
  function apply(events: AccountEvent[]) {
    for (const event of events) {
      portfolio.apply(event)
      manager.reconcileActiveOrders(portfolio.snapshot())
    }
    return events
  }
  async function send(
    intents: Intent[],
    ctx = context(),
    mode: 'immediate' | 'queued' = 'immediate',
  ) {
    return apply(
      await manager.handleIntents(intents, { ...ctx, portfolio: portfolio.snapshot() }, { mode }),
    )
  }
  async function tick(ctx = context()) {
    return apply(await manager.onMarketTick({ ...ctx, portfolio: portfolio.snapshot() }))
  }
  async function seed() {
    await send([order(), order('sell-up', up, 'SELL'), order('buy-down', down)])
    await send([order('other-market', other)], context(1001, marketB))
  }
  const remaining = () => Object.keys(portfolio.snapshot().openOrdersByClientId).sort()
  return { execution, manager, portfolio, apply, send, tick, seed, remaining }
}

function live(t: TestContext, host = 'https://clob.invalid') {
  t.mock.method(console, 'log', () => {})
  const batch = t.mock.method(ClobClient.prototype, 'cancelOrders', async (ids: string[]) => ({
    canceled: ids,
    not_canceled: {},
  }))
  const scope = t.mock.method(ClobClient.prototype, 'cancelMarketOrders', async () => ({
    canceled: ['ex-buy-up', 'ex-sell-up', 'ex-buy-down'],
    not_canceled: {},
  }))
  const single = t.mock.method(
    ClobClient.prototype,
    'cancelOrder',
    async ({ orderID }: { orderID: string }) => ({ canceled: [orderID], not_canceled: {} }),
  )
  const all = t.mock.method(ClobClient.prototype, 'cancelAll', async () => ({
    canceled: ['ex-buy-up', 'ex-sell-up', 'ex-buy-down', 'ex-other-market'],
    not_canceled: {},
  }))
  const execution = new LiveExecution({
    config: {
      privateKey: `0x${'1'.repeat(64)}`,
      creds: { apiKey: 'test-key', secret: 'test-secret', passphrase: 'test-passphrase' },
      clob: { host, chainId: 137, pollIntervalMs: 1000, signatureType: 0 },
      ws: { marketUrl: 'wss://market.invalid', userUrl: 'wss://user.invalid' },
      gamma: { baseUrl: 'https://gamma.invalid' },
    },
  })
  t.mock.method(
    execution,
    'placeLimit',
    async (intent: PlaceLimitIntent, ctx: OrderManagerContext) => ({
      events: [
        {
          kind: 'order_accepted',
          tsMs: ctx.nowMs,
          clientOrderId: intent.clientOrderId,
          orderId: `ex-${intent.clientOrderId}`,
        },
      ] as AccountEvent[],
    }),
  )
  return { ...harness(execution), batch, scope, single, all }
}

const doneIds = (events: AccountEvent[]) =>
  events
    .filter((e) => e.kind === 'order_done')
    .map((e) => e.clientOrderId)
    .sort()
const failures = (events: AccountEvent[]) => events.filter((e) => e.kind === 'cancel_failed')

for (const runtime of ['live', 'backtest', 'dry-run'] as const) {
  test(`${runtime}: selected batch resolves and deduplicates IDs, preserves unrelated orders`, async (t) => {
    const liveHarness = runtime === 'live' ? live(t) : undefined
    const h = liveHarness ?? harness(new BacktestExecution(), runtime === 'dry-run')
    await h.seed()
    const oid = h.portfolio.snapshot().openOrdersByClientId['buy-up']?.orderId
    const events = await h.send([
      {
        kind: 'cancel_batch',
        orders: [
          { clientOrderId: 'buy-up' },
          { clientOrderId: 'buy-up' },
          ...(oid ? [{ orderId: oid }] : []),
          { clientOrderId: 'buy-down' },
        ],
      },
    ])
    assert.deepEqual(doneIds(events), ['buy-down', 'buy-up'])
    assert.deepEqual(h.remaining(), ['other-market', 'sell-up'])
    assert.deepEqual(h.portfolio.snapshot().positionsByAssetId, {})
    // Failed/untargeted orders retain active-ID dedupe; canceled IDs can be used again.
    assert.deepEqual(await h.send([order('sell-up', up, 'SELL')]), [])
    assert.ok((await h.send([order()])).some((e) => e.kind === 'order_submitted'))
    if (liveHarness)
      assert.deepEqual(liveHarness.batch.mock.calls[0]?.arguments, [['ex-buy-up', 'ex-buy-down']])
  })

  for (const [filters, expected] of [
    [{ market: marketA }, ['buy-down', 'buy-up', 'sell-up']],
    [{ assetId: up }, ['buy-up', 'sell-up']],
    [{ market: marketA, assetId: up }, ['buy-up', 'sell-up']],
    [{ market: marketB, assetId: up }, []],
  ] as const) {
    test(`${runtime}: scoped cancellation ${JSON.stringify(filters)}`, async (t) => {
      const liveHarness = runtime === 'live' ? live(t) : undefined
      const h = liveHarness ?? harness(new BacktestExecution(), runtime === 'dry-run')
      await h.seed()
      if (liveHarness)
        liveHarness.scope.mock.mockImplementation(async () => ({
          canceled: expected.map((cid) => `ex-${cid}`),
          not_canceled: {},
        }))
      const events = await h.send([{ kind: 'cancel_market', ...filters }])
      assert.deepEqual(doneIds(events), [...expected].sort())
      assert.equal(h.remaining().length, 4 - expected.length)
      assert.ok(h.remaining().includes('other-market'))
      if (liveHarness)
        assert.deepEqual(liveHarness.scope.mock.calls[0]?.arguments, [
          {
            ...('market' in filters ? { market: filters.market } : {}),
            ...('assetId' in filters ? { asset_id: filters.assetId } : {}),
          },
        ])
    })
  }

  test(`${runtime}: empty batch and known completed orders do not produce duplicate terminal events`, async (t) => {
    const liveHarness = runtime === 'live' ? live(t) : undefined
    const h = liveHarness ?? harness(new BacktestExecution(), runtime === 'dry-run')
    await h.send([order()])
    assert.deepEqual(await h.send([{ kind: 'cancel_batch', orders: [] }]), [])
    const cancel: Intent = { kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }
    assert.deepEqual(doneIds(await h.send([cancel])), ['buy-up'])
    assert.deepEqual(await h.send([cancel]), [])
    if (liveHarness) assert.equal(liveHarness.batch.mock.callCount(), 1)
  })

  test(`${runtime}: single and explicit account-wide cancellation still work`, async (t) => {
    const liveHarness = runtime === 'live' ? live(t) : undefined
    const h = liveHarness ?? harness(new BacktestExecution(), runtime === 'dry-run')
    await h.seed()
    assert.deepEqual(doneIds(await h.send([{ kind: 'cancel_order', clientOrderId: 'buy-up' }])), [
      'buy-up',
    ])
    assert.deepEqual(doneIds(await h.send([{ kind: 'cancel_all' }])), [
      'buy-down',
      'other-market',
      'sell-up',
    ])
    assert.deepEqual(h.remaining(), [])
    assert.deepEqual(h.portfolio.snapshot().wsOpenOrdersByOrderId, {})
  })
}

for (const scope of [
  {},
  { market: '' },
  { assetId: ' ' },
  { market: 'slug' },
  { assetId: 'UP' },
  { market: marketA, assetId: '' },
  { market: null },
  { assetId: 101 },
]) {
  test(`invalid scope cannot reach any live endpoint: ${JSON.stringify(scope)}`, async (t) => {
    const h = live(t)
    await h.seed()
    const events = await h.send([{ kind: 'cancel_market', ...scope } as CancelMarketIntent])
    assert.equal(failures(events).length, 1)
    assert.equal(h.remaining().length, 4)
    assert.equal(h.scope.mock.callCount(), 0)
    assert.equal(h.all.mock.callCount(), 0)
    const direct = await h.execution.cancelMarket(
      { kind: 'cancel_market', ...scope } as CancelMarketIntent,
      context(),
    )
    assert.equal(failures(direct.events).length, 1)
    const backtest = await new BacktestExecution().cancelMarket(
      { kind: 'cancel_market', ...scope } as CancelMarketIntent,
      context(),
    )
    assert.equal(failures(backtest.events).length, 1)
  })
}

test('live partial success and missing results leave failed orders tracked and active', async (t) => {
  const h = live(t)
  await h.seed()
  h.batch.mock.mockImplementation(async () => ({
    canceled: ['ex-buy-up', 'ex-other-market'],
    not_canceled: { 'ex-sell-up': 'already matched' },
  }))
  const events = await h.send([
    {
      kind: 'cancel_batch',
      orders: ['buy-up', 'sell-up', 'buy-down'].map((clientOrderId) => ({ clientOrderId })),
    },
  ])
  assert.deepEqual(doneIds(events), ['buy-up'])
  assert.deepEqual(
    failures(events).map((e) => e.reason),
    ['already matched', 'cancel_not_confirmed'],
  )
  assert.deepEqual(h.remaining(), ['buy-down', 'other-market', 'sell-up'])
  assert.deepEqual(await h.send([order('sell-up', up, 'SELL')]), [])
})

for (const response of [
  undefined,
  { error: 'unauthorized' },
  { canceled: ['ex-buy-up'] },
  { canceled: ['ex-buy-up'], not_canceled: { 'ex-buy-up': 'conflict' } },
]) {
  test(`live malformed/error/conflicting response cannot falsely close orders: ${JSON.stringify(response)}`, async (t) => {
    const h = live(t)
    await h.send([order()])
    h.batch.mock.mockImplementation(async () => response)
    assert.equal(
      failures(await h.send([{ kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }]))
        .length,
      1,
    )
    assert.deepEqual(h.remaining(), ['buy-up'])
    assert.deepEqual(await h.send([order()]), [])
  })
}

test('live request exception and single/global partial failure preserve active IDs', async (t) => {
  const h = live(t)
  await h.seed()
  h.batch.mock.mockImplementation(async () => {
    throw new Error('connection reset')
  })
  assert.equal(
    failures(await h.send([{ kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }]))[0]
      ?.reason,
    'connection reset',
  )
  h.single.mock.mockImplementation(async () => ({
    canceled: [],
    not_canceled: { 'ex-buy-up': 'cannot cancel' },
  }))
  assert.equal(
    failures(await h.send([{ kind: 'cancel_order', clientOrderId: 'buy-up' }])).length,
    1,
  )
  h.all.mock.mockImplementation(async () => ({
    canceled: ['ex-buy-down'],
    not_canceled: { 'ex-buy-up': 'cannot cancel' },
  }))
  assert.deepEqual(doneIds(await h.send([{ kind: 'cancel_all' }])), ['buy-down'])
  assert.deepEqual(h.remaining(), ['buy-up', 'other-market', 'sell-up'])
  assert.deepEqual(await h.send([order()]), [])
})

test('references: unknown clients, conflicts, invalid entries, missing exchange IDs, and external exchange IDs', async (t) => {
  const h = live(t)
  await h.send([order()])
  const events = await h.send([
    {
      kind: 'cancel_batch',
      orders: [
        {},
        { orderId: ' ' },
        { clientOrderId: 'unknown' },
        { clientOrderId: 'buy-up', orderId: 'wrong' },
        { orderId: 'external-id' },
      ],
    },
  ])
  assert.deepEqual(
    failures(events).map((e) => e.reason),
    [
      'invalid_order_reference',
      'invalid_order_reference',
      'unknown_client_order',
      'conflicting_order_reference',
    ],
  )
  assert.deepEqual(h.batch.mock.calls[0]?.arguments, [['external-id']])
  assert.deepEqual(h.remaining(), ['buy-up'])
  const bt = harness(new BacktestExecution({ latencyMs: 100 }))
  await bt.send([order()])
  const pending = await bt.send([{ kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }])
  assert.equal(failures(pending)[0]?.reason, 'missing_exchange_order_id')
  assert.deepEqual(bt.remaining(), ['buy-up'])
  await bt.tick(context(1100))
  assert.equal(bt.portfolio.snapshot().openOrdersByClientId['buy-up']?.state, 'open')
})

test('same intent list can place and then cancel using the newly acknowledged exchange ID', async (t) => {
  const h = live(t)
  const events = await h.send([
    order(),
    { kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] },
  ])
  assert.deepEqual(doneIds(events), ['buy-up'])
  assert.deepEqual(h.batch.mock.calls[0]?.arguments, [['ex-buy-up']])
  assert.deepEqual(h.remaining(), [])
})

test('backtest scope is evaluated at execution time, including placements during cancellation latency', async () => {
  const h = harness(new BacktestExecution({ latencyMs: 100 }))
  await h.send([order()], context(1000))
  await h.send([{ kind: 'cancel_market', market: marketA }], context(1050))
  await h.tick(context(1100))
  assert.deepEqual(h.remaining(), ['buy-up'])
  await h.tick(context(1149))
  assert.deepEqual(h.remaining(), ['buy-up'])
  assert.deepEqual(doneIds(await h.tick(context(1150))), ['buy-up'])
  assert.deepEqual(h.remaining(), [])
})

test('partial taker fill during cancellation latency preserves position, fees and PnL; only remainder is canceled', async () => {
  const h = harness(new BacktestExecution({ latencyMs: 100 }))
  await h.send([order()], context(1000))
  await h.send([{ kind: 'cancel_market', assetId: up }], context(1050))
  // At placement, two shares fill at the limit; worst_queue leaves the remainder resting at equality.
  const fills = await h.tick(context(1100, marketA, 0.5))
  assert.equal(fills.filter((e) => e.kind === 'fill').length, 1)
  const before = h.portfolio.snapshot()
  assert.equal(before.openOrdersByClientId['buy-up']?.remaining, 8)
  assert.equal(before.positionsByAssetId[up]?.qty, 2)
  assert.ok(before.positionsByAssetId[up]!.costBasis > 1)
  assert.deepEqual(doneIds(await h.tick(context(1150, marketA, 0.5))), ['buy-up'])
  const after = h.portfolio.snapshot()
  assert.deepEqual(after.positionsByAssetId, before.positionsByAssetId)
  assert.deepEqual(after.recentFills, before.recentFills)
  assert.equal(after.realizedPnlTotal, before.realizedPnlTotal)
  assert.equal(after.ordersByClientId['buy-up']?.sizeMatched, 2)
  assert.deepEqual(h.remaining(), [])
})

test('backtest full fill before batch cancellation prevents duplicate terminal events and preserves active IDs until done', async () => {
  const h = harness(new BacktestExecution({ latencyMs: 100 }))
  await h.send([order()])
  await h.tick(context(1100))
  await h.send([{ kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }], context(1110))
  assert.deepEqual(await h.send([order()], context(1111)), [])
  const fills = await h.tick(context(1150, marketA, 0.4))
  assert.deepEqual(doneIds(fills), ['buy-up'])
  assert.deepEqual(await h.tick(context(1210)), [])
  assert.equal(h.portfolio.snapshot().positionsByAssetId[up]?.qty, 10)
})

test('backtest queued mode and cancelLatency=false use the existing tick boundary', async () => {
  const h = harness(new BacktestExecution({ latencyMs: 100, cancelLatency: false }))
  await h.send([order()])
  await h.tick(context(1100))
  assert.deepEqual(
    await h.send(
      [{ kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] }],
      context(1101),
      'queued',
    ),
    [],
  )
  assert.deepEqual(h.remaining(), ['buy-up'])
  assert.deepEqual(doneIds(await h.tick(context(1102))), ['buy-up'])
})

test('dry-run never calls cancellation adapters, including invalid requests', async (t) => {
  const execution = new BacktestExecution()
  const methods = (['cancelBatch', 'cancelMarket', 'cancelOrder', 'cancelAll'] as const).map(
    (method) =>
      t.mock.method(execution, method, async () => {
        throw new Error('adapter must not run')
      }),
  )
  const h = harness(execution, true)
  await h.seed()
  await h.send([
    { kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] },
    { kind: 'cancel_market', assetId: up },
    { kind: 'cancel_market' },
    { kind: 'cancel_all' },
  ])
  assert.deepEqual(h.remaining(), [])
  for (const method of methods) assert.equal(method.mock.callCount(), 0)
})

test('confirmed cancellation reconciles external WS orders and cannot be undone by late updates; late fills remain idempotent', async (t) => {
  const h = live(t)
  await h.send([order()])
  const ws = {
    orderId: 'ex-buy-up',
    market: marketA,
    assetId: up,
    originalSize: 10,
    sizeMatched: 0,
    status: 'LIVE',
    event: 'PLACEMENT' as const,
  }
  h.apply([
    { kind: 'ws_order_update', tsMs: 1001, order: ws },
    { kind: 'ws_order_update', tsMs: 1001, order: { ...ws, orderId: 'external' } },
  ])
  await h.send([
    { kind: 'cancel_batch', orders: [{ orderId: 'ex-buy-up' }, { orderId: 'external' }] },
  ])
  h.apply([
    { kind: 'ws_order_update', tsMs: 1002, order: ws },
    { kind: 'ws_order_update', tsMs: 1002, order: { ...ws, orderId: 'external' } },
  ])
  assert.deepEqual(h.remaining(), [])
  assert.deepEqual(h.portfolio.snapshot().wsOpenOrdersByOrderId, {})
  assert.equal(h.portfolio.snapshot().ordersByClientId['buy-up']?.remaining, 0)
  const fill: AccountEvent = {
    kind: 'fill',
    fill: {
      id: 'late-fill',
      tsMs: 1001,
      orderId: 'ex-buy-up',
      assetId: up,
      side: 'BUY',
      price: 0.5,
      size: 2,
      liquidity: 'TAKER',
      feeRateBps: 700,
    },
  }
  h.apply([
    fill,
    fill,
    {
      kind: 'ws_order_update',
      tsMs: 1003,
      order: { ...ws, sizeMatched: 2, event: 'CANCELLATION' },
    },
  ])
  assert.equal(h.portfolio.snapshot().positionsByAssetId[up]?.qty, 2)
  assert.equal(h.portfolio.snapshot().recentFills.length, 1)
  assert.equal(h.portfolio.snapshot().ordersByClientId['buy-up']?.sizeMatched, 2)
  assert.deepEqual(h.remaining(), [])
})

test('asynchronous WS cancellation releases dedupe without closing a later order with the same client ID', async (t) => {
  const h = live(t)
  await h.send([order()])
  h.apply([
    { kind: 'ws_order_update', tsMs: 1100, order: { orderId: 'ex-buy-up', event: 'CANCELLATION' } },
    { kind: 'order_done', tsMs: 1100, orderId: 'ex-buy-up', reason: 'canceled' },
  ])
  assert.deepEqual(h.remaining(), [])
  t.mock.method(h.execution, 'placeLimit', async (intent: PlaceLimitIntent) => ({
    events: [
      {
        kind: 'order_accepted',
        tsMs: 1101,
        clientOrderId: intent.clientOrderId,
        orderId: 'new-exchange-id',
      },
    ] as AccountEvent[],
  }))
  await h.send([order()], context(1101))
  h.apply([
    {
      kind: 'order_done',
      tsMs: 1102,
      clientOrderId: 'buy-up',
      orderId: 'ex-buy-up',
      reason: 'canceled',
    },
  ])
  assert.deepEqual(h.remaining(), ['buy-up'])
  assert.equal(h.portfolio.snapshot().openOrdersByClientId['buy-up']?.orderId, 'new-exchange-id')
})

test('cancel requests do not prematurely release risk capacity', async () => {
  const h = harness(new BacktestExecution())
  await h.send([order()])
  for (const cancel of [
    { kind: 'cancel_order', clientOrderId: 'buy-up' },
    { kind: 'cancel_all' },
    { kind: 'cancel_batch', orders: [{ clientOrderId: 'buy-up' }] },
    { kind: 'cancel_market', market: marketA },
  ] satisfies Intent[]) {
    const result = enforceRiskLimits({
      nowMs: 1001,
      portfolio: h.portfolio.snapshot(),
      intents: [cancel, order('replacement')],
      limits: { maxOpenOrders: 1, maxOrderSize: 100, maxAbsPosition: 100, maxLossStop: 500 },
    })
    assert.deepEqual(result.allowed, [cancel])
    assert.equal(result.rejectedEvents.length, 1)
  }
})

test(
  'installed SDK sends exact batch/scoped DELETE payloads to a local server',
  { timeout: 10_000 },
  async (t) => {
    const requests: Array<{ method?: string; path?: string; body: unknown }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        requests.push({
          ...(request.method ? { method: request.method } : {}),
          ...(request.url ? { path: request.url } : {}),
          body: JSON.parse(body),
        })
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ canceled: ['external'], not_canceled: {} }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const h = live(t, `http://127.0.0.1:${address.port}`)
    h.batch.mock.restore()
    h.scope.mock.restore()
    await h.send([{ kind: 'cancel_batch', orders: [{ orderId: 'external' }] }])
    for (const scope of [{ market: marketA }, { assetId: up }, { market: marketA, assetId: up }]) {
      await h.send([{ kind: 'cancel_market', ...scope }])
    }
    assert.deepEqual(requests, [
      { method: 'DELETE', path: '/orders', body: ['external'] },
      { method: 'DELETE', path: '/cancel-market-orders', body: { market: marketA } },
      { method: 'DELETE', path: '/cancel-market-orders', body: { asset_id: up } },
      { method: 'DELETE', path: '/cancel-market-orders', body: { market: marketA, asset_id: up } },
    ])
  },
)

test('backtest completed fills and FOK kills remain terminal when canceled again', async () => {
  const h = harness(new BacktestExecution())
  await h.send([{ ...order('killed'), orderType: 'FOK' }])
  assert.equal(h.portfolio.snapshot().ordersByClientId['killed']?.lifecycleState, 'killed')
  await h.send([order()])
  await h.tick(context(1100, marketA, 0.4))
  assert.equal(h.portfolio.snapshot().ordersByClientId['buy-up']?.lifecycleState, 'filled')
  assert.deepEqual(
    await h.send([
      {
        kind: 'cancel_batch',
        orders: [
          { clientOrderId: 'killed' },
          { clientOrderId: 'buy-up' },
          { orderId: 'nonexistent' },
        ],
      },
    ]),
    [],
  )
})

test('live scoped partial failure affects only matching confirmed orders, including external orders with incomplete metadata', async (t) => {
  const h = live(t)
  await h.seed()
  h.apply([
    {
      kind: 'ws_order_update',
      tsMs: 1002,
      order: { orderId: 'external', assetId: up, event: 'PLACEMENT' },
    },
  ])
  h.scope.mock.mockImplementation(async () => ({
    canceled: ['ex-buy-up', 'ex-other-market', 'external'],
    not_canceled: { 'ex-sell-up': 'retry' },
  }))
  const events = await h.send([{ kind: 'cancel_market', market: marketA, assetId: up }])
  assert.deepEqual(
    events.filter((e) => e.kind === 'order_done').map((e) => e.orderId),
    ['ex-buy-up', 'external'],
  )
  assert.deepEqual(
    failures(events).map((e) => e.reason),
    ['cancel_response_outside_scope', 'retry'],
  )
  assert.deepEqual(h.remaining(), ['buy-down', 'other-market', 'sell-up'])
  assert.deepEqual(h.portfolio.snapshot().wsOpenOrdersByOrderId, {})
})

test('oversized batches are rejected before submission', async (t) => {
  const h = live(t)
  const events = await h.send([
    {
      kind: 'cancel_batch',
      orders: Array.from({ length: 3001 }, (_, i) => ({ orderId: `id-${i}` })),
    },
  ])
  assert.equal(failures(events)[0]?.reason, 'invalid_cancel_batch_size')
  assert.equal(h.batch.mock.callCount(), 0)
})

test('partial fill before a selected batch cancel retains its accounting and closes only the remainder', async () => {
  const h = harness(new BacktestExecution({ latencyMs: 100 }))
  await h.send([order()])
  await h.tick(context(1100, marketA, 0.5))
  const before = h.portfolio.snapshot()
  await h.send([{ kind: 'cancel_batch', orders: [{ orderId: 'bt-buy-up' }] }], context(1101))
  assert.deepEqual(await h.tick(context(1200, marketA, 0.5)), [])
  assert.deepEqual(doneIds(await h.tick(context(1201, marketA, 0.5))), ['buy-up'])
  const after = h.portfolio.snapshot()
  assert.deepEqual(after.positionsByAssetId, before.positionsByAssetId)
  assert.deepEqual(after.recentFills, before.recentFills)
  assert.equal(after.realizedPnlTotal, before.realizedPnlTotal)
  assert.equal(after.ordersByClientId['buy-up']?.sizeMatched, 2)
})

test('explicit client/exchange pairs still support single cancellation without a portfolio snapshot', async (t) => {
  const h = live(t)
  const result = await h.execution.cancelOrder(
    { kind: 'cancel_order', clientOrderId: 'external-client', orderId: 'external-exchange' },
    context(),
  )
  assert.deepEqual(h.single.mock.calls[0]?.arguments, [{ orderID: 'external-exchange' }])
  assert.deepEqual(result.events, [
    {
      kind: 'order_done',
      tsMs: 1000,
      clientOrderId: 'external-client',
      orderId: 'external-exchange',
      reason: 'canceled',
    },
  ])
})

for (const batch of [false, true]) {
  test(`delayed placement keeps its original market across a switch (batch=${batch})`, async () => {
    const h = harness(new BacktestExecution({ latencyMs: 100 }))
    await h.send(
      [batch ? { kind: 'place_batch', orders: [order()] } : order()],
      context(1000, marketA),
    )
    await h.send([{ kind: 'cancel_market', market: marketA }], context(1001, marketA))
    await h.tick(context(1100, marketB))
    assert.deepEqual(h.remaining(), ['buy-up'])
    assert.deepEqual(doneIds(await h.tick(context(1101, marketB))), ['buy-up'])
    assert.deepEqual(h.remaining(), [])
  })
}
