import { access } from 'node:fs/promises'
import {
  aggTradesDayPath,
  defaultBinancePairForSymbol,
  utcDatesCovering,
} from '../../binance/paths.js'
import { assetIdForSymbol, cryptoPricesDayPath } from '../../telonex/cryptoPrices/paths.js'
import { getInMemoryDuckDb, sqlQuote } from '../../utils/duckdb.js'

export type CoverageFeed = 'binance' | 'chainlink'
export type CoverageWindow = { slug: string; startMs: number; endMs: number }
export type FeedCoverageMeasurement = CoverageWindow & {
  /** Largest timestamp gap clipped to the market window; null if any file could not be checked. */
  maxGapMs: number | null
  rows: number
  invalidRows: number
  issues: string[]
}
export type CoverageStatus = 'usable' | 'unusable' | 'unverified'

export function coverageStatus(
  result: FeedCoverageMeasurement,
  allowedGapMs: number,
): CoverageStatus {
  if (!Number.isFinite(allowedGapMs) || allowedGapMs <= 0) {
    throw new Error('allowed gap must be a positive number of milliseconds')
  }
  if (result.issues.length > 0 || result.maxGapMs === null) return 'unverified'
  return result.rows > 0 && result.invalidRows === 0 && result.maxGapMs <= allowedGapMs
    ? 'usable'
    : 'unusable'
}

export function summarizeFeedCoverage(results: FeedCoverageMeasurement[], allowedGapMs: number) {
  const counts = { usable: 0, unusable: 0, unverified: 0 }
  for (const result of results) counts[coverageStatus(result, allowedGapMs)]++
  return { allowedGapMs, total: results.length, ...counts }
}

/**
 * Read-only gap trial: scan each needed day once and return one aggregate per
 * market, never the complete tick stream. Binance uses trade time; Chainlink
 * uses round time, matching the existing loader's gap clock. This measures
 * timestamp coverage, not source-archive completeness or receive latency.
 */
export async function measureFeedCoverage(args: {
  feed: CoverageFeed
  symbol: string
  windows: CoverageWindow[]
  onDay?: (date: string, completed: number, total: number) => void
}): Promise<FeedCoverageMeasurement[]> {
  const results = args.windows.map((window) => ({
    ...window,
    maxGapMs: 0 as number | null,
    rows: 0,
    invalidRows: 0,
    issues: [] as string[],
  }))
  const cursors = args.windows.map((window) => window.startMs)
  const byDay = new Map<string, number[]>()
  const slugs = new Set<string>()
  for (const [index, window] of args.windows.entries()) {
    if (
      !Number.isSafeInteger(window.startMs) ||
      !Number.isSafeInteger(window.endMs) ||
      window.endMs <= window.startMs ||
      slugs.has(window.slug)
    ) {
      throw new Error(`invalid or duplicate market window: ${window.slug}`)
    }
    slugs.add(window.slug)
    for (const date of utcDatesCovering(window.startMs, window.endMs)) {
      const indices = byDay.get(date) ?? []
      indices.push(index)
      byDay.set(date, indices)
    }
  }
  if (results.length === 0) return results

  const pair = defaultBinancePairForSymbol(args.symbol)
  const assetId = assetIdForSymbol(args.symbol)
  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  let completed = 0
  try {
    for (const [date, indices] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const file =
        args.feed === 'binance' ? aggTradesDayPath(pair, date) : cryptoPricesDayPath(assetId, date)
      const dayStartMs = Date.parse(`${date}T00:00:00Z`)
      const dayEndMs = dayStartMs + 86_400_000
      try {
        await access(file)
        const timestamp =
          args.feed === 'binance'
            ? 'TRY_CAST(ts_ms AS BIGINT)'
            : 'TRY_CAST(timestamp_us AS BIGINT) // 1000'
        const feedValidity =
          args.feed === 'binance'
            ? 'TRUE'
            : `asset_id = ${sqlQuote(assetId)} AND TRY_CAST(server_timestamp_us AS BIGINT) > 0`
        await conn.run(`CREATE OR REPLACE TEMP TABLE coverage_rows AS
          SELECT ${timestamp} AS ts,
            COALESCE(TRY_CAST(price AS DOUBLE) > 0
              AND isfinite(TRY_CAST(price AS DOUBLE)) AND (${feedValidity}), FALSE) AS valid
          FROM read_parquet(${sqlQuote(file)})`)
        // An undatable row cannot be assigned to a particular window: conservatively
        // flag every requested window that depends on this day's file.
        const invalid = await conn.run(
          'SELECT count(*) FROM coverage_rows WHERE ts IS NULL OR ts <= 0',
        )
        const undatableRows = Number(invalid.getChunk(0).getRows()[0]![0])
        const windows = indices
          .map((index) => {
            const window = results[index]!
            return `(${index}, ${Math.max(window.startMs, dayStartMs)}, ${Math.min(window.endMs, dayEndMs)})`
          })
          .join(', ')
        const aggregates = await conn.run(`
          WITH windows(idx, start_ms, end_ms) AS (VALUES ${windows}),
          points AS (
            SELECT ts, valid, lag(ts) OVER (ORDER BY ts) AS prev_ts
            FROM coverage_rows WHERE ts > 0
          )
          SELECT w.idx, count(p.ts), min(p.ts), max(p.ts),
            count(*) FILTER (WHERE p.ts IS NOT NULL AND NOT p.valid),
            coalesce(max(CASE WHEN p.prev_ts >= w.start_ms THEN p.ts - p.prev_ts ELSE 0 END), 0)
          FROM windows w LEFT JOIN points p ON p.ts >= w.start_ms AND p.ts < w.end_ms
          GROUP BY w.idx ORDER BY w.idx`)
        for (let chunk = 0; chunk < aggregates.chunkCount; chunk++) {
          for (const row of aggregates.getChunk(chunk).getRows()) {
            const index = Number(row[0])
            const result = results[index]!
            const count = Number(row[1])
            result.rows += count
            result.invalidRows += Number(row[4]) + undatableRows
            if (count > 0) {
              result.maxGapMs = Math.max(
                result.maxGapMs ?? 0,
                Number(row[2]) - cursors[index]!,
                Number(row[5]),
              )
              cursors[index] = Number(row[3])
            }
          }
        }
      } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        const detail = error instanceof Error ? error.message : String(error)
        for (const index of indices) {
          results[index]!.issues.push(
            `${date}: ${missing ? 'missing local file' : `read error: ${detail}`}`,
          )
        }
      }
      args.onDay?.(date, ++completed, byDay.size)
    }
  } finally {
    conn.closeSync()
  }
  for (const [index, result] of results.entries()) {
    result.maxGapMs =
      result.issues.length > 0
        ? null
        : Math.max(result.maxGapMs ?? 0, result.endMs - cursors[index]!)
  }
  return results
}
