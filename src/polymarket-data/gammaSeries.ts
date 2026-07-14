/**
 * Gamma events client for the polymarket-data catalog sync.
 *
 * Paging model (all behaviour probed against the live API on 2026-07-14):
 *   - `limit` is silently capped at 100.
 *   - `offset >= 3000` is rejected ("use /events/keyset"), and the keyset
 *     cursor is NOT honoured on this endpoint — passing it returns page 1 again
 *     under every cursor param name we tried. So keyset is not usable.
 *   - `end_date_min` / `end_date_max` DO work, and `order=endDate` gives a
 *     stable total order (`endDate` is the true window end for every timeframe).
 *
 * → We walk bounded [windowStart, windowEnd) ranges on `endDate` and use offset
 *   only *within* a window. Window sizes (see `pagingWindowMs`) keep each window
 *   far below the offset cap, and we assert loudly if one ever fills up.
 */

import { POLYMARKET_DATA_GAMMA_API_URL } from '../config/polymarketData.js'
import { fetchJson } from './http.js'
import type { RateLimiter } from './rateLimiter.js'
import {
  pagingWindowMs,
  resolveMarketWindow,
  type MarketSeries,
  type Timeframe,
} from './marketSeries.js'

const PAGE_LIMIT = 100
const MAX_OFFSET = 2000

type GammaMarket = {
  id?: string
  slug?: string
  conditionId?: string
  question?: string
  outcomes?: string
  outcomePrices?: string
  clobTokenIds?: string
  volumeNum?: number | null
  liquidityNum?: number | null
  closed?: boolean
  endDate?: string
  eventStartTime?: string
  [k: string]: unknown
}

type GammaEvent = {
  id?: string
  slug?: string
  markets?: GammaMarket[]
}

/** A catalog row, already normalised to what `polymarket_markets` stores. */
export type CatalogMarket = {
  conditionId: string
  slug: string
  eventId: string | null
  seriesId: string
  symbol: string
  timeframe: Timeframe
  marketStartMs: number
  marketEndMs: number
  question: string | null
  outcomes: string[]
  resolvedOutcome: string | null
  closed: boolean
  volumeGamma: string | null
  liquidityGamma: string | null
  assetId0: string | null
  assetId1: string | null
  rawJson: Record<string, unknown>
}

/** Gamma serialises these as JSON *strings* (e.g. `"[\"Up\", \"Down\"]"`). */
function parseJsonArray(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : null
  } catch {
    return null
  }
}

/**
 * A resolved binary market has outcomePrices `["1","0"]` / `["0","1"]`. An
 * unresolved (or ambiguously priced) one yields null rather than a guess.
 */
function resolvedOutcomeFrom(outcomes: string[], prices: string[] | null): string | null {
  if (!prices || prices.length !== outcomes.length) return null
  const winners = prices
    .map((p, i) => ({ p: Number(p), i }))
    .filter(({ p }) => Number.isFinite(p) && p === 1)
  if (winners.length !== 1) return null
  return outcomes[winners[0]!.i] ?? null
}

function numToDecimalString(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v.toFixed(6)
}

function toCatalogMarket(
  event: GammaEvent,
  market: GammaMarket,
  series: MarketSeries,
): CatalogMarket | null {
  const slug = market.slug ?? event.slug
  const conditionId = market.conditionId
  if (!slug || !conditionId) return null

  const outcomes = parseJsonArray(market.outcomes) ?? []
  const tokenIds = parseJsonArray(market.clobTokenIds) ?? []
  const window = resolveMarketWindow({
    slug,
    timeframe: series.timeframe,
    endDateIso: market.endDate ?? null,
    eventStartTimeIso: market.eventStartTime ?? null,
  })

  return {
    conditionId,
    slug,
    eventId: event.id ?? null,
    seriesId: series.seriesId,
    symbol: series.symbol,
    timeframe: series.timeframe,
    marketStartMs: window.startMs,
    marketEndMs: window.endMs,
    question: market.question ?? null,
    outcomes,
    resolvedOutcome: resolvedOutcomeFrom(outcomes, parseJsonArray(market.outcomePrices)),
    closed: market.closed === true,
    volumeGamma: numToDecimalString(market.volumeNum),
    liquidityGamma: numToDecimalString(market.liquidityNum),
    assetId0: tokenIds[0] ?? null,
    assetId1: tokenIds[1] ?? null,
    rawJson: market as Record<string, unknown>,
  }
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export type FetchSeriesOptions = {
  limiter: RateLimiter
  signal?: AbortSignal
  label?: string
}

/**
 * Yield every market of `series` whose window END falls in [fromMs, toMs).
 *
 * Filtering on end rather than start is deliberate: `end_date_min/max` are the
 * only server-side time filters that work, and end = start + timeframe, so the
 * two are equivalent up to a fixed shift (the caller's `fromMs` is shifted by
 * the timeframe before being applied).
 */
export async function* fetchSeriesMarkets(
  series: MarketSeries,
  fromMs: number,
  toMs: number,
  opts: FetchSeriesOptions,
): AsyncGenerator<CatalogMarket> {
  const label = opts.label ?? '[polymarket-data:gamma]'
  const windowMs = pagingWindowMs(series.timeframe)

  for (let windowStart = fromMs; windowStart < toMs; windowStart += windowMs) {
    const windowEnd = Math.min(windowStart + windowMs, toMs)
    let offset = 0

    for (;;) {
      const url =
        `${POLYMARKET_DATA_GAMMA_API_URL}/events` +
        `?series_id=${encodeURIComponent(series.seriesId)}` +
        `&limit=${PAGE_LIMIT}&offset=${offset}` +
        `&order=endDate&ascending=true` +
        `&end_date_min=${encodeURIComponent(isoOf(windowStart))}` +
        `&end_date_max=${encodeURIComponent(isoOf(windowEnd))}`

      const events = await fetchJson<GammaEvent[]>(url, {
        limiter: opts.limiter,
        ...(opts.signal ? { signal: opts.signal } : {}),
        label,
      })
      if (!Array.isArray(events) || events.length === 0) break

      for (const event of events) {
        for (const market of event.markets ?? []) {
          const row = toCatalogMarket(event, market, series)
          if (row) yield row
        }
      }

      if (events.length < PAGE_LIMIT) break
      offset += PAGE_LIMIT
      if (offset > MAX_OFFSET) {
        // Would hit Gamma's offset cap: the window holds more events than we
        // sized for. Never silently truncate — this is a bug in pagingWindowMs.
        throw new Error(
          `${label} window ${isoOf(windowStart)}..${isoOf(windowEnd)} for ${series.seriesSlug} ` +
            `exceeded the offset cap (${MAX_OFFSET}); shrink pagingWindowMs()`,
        )
      }
    }
  }
}
