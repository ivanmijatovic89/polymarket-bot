// -----------------------------------------------------------------------------
// SOURCE OF TRUTH for queries against `telonex_markets` /
// `telonex_market_conversions`. Do NOT write inline SQL against these tables
// elsewhere. Add a function here instead.
//
// Eligibility = `conversion.status = 'done'` AND the requested converter has a
// non-empty `local_path` (if readFrom='local') or `r2_url` (if readFrom='r2'),
// AND the market window start is >= TELONEX_DATASET_ELIGIBLE_FROM_MS (per env
// `TELONEX_DATASET_ELIGIBLE_FROM`, default 2025-12-01), AND the market is
// resolved with a final result_id.
//
// Ordering is always `market_start_ms ASC` (chronological) unless `random` is
// set. `market_start_ms` is derived from the slug suffix at sync time and is
// indexed via `(symbol, timeframe, market_start_ms)` and
// `(timeframe, market_start_ms)`. NEVER order/filter by `start_date_us` — it
// represents something other than the trading window (verified: 100% of rows
// differ from the slug epoch).
// -----------------------------------------------------------------------------

import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { getDb } from './index.js'
import { telonexMarkets, telonexMarketConversions } from './schema.js'
import { buildTelonexEligibilityConditions } from './telonexEligibility.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../config/telonex.js'

// `local-or-download-from-r2-to-local` resolves like `r2` for the DB query (gates on r2_url, returns
// r2_url as the dataset) — `pickDataset` / eligibility route any non-`local`
// value through the r2 branch. The backtest worker then reads the canonical
// local file if present, else downloads the r2_url to it first.
export type ReadFrom = 'local' | 'r2' | 'local-or-download-from-r2-to-local'
export type Converter = 'delta-typed' | 'paired'

/**
 * A slug-pattern WHERE clause plus an optional pattern-order ORDER BY expression.
 * `order` is null for a single pattern (there is no cross-pattern rank to apply),
 * which lets the claim queries order by `market_start_ms` alone — an index can
 * satisfy that, avoiding the full-scan + filesort that a CASE expression forces.
 */
export type SlugSelection = { where: SQL; order: SQL | null }

/**
 * Build a `--slug-pattern` selection against `telonex_markets.slug`:
 *   - `where`: an OR of `slug LIKE <pattern>` (parameterized).
 *   - `order`: a CASE that drains markets in pattern order — all of pattern[0]
 *     first, then pattern[1], … (combine with `marketStartMs ASC` for
 *     chronological order within each pattern).
 *
 * Shared by `telonex:download` and `telonex:convert` so both interpret
 * `--slug-pattern` identically. Patterns are MySQL LIKE patterns, e.g.
 * `btc-updown-15m-%`.
 */
export function buildSlugSelection(patterns: string[]): SlugSelection {
  const likes = patterns.map((p) => sql`${telonexMarkets.slug} LIKE ${p}`)
  const where = sql`(${sql.join(likes, sql` OR `)})`
  if (patterns.length <= 1) {
    // Single pattern: every matched row shares the same pattern rank, so there is
    // nothing to order across patterns. Returning null lets the claim order by
    // market_start_ms alone (index-friendly, no filesort).
    return { where, order: null }
  }
  const cases = patterns.map((p, i) => sql`WHEN ${telonexMarkets.slug} LIKE ${p} THEN ${i}`)
  const order = sql`CASE ${sql.join(cases, sql` `)} ELSE ${patterns.length} END`
  return { where, order }
}

export type Market = {
  marketId: string
  slug: string
  symbol: string
  timeframe: string
  marketStartMs: number
  dataset: string | null // local_path or r2_url, picked by caller via readFrom
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  resultId: string | null
  telonexStatus: string | null
  question: string | null
  /** @deprecated `start_date_us` is NOT the market window start. Use `marketStartMs`. */
  startDateMs: number | null
  /** End of the 15m/5m trading window. Matches `marketStartMs + timeframeMs`. */
  endDateMs: number | null
  /**
   * Chainlink open/strike price of the window, backfilled from Gamma
   * `events[].eventMetadata` (null: not backfilled yet, or Gamma has no data —
   * disambiguate via `gammaMetadataSyncedAt`). Epochs: docs/datasets/data-coverage.md.
   */
  priceToBeat: number | null
  /** When the Gamma metadata fetch was last attempted for this row (null = never). */
  gammaMetadataSyncedAt: Date | null
}

