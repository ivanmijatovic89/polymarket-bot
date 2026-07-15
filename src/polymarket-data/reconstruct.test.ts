import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReconstructedRows, takerKey, takerKeysOf } from './reconstruct.js'
import type { ApiActivity } from './activityApi.js'
import type { ApiTrade } from './dataApi.js'

const CID = '0xmarket'

function activity(over: Partial<ApiActivity> = {}): ApiActivity {
  return {
    proxyWallet: '0xWALLET',
    type: 'TRADE',
    timestamp: 1_000_000,
    conditionId: CID,
    side: 'BUY',
    size: 10,
    price: 0.5,
    usdcSize: 5,
    asset: 'tok',
    transactionHash: '0xtx',
    ...over,
  }
}

function takerTrade(over: Partial<ApiTrade> = {}): ApiTrade {
  return {
    proxyWallet: '0xWALLET',
    side: 'BUY',
    asset: 'tok',
    conditionId: CID,
    size: 3,
    price: 0.5,
    timestamp: 1_000_000,
    outcomeIndex: 0,
    transactionHash: '0xtx',
    ...over,
  }
}

test('complete taker query: taker side is per-fill from /trades, aggregated activity row dropped', () => {
  // /activity aggregates the taker's sweep into ONE row (size 5); /trades has the
  // two per-fill taker rows (3 + 2). We must store the per-fill rows, not the
  // aggregate — otherwise fill counts and per-fill prices are wrong.
  const takerRows = [takerTrade({ size: 3, price: 0.5 }), takerTrade({ size: 2, price: 0.7 })]
  const agg = activity({ size: 5, usdcSize: 2.9, price: 0.58 }) // aggregated taker activity row

  const out = buildReconstructedRows([[agg]], takerRows, false, CID)

  assert.equal(out.rows.length, 2, 'per-fill taker rows, not the single aggregate')
  assert.ok(
    out.rows.every((r) => r.isTaker),
    'both are taker fills',
  )
  assert.deepEqual(
    out.rows.map((r) => r.size).sort((a, b) => a - b),
    [2, 3],
  )
  assert.deepEqual(
    out.rows.map((r) => r.price).sort((a, b) => a - b),
    [0.5, 0.7],
    'true per-fill prices, not a blended aggregate',
  )
})

test('complete taker query: maker side from /activity, taker side from /trades; totals preserved', () => {
  // Maker M is swept by taker T. /activity gives M per-fill and T aggregated;
  // /trades gives T per-fill (3 + 2). Result: 1 maker + 2 taker rows, and the
  // volume/shares invariants are unchanged by the swap.
  const maker = activity({ proxyWallet: '0xMAKER', size: 5, usdcSize: 2.5, price: 0.5 })
  const takerAgg = activity({ proxyWallet: '0xTAKER', size: 5, usdcSize: 2.5, price: 0.5 })
  const takerRows = [
    takerTrade({ proxyWallet: '0xTAKER', size: 3, price: 0.5 }),
    takerTrade({ proxyWallet: '0xTAKER', size: 2, price: 0.5 }),
  ]

  const out = buildReconstructedRows([[maker], [takerAgg]], takerRows, false, CID)

  assert.equal(out.rows.length, 3)
  assert.equal(out.rows.filter((r) => r.isTaker).length, 2, 'two per-fill takers')
  assert.equal(out.rows.filter((r) => !r.isTaker).length, 1, 'one maker (kept from activity)')
  assert.equal(out.sharesVolume, 5, '(maker 5 + taker 5) / 2')
  assert.equal(out.volume, 5)
  assert.equal(out.wallets, 2)
})

test('capped taker query: the aggregated activity row stands in (flagged upstream)', () => {
  // Cannot reconstruct per-fill takers, so keep the aggregated activity row as a
  // stand-in. The caller sets takerCapped so the market records the limitation.
  const takerRows = [takerTrade({ size: 3, price: 0.5 })] // partial (capped)
  const agg = activity({ size: 5, usdcSize: 2.9, price: 0.58 })

  const out = buildReconstructedRows([[agg]], takerRows, true, CID)

  assert.equal(out.rows.length, 1, 'aggregated row kept — not replaced when capped')
  assert.equal(out.rows[0]!.isTaker, true, 'still recognised as a taker via the coarse key')
  assert.equal(out.rows[0]!.size, 5)
})

test('stored price is the effective price for maker rows, so usdc_size == size * price', () => {
  const maker = activity({
    proxyWallet: '0xMAKER',
    size: 2880.23,
    price: 0.595044,
    usdcSize: 1762.44763,
  })
  const out = buildReconstructedRows([[maker]], [], false, CID)
  const r = out.rows[0]!

  assert.ok(Math.abs(r.usdcSize - r.size * r.price) < 1e-6, 'row is internally consistent')
  assert.ok(Math.abs(r.price - 1762.44763 / 2880.23) < 1e-9, 'effective price, not the API price')
})

test('a maker fill (no taker key) is labelled maker', () => {
  const out = buildReconstructedRows([[activity({ proxyWallet: '0xMAKER' })]], [], false, CID)
  assert.equal(out.rows[0]!.isTaker, false)
})

test('rows from other markets and non-TRADE rows are dropped', () => {
  const out = buildReconstructedRows(
    [[activity(), activity({ conditionId: '0xother' }), activity({ type: 'REDEEM' })]],
    [],
    false,
    CID,
  )
  assert.equal(out.rows.length, 1)
})

test('foreign taker rows cannot classify or append rows under the current market', () => {
  // Same coarse taker key as the local activity row, but a different condition.
  // Without filtering first, this drops the legitimate local maker and appends
  // the foreign taker under the current market id.
  const foreignTaker = takerTrade({ conditionId: '0xother' })
  const out = buildReconstructedRows([[activity()]], [foreignTaker], false, CID)

  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0]!.isTaker, false, 'the local activity row remains a maker')
  assert.equal(out.rows[0]!.size, 10, 'the foreign per-fill row was not appended')
  assert.equal(out.volume, 5)
})

test('volume is USDC summed; sharesVolume is shares halved (Gamma volumeNum)', () => {
  const out = buildReconstructedRows(
    [
      [
        activity({ proxyWallet: '0xA', size: 120, usdcSize: 60 }),
        activity({ proxyWallet: '0xB', size: 80, usdcSize: 40 }),
      ],
    ],
    [],
    false,
    CID,
  )
  assert.equal(out.volume, 100)
  assert.equal(out.sharesVolume, 100) // (120 + 80) / 2
  assert.equal(out.wallets, 2)
})

test('takerKey lowercases wallet and ignores size/price', () => {
  const a = takerKey({ wallet: '0xabc', tx: '0xt', asset: 'x', side: 'BUY' })
  const b = takerKey({ wallet: '0xABC', tx: '0xt', asset: 'x', side: 'BUY' })
  assert.equal(a, b)
  const c = takerKey({ wallet: '0xabc', tx: '0xt', asset: 'x', side: 'SELL' })
  assert.notEqual(a, c)
  assert.equal(takerKeysOf([takerTrade()]).size, 1)
})

test('a zero-size maker row does not divide by zero', () => {
  const out = buildReconstructedRows(
    [[activity({ proxyWallet: '0xMAKER', size: 0, usdcSize: 0, price: 0.4 })]],
    [],
    false,
    CID,
  )
  assert.equal(out.rows[0]!.price, 0.4) // falls back to the API price
})
