import assert from 'node:assert/strict'
import test from 'node:test'
import type { OrderBookSnapshot } from '../../market/orderbook/index.js'
import type { AccountEvent, Intent, PlaceLimitIntent } from '../../strategy/Strategy.js'
import { OrderManager, type OrderManagerContext } from '../OrderManager.js'
import { Portfolio } from '../Portfolio.js'
import { BacktestExecution } from './BacktestExecution.js'

const startMs = 1_000
const expireAtMs = startMs + 60_000
const paths = ['single', 'batch'] as const
type Path = (typeof paths)[number]

function order(overrides: Partial<PlaceLimitIntent> = {}): PlaceLimitIntent {
  return {
    kind: 'place_limit',
    clientOrderId: 'order-1',
    assetId: 'up',
    side: 'BUY',
    price: 0.5,
    size: 10,
    orderType: 'GTC',
    postOnly: true,
    ...overrides,
  }
}

function context(
  nowMs = startMs,
  bid: number | null = 0.4,
  ask: number | null = 0.6,
): OrderManagerContext {
  const book: OrderBookSnapshot = {
    market: 'market-1',
    assetId: 'up',
    timestamp: nowMs,
    bestBid: bid,
    bestAsk: ask,
    mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
    spread: bid !== null && ask !== null ? ask - bid : null,
    // Less than the order size: crossing post-only orders must not partially fill.
    bids: bid === null ? [] : [{ price: bid, size: 2 }],
    asks: ask === null ? [] : [{ price: ask, size: 2 }],
    depthLevels: 1,
    bidsDepthByLevel: bid === null ? [] : [2],
    asksDepthByLevel: ask === null ? [] : [2],
  }
  return { nowMs, lastMarket: { market: 'market-1', timestamp: nowMs, byAssetId: { up: book } } }
}

function harness(opts?: ConstructorParameters<typeof BacktestExecution>[0]) {
  const execution = new BacktestExecution(opts)
  const manager = new OrderManager({ execution })
  const portfolio = new Portfolio()
  function apply(events: AccountEvent[]): AccountEvent[] {
    for (const event of events) portfolio.apply(event)
    return events
  }
  async function submit(
    orders: PlaceLimitIntent[],
    path: Path,
    ctx = context(),
    mode: 'immediate' | 'queued' = 'immediate',
  ) {
    const intents: Intent[] = path === 'single' ? orders : [{ kind: 'place_batch', orders }]
    return apply(
      await manager.handleIntents(intents, { ...ctx, portfolio: portfolio.snapshot() }, { mode }),
    )
  }
  async function tick(ctx = context()) {
    return apply(await manager.onMarketTick({ ...ctx, portfolio: portfolio.snapshot() }))
  }
  return { execution, manager, portfolio, apply, submit, tick }
}

function kinds(events: AccountEvent[]): string[] {
  return events.map((event) => event.kind)
}

function assertRejected(events: AccountEvent[], clientOrderId = 'order-1', tsMs = startMs) {
  assert.deepEqual(events, [
    { kind: 'order_rejected', clientOrderId, tsMs, reason: 'post_only_would_cross' },
  ])
}

