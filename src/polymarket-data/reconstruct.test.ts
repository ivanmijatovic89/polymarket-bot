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

test('an aggregated taker row is flagged via (wallet, tx, asset, side), not size/price', () => {
  // Real shape: the /trades taker rows are per-fill (3 + 2 shares), the /activity
  // row aggregates them (5 shares) with a blended price that matches neither.
  const takerKeys = takerKeysOf([
    takerTrade({ size: 3, price: 0.5 }),
    takerTrade({ size: 2, price: 0.7 }),
  ])
  const agg = activity({ size: 5, usdcSize: 2.9, price: 0.55 }) // implied 0.58, != stored price

  const out = buildReconstructedRows([[agg]], takerKeys, CID)

  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0]!.isTaker, true, 'aggregated taker must still be recognised')
})

test('stored price is the effective price, so usdc_size == size * price for every row', () => {
  // The regression: keeping the API's `price` left rows where usdc != size*price.
  const agg = activity({ size: 2880.23, price: 0.595044, usdcSize: 1762.44763 })

  const out = buildReconstructedRows([[agg]], new Set(), CID)
  const r = out.rows[0]!

  assert.ok(Math.abs(r.usdcSize - r.size * r.price) < 1e-6, 'row is internally consistent')
  assert.ok(Math.abs(r.price - 1762.44763 / 2880.23) < 1e-9, 'effective price, not the API price')
})

test('a maker fill (no taker key) is labelled maker', () => {
  const out = buildReconstructedRows([[activity({ proxyWallet: '0xMAKER' })]], new Set(), CID)
  assert.equal(out.rows[0]!.isTaker, false)
})

test('rows from other markets and non-TRADE rows are dropped', () => {
  const out = buildReconstructedRows(
    [[activity(), activity({ conditionId: '0xother' }), activity({ type: 'REDEEM' })]],
    new Set(),
    CID,
  )
  assert.equal(out.rows.length, 1)
})

test('volume is USDC summed; sharesVolume is shares halved (Gamma volumeNum)', () => {
  const out = buildReconstructedRows(
    [
      [
        activity({ proxyWallet: '0xA', size: 120, usdcSize: 60 }),
        activity({ proxyWallet: '0xB', size: 80, usdcSize: 40 }),
      ],
    ],
    new Set(),
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
})

test('a zero-size row does not divide by zero', () => {
  const out = buildReconstructedRows(
    [[activity({ size: 0, usdcSize: 0, price: 0.4 })]],
    new Set(),
    CID,
  )
  assert.equal(out.rows[0]!.price, 0.4) // falls back to the API price
})
