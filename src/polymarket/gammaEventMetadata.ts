/**
 * Gamma `events[].eventMetadata` — the only bulk-history source for the
 * Chainlink open/strike (`priceToBeat`) and settle (`finalPrice`) of up/down
 * markets. Epoch boundaries (measured 2026-07-20, see
 * docs/datasets/data-coverage.md):
 *   - priceToBeat exists from ~2026-02-19 (between 02-18 20:00 and 02-19 04:00 UTC)
 *   - finalPrice  exists from ~2026-03-21 (between 12:00 and 18:00 UTC)
 * Markets before return `eventMetadata: null` — Gamma did NOT backfill.
 */

/**
 * Conservative "data can exist" floor: the lower edge of the measured
 * boundary window. Markets starting before this can never have a strike in
 * Gamma (feed key stays absent); markets at/after it hard-error when the
 * backfill hasn't run.
 */
export const GAMMA_PRICE_TO_BEAT_FROM_MS = Date.parse('2026-02-18T20:00:00Z')

/**
 * Per-series priceToBeat epochs. 15m/5m are exact, measured from the COMPLETE
 * 179k-market backfill (2026-07-20, docs/datasets/data-coverage.md):
 * Polymarket enabled the strike per series, not globally — recording for
 * 5m eth/sol/xrp simply started a month later. Markets before their series'
 * epoch are "recording had not started yet" (feed key absent, no error);
 * markets after it with no strike are genuine platform-side holes (hard error
 * in backtests).
 *
 * 1h/4h/1d are PROVISIONAL, deliberately-late estimates (probes only: 1h got
 * the strike in the same ~2026-03-18/19 wave as the 5m alts; 4h/1d were
 * spot-checked present ≥ late Mar 2026). A late epoch is safe because the
 * backtest wiring feeds a backfilled strike whenever one EXISTS regardless of
 * epoch — the epoch only classifies markets with a null strike (quiet-absent
 * vs hard-error), so overshooting merely softens hole detection inside the
 * provisional span. Tighten by measurement (MIN(market_start_ms) WHERE
 * price_to_beat IS NOT NULL per series) once those series enter the catalog.
 * Note: only 4h uses the machine slug format today; 1h/1d human-date slugs
 * don't parse to a timeframe yet (see docs/datasets/data-coverage.md) and
 * need slug-parser support before they can reach this lookup.
 *
 * Unknown series (anything else) fall back to the global floor so their nulls
 * surface loudly rather than being silently excused.
 */
export function gammaPriceToBeatEpochMs(symbol: string | null, timeframe: string | null): number {
  if (timeframe === '15m') return Date.parse('2026-02-18T23:45:00Z')
  if (timeframe === '5m') {
    if (symbol === 'btc') return Date.parse('2026-02-19T00:05:00Z')
    if (symbol === 'eth' || symbol === 'sol' || symbol === 'xrp') {
      return Date.parse('2026-03-18T23:00:00Z')
    }
  }
  if (timeframe === '1h') return Date.parse('2026-03-20T00:00:00Z')
  if (timeframe === '4h' || timeframe === '1d') return Date.parse('2026-04-01T00:00:00Z')
  return GAMMA_PRICE_TO_BEAT_FROM_MS
}

export type GammaEventMetadata = {
  priceToBeat: number | null
  finalPrice: number | null
}

function asFiniteNumber(x: unknown): number | null {
  // Empty/whitespace strings must be null, not Number('') === 0 — a $0 strike
  // would silently pass the null checks downstream. Matches the live client's
  // parser (polymarketPriceToBeatClient guards x.length > 0 the same way).
  const n = typeof x === 'string' ? (x.trim().length > 0 ? Number(x) : Number.NaN) : x
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Extract eventMetadata prices from a raw Gamma market object (null-safe). */
export function parseGammaEventMetadata(raw: Record<string, unknown> | null): GammaEventMetadata {
  const events = raw?.events
  const first = Array.isArray(events)
    ? (events[0] as Record<string, unknown> | undefined)
    : undefined
  const md = first?.eventMetadata as Record<string, unknown> | null | undefined
  return {
    priceToBeat: asFiniteNumber(md?.priceToBeat),
    finalPrice: asFiniteNumber(md?.finalPrice),
  }
}