/**
 * Filters for eligibility queries. All optional fields default sensibly; see
 * field comments. Pass through unchanged from CLI flags / API params.
 */
export type EligibleMarketsQuery = {
  symbol?: string
  /** e.g. '15m', '5m'. When omitted, all timeframes are returned. */
  timeframe?: string
  converter: Converter
  readFrom: ReadFrom
  /** Inclusive lower bound. Defaults to TELONEX_DATASET_ELIGIBLE_FROM_MS. */
  fromMs?: number
  /** Inclusive upper bound. No default. */
  toMs?: number
  /** Restrict to this exact set of slugs (after eligibility filter). */
  slugs?: string[]
  /** Skip these slugs (useful for research / --all). */
  excludeSlugs?: string[]
  /** Defaults to true. Explicit slug lookups may opt out for diagnostics. */
  resolvedOnly?: boolean
  /** Cap the result count. Defaults to 1000 to match legacy behaviour. */
  limit?: number
  /** With `limit`, returns the LAST `limit` rows (newest by market_start_ms). */
  latest?: boolean
  /** Order by RAND() instead of market_start_ms ASC. Mutually exclusive with `latest`. */
  random?: boolean
}

type JoinedRow = {
  marketId: number
  slug: string
  symbol: string
  timeframe: string
  marketStartMs: number
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  resultId: string | null
  telonexStatus: string | null
  question: string | null
  startDateUs: number | null
  endDateUs: number | null
  priceToBeat: number | null
  gammaMetadataSyncedAt: Date | null
  localPath: string | null
  r2Url: string | null
}

function mustGetDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!db) {
    throw new Error('[db] getDb() returned null (unexpected)')
  }
  return db
}

function pickDataset(
  readFrom: ReadFrom,
  row: { localPath: string | null; r2Url: string | null },
): string | null {
  return readFrom === 'local' ? row.localPath : row.r2Url
}

function usToMs(us: number | null): number | null {
  if (us === null || !Number.isFinite(us)) return null
  return Math.trunc(us / 1000)
}

function toMarket(row: JoinedRow, readFrom: ReadFrom): Market {
  return {
    marketId: String(row.marketId),
    slug: row.slug,
    symbol: row.symbol,
    timeframe: row.timeframe,
    marketStartMs: row.marketStartMs,
    dataset: pickDataset(readFrom, row),
    outcome0: row.outcome0,
    outcome1: row.outcome1,
    assetId0: row.assetId0,
    assetId1: row.assetId1,
    resultId: row.resultId,
    telonexStatus: row.telonexStatus,
    question: row.question,
    startDateMs: usToMs(row.startDateUs),
    endDateMs: usToMs(row.endDateUs),
    priceToBeat: row.priceToBeat,
    gammaMetadataSyncedAt: row.gammaMetadataSyncedAt,
  }
}

function baseSelect() {
  const db = mustGetDb()
  return db
    .select({
      marketId: telonexMarkets.id,
      slug: telonexMarkets.slug,
      symbol: telonexMarkets.symbol,
      timeframe: telonexMarkets.timeframe,
      marketStartMs: telonexMarkets.marketStartMs,
      outcome0: telonexMarkets.outcome0,
      outcome1: telonexMarkets.outcome1,
      assetId0: telonexMarkets.assetId0,
      assetId1: telonexMarkets.assetId1,
      resultId: telonexMarkets.resultId,
      telonexStatus: telonexMarkets.telonexStatus,
      question: telonexMarkets.question,
      startDateUs: telonexMarkets.startDateUs,
      endDateUs: telonexMarkets.endDateUs,
      priceToBeat: telonexMarkets.priceToBeat,
      gammaMetadataSyncedAt: telonexMarkets.gammaMetadataSyncedAt,
      localPath: telonexMarketConversions.localPath,
      r2Url: telonexMarketConversions.r2Url,
    })
    .from(telonexMarkets)
    .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
}

/**
 * Build the WHERE clause shared by all eligibility queries. Kept private so
 * the eligibility definition has exactly one implementation.
 */
