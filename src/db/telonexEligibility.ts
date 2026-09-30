import { eq, gte, inArray, lte, notInArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { telonexDatasetMaxStartMs } from '../config/telonex.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { symbolFromSlug } from '../polymarket/upDownSlugWindow.js'

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
    binanceUsable: SQLWrapper
    chainlinkUsable: SQLWrapper
    priceToBeat: SQLWrapper
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
  /** Effective request from the strategy's active plugin set. Omitted = no feed gates. */
  requiredFeeds?: ExternalFeedsRequestConfig
}

/** Saved flags certify the market's own feeds, never another asset's history. */
function validateFeedSymbols(opts: TelonexEligibilityFilter): void {
  const binance = opts.requiredFeeds?.binanceWsSpotPrice?.symbol?.trim().toLowerCase()
  const chainlink = opts.requiredFeeds?.rtdsCryptoPrices?.chainlinkSymbols?.[0]
    ?.trim()
    .toLowerCase()
  if (!binance && !chainlink) return
  const symbols = opts.symbol ? [opts.symbol.toLowerCase()] : (opts.slugs ?? []).map(symbolFromSlug)
  if (
    symbols.length === 0 ||
    symbols.some(
      (symbol) =>
        !symbol ||
        (binance && binance !== `${symbol}usdt`) ||
        (chainlink && chainlink !== `${symbol}/usd`),
    )
  ) {
    throw new Error(
      'Saved feed checks cover each market’s own Binance USDT and Chainlink USD feeds. Cross-asset requests are not supported; specify matching market symbols/slugs.',
    )
  }
}

export function buildTelonexEligibilityConditions(
  columns: TelonexEligibilityColumns,
  opts: TelonexEligibilityFilter,
): SQL[] {
  validateFeedSymbols(opts)
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
  conditions.push(...buildTelonexFeedConditions(columns, opts))
  return conditions
}

export function buildTelonexFeedConditions(
  columns: TelonexEligibilityColumns,
  opts: Pick<TelonexEligibilityFilter, 'requiredFeeds'>,
): SQL[] {
  const conditions: SQL[] = []
  if (opts.requiredFeeds?.binanceWsSpotPrice) {
    conditions.push(eq(columns.markets.binanceUsable, true))
  }
  // Replay loads Chainlink for any RTDS request; RTDS Binance stays unsupported.
  if (opts.requiredFeeds?.rtdsCryptoPrices) {
    conditions.push(eq(columns.markets.chainlinkUsable, true))
  }
  if (opts.requiredFeeds?.polymarketPriceToBeat?.enabled === true) {
    conditions.push(sql`${columns.markets.priceToBeat} IS NOT NULL`)
  }
  return conditions
}

export type TelonexEligibilitySummary = {
  total: number
  eligible: number
  binanceUnusable: number
  binanceUnverified: number
  chainlinkUnusable: number
  chainlinkUnverified: number
  priceToBeatMissing: number
}

/** Saved with a run so coverage never needs to execute strategy code in the dashboard. */
export type TelonexFeedEligibility = {
  version: 1
  maxGapMs: 10000
  requiredFeeds: ExternalFeedsRequestConfig
  summary: TelonexEligibilitySummary
}
