/**
 * Telonex-specific configuration.
 *
 * Import this AFTER `src/config/env.js` has loaded the dotenv files. Most CLI
 * entry points already do that via `import '../config/env.js'` at the top.
 */

const DEFAULT_ELIGIBLE_FROM_ISO = '2025-12-01T00:00:00Z'

function parseEligibleFromMs(): number {
  const raw = (process.env.TELONEX_DATASET_ELIGIBLE_FROM ?? '').trim()
  const iso = raw === '' ? DEFAULT_ELIGIBLE_FROM_ISO : raw
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) {
    throw new Error(
      `[config/telonex] TELONEX_DATASET_ELIGIBLE_FROM is not a valid ISO date: ${raw}`,
    )
  }
  return ms
}

/**
 * Lower bound (epoch ms) for telonex markets considered "eligible" for
 * backtest coverage / queue selection. Configured via env
 * `TELONEX_DATASET_ELIGIBLE_FROM` (ISO 8601 UTC). Default
 * `2025-12-01T00:00:00Z`.
 *
 * Compared against `telonex_markets.market_start_ms` (slug-derived, indexed).
 */
export const TELONEX_DATASET_ELIGIBLE_FROM_MS = parseEligibleFromMs()

const DEFAULT_CONVERT_STALE_CLAIM_MINUTES = 120

function parseConvertStaleClaimMinutes(): number {
  const raw = (process.env.TELONEX_CONVERT_STALE_CLAIM_MINUTES ?? '').trim()
  if (raw === '') return DEFAULT_CONVERT_STALE_CLAIM_MINUTES
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `[config/telonex] TELONEX_CONVERT_STALE_CLAIM_MINUTES must be a non-negative number, got: ${raw}`,
    )
  }
  return n
}

/**
 * Age (minutes) after which an `in_progress` row in
 * `telonex_market_conversions` is considered abandoned (its process was
 * killed without reverting the claim) and becomes claimable again.
 *
 * Deliberately conservative: a legitimately slow conversion older than this
 * gets double-converted (wasteful but safe — writes are atomic and
 * idempotent), while a lower value risks stealing live claims. Raise it via
 * env `TELONEX_CONVERT_STALE_CLAIM_MINUTES` when converting larger
 * timeframes (1h/4h/1d snapshots take far longer than the 15m ~70s median).
 */
export const TELONEX_CONVERT_STALE_CLAIM_MINUTES = parseConvertStaleClaimMinutes()

const DEFAULT_DATASET_MIN_AGE_DAYS = 3

function parseDatasetMinAgeDays(): number {
  const raw = (process.env.TELONEX_DATASET_MIN_AGE_DAYS ?? '').trim()
  if (raw === '') return DEFAULT_DATASET_MIN_AGE_DAYS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(
      `[config/telonex] TELONEX_DATASET_MIN_AGE_DAYS must be a non-negative integer, got: ${raw}`,
    )
  }
  return n
}

/**
 * Publication-lag guard: markets younger than this many days are (a) not
 * cataloged by telonex:sync and (b) not part of the eligible universe.
 *
 * Rationale: Telonex publishes raw day files and crypto_prices ~T+1/T+2 and
 * Binance publishes aggTrades dumps ~T+2, so a market only has its COMPLETE
 * dataset (orderbook + feeds + priceToBeat) once it is a few days old.
 * Cataloging/selecting earlier produced partial-download churn, misleading
 * fleet sync counts, and backtest batches that hard-error on missing feed
 * days (issue #146).
 */
export const TELONEX_DATASET_MIN_AGE_DAYS = parseDatasetMinAgeDays()

/** Upper bound for market_start_ms under the publication-lag guard ("now" moves — always call, never cache). */
export function telonexDatasetMaxStartMs(): number {
  return Date.now() - TELONEX_DATASET_MIN_AGE_DAYS * 24 * 60 * 60 * 1000
}
