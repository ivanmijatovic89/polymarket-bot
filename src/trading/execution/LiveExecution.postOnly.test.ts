import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  ClobClient,
  OrderSide,
  OrderType,
  Side,
  SignatureType,
  type PostOrdersArgs,
  type SignedOrder,
} from '@polymarket/clob-client'
import type { PlaceLimitIntent } from '../../strategy/Strategy.js'
import { OrderManager } from '../OrderManager.js'
import { LiveExecution } from './LiveExecution.js'

const signed: SignedOrder = {
  salt: '1',
  maker: 'test-maker',
  signer: 'test-signer',
  taker: 'test-taker',
  tokenId: 'up',
  makerAmount: '5000000',
  takerAmount: '10000000',
  expiration: '0',
  nonce: '0',
  feeRateBps: '0',
  side: OrderSide.BUY,
  signatureType: SignatureType.EOA,
  signature: 'test-signature',
}

function setup(t: TestContext) {
  t.mock.method(console, 'log', () => {})
  const create = t.mock.method(ClobClient.prototype, 'createOrder', async () => signed)
  const single = t.mock.method(ClobClient.prototype, 'postOrder', async () => ({
    success: true,
    orderID: 'exchange-1',
  }))
  const batch = t.mock.method(
    ClobClient.prototype,
    'postOrders',
    async (orders: PostOrdersArgs[]) =>
      orders.map((_, index) => ({ success: true, orderID: `exchange-${index}` })),
  )
  // Explicit test config avoids using any real account credentials. All signing/submission is stubbed.
  const execution = new LiveExecution({
    config: {
      privateKey: `0x${'1'.repeat(64)}`,
      creds: { apiKey: 'test-key', secret: 'test-secret', passphrase: 'test-passphrase' },
      clob: { host: 'https://clob.invalid', chainId: 137, pollIntervalMs: 1000, signatureType: 0 },
      ws: { marketUrl: 'wss://market.invalid', userUrl: 'wss://user.invalid' },
      gamma: { baseUrl: 'https://gamma.invalid' },
    },
  })
  return { execution, create, single, batch, manager: new OrderManager({ execution }) }
}

function order(overrides: Partial<PlaceLimitIntent> = {}): PlaceLimitIntent {
  return {
    kind: 'place_limit',
    clientOrderId: 'order-1',
    assetId: 'up',
    side: 'BUY',
    price: 0.5,
    size: 10,
    orderType: 'GTC',
    ...overrides,
  }
}

for (const orderType of ['GTC', 'GTD'] as const) {
  for (const postOnly of [undefined, false, true]) {
    for (const side of ['BUY', 'SELL'] as const) {
      test(`live single: ${side} ${orderType} postOnly=${postOnly} preserves SDK argument positions`, async (t) => {
        const h = setup(t)
        const intent = order({
          side,
          orderType,
          ...(postOnly !== undefined ? { postOnly } : {}),
          ...(orderType === 'GTD' ? { expireAtMs: 120_999 } : {}),
        })
        const events = await h.manager.handleIntents(
          [intent],
          { nowMs: 1000 },
          { mode: 'immediate' },
        )
        assert.deepEqual(h.create.mock.calls[0]?.arguments, [
          {
            tokenID: 'up',
            price: 0.5,
            size: 10,
            side: side === 'BUY' ? Side.BUY : Side.SELL,
            ...(orderType === 'GTD' ? { expiration: 120 } : {}),
          },
        ])
        assert.deepEqual(h.single.mock.calls[0]?.arguments, [
          signed,
          OrderType[orderType],
          false,
          postOnly ?? false,
        ])
        assert.deepEqual(
          events.map((event) => event.kind),
          ['order_submitted', 'order_accepted'],
        )
        const submitted = events[0]
        assert.ok(submitted?.kind === 'order_submitted')
        assert.equal(submitted.order.postOnly, postOnly)
      })
    }
  }
}

