import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { ClobClient, Side, type MakerOrder, type Trade } from '@polymarket/clob-client'
import { createRestPollAccountSource } from '../polymarket/restPollAccountSource.js'
import type { Fill } from '../strategy/Strategy.js'
import { Portfolio } from './Portfolio.js'

const market = `0x${'a'.repeat(64)}`
const owner = 'our-api-key'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-a',
    taker_order_id: 'ex-a',
    market,
    asset_id: 'up',
    side: Side.BUY,
    size: '800',
    fee_rate_bps: '700',
    price: '0.6',
    status: 'CONFIRMED',
    match_time: '1',
    last_update: '1',
    outcome: 'Up',
    bucket_index: 0,
    owner,
    maker_address: '0xmaker',
    maker_orders: [],
    transaction_hash: '0xtx',
    trader_side: 'TAKER',
    ...overrides,
  }
}

async function pollFills(t: TestContext, trades: Trade[]): Promise<Fill[]> {
  t.mock.method(console, 'log', () => {})
  t.mock.method(ClobClient.prototype, 'getTrades', async () => trades)
  const source = createRestPollAccountSource({
    config: {
      privateKey: `0x${'1'.repeat(64)}`,
      creds: { apiKey: 'unused-config-key', secret: 'test', passphrase: 'test' },
      clob: { host: 'https://clob.invalid', chainId: 137, pollIntervalMs: 1000, signatureType: 0 },
      ws: { marketUrl: 'wss://market.invalid', userUrl: 'wss://user.invalid' },
      gamma: { baseUrl: 'https://gamma.invalid' },
    },
    overrides: { creds: { apiKey: owner, secret: 'test', passphrase: 'test' } },
  })
  const fills: Fill[] = []
  source.onAccountEvent((ev) => {
    if (ev.kind === 'fill') fills.push(ev.fill)
  })
  t.after(() => source.stop())
  source.start()
  await new Promise<void>((resolve) => setImmediate(resolve))
  source.stop()
  return fills
}

function reserve(p: Portfolio, id: string, size: number, postOnly = false) {
  p.apply({
    kind: 'order_submitted',
    tsMs: 1000,
    order: {
      clientOrderId: id,
      orderId: `ex-${id}`,
      market,
      assetId: 'up',
      side: 'BUY',
      price: 0.6,
      orderType: 'GTC',
      size,
      filled: 0,
      remaining: size,
      postOnly,
      state: 'requested',
      createdAtMs: 1000,
      updatedAtMs: 1000,
    },
  })
}

test('REST taker fees and WebSocket duplicates produce the same cash in either arrival order', async (t) => {
  const fills = await pollFills(t, [trade(), trade()])
  assert.equal(fills.length, 1)
  const wsFill: Fill = {
    id: 'trade-a',
    tsMs: 1000,
    market,
    assetId: 'up',
    side: 'BUY',
    price: 0.6,
    size: 800,
    orderId: 'ex-a',
    liquidity: 'TAKER',
    feeRateBps: 700,
  }
  assert.deepEqual(fills[0], wsFill)
  for (const ordered of [
    [fills[0]!, wsFill],
    [wsFill, fills[0]!],
  ]) {
    const p = new Portfolio()
    reserve(p, 'a', 800)
    for (const fill of ordered) p.apply({ kind: 'fill', fill })
    assert.deepEqual(p.snapshot().capital, {
      startingCapital: 500,
      cash: 6.56,
      reservedCash: 0,
      availableCash: 6.56,
    })
    assert.equal(p.snapshot().positionsByAssetId.up!.qty, 800)
  }
})

test('REST honors explicit zero fees and deducts taker fees from sale proceeds', async (t) => {
  const fills = await pollFills(t, [
    trade({ id: 'free-buy', fee_rate_bps: '0' }),
    trade({ id: 'sale', side: Side.SELL }),
  ])
  assert.equal(fills.length, 2)
  assert.equal(fills[0]!.feeRateBps, 0)
  const p = new Portfolio()
  p.apply({ kind: 'fill', fill: fills[0]! })
  assert.equal(p.snapshot().capital!.cash, 20)
  p.apply({ kind: 'fill', fill: fills[1]! })
  assert.equal(p.snapshot().capital!.cash, 486.56)
})

test('REST maker fills use our order fields and WebSocket IDs without charging taker fees', async (t) => {
  const maker = (orderId: string, size: string, makerOwner = owner): MakerOrder => ({
    order_id: orderId,
    owner: makerOwner,
    maker_address: '0xmaker',
    matched_amount: size,
    price: '0.6',
    fee_rate_bps: '700',
    asset_id: 'up',
    outcome: 'Up',
    side: Side.BUY,
  })
  const fills = await pollFills(t, [
    trade({
      trader_side: 'MAKER',
      owner: 'taker-owner',
      side: Side.SELL,
      size: '1000',
      maker_orders: [
        maker('ex-a', '300'),
        maker('ex-b', '500'),
        maker('other', '200', 'other-owner'),
      ],
    }),
  ])
  const wsFills: Fill[] = ['a', 'b'].map((id, index) => ({
    id: `trade-a:ex-${id}`,
    tsMs: 1000,
    market,
    assetId: 'up',
    side: 'BUY',
    price: 0.6,
    size: index === 0 ? 300 : 500,
    feeRateBps: 700,
    orderId: `ex-${id}`,
    liquidity: 'MAKER',
  }))
  assert.deepEqual(fills, wsFills)
  for (const ordered of [
    [...fills, ...wsFills],
    [...wsFills, ...fills],
  ]) {
    const p = new Portfolio()
    reserve(p, 'a', 300, true)
    reserve(p, 'b', 500, true)
    for (const fill of ordered) p.apply({ kind: 'fill', fill })
    assert.deepEqual(p.snapshot().capital, {
      startingCapital: 500,
      cash: 20,
      reservedCash: 0,
      availableCash: 20,
    })
    assert.equal(p.snapshot().positionsByAssetId.up!.qty, 800)
  }
})
