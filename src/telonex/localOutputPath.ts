import path from 'node:path'

/**
 * Canonical on-disk location for a converted Telonex parquet.
 *
 * SINGLE SOURCE OF TRUTH for the converted-file local path. Both `telonex:convert`
 * (which writes the file) and `telonex:download-converted-r2-to-local` (which
 * pulls it back from R2) derive the path here so they can never drift.
 *
 * The `relative` form is also exactly what `telonex_market_conversions.local_path`
 * stores when convert runs with `--output local|both`, so a file fetched here is
 * found by a backtest run with `--read-from local`.
 *
 *   data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet
 */
export function localOutputPath(args: {
  converter: string
  symbol: string
  timeframe: string
  slug: string
}): { relative: string; absolute: string } {
  const relative = path.join(
    'data/events/telonex',
    args.converter,
    args.symbol,
    args.timeframe,
    `${args.slug}.parquet`,
  )
  return { relative, absolute: path.resolve(relative) }
}