for (const path of paths) {
  for (const side of ['BUY', 'SELL'] as const) {
    for (const orderType of ['GTC', 'GTD'] as const) {
      const validOrder = order({ side, orderType, ...(orderType === 'GTD' ? { expireAtMs } : {}) })

      test(`${path}: non-crossing post-only ${side} ${orderType} rests and retains its flag`, async () => {
        const h = harness()
        assert.deepEqual(kinds(await h.submit([validOrder], path)), [
          'order_submitted',
          'order_accepted',
          'ws_order_update',
          'order_open',
        ])
        const snap = h.portfolio.snapshot()
        assert.equal(snap.openOrdersByClientId['order-1']?.postOnly, true)
        assert.equal(snap.ordersByClientId['order-1']?.postOnly, true)
        assert.equal(snap.openOrdersByClientId['order-1']?.remaining, 10)
        assert.equal(snap.recentFills.length, 0)
      })

      for (const equality of [false, true]) {
        test(`${path}: crossing post-only ${side} ${orderType} rejects entirely (equality=${equality})`, async () => {
          const h = harness()
          h.portfolio.apply({
            kind: 'fill',
            fill: {
              id: 'seed',
              tsMs: startMs - 1,
              assetId: 'up',
              side: 'BUY',
              price: 0.3,
              size: 20,
              liquidity: 'MAKER',
            },
          })
          const before = h.portfolio.snapshot()
          const price = side === 'BUY' ? (equality ? 0.6 : 0.7) : equality ? 0.4 : 0.3
          const events = await h.submit([{ ...validOrder, price }], path)
          assert.equal(events[0]?.kind, 'order_submitted')
          assertRejected(events.slice(1))
          const after = h.portfolio.snapshot()
          assert.deepEqual(after.positionsByAssetId, before.positionsByAssetId)
          assert.deepEqual(after.recentFills, before.recentFills)
          assert.equal(after.realizedPnlTotal, before.realizedPnlTotal)
          assert.deepEqual(after.openOrdersByClientId, {})
          assert.deepEqual(after.wsOpenOrdersByOrderId, {})
          assert.equal(after.ordersByClientId['order-1']?.lifecycleState, 'rejected')
          assert.equal(after.ordersByClientId['order-1']?.postOnly, true)
          assert.equal(after.ordersByClientId['order-1']?.tradeStatusRank, 0)
          assert.deepEqual(await h.tick(context(startMs + 1, 0.8, 0.2)), [])
          // Reusing a rejected client ID must reach execution again.
          assert.ok(kinds(await h.submit([validOrder], path)).includes('order_accepted'))
        })
      }
    }

    for (const becomesCrossing of [true, false]) {
      test(`${path}: ${side} checks the dispatch book after latency (becomesCrossing=${becomesCrossing})`, async () => {
        const h = harness({ latencyMs: 100 })
        const safe = context(startMs, 0.4, 0.6)
        const crossing = context(startMs, 0.5, 0.5)
        const initial = becomesCrossing ? safe : crossing
        const final = becomesCrossing ? crossing : safe
        assert.deepEqual(kinds(await h.submit([order({ side })], path, initial)), [
          'order_submitted',
        ])
        assert.deepEqual(await h.tick({ ...final, nowMs: startMs + 99 }), [])
        const events = await h.tick({ ...final, nowMs: startMs + 100 })
        if (becomesCrossing) {
          assertRejected(events, 'order-1', startMs + 100)
          assert.deepEqual(h.portfolio.snapshot().openOrdersByClientId, {})
          assert.deepEqual(await h.tick({ ...crossing, nowMs: startMs + 101 }), [])
          assert.deepEqual(
            kinds(await h.submit([order({ side })], path, { ...safe, nowMs: startMs + 101 })),
            ['order_submitted'],
          )
          assert.ok(
            kinds(await h.tick({ ...safe, nowMs: startMs + 201 })).includes('order_accepted'),
          )
        } else {
          assert.deepEqual(kinds(events), ['order_accepted', 'ws_order_update', 'order_open'])
        }
        assert.equal(h.portfolio.snapshot().recentFills.length, 0)
      })
    }

    test(`${path}: ${side} accepts an empty opposing side or a missing book`, async () => {
      for (const ctx of [context(startMs, null, null), { nowMs: startMs }]) {
        const h = harness()
        assert.ok(kinds(await h.submit([order({ side })], path, ctx)).includes('order_open'))
        assert.equal(h.portfolio.snapshot().recentFills.length, 0)
      }
    })

    for (const makerFillMode of ['worst_queue', 'touch_or_better'] as const) {
      test(`${path}: resting ${side} uses ${makerFillMode} maker fills without rechecking post-only`, async () => {
        const h = harness({ makerFillMode })
        await h.submit([order({ side })], path)
        const touchEvents = await h.tick(context(startMs + 1, 0.5, 0.5))
        const events =
          makerFillMode === 'touch_or_better'
            ? touchEvents
            : await h.tick(context(startMs + 2, 0.6, 0.4))
        if (makerFillMode === 'worst_queue') assert.deepEqual(touchEvents, [])
        assert.deepEqual(kinds(events), ['fill', 'order_done'])
        const fill = events[0]
        assert.ok(fill?.kind === 'fill')
        assert.equal(fill.fill.liquidity, 'MAKER')
        assert.equal(fill.fill.price, 0.5)
        assert.equal(fill.fill.size, 10)
        assert.equal(fill.fill.feeRateBps, undefined)
        assert.deepEqual(h.portfolio.snapshot().openOrdersByClientId, {})
        assert.equal(h.portfolio.snapshot().ordersByClientId['order-1']?.postOnly, true)
      })
    }

    test(`${path}: ${side} cancellation and GTD expiration retain existing semantics`, async () => {
      const h = harness()
      await h.submit([order({ side })], path)
      const canceled = h.apply(
        await h.manager.handleIntents(
          [{ kind: 'cancel_order', clientOrderId: 'order-1' }],
          context(startMs + 1),
          { mode: 'immediate' },
        ),
      )
      assert.deepEqual(canceled, [
        {
          kind: 'order_done',
          clientOrderId: 'order-1',
          orderId: 'bt-order-1',
          tsMs: startMs + 1,
          reason: 'canceled',
        },
      ])
      assert.equal(h.portfolio.snapshot().ordersByClientId['order-1']?.postOnly, true)
      assert.deepEqual(await h.tick(context(startMs + 2, 0.8, 0.2)), [])
      await h.submit([order({ side, orderType: 'GTD', expireAtMs })], path)
      assert.deepEqual(await h.tick(context(expireAtMs - 1)), [])
      // Expiry wins over a potential maker fill on the expiry tick.
      assert.deepEqual(await h.tick(context(expireAtMs, 0.8, 0.2)), [
        {
          kind: 'order_done',
          clientOrderId: 'order-1',
          orderId: 'bt-order-1',
          tsMs: expireAtMs,
          reason: 'expired',
        },
      ])
      assert.equal(h.portfolio.snapshot().ordersByClientId['order-1']?.postOnly, true)
      assert.equal(h.portfolio.snapshot().recentFills.length, 0)
      assert.ok(
        kinds(await h.submit([order({ side })], path, context(expireAtMs + 1))).includes(
          'order_accepted',
        ),
      )
    })

    for (const orderType of ['GTC', 'GTD', 'FOK'] as const) {
      test(`${path}: omitted/false flags preserve ordinary ${side} ${orderType} behavior`, async () => {
        const results: AccountEvent[][] = []
        for (const postOnly of [undefined, false]) {
          const h = harness()
          const ordinary = order({
            side,
            orderType,
            price: side === 'BUY' ? 0.7 : 0.3,
            ...(orderType === 'GTD' ? { expireAtMs } : {}),
          })
          delete ordinary.postOnly
          if (postOnly !== undefined) ordinary.postOnly = postOnly
          const events = await h.submit([ordinary], path)
          results.push(events.filter((event) => event.kind !== 'order_submitted'))
          assert.equal(h.portfolio.snapshot().ordersByClientId['order-1']?.postOnly, postOnly)
          assert.equal(
            events.some((event) => event.kind === 'order_rejected'),
            false,
          )
          if (orderType === 'FOK') {
            assert.ok(
              events.some((event) => event.kind === 'order_done' && event.reason === 'killed'),
            )
          } else {
            const fill = events.find((event) => event.kind === 'fill')
            assert.equal(fill?.fill.liquidity, 'TAKER')
            assert.equal(fill?.fill.size, 2)
            assert.equal(h.portfolio.snapshot().openOrdersByClientId['order-1']?.remaining, 8)
          }
        }
        assert.deepEqual(results[0], results[1])
      })
    }
  }

  test(`${path}: shared validation rejects post-only FOK before adapter submission`, async (t) => {
    const h = harness()
    const method = path === 'single' ? 'placeLimit' : 'placeBatch'
    const submit = t.mock.method(h.execution, method)
    const invalid = order({ orderType: 'FOK' })
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await h.submit([invalid], path), [
        {
          kind: 'order_rejected',
          tsMs: startMs,
          clientOrderId: 'order-1',
          reason: 'post_only_requires_gtc_or_gtd',
        },
      ])
    }
    assert.equal(submit.mock.callCount(), 0)
    assert.ok(kinds(await h.submit([order()], path)).includes('order_accepted'))
    assert.equal(submit.mock.callCount(), 1)
  })

  test(`${path}: manager's tick queue also checks the execution book`, async () => {
    const h = harness()
    assert.deepEqual(await h.submit([order()], path, context(), 'queued'), [])
    const events = await h.tick(context(startMs + 1, 0.5, 0.5))
    assert.equal(events[0]?.kind, 'order_submitted')
    assertRejected(events.slice(1), 'order-1', startMs + 1)
  })
}

