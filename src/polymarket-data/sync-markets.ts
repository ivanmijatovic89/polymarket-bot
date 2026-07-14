#!/usr/bin/env tsx
/**
 * polymarket-data sync-markets: build/refresh the catalog of crypto up/down
 * markets in `polymarket_markets` by paging every Gamma series in
 * `marketSeries.ts`.
 *
 * Stage 1 of the pipeline. Later stages (positions, trades, activity) only ever
 * read markets from this table — nothing downstream talks to Gamma.
 *
 * Incremental by construction: each (symbol, timeframe) resumes from the newest
 * `market_end_ms` already stored (minus an overlap, so an in-flight market gets
 * refreshed once it closes) and walks forward to now. Lower
 * POLYMARKET_DATA_BACKFILL_FROM and re-run to extend history backwards — older
 * markets simply appear as `pending`.
 *
 * Usage:
 *   npm run polymarket-data:sync-markets -- [--symbol btc] [--timeframe 15m]
 *                                           [--from 2026-07-01] [--to 2026-07-03]
 *                                           [--full] [--dry-run]
 */

import '../config/env.js'
import { sql } from 'drizzle-orm'
import { getDb, closeDb, polymarketMarkets } from '../db/index.js'
import {
  POLYMARKET_DATA_BACKFILL_FROM_MS,
  POLYMARKET_DATA_GAMMA_RPS,
} from '../config/polymarketData.js'
import { RateLimiter } from './rateLimiter.js'
import { fetchSeriesMarkets, type CatalogMarket } from './gammaSeries.js'
import {
  isTimeframe,
  selectSeries,
  TIMEFRAME_MS,
  type MarketSeries,
  type Timeframe,
} from './marketSeries.js'

const LABEL = '[polymarket-data:sync-markets]'
const INSERT_BATCH = 200

// Re-scan this far behind the newest known market so a market that was still
// open on the previous run gets its final `closed` / volume / resolution.
const RESUME_OVERLAP_MS = 24 * 60 * 60 * 1000

type Args = {
  symbol?: string
  timeframe?: Timeframe
  fromMs?: number
  toMs?: number
  full: boolean
  dryRun: boolean
}

function parseDate(raw: string, flag: string): number {
  const ms = new Date(raw).getTime()
  if (!Number.isFinite(ms)) throw new Error(`${LABEL} ${flag} is not a valid date: ${raw}`)
  return ms
}