function buildEligibleWhere(opts: EligibleMarketsQuery): SQL {
  return and(
    ...buildTelonexEligibilityConditions(
      {
        markets: {
          slug: telonexMarkets.slug,
          symbol: telonexMarkets.symbol,
          timeframe: telonexMarkets.timeframe,
          marketStartMs: telonexMarkets.marketStartMs,
          telonexStatus: telonexMarkets.telonexStatus,
          resultId: telonexMarkets.resultId,
        },
        conversions: {
          converter: telonexMarketConversions.converter,
          status: telonexMarketConversions.status,
          localPath: telonexMarketConversions.localPath,
          r2Url: telonexMarketConversions.r2Url,
        },
      },
      { ...opts, fromMs: opts.fromMs ?? TELONEX_DATASET_ELIGIBLE_FROM_MS },
    ),
  )!
}

/**
 * Fetch eligible telonex markets, ordered `market_start_ms ASC` (or RAND() if
 * `random=true`). See EligibleMarketsQuery for the filter shape.
 */
export async function listEligibleTelonexMarkets(opts: EligibleMarketsQuery): Promise<Market[]> {
  if (opts.random && opts.latest) {
    throw new Error('[telonexMarkets] random and latest are mutually exclusive')
  }
  const where = buildEligibleWhere(opts)
  const orderBy = opts.random ? sql`RAND()` : asc(telonexMarkets.marketStartMs)

  let offset: number | undefined
  if (opts.latest && opts.limit !== undefined) {
    const db = mustGetDb()
    const countResult = await db
      .select({ count: count() })
      .from(telonexMarkets)
      .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
      .where(where)
    const total = countResult[0]?.count ?? 0
    offset = Math.max(0, total - opts.limit)
  }

  const queryBuilder = baseSelect()
    .where(where)
    .orderBy(orderBy)
    .limit(opts.limit ?? 1000)

  const results = (
    offset !== undefined ? await queryBuilder.offset(offset) : await queryBuilder
  ) as JoinedRow[]

  return results.map((r) => toMarket(r, opts.readFrom))
}

/**
 * Lightweight variant — returns only slugs in `market_start_ms ASC` order.
 * Coverage feature uses this to avoid hydrating full Market rows.
 */
export async function listEligibleTelonexSlugs(opts: EligibleMarketsQuery): Promise<string[]> {
  if (opts.random && opts.latest) {
    throw new Error('[telonexMarkets] random and latest are mutually exclusive')
  }
  const db = mustGetDb()
  const where = buildEligibleWhere(opts)
  const orderBy = opts.random ? sql`RAND()` : asc(telonexMarkets.marketStartMs)

  let offset: number | undefined
  if (opts.latest && opts.limit !== undefined) {
    const countResult = await db
      .select({ count: count() })
      .from(telonexMarkets)
      .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
      .where(where)
    const total = countResult[0]?.count ?? 0
    offset = Math.max(0, total - opts.limit)
  }

  const baseQ = db
    .select({ slug: telonexMarkets.slug })
    .from(telonexMarkets)
    .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
    .where(where)
    .orderBy(orderBy)
  const limited = opts.limit !== undefined ? baseQ.limit(opts.limit) : baseQ

  const rows = (offset !== undefined ? await limited.offset(offset) : await limited) as Array<{
    slug: string
  }>
  return rows.map((r) => r.slug)
}

/**
 * Count eligible telonex markets matching the filter. `limit`/`latest`/`random`
 * are ignored (they only affect what you get, not how many exist).
 */
export async function countEligibleTelonexMarkets(opts: EligibleMarketsQuery): Promise<number> {
  const db = mustGetDb()
  const where = buildEligibleWhere(opts)
  const result = await db
    .select({ count: count() })
    .from(telonexMarkets)
    .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
    .where(where)
  return result[0]?.count ?? 0
}

/**
 * Single-market lookup by slug, with eligibility constraints. Returns null
 * if not found OR not eligible under the requested converter/readFrom.
 */
