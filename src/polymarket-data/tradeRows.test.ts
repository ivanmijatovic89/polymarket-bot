import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTradeRows, completenessToleranceShares, tradeCompleteness } from './tradeRows.js'
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

  // 10 + 10 shares → shares/2 = 10, so a matching Gamma volume keeps it clean.
  const out = buildTradeRows({
    trades: [taker, maker],
    takerTrades: [taker],
    market: { ...MARKET, volumeGamma: 10 },
  })

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

  const out = buildTradeRows({
    trades: [a, b],
    takerTrades: [a],
    market: { ...MARKET, volumeGamma: 10 }, // 10 + 10 shares → shares/2 = 10
  })

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
    trades: [trade({ timestamp: 999_000 - 86_400 })], // a day early, size 10
    takerTrades: [],
    market: { ...MARKET, volumeGamma: 5 }, // 10 shares → shares/2 = 5
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

test('tolerance: a small-but-real shortfall on a high-volume market stays partial', () => {
  // The bug this replaces: a relative 0.1% tolerance let a 60-share shortfall on
  // a ~1M-share market pass as complete. With the absolute share tolerance it
  // must be `false`. Build a big market and drop ~10 shares.
  const rows = Array.from({ length: 2000 }, (_, i) =>
    trade({ proxyWallet: `0x${i}`, transactionHash: `0x${i}`, size: 100 }),
  )
  const sharesTotal = 2000 * 100 // 200,000 shares → gamma = 100,000
  const out = buildTradeRows({
    trades: rows,
    takerTrades: [],
    market: { ...MARKET, volumeGamma: sharesTotal / 2 + 10 }, // 10 shares short
  })
  assert.equal(out.complete, false, '10 missing shares must not be tolerated')
  assert.match(out.warnings.join(' '), /short 10\.00 shares/)
})

test('tolerance: harmless sub-rounding difference is accepted as complete', () => {
  // A tiny difference (well under the per-row rounding budget) is accepted.
  const out = buildTradeRows({
    trades: [trade({ size: 200 })], // shares/2 = 100
    takerTrades: [],
    market: { ...MARKET, volumeGamma: 100 + 0.004 }, // 0.004 shares off < 0.05 floor
  })
  assert.equal(out.complete, true)
})

test('tolerance: budget scales with row count (per-row decimal rounding)', () => {
  assert.equal(completenessToleranceShares(0), 0.05) // floor
  assert.equal(completenessToleranceShares(1000), 0.05) // still under floor
  assert.equal(completenessToleranceShares(20000), 0.1) // 20000 * 5e-6
})

test('no Gamma volume but rows exist → unverifiable (null), never done', () => {
  const out = buildTradeRows({
    trades: [trade()],
    takerTrades: [],
    market: { ...MARKET, volumeGamma: null },
  })

  assert.equal(out.complete, null)
  assert.match(out.warnings.join(' '), /UNVERIFIABLE/)
})

test('no Gamma volume AND no rows → empty market is trivially complete (true)', () => {
  for (const volumeGamma of [null, 0]) {
    const out = buildTradeRows({
      trades: [],
      takerTrades: [],
      market: { ...MARKET, volumeGamma },
    })
    assert.equal(out.complete, true, `volumeGamma=${volumeGamma}`)
    assert.equal(out.rows.length, 0)
    assert.deepEqual(out.warnings, [])
  }
})

// Row completeness and maker/taker-label completeness are INDEPENDENT. `partial`
// tracks only rows; a capped taker query is always diagnosed but never forces
// `partial`. `shortRows` is the caller's wording for the complete===false case.
const SHORT = 'fills missing (offset cap); awaiting deep-backfill'
const tc = (complete: boolean | null, takerCapped: boolean, shortRowsNote = SHORT) =>
  tradeCompleteness({ complete, takerCapped, shortRowsNote })

test('complete rows, neither query capped → done, no diagnostic', () => {
  assert.deepEqual(tc(true, false), { partial: false, error: null })
})

test('complete rows, taker query capped → done, but taker diagnostic recorded', () => {
  // THE regression: this used to be done with the diagnostic silently cleared.
  const out = tc(true, true)
  assert.equal(out.partial, false, 'all rows present → not partial')
  assert.match(String(out.error), /maker\/taker flags incomplete: taker query hit the offset cap/)
})

test('complete rows, full query capped but invariant proves completeness → done', () => {
  // `all.capped` only refines wording; when the invariant holds, rows are all
  // present regardless. Full-cap alone (taker not capped) → done, no note.
  assert.deepEqual(tc(true, false, SHORT), { partial: false, error: null })
})

test('incomplete rows, full query capped → partial with the offset-cap diagnostic', () => {
  const out = tc(false, false, 'fills missing (offset cap); awaiting deep-backfill')
  assert.equal(out.partial, true)
  assert.match(String(out.error), /offset cap/)
})

test('incomplete rows, no query capped → partial with the invariant-failed diagnostic', () => {
  const out = tc(false, false, 'fills missing (invariant failed); awaiting deep-backfill')
  assert.equal(out.partial, true)
  assert.match(String(out.error), /invariant failed/)
})

test('unverifiable non-empty rows (no Gamma volume) → partial, unverifiable diagnostic', () => {
  const out = tc(null, false)
  assert.equal(out.partial, true)
  assert.match(String(out.error), /unverifiable/i)
})

test('incomplete rows AND capped taker → partial, both diagnostics present', () => {
  const out = tc(false, true, 'fills missing (offset cap); awaiting deep-backfill')
  assert.equal(out.partial, true)
  assert.match(String(out.error), /offset cap/)
  assert.match(String(out.error), /maker\/taker flags incomplete/)
})

test('unmatched taker rows are reported', () => {
  const out = buildTradeRows({
    trades: [trade({ proxyWallet: '0xA' })],
    takerTrades: [trade({ proxyWallet: '0xGHOST' })],
    market: MARKET,
  })

  assert.match(out.warnings.join(' '), /no match in the full set/)
})