function parseArgs(argv: string[]): Args {
  const out: Args = { full: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') out.symbol = (argv[++i] ?? '').toLowerCase()
    else if (a === '--timeframe') {
      const tf = argv[++i] ?? ''
      if (!isTimeframe(tf)) throw new Error(`${LABEL} unknown --timeframe: ${tf}`)
      out.timeframe = tf
    } else if (a === '--from') out.fromMs = parseDate(argv[++i] ?? '', '--from')
    else if (a === '--to') out.toMs = parseDate(argv[++i] ?? '', '--to')
    else if (a === '--full') out.full = true
    else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

/**
 * Where to resume this series from: just behind the newest market we already
 * have, or the backfill floor when the series is new here. `--from` overrides;
 * `--full` ignores stored state and rescans from the floor.
 */
async function resolveFromMs(series: MarketSeries, args: Args): Promise<number> {
  if (args.fromMs !== undefined) return args.fromMs
  if (args.full) return POLYMARKET_DATA_BACKFILL_FROM_MS

  const db = getDb()
  const rows = await db
    .select({ maxStart: sql<number | null>`MAX(${polymarketMarkets.marketStartMs})` })
    .from(polymarketMarkets)
    .where(
      sql`${polymarketMarkets.symbol} = ${series.symbol} AND ${polymarketMarkets.timeframe} = ${series.timeframe}`,
    )
  const maxStart = rows[0]?.maxStart ?? null
  if (maxStart === null) return POLYMARKET_DATA_BACKFILL_FROM_MS
  return Math.max(POLYMARKET_DATA_BACKFILL_FROM_MS, Number(maxStart) - RESUME_OVERLAP_MS)
}

function toRow(m: CatalogMarket) {
  return {
    conditionId: m.conditionId,
    slug: m.slug,
    eventId: m.eventId,
    seriesId: m.seriesId,
    symbol: m.symbol,
    timeframe: m.timeframe,
    marketStartMs: m.marketStartMs,
    marketEndMs: m.marketEndMs,
    question: m.question,
    outcomes: m.outcomes,
    resolvedOutcome: m.resolvedOutcome,
    closed: m.closed,
    volumeGamma: m.volumeGamma,
    liquidityGamma: m.liquidityGamma,
    assetId0: m.assetId0,
    assetId1: m.assetId1,
    rawJson: m.rawJson,
  }
}

/**
 * Upsert a batch, returning the number of rows the server touched. On conflict
 * only the *mutable* Gamma fields are refreshed — sync state columns
 * (trades_status, positions_status, …) are never touched, so re-running the
 * catalog can't reset work the later stages already did.
 *
 * The return value is MySQL's `affectedRows`, which counts 1 per insert and 2
 * per changed row — it is a "touched" signal, not a row count.
 */
async function upsertBatch(rows: CatalogMarket[]): Promise<number> {
  if (rows.length === 0) return 0
  const db = getDb()
  const res = await db
    .insert(polymarketMarkets)
    .values(rows.map(toRow))
    .onDuplicateKeyUpdate({
      set: {
        closed: sql`VALUES(closed)`,
        resolvedOutcome: sql`VALUES(resolved_outcome)`,
        volumeGamma: sql`VALUES(volume_gamma)`,
        liquidityGamma: sql`VALUES(liquidity_gamma)`,
        assetId0: sql`VALUES(asset_id_0)`,
        assetId1: sql`VALUES(asset_id_1)`,
        question: sql`VALUES(question)`,
        outcomes: sql`VALUES(outcomes)`,
        marketStartMs: sql`VALUES(market_start_ms)`,
        marketEndMs: sql`VALUES(market_end_ms)`,
        rawJson: sql`VALUES(raw_json)`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
  // mysql2 reports affectedRows = 1 per insert, 2 per update (1 if unchanged).
  const affected = Array.isArray(res)
    ? ((res[0] as { affectedRows?: number })?.affectedRows ?? 0)
    : 0
  return affected
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(0)}s`
}

function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)))
  for (const r of rows) {
    console.log(
      `${LABEL}   ` +
        r
          .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!)))
          .join('  '),
    )
  }
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const args = parseArgs(process.argv.slice(2))

  const seriesList = selectSeries({
    ...(args.symbol ? { symbol: args.symbol } : {}),
    ...(args.timeframe ? { timeframe: args.timeframe } : {}),
  })
  if (seriesList.length === 0) {
    throw new Error(`${LABEL} no series match symbol=${args.symbol} timeframe=${args.timeframe}`)
  }

  const toMs = args.toMs ?? Date.now()
  const limiter = new RateLimiter(POLYMARKET_DATA_GAMMA_RPS)
  const ac = new AbortController()
  const onSignal = () => {
    console.log(`${LABEL} shutting down…`)
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  console.log(
    `${LABEL} series=${seriesList.length} to=${new Date(toMs).toISOString()} ` +
      `floor=${new Date(POLYMARKET_DATA_BACKFILL_FROM_MS).toISOString()} dry-run=${args.dryRun}`,
  )

  const table: string[][] = [['series', 'from', 'fetched', 'affected']]
  let totalFetched = 0
  let totalWritten = 0

  for (const series of seriesList) {
    const fromMs = await resolveFromMs(series, args)
    if (fromMs >= toMs) {
      table.push([`${series.symbol}-${series.timeframe}`, 'up-to-date', '0', '0'])
      continue
    }

    // Gamma's only working time filters are on endDate; a market's end is its
    // start + timeframe, so shift the window to keep `--from` a *start* bound.
    const endFromMs = fromMs + TIMEFRAME_MS[series.timeframe]
    const endToMs = toMs + TIMEFRAME_MS[series.timeframe]

    let fetched = 0
    let written = 0
    let buffer: CatalogMarket[] = []

    for await (const market of fetchSeriesMarkets(series, endFromMs, endToMs, {
      limiter,
      signal: ac.signal,
      label: LABEL,
    })) {
      if (market.marketStartMs < POLYMARKET_DATA_BACKFILL_FROM_MS) continue
      fetched += 1
      if (args.dryRun) continue
      buffer.push(market)
      if (buffer.length >= INSERT_BATCH) {
        written += await upsertBatch(buffer)
        buffer = []
      }
    }
    if (buffer.length > 0) written += await upsertBatch(buffer)

    totalFetched += fetched
    totalWritten += written
    table.push([
      `${series.symbol}-${series.timeframe}`,
      new Date(fromMs).toISOString().slice(0, 10),
      String(fetched),
      String(written),
    ])
    console.log(
      `${LABEL} ${series.symbol}-${series.timeframe}: fetched=${fetched} written=${written}`,
    )
  }

  table.push(['TOTAL', '', String(totalFetched), String(totalWritten)])
  printTable(table)
  console.log(
    `${LABEL} done fetched=${totalFetched} affected_rows=${totalWritten} in ${fmtMs(Date.now() - t0)}` +
      (args.dryRun ? ' (dry-run: no writes)' : ''),
  )
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
