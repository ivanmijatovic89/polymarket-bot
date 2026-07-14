import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTradeRows } from './tradeRows.js'
import type { ApiTrade } from './dataApi.js'

const CID = '0xabc'
const MARKET = {
  conditionId: CID,
  slug: 'btc-updown-15m-1000000',
  marketStartMs: 1_000_000_000,
  marketEndMs: 1_000_900_000,
  volumeGamma: null as number | null,
}

function trade(over: Partial<ApiTrade> = {}): ApiTrade {
  return {
    proxyWallet: '0xAAA',
    side: 'BUY',
    asset: 'token-1',
    conditionId: CID,
    size: 10,
    price: 0.5,
    timestamp: 1_000_000,
    outcomeIndex: 0,
    transactionHash: '0xtx1',
    ...over,
  }
}

test('taker rows are flagged, the rest are makers', () => {
  const taker = trade({ proxyWallet: '0xTAKER', transactionHash: '0xtx9' })
  const maker = trade({ proxyWallet: '0xMAKER', side: 'SELL', transactionHash: '0xtx9' })

  const out = buildTradeRows({ trades: [taker, maker], takerTrades: [taker], market: MARKET })

  assert.equal(out.rows.length, 2)
  assert.equal(out.takerRows, 1)
  assert.equal(out.rows.find((r) => r.wallet === '0xtaker')?.isTaker, true)
  assert.equal(out.rows.find((r) => r.wallet === '0xmaker')?.isTaker, false)
  assert.deepEqual(out.warnings, [])
})

test('two identical fills with one taker flag only one row as taker', () => {
  // Multiset matching: a set would wrongly flag both.
  const a = trade()
  const b = trade()

  const out = buildTradeRows({ trades: [a, b], takerTrades: [a], market: MARKET })

  assert.equal(out.rows.filter((r) => r.isTaker).length, 1)
  assert.equal(out.rows.filter((r) => !r.isTaker).length, 1)
  assert.deepEqual(out.warnings, [])
})

test('usdc size, volume and wallet count are derived from all rows', () => {
  const out = buildTradeRows({
    trades: [
      trade({ proxyWallet: '0xA', size: 10, price: 0.5 }),
      trade({ proxyWallet: '0xB', size: 4, price: 0.25 }),
      trade({ proxyWallet: '0xA', size: 2, price: 1 }),
    ],
    takerTrades: [],
    market: MARKET,
  })

  assert.equal(out.rows[0]!.usdcSize, 5)
  assert.equal(out.volumeTraded, 5 + 1 + 2)
  assert.equal(out.wallets, 2)
})

test('rows from another market are dropped and reported', () => {
  const out = buildTradeRows({
    trades: [trade(), trade({ conditionId: '0xother' })],
    takerTrades: [],
    market: MARKET,
  })

  assert.equal(out.rows.length, 1)
  assert.match(out.warnings.join(' '), /different conditionId/)
})

test('pre-window fills are normal and are not warned about', () => {
  // Markets accept orders from creation, up to ~a day before the window opens;
  // ~6% of a real 15m market's fills land there.
  const out = buildTradeRows({
    trades: [trade({ timestamp: 999_000 - 86_400 })], // a day early
    takerTrades: [],
    market: MARKET,
  })

  assert.equal(out.rows.length, 1)
  assert.deepEqual(out.warnings, [])
})

test('fills long after settlement are kept but warned about', () => {
  const out = buildTradeRows({
    trades: [trade({ timestamp: 1_000_900 + 600 })], // 10 min after the window closed
    takerTrades: [],
    market: MARKET,
  })

  assert.equal(out.rows.length, 1)
  assert.match(out.warnings.join(' '), /after settlement/)
})

test('completeness: shares/2 reproducing Gamma volume means every fill is held', () => {
  // Gamma's volumeNum is the traded SHARE count with each match counted once —
  // an identity, verified at 0.000% drift across every market synced so far.
  // 200 shares over all rows → 100 matched shares → gamma 100.
  const complete = buildTradeRows({
    trades: [trade({ size: 120, price: 0.9 }), trade({ size: 80, price: 0.1 })],
    takerTrades: [],
    market: { ...MARKET, volumeGamma: 100 },
  })

  assert.equal(complete.sharesVolume, 100)
  assert.equal(complete.complete, true)
  assert.deepEqual(complete.warnings, [])
  // Note the USDC total is unrelated to Gamma's figure — comparing them would
  // raise false alarms, which is exactly the trap this check avoids.
  assert.equal(complete.volumeTraded, 120 * 0.9 + 80 * 0.1)
})

test('completeness: missing fills show up as a shortfall, not a rounding wobble', () => {
  const short = buildTradeRows({
    trades: [trade({ size: 150 })], // 75 matched shares vs gamma 100
    takerTrades: [],
    market: { ...MARKET, volumeGamma: 100 },
  })

  assert.equal(short.complete, false)
  assert.match(short.warnings.join(' '), /INCOMPLETE/)
})

test('completeness is unknown when Gamma reports no volume', () => {
  const out = buildTradeRows({
    trades: [trade()],
    takerTrades: [],
    market: { ...MARKET, volumeGamma: null },
  })

  assert.equal(out.complete, null)
  assert.deepEqual(out.warnings, [])
})

test('unmatched taker rows are reported', () => {
  const out = buildTradeRows({
    trades: [trade({ proxyWallet: '0xA' })],
    takerTrades: [trade({ proxyWallet: '0xGHOST' })],
    market: MARKET,
  })

  assert.match(out.warnings.join(' '), /no match in the full set/)
})
