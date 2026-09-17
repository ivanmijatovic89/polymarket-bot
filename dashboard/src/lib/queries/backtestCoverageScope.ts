import {
  symbolFromSlug,
  timeframeFromSlug,
  windowFromSlug,
} from '../../../../src/polymarket/upDownSlugWindow'

type Scope = { symbol: string; timeframe: string }

/** Resolve display scope without changing the run's persisted metadata or selection. */
export function resolveCoverageScope(run: {
  symbol: string | null
  timeframe: string | null
  slugs: unknown
}): Scope | null {
  if (run.symbol !== null && run.timeframe !== null) {
    return { symbol: run.symbol, timeframe: run.timeframe }
  }
  if (!Array.isArray(run.slugs) || run.slugs.length === 0) return null

  // Use every requested slug, including failed markets. Inferring from only
  // successful rows could misclassify a mixed selection as one market series.
  let scope: Scope | null = null
  for (const slug of run.slugs) {
    if (typeof slug !== 'string' || windowFromSlug(slug) === null) return null
    const symbol = symbolFromSlug(slug)
    const timeframe = timeframeFromSlug(slug)
    if (symbol === null || timeframe === null) return null
    if (scope && (scope.symbol !== symbol || scope.timeframe !== timeframe)) return null
    scope = { symbol, timeframe }
  }
  if (run.symbol !== null && run.symbol !== scope?.symbol) return null
  // Slug-selected runs historically store the CLI's default timeframe (15m),
  // so infer both fields together when the explicit symbol is absent.
  return scope
}
