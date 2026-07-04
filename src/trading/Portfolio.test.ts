import test from 'node:test'
import assert from 'node:assert/strict'
import { Portfolio } from './Portfolio.js'
import type { OpenOrder } from '../strategy/Strategy.js'

function makeOrder(clientOrderId: string, tsMs: number): OpenOrder {
  return {
    clientOrderId,
    assetId: `asset-${clientOrderId}`,
    side: 'SELL',
    price: 0.42,
    size: 10,
    remaining: 10,
    filled: 0,
    orderType: 'GTC',
    state: 'requested',
    createdAtMs: tsMs,
    updatedAtMs: tsMs,
    meta: { source: 'portfolio-test' },
  }
}

test('Portfolio.snapshot caches frozen ordersByClientId records until order history changes', () => {
  const portfolio = new Portfolio()

  portfolio.apply({ kind: 'order_submitted', tsMs: 1_000, order: makeOrder('cid-1', 1_000) })
  portfolio.apply({ kind: 'order_accepted', tsMs: 1_001, clientOrderId: 'cid-1', orderId: 'oid-1' })
  portfolio.apply({
    kind: 'order_done',
    tsMs: 1_002,
    clientOrderId: 'cid-1',
    orderId: 'oid-1',
    reason: 'canceled',
  })

  const first = portfolio.snapshot()
  assert.equal(first.ordersByClientId['cid-1']?.orderId, 'oid-1')
  assert.equal(first.ordersByClientId['cid-1']?.lifecycleState, 'canceled')
  assert.deepEqual(first.ordersByClientId['cid-1']?.meta, { source: 'portfolio-test' })
  assert.equal(Object.isFrozen(first.ordersByClientId), true)

  const second = portfolio.snapshot()
  assert.equal(second.ordersByClientId, first.ordersByClientId)
  assert.notEqual(second.openOrdersByClientId, first.openOrdersByClientId)

  portfolio.apply({ kind: 'order_submitted', tsMs: 1_003, order: makeOrder('cid-2', 1_003) })

  const third = portfolio.snapshot()
  assert.notEqual(third.ordersByClientId, first.ordersByClientId)
  assert.equal(third.ordersByClientId['cid-2']?.lifecycleState, 'requested')
  assert.equal(first.ordersByClientId['cid-2'], undefined)

  const json = JSON.parse(JSON.stringify(third)) as {
    ordersByClientId?: Record<string, unknown>
  }
  assert.ok(json.ordersByClientId)
  assert.ok(json.ordersByClientId['cid-1'])
  assert.ok(json.ordersByClientId['cid-2'])
})
