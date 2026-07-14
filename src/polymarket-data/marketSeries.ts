/**
 * The market universe we sync: every (symbol, timeframe) crypto up/down market
 * on Polymarket is published as a Gamma *series*. Paging a series' events is
 * how we discover markets — there is no slug-guessing.
 *
 * Every series id below was verified against the live Gamma API (2026-07-14) by
 * fetching one event from each and asserting the slug matches the expected
 * symbol + timeframe. Two legacy series exist but return zero events and are
 * deliberately excluded: `ethereum-up-or-down-4h` (10325) and
 * `solana-up-or-down-4h` (10326) — the live ones are 10332 / 10333.
 *
 * Adding a symbol (DOGE / BNB / HYPE) means adding rows here; nothing else in
 * the pipeline hardcodes a symbol.
 */

export const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
}

export type MarketSeries = {
  symbol: string
  timeframe: Timeframe
  /** Gamma `series_id` used for `GET /events?series_id=…`. */
  seriesId: string
  /** Gamma series slug — informational, useful when debugging. */
  seriesSlug: string
}

export const MARKET_SERIES: MarketSeries[] = [
  { symbol: 'btc', timeframe: '5m', seriesId: '10684', seriesSlug: 'btc-up-or-down-5m' },
  { symbol: 'btc', timeframe: '15m', seriesId: '10192', seriesSlug: 'btc-up-or-down-15m' },
  { symbol: 'btc', timeframe: '1h', seriesId: '10114', seriesSlug: 'btc-up-or-down-hourly' },
  { symbol: 'btc', timeframe: '4h', seriesId: '10331', seriesSlug: 'btc-up-or-down-4h' },
  { symbol: 'btc', timeframe: '1d', seriesId: '41', seriesSlug: 'btc-up-or-down-daily' },

  { symbol: 'eth', timeframe: '5m', seriesId: '10683', seriesSlug: 'eth-up-or-down-5m' },
  { symbol: 'eth', timeframe: '15m', seriesId: '10191', seriesSlug: 'eth-up-or-down-15m' },
  { symbol: 'eth', timeframe: '1h', seriesId: '10117', seriesSlug: 'eth-up-or-down-hourly' },
  { symbol: 'eth', timeframe: '4h', seriesId: '10332', seriesSlug: 'eth-up-or-down-4h' },
  { symbol: 'eth', timeframe: '1d', seriesId: '40', seriesSlug: 'eth-up-or-down-daily' },

  { symbol: 'sol', timeframe: '5m', seriesId: '10686', seriesSlug: 'sol-up-or-down-5m' },
  { symbol: 'sol', timeframe: '15m', seriesId: '10423', seriesSlug: 'sol-up-or-down-15m' },
  { symbol: 'sol', timeframe: '1h', seriesId: '10122', seriesSlug: 'solana-up-or-down-hourly' },
  { symbol: 'sol', timeframe: '4h', seriesId: '10333', seriesSlug: 'sol-up-or-down-4h' },
  { symbol: 'sol', timeframe: '1d', seriesId: '10086', seriesSlug: 'solana-up-or-down-daily' },

  { symbol: 'xrp', timeframe: '5m', seriesId: '10685', seriesSlug: 'xrp-up-or-down-5m' },
  { symbol: 'xrp', timeframe: '15m', seriesId: '10422', seriesSlug: 'xrp-up-or-down-15m' },
  { symbol: 'xrp', timeframe: '1h', seriesId: '10123', seriesSlug: 'xrp-up-or-down-hourly' },
  { symbol: 'xrp', timeframe: '4h', seriesId: '10327', seriesSlug: 'xrp-up-or-down-4h' },
  { symbol: 'xrp', timeframe: '1d', seriesId: '10100', seriesSlug: 'xrp-up-or-down-daily' },
]

export const SYMBOLS = [...new Set(MARKET_SERIES.map((s) => s.symbol))]

export function isTimeframe(v: string): v is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(v)
}

export function selectSeries(filter: { symbol?: string; timeframe?: Timeframe }): MarketSeries[] {
  return MARKET_SERIES.filter(
    (s) =>
      (filter.symbol === undefined || s.symbol === filter.symbol) &&
      (filter.timeframe === undefined || s.timeframe === filter.timeframe),
  )
}

/**
 * Epoch-suffixed slugs (`btc-updown-15m-1784061000`) are used by 5m / 15m / 4h.
 * The suffix IS the window start — Gamma's `startDate` is the market's creation
 * time and must never be used for this. 1h / 1d markets use word slugs
 * (`bitcoin-up-or-down-july-14-2026-2pm-et`) and carry no epoch.
 */
export function parseSlugEpochMs(slug: string): number | null {
  const parts = slug.split('-')
  const last = parts[parts.length - 1]
  if (parts[1] !== 'updown' || last === undefined) return null
  const epochSec = Number(last)
  if (!Number.isSafeInteger(epochSec) || epochSec <= 0) return null
  return epochSec * 1000
}

/**
 * Resolve a market's trading window.
 *
 * `endDate` (Gamma) is the true window end for every timeframe — verified. The
 * start comes from the slug epoch when present, else from `eventStartTime`, and
 * falls back to `end − timeframe`. When both the slug epoch and eventStartTime
 * exist they must agree; a mismatch means Gamma changed shape and we want to
 * hear about it rather than silently store a wrong window.
 */
export function resolveMarketWindow(args: {
  slug: string
  timeframe: Timeframe
  endDateIso: string | null
  eventStartTimeIso: string | null
}): { startMs: number; endMs: number } {
  const { slug, timeframe, endDateIso, eventStartTimeIso } = args
  const tfMs = TIMEFRAME_MS[timeframe]

  const endMs = endDateIso ? Date.parse(endDateIso) : NaN
  const slugMs = parseSlugEpochMs(slug)
  const eventStartMs = eventStartTimeIso ? Date.parse(eventStartTimeIso) : NaN

  if (slugMs !== null && Number.isFinite(eventStartMs) && slugMs !== eventStartMs) {
    throw new Error(
      `[polymarket-data] window mismatch for ${slug}: slug epoch=${slugMs} eventStartTime=${eventStartMs}`,
    )
  }

  const startMs =
    slugMs ??
    (Number.isFinite(eventStartMs)
      ? eventStartMs
      : Number.isFinite(endMs)
        ? endMs - tfMs
        : Number.NaN)

  if (!Number.isFinite(startMs)) {
    throw new Error(`[polymarket-data] cannot resolve window start for ${slug}`)
  }

  const resolvedEnd = Number.isFinite(endMs) ? endMs : startMs + tfMs
  return { startMs, endMs: resolvedEnd }
}

/**
 * Gamma caps `limit` at 100 and rejects `offset >= 3000`, and its keyset cursor
 * is not honoured on the events endpoint (probed). So the catalog is paged by
 * walking bounded `end_date_min`/`end_date_max` windows and using offsets only
 * inside a window. Window sizes are chosen so a window holds well under the
 * offset cap even for the densest series.
 */
export function pagingWindowMs(timeframe: Timeframe): number {
  const eventsPerWindow = 1000
  return TIMEFRAME_MS[timeframe] * eventsPerWindow
}