test('live batch: forwards per-order flags and isolates exchange and shared validation rejections', async (t) => {
  const h = setup(t)
  h.batch.mock.mockImplementation(async () => [
    { success: true, orderID: 'exchange-0' },
    { success: false, errorMsg: 'post only order crosses book' },
    { success: true, orderID: 'exchange-2' },
    { success: true, orderID: 'exchange-3' },
  ])
  const intents = [
    order({ clientOrderId: 'safe', postOnly: true }),
    order({
      clientOrderId: 'crossing',
      postOnly: true,
      side: 'SELL',
      orderType: 'GTD',
      expireAtMs: 120_999,
    }),
    order({ clientOrderId: 'false', postOnly: false, orderType: 'FOK' }),
    order({ clientOrderId: 'omitted' }),
    order({ clientOrderId: 'invalid', postOnly: true, orderType: 'FOK' }),
  ]
  const events = await h.manager.handleIntents(
    [{ kind: 'place_batch', orders: intents }],
    { nowMs: 1000 },
    { mode: 'immediate' },
  )
  // Only the orders argument is passed; deferExec retains the SDK's default.
  assert.deepEqual(h.batch.mock.calls[0]?.arguments, [
    [
      { order: signed, orderType: OrderType.GTC, postOnly: true },
      { order: signed, orderType: OrderType.GTD, postOnly: true },
      { order: signed, orderType: OrderType.FOK, postOnly: false },
      { order: signed, orderType: OrderType.GTC },
    ],
  ])
  assert.equal(h.create.mock.callCount(), 4)
  assert.deepEqual(h.create.mock.calls[1]?.arguments, [
    { tokenID: 'up', price: 0.5, size: 10, side: Side.SELL, expiration: 120 },
  ])
  assert.deepEqual(
    events.filter((event) => event.kind === 'order_rejected'),
    [
      {
        kind: 'order_rejected',
        tsMs: 1000,
        clientOrderId: 'invalid',
        reason: 'post_only_requires_gtc_or_gtd',
      },
      {
        kind: 'order_rejected',
        tsMs: 1000,
        clientOrderId: 'crossing',
        reason: 'post only order crosses book',
      },
    ],
  )
  assert.deepEqual(
    events.filter((event) => event.kind === 'order_accepted').map((event) => event.clientOrderId),
    ['safe', 'false', 'omitted'],
  )
  for (const clientOrderId of ['crossing', 'invalid']) {
    const retry = await h.manager.handleIntents(
      [order({ clientOrderId, postOnly: true })],
      { nowMs: 1001 },
      { mode: 'immediate' },
    )
    assert.ok(retry.some((event) => event.kind === 'order_accepted'))
  }
  assert.deepEqual(
    await h.manager.handleIntents(
      [order({ clientOrderId: 'safe' })],
      { nowMs: 1001 },
      { mode: 'immediate' },
    ),
    [],
  )
})

for (const response of [
  { error: 'post only order crosses book' },
  { success: false, errorMsg: 'post only order crosses book' },
]) {
  test(`live single: existing rejection handling releases the client ID (${JSON.stringify(response)})`, async (t) => {
    const h = setup(t)
    h.single.mock.mockImplementation(async () => response)
    for (let attempt = 0; attempt < 2; attempt++) {
      const events = await h.manager.handleIntents(
        [order({ postOnly: true })],
        { nowMs: 1000 },
        { mode: 'immediate' },
      )
      assert.deepEqual(
        events.map((event) => event.kind),
        ['order_submitted', 'order_rejected'],
      )
      assert.deepEqual(events[1], {
        kind: 'order_rejected',
        tsMs: 1000,
        clientOrderId: 'order-1',
        reason: 'post only order crosses book',
      })
    }
    assert.equal(h.single.mock.callCount(), 2)
  })
}

test('live single: shared validation blocks post-only FOK before signing or submission', async (t) => {
  const h = setup(t)
  const events = await h.manager.handleIntents(
    [order({ postOnly: true, orderType: 'FOK' })],
    { nowMs: 1000 },
    { mode: 'immediate' },
  )
  assert.deepEqual(events, [
    {
      kind: 'order_rejected',
      tsMs: 1000,
      clientOrderId: 'order-1',
      reason: 'post_only_requires_gtc_or_gtd',
    },
  ])
  assert.equal(h.create.mock.callCount(), 0)
  assert.equal(h.single.mock.callCount(), 0)
})
