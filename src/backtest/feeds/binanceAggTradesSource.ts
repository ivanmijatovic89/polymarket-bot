import { DuckDBInstance } from '@duckdb/node-api'
import { fileExists } from '../../utils/fs.js'
import { aggTradesDayPath, utcDatesCovering } from '../../binance/paths.js'

/**
 * A time-indexed price series for as-of lookups, sorted by agg_trade_id
 * ascending (same-ms trades keep exchange order, so "latest at ts" resolves to
 * the highest agg id — matching live last-write-wins semantics).
 */
export type AsOfSeries = {
  tsMs: Float64Array
  value: Float64Array
  length: number
}

// One in-memory DuckDB per process; backtest worker children are
// single-concurrency forks, so this is at most one instance per child.
let dbPromise: Promise<DuckDBInstance> | undefined
function getDuckDb(): Promise<DuckDBInstance> {
  dbPromise ??= DuckDBInstance.create(':memory:')
  return dbPromise
}

function sqlQuote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`
}

/**
 * Load the historical Binance aggTrade prices covering
 * `[startMs - lookbackMs, endMs]` from the converted daily-dump parquet files.
 *
 * The series is SEEDED with the single latest trade before the range (when
 * one exists in the covered day files): live, the feeds store retains the
 * last received price indefinitely, so even a quiet gap longer than the
 * lookback must still produce a price at the first tick — without the seed,
 * replay would report the feed as absent where live would have served the
 * pre-gap price.
 *
 * Missing day files — and day files with zero trades up to the window end —
 * are HARD errors naming the exact downloader command: an opted-in backtest
 * silently running feed-less would recreate the exact live/replay divergence
 * this feature exists to eliminate.
 */
export async function loadBinanceAggTradesSeries(args: {
  pair: string
  startMs: number
  endMs: number
  lookbackMs: number
}): Promise<AsOfSeries> {
  const fromMs = args.startMs - args.lookbackMs
  const dates = utcDatesCovering(fromMs, args.endMs)

  const paths: string[] = []
  const missing: string[] = []
  for (const d of dates) {
    const p = aggTradesDayPath(args.pair, d)
    if (await fileExists(p)) paths.push(p)
    else missing.push(d)
  }
  if (missing.length > 0) {
    throw new Error(
      `[backtest:feeds] missing Binance aggTrades day file(s) for ${args.pair}: ${missing.join(', ')}. ` +
        `Worker machines: npm run binance:download-aggtrades-r2-to-local -- --pair ${args.pair} (pull from the R2 mirror). ` +
        `Producer machine: npm run binance:download-aggtrades -- --pair ${args.pair} ` +
        `--from ${missing[0]} --to ${missing[missing.length - 1]} (direct Binance download)`,
    )
  }

  const db = await getDuckDb()
  const conn = await db.connect()
  try {
    const fileList = paths.map(sqlQuote).join(', ')
    // Seed: the latest trade strictly before the range start (highest agg id,
    // since ids increase with time). Prepended in JS so the series stays
    // sorted regardless of SQL execution order.
    const seedResult = await conn.run(
      `SELECT ts_ms, price FROM read_parquet([${fileList}])
       WHERE ts_ms < ${Math.floor(fromMs)}
       ORDER BY agg_trade_id DESC LIMIT 1`,
    )
    const seedRow = seedResult.chunkCount > 0 ? seedResult.getChunk(0).getRows()[0] : undefined
    const result = await conn.run(
      `SELECT ts_ms, price FROM read_parquet([${fileList}])
       WHERE ts_ms BETWEEN ${Math.floor(fromMs)} AND ${Math.floor(args.endMs)}
       ORDER BY agg_trade_id`,
    )
    const tsChunks: Float64Array[] = []
    const pxChunks: Float64Array[] = []
    let total = 0
    if (seedRow) {
      tsChunks.push(Float64Array.of(Number(seedRow[0])))
      pxChunks.push(Float64Array.of(Number(seedRow[1])))
      total += 1
    }
    for (let c = 0; c < result.chunkCount; c++) {
      const rows = result.getChunk(c).getRows()
      const ts = new Float64Array(rows.length)
      const px = new Float64Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        ts[i] = Number(rows[i]?.[0])
        px[i] = Number(rows[i]?.[1])
      }
      tsChunks.push(ts)
      pxChunks.push(px)
      total += rows.length
    }
    if (total === 0) {
      // Files exist but contain no trades up to the window end — empty or
      // corrupt data. Same policy as missing files: hard error over a silent
      // feed-less replay.
      throw new Error(
        `[backtest:feeds] Binance aggTrades day file(s) for ${args.pair} contain no trades up to ` +
          `${new Date(args.endMs).toISOString()} (${dates.join(', ')}) — empty or corrupt day file(s)? ` +
          `Re-download on the producer with: npm run binance:download-aggtrades -- --pair ${args.pair} ` +
          `--from ${dates[0]} --to ${dates[dates.length - 1]} --force`,
      )
    }
    const tsMs = new Float64Array(total)
    const value = new Float64Array(total)
    let off = 0
    for (let i = 0; i < tsChunks.length; i++) {
      tsMs.set(tsChunks[i]!, off)
      value.set(pxChunks[i]!, off)
      off += tsChunks[i]!.length
    }
    return { tsMs, value, length: total }
  } finally {
    conn.closeSync()
  }
}
