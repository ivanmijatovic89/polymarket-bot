/**
 * Parsing helpers for up/down market slugs: `<symbol>-updown-<timeframe>-<epochSeconds>`.
 *
 * SINGLE SOURCE OF TRUTH for deriving the market window from a slug. Used by
 * the backtest CLI (strategy window for telonex modes) and by the backtest
 * external-feeds wiring (feed coverage window in any input mode). Timeframe
 * units are generic (`m`/`h`/`d`), so 5m/15m/1h/4h/1d all parse.
 */

/** `<symbol>-updown-<tf>-<epochSeconds>` → window-start ms, or null if unparseable. */
export function windowStartMsFromSlug(slug: string): number | null {
  const m = slug.match(/^[a-z]+-updown-[^-]+-(\d+)$/)
  if (!m) return null
  const sec = Number(m[1])
  if (!Number.isFinite(sec)) return null
  return sec * 1000
}

/** `<symbol>-updown-<tf>-<epoch>` → timeframe duration ms, or null if unparseable. */
export function timeframeMsFromSlug(slug: string): number | null {
  const m = slug.match(/^[a-z]+-updown-([^-]+)-\d+$/)
  if (!m) return null
  const tf = m[1]?.toLowerCase() ?? ''
  const parsed = tf.match(/^(\d+)([mhd])$/)
  if (!parsed) return null
  const n = Number(parsed[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = parsed[2]
  if (unit === 'm') return n * 60_000
  if (unit === 'h') return n * 3_600_000
  if (unit === 'd') return n * 86_400_000
  return null
}

/** Full `[startMs, endMs]` window from a slug, or null if either part is unparseable. */
export function windowFromSlug(slug: string): { startMs: number; endMs: number } | null {
  const startMs = windowStartMsFromSlug(slug)
  const durationMs = timeframeMsFromSlug(slug)
  if (startMs === null || durationMs === null) return null
  return { startMs, endMs: startMs + durationMs }
}

/** Leading symbol of an up/down slug (`btc-updown-15m-...` → `btc`), or null. */
export function symbolFromSlug(slug: string): string | null {
  const m = slug.match(/^([a-z]+)-updown-/)
  return m?.[1] ?? null
}
