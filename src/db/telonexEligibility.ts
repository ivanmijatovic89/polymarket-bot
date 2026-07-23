import { eq, gte, inArray, lte, notInArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { telonexDatasetMaxStartMs } from '../config/telonex.js'

// `local-or-download-from-r2-to-local` is treated like `r2` here (the `datasetNonEmpty` check below
// routes any non-`local` value to the r2_url gate).
export type TelonexEligibilityReadFrom = 'local' | 'r2' | 'local-or-download-from-r2-to-local'

export type TelonexEligibilityColumns = {
  markets: {
    slug: SQLWrapper
    symbol: SQLWrapper
    timeframe: SQLWrapper
    marketStartMs: SQLWrapper
    telonexStatus: SQLWrapper
    resultId: SQLWrapper
  }
  conversions: {
    converter: SQLWrapper
    status: SQLWrapper
    localPath: SQLWrapper
    r2Url: SQLWrapper
  }
}

export type TelonexEligibilityFilter = {
  converter: string
  readFrom: TelonexEligibilityReadFrom
  symbol?: string
  timeframe?: string
  fromMs: number
  toMs?: number
  slugs?: string[]
  excludeSlugs?: string[]
  /**
   * Defaults to true. Backtest coverage and batch selection should only use
   * resolved markets because final PnL cannot be computed without result_id.
   * Explicit slug diagnostics can opt out.
   */
  resolvedOnly?: boolean
}

export function buildTelonexEligibilityConditions(
  columns: TelonexEligibilityColumns,
  opts: TelonexEligibilityFilter,
): SQL[] {
  const datasetNonEmpty =
    opts.readFrom === 'local'
      ? sql`${columns.conversions.localPath} IS NOT NULL AND ${columns.conversions.localPath} <> ''`
      : sql`${columns.conversions.r2Url} IS NOT NULL AND ${columns.conversions.r2Url} <> ''`

  const conditions: SQL[] = [
    eq(columns.conversions.converter, opts.converter),
    eq(columns.conversions.status, 'done'),
    datasetNonEmpty,
    gte(columns.markets.marketStartMs, opts.fromMs),
    // Keep every eligibility consumer on the same publication-lag ceiling.
    // This helper is shared by the CLI/database layer and dashboard coverage;
    // applying the cap here prevents either surface from drifting.
    lte(
      columns.markets.marketStartMs,
      Math.min(opts.toMs ?? Number.POSITIVE_INFINITY, telonexDatasetMaxStartMs()),
    ),
  ]
  if (opts.symbol !== undefined) {
    conditions.push(eq(columns.markets.symbol, opts.symbol.toLowerCase()))
  }
  if (opts.timeframe !== undefined) {
    conditions.push(eq(columns.markets.timeframe, opts.timeframe))
  }
  if (opts.slugs !== undefined && opts.slugs.length > 0) {
    conditions.push(inArray(columns.markets.slug, opts.slugs))
  }
  if (opts.excludeSlugs !== undefined && opts.excludeSlugs.length > 0) {
    conditions.push(notInArray(columns.markets.slug, opts.excludeSlugs))
  }
  if (opts.resolvedOnly !== false) {
    conditions.push(eq(columns.markets.telonexStatus, 'resolved'))
    conditions.push(sql`${columns.markets.resultId} IS NOT NULL`)
  }
  return conditions
}
