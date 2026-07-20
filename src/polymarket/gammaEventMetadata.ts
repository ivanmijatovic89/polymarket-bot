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

export type GammaEventMetadata = {
  priceToBeat: number | null
  finalPrice: number | null
}

function asFiniteNumber(x: unknown): number | null {
  const n = typeof x === 'string' ? Number(x) : x
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