test('mixed batch independently accepts, rejects, and fills orders, and releases only rejected IDs', async () => {
  const h = harness()
  const orders = [
    order({ clientOrderId: 'safe-buy' }),
    order({ clientOrderId: 'crossing-buy', price: 0.6 }),
    order({ clientOrderId: 'safe-sell', side: 'SELL', orderType: 'GTD', expireAtMs }),
    order({ clientOrderId: 'crossing-sell', side: 'SELL', price: 0.4 }),
    order({ clientOrderId: 'ordinary', price: 0.7, postOnly: false }),
    order({ clientOrderId: 'invalid', orderType: 'FOK' }),
  ]
  const events = await h.submit(orders, 'batch')
  assert.deepEqual(
    events.filter((event) => event.kind === 'order_rejected').map((event) => event.clientOrderId),
    ['invalid', 'crossing-buy', 'crossing-sell'],
  )
  assert.deepEqual(
    events.filter((event) => event.kind === 'order_accepted').map((event) => event.clientOrderId),
    ['safe-buy', 'safe-sell', 'ordinary'],
  )
  const snap = h.portfolio.snapshot()
  assert.deepEqual(Object.keys(snap.openOrdersByClientId), ['safe-buy', 'safe-sell', 'ordinary'])
  assert.equal(snap.recentFills.length, 1)
  assert.equal(snap.recentFills[0]?.clientOrderId, 'ordinary')
  assert.equal(snap.recentFills[0]?.liquidity, 'TAKER')
  // Accepted IDs remain active; rejected IDs can be resubmitted safely.
  assert.deepEqual(await h.submit([order({ clientOrderId: 'safe-buy' })], 'single'), [])
  const retry = await h.submit(
    ['crossing-buy', 'crossing-sell', 'invalid'].map((clientOrderId) => order({ clientOrderId })),
    'batch',
  )
  assert.equal(retry.filter((event) => event.kind === 'order_accepted').length, 3)
})
