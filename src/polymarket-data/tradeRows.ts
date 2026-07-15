/**
 * Pure mapping/validation of `/trades` rows into `polymarket_trades` rows.
 *
 * Kept free of I/O so the two fiddly bits — taker flagging and the sanity checks
 * — are unit-testable.
 */

import type { ApiTrade } from './dataApi.js'

export type TradeRow = {
  wallet: string
  side: 'BUY' | 'SELL'
  outcomeIndex: number | null
  asset: string
  size: number
  price: number
  usdcSize: number
  isTaker: boolean
  tsMs: number
  txHash: string
}

export type BuildResult = {
  rows: TradeRow[]
  /** Sum of usdc over ALL rows (maker + taker). This is the money that changed hands. */
  volumeTraded: number
  /**
   * Sum of shares over all rows, halved — i.e. each match counted once.
   *
   * This is EXACTLY Gamma's `volumeNum`: verified across 31 markets (both
   * API-synced and deep-backfilled) at 0.000% drift, max 0.000%. It is not a
   * heuristic, it is an identity, which makes it a precise completeness check:
   * if our rows are missing even one fill, this number drops below Gamma's.
   */
  sharesVolume: number
  wallets: number
  takerRows: number
  /**
   * `true` = proven complete (invariant held, or an empty no-volume market);
   * `false` = proven incomplete (fills missing); `null` = unverifiable (Gamma
   * reports no volume but rows exist). Only `true` may become `done`.
   */
  complete: boolean | null
  warnings: string[]
}

/**
 * Identity of a fill *within one market*, used to match the taker-only subset
 * back into the full set. Two genuinely identical fills can exist, so matching
 * is multiset-based (count per key) rather than set-based.
 */
function fillKey(t: ApiTrade): string {
  return [
    t.proxyWallet.toLowerCase(),
    t.asset,
    t.side,
    t.price,
    t.size,
    t.timestamp,
    t.transactionHash,
  ].join('|')
}

export type BuildInput = {
  trades: ApiTrade[]
  takerTrades: ApiTrade[]
  market: {
    conditionId: string
    slug: string
    marketStartMs: number
    marketEndMs: number
    volumeGamma: number | null
  }
}

/**
 * Trades BEFORE the window opens are normal — a market accepts orders from the
 * moment it is created, which is up to ~a day before its trading window (we see
 * ~6% of a 15m market's fills land there). Only fills well AFTER settlement are
 * suspicious: they would mean the rows don't belong to this market.
 */
const LATE_SLACK_MS = 5 * 60_000

/**
 * `sum(size)/2 == volumeNum` is an identity, not an approximation, so the only
 * tolerance needed is for float/decimal rounding across thousands of rows.
 */
export const COMPLETENESS_TOLERANCE = 0.001

/** The maker/taker note — a capped taker query means some takers are stored as makers. */
export const TAKER_FLAGS_INCOMPLETE_NOTE =
  'maker/taker flags incomplete: taker query hit the offset cap'

export type TradeCompleteness = {
  /** true → the market must stay `partial`; false → it may be `done`. */
  partial: boolean
  /** `trades_error` diagnostic. MAY be non-null even when `partial` is false. */
  error: string | null
}

/**
 * Resolve a market's status and diagnostic from the TWO INDEPENDENT
 * data-quality dimensions — collapsing them is the bug this replaces:
 *
 *   1. Row completeness (`complete`): are all fills present? Only `true` may
 *      become `done` (invariant proven, or an empty no-volume market). `false`
 *      = fills missing; `null` = unverifiable (no Gamma volume but rows exist).
 *      This is the ONLY dimension that drives `partial`.
 *
 *   2. Maker/taker-label completeness (`takerCapped`): a capped taker-only query
 *      leaves some rows that should be `is_taker = true` stored as `false`. This
 *      does NOT make the market `partial` (every ROW is present, so the Gamma
 *      invariant still holds) — matching deep-backfill, which files such a market
 *      as `done` — but the diagnostic must ALWAYS be recorded, never cleared.
 *
 * `shortRowsNote` is the caller's wording for the `complete === false` case
 * (the /trades offset cap and deep-backfill describe it differently).
 */