export async function getMarketBySlug(
  slug: string,
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market | null> {
  const results = await listEligibleTelonexMarkets({
    converter: opts.converter,
    readFrom: opts.readFrom,
    slugs: [slug],
    // Skip the default eligibility-from floor: callers who hold a slug already
    // know they want this specific market regardless of date.
    fromMs: 0,
    resolvedOnly: false,
    limit: 1,
  })
  return results[0] ?? null
}

/**
 * Multi-market lookup by slugs. Skips the default eligibility-from floor
 * because callers passing explicit slugs already know what they want.
 */
export async function getMarketsBySlugs(
  slugs: string[],
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market[]> {
  if (slugs.length === 0) return []
  return listEligibleTelonexMarkets({
    converter: opts.converter,
    readFrom: opts.readFrom,
    slugs,
    fromMs: 0,
    resolvedOnly: false,
    limit: slugs.length,
  })
}

// -----------------------------------------------------------------------------
// Gamma eventMetadata backfill (price_to_beat / final_price)
// -----------------------------------------------------------------------------

/**
 * Rows that still need a Gamma eventMetadata fetch: never attempted
 * (`gamma_metadata_synced_at IS NULL`) within `[fromMs, toMs]`, oldest first.
 * No conversion join — the strike exists for every market Gamma knows,
 * converted or not.
 */
export async function listMarketsForGammaBackfill(opts: {
  fromMs: number
  toMs?: number
  limit: number
}): Promise<Array<{ slug: string; marketStartMs: number }>> {
  const db = mustGetDb()
  const conds: SQL[] = [
    sql`${telonexMarkets.gammaMetadataSyncedAt} IS NULL`,
    sql`${telonexMarkets.marketStartMs} >= ${opts.fromMs}`,
  ]
  if (opts.toMs !== undefined) conds.push(sql`${telonexMarkets.marketStartMs} <= ${opts.toMs}`)
  return db
    .select({ slug: telonexMarkets.slug, marketStartMs: telonexMarkets.marketStartMs })
    .from(telonexMarkets)
    .where(and(...conds))
    .orderBy(asc(telonexMarkets.marketStartMs))
    .limit(opts.limit)
}

/** Count of rows still pending a Gamma eventMetadata fetch (preflight). */
export async function countMarketsForGammaBackfill(opts: {
  fromMs: number
  toMs?: number
}): Promise<number> {
  const db = mustGetDb()
  const conds: SQL[] = [
    sql`${telonexMarkets.gammaMetadataSyncedAt} IS NULL`,
    sql`${telonexMarkets.marketStartMs} >= ${opts.fromMs}`,
  ]
  if (opts.toMs !== undefined) conds.push(sql`${telonexMarkets.marketStartMs} <= ${opts.toMs}`)
  const rows = await db
    .select({ count: count() })
    .from(telonexMarkets)
    .where(and(...conds))
  return rows[0]?.count ?? 0
}

/**
 * Gamma metadata for one slug, catalog-wide (no conversion join — recorded-mode
 * backtests need this too). Returns null when the slug isn't in the catalog.
 */
export async function getGammaMetadataBySlug(
  slug: string,
): Promise<{ priceToBeat: number | null; syncedAtMs: number | null } | null> {
  const db = mustGetDb()
  const rows = await db
    .select({
      priceToBeat: telonexMarkets.priceToBeat,
      gammaMetadataSyncedAt: telonexMarkets.gammaMetadataSyncedAt,
    })
    .from(telonexMarkets)
    .where(eq(telonexMarkets.slug, slug))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    priceToBeat: row.priceToBeat,
    syncedAtMs: row.gammaMetadataSyncedAt ? row.gammaMetadataSyncedAt.getTime() : null,
  }
}

/**
 * Record a Gamma eventMetadata fetch result. Always stamps
 * `gamma_metadata_synced_at` — null prices on a stamped row mean "Gamma has no
 * data for this market", which the backfill treats as final (no re-fetch).
 */
export async function updateGammaMetadata(
  slug: string,
  values: { priceToBeat: number | null; finalPrice: number | null },
): Promise<void> {
  const db = mustGetDb()
  await db
    .update(telonexMarkets)
    .set({
      priceToBeat: values.priceToBeat,
      finalPrice: values.finalPrice,
      gammaMetadataSyncedAt: new Date(),
    })
    .where(eq(telonexMarkets.slug, slug))
}
