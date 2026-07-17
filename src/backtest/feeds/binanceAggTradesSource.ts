import { promises as fs } from 'node:fs'
import { DuckDBInstance } from '@duckdb/node-api'
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Load the historical Binance aggTrade prices covering
 * `[startMs - lookbackMs, endMs]` from the converted daily-dump parquet files.
 *
 * Missing day files are a HARD error naming the exact downloader command —
 * an opted-in backtest silently running feed-less would recreate the exact
 * live/replay divergence this feature exists to eliminate.
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
        `Fetch them with: npm run binance:download-aggtrades -- --pair ${args.pair} ` +
        `--from ${missing[0]} --to ${missing[missing.length - 1]}`,
    )
  }

  const db = await getDuckDb()
  const conn = await db.connect()
  try {
    const fileList = paths.map(sqlQuote).join(', ')
    const result = await conn.run(
      `SELECT ts_ms, price FROM read_parquet([${fileList}])
       WHERE ts_ms BETWEEN ${Math.floor(fromMs)} AND ${Math.floor(args.endMs)}
       ORDER BY agg_trade_id`,
    )
    const tsChunks: Float64Array[] = []
    const pxChunks: Float64Array[] = []
    let total = 0
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