export function tradeCompleteness(opts: {
  complete: boolean | null
  takerCapped: boolean
  shortRowsNote: string
}): TradeCompleteness {
  const notes: string[] = []
  if (opts.complete === false) notes.push(opts.shortRowsNote)
  else if (opts.complete === null)
    notes.push('unverifiable: Gamma reports no volume but trades exist')
  if (opts.takerCapped) notes.push(TAKER_FLAGS_INCOMPLETE_NOTE)

  return { partial: opts.complete !== true, error: notes.length > 0 ? notes.join('; ') : null }
}

export function buildTradeRows(input: BuildInput): BuildResult {
  const { trades, takerTrades, market } = input
  const warnings: string[] = []

  // The API silently ignores several query params, so verify rather than trust
  // that every row actually belongs to the market we asked for.
  const foreign = trades.filter((t) => t.conditionId !== market.conditionId).length
  if (foreign > 0) {
    warnings.push(`${foreign} row(s) carry a different conditionId than ${market.slug}`)
  }

  const takerCounts = new Map<string, number>()
  for (const t of takerTrades) {
    const k = fillKey(t)
    takerCounts.set(k, (takerCounts.get(k) ?? 0) + 1)
  }

  const rows: TradeRow[] = []
  const wallets = new Set<string>()
  let volumeTraded = 0
  let sharesTotal = 0
  let lateRows = 0
  let takerRows = 0

  for (const t of trades) {
    if (t.conditionId !== market.conditionId) continue

    const key = fillKey(t)
    const remaining = takerCounts.get(key) ?? 0
    const isTaker = remaining > 0
    if (isTaker) {
      takerCounts.set(key, remaining - 1)
      takerRows += 1
    }

    const tsMs = t.timestamp * 1000
    if (tsMs > market.marketEndMs + LATE_SLACK_MS) lateRows += 1

    const usdcSize = t.size * t.price
    volumeTraded += usdcSize
    sharesTotal += t.size
    wallets.add(t.proxyWallet.toLowerCase())

    rows.push({
      wallet: t.proxyWallet.toLowerCase(),
      side: t.side,
      outcomeIndex: typeof t.outcomeIndex === 'number' ? t.outcomeIndex : null,
      asset: t.asset,
      size: t.size,
      price: t.price,
      usdcSize,
      isTaker,
      tsMs,
      txHash: t.transactionHash,
    })
  }

  if (lateRows > 0) {
    warnings.push(`${lateRows} row(s) are timestamped more than 5min after settlement`)
  }

  // Every taker row should have found a home in the full set. Leftovers mean the
  // two queries saw different data (e.g. the market was still settling).
  const unmatchedTakers = [...takerCounts.values()].reduce((a, b) => a + b, 0)
  if (unmatchedTakers > 0) {
    warnings.push(`${unmatchedTakers} taker row(s) had no match in the full set`)
  }

  // Completeness. Gamma's volumeNum is the traded SHARE count with each match
  // counted once — so half the sum of `size` over all rows. Holding every fill
  // reproduces it exactly; missing fills show up immediately as a shortfall.
  //
  //   true  → proven complete (invariant held, OR an empty market with no volume
  //           and no rows — trivially nothing to fetch).
  //   false → proven incomplete (invariant failed; fills are missing).
  //   null  → UNVERIFIABLE (Gamma reports no volume but rows exist, so there is
  //           nothing to check against). Never treated as `done`.
  const sharesVolume = sharesTotal / 2
  let complete: boolean | null
  if (market.volumeGamma !== null && market.volumeGamma > 0) {
    const drift = (sharesVolume - market.volumeGamma) / market.volumeGamma
    complete = Math.abs(drift) <= COMPLETENESS_TOLERANCE
    if (!complete) {
      warnings.push(
        `INCOMPLETE: shares/2=${sharesVolume.toFixed(2)} vs gamma=${market.volumeGamma.toFixed(2)} ` +
          `(${(drift * 100).toFixed(2)}%) — fills are missing`,
      )
    }
  } else if (rows.length === 0) {
    // No Gamma volume AND no trades: an empty market. Trivially verified.
    complete = true
  } else {
    // No Gamma volume but trades exist — can't prove completeness either way.
    complete = null
    warnings.push('UNVERIFIABLE: Gamma reports no volume for this market but trades exist')
  }

  return { rows, volumeTraded, sharesVolume, wallets: wallets.size, takerRows, complete, warnings }
}
