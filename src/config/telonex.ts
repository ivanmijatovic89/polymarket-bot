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
