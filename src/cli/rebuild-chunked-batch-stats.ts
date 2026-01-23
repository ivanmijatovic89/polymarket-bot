/**
 * Rebuild chunked_batch_stats for backtests.
 *
 * Usage:
 *   tsx src/cli/rebuild-chunked-batch-stats.ts --onlyNull
 *   tsx src/cli/rebuild-chunked-batch-stats.ts --batchSize 1000
 *   tsx src/cli/rebuild-chunked-batch-stats.ts --where "strategy = 'foo'"
 */
import '../config/env.js'
import { asc, eq, sql } from 'drizzle-orm'
import { backtests, closeDb, getDb } from '../db/index.js'
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'
import type { MarketStats } from '../backtest/stats/marketStats.js'

type CliArgs = {
  batchSize: number
  onlyNull: boolean
  force: boolean
  where?: string
}

type Counters = {
  processed: number
  updated: number
  skipped: number
  errors: number
  warnings: number
}

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_INITIAL_CAPITAL = 100
const WINDOWS = [96]

function parseArgs(argv: string[]): CliArgs {
  let batchSize = DEFAULT_BATCH_SIZE
  let onlyNull = false
  let force = false
  let where: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--onlyNull') {
      onlyNull = true
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }

    if (arg === '--batchSize') {
      const raw = argv[i + 1]
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(`[rebuild-chunked-batch-stats] --batchSize must be a positive integer, got: ${String(raw)}`)
      }
      batchSize = n
      i += 1
      continue
    }

    if (arg.startsWith('--batchSize=')) {
      const raw = arg.slice('--batchSize='.length)
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(`[rebuild-chunked-batch-stats] --batchSize must be a positive integer, got: ${String(raw)}`)
      }
      batchSize = n
      continue
    }

    if (arg === '--where') {
      const raw = argv[i + 1]
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('[rebuild-chunked-batch-stats] missing value for --where')
      }
      where = raw
      i += 1
      continue
    }

    if (arg.startsWith('--where=')) {
      const raw = arg.slice('--where='.length)
      if (!raw) {
        throw new Error('[rebuild-chunked-batch-stats] missing value for --where')
      }
      where = raw
      continue
    }
  }

  return { batchSize, onlyNull, force, ...(where ? { where } : {}) }
}

function parseJsonValue<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

function getInitialCapital(
  batchStatsRaw: unknown,
  rowId: number,
  counters: Counters,
): number {
  const parsed = parseJsonValue<Record<string, unknown>>(batchStatsRaw)
  const raw = parsed?.capitalInitial
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n)) return n

  counters.warnings += 1
  console.warn(`[rebuild-chunked-batch-stats] id=${rowId} missing capitalInitial, default=${DEFAULT_INITIAL_CAPITAL}`)
  return DEFAULT_INITIAL_CAPITAL
}

function parseMarkets(marketStatsRaw: unknown): MarketStats[] | null {
  const parsed = parseJsonValue<unknown[]>(marketStatsRaw)
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const ok = parsed.every((m) => typeof (m as { slug?: unknown }).slug === 'string')
  if (!ok) return null

  return parsed as MarketStats[]
}

async function updateErrorRow(db: ReturnType<typeof getDb>, id: number, reason: string) {
  await db
    .update(backtests)
    .set({ chunkedBatchStats: { error: reason, version: 1 } })
    .where(eq(backtests.id, id))
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const db = getDb()

  const counters: Counters = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    warnings: 0,
  }

  let lastId = 0
  let batchIndex = 0

  try {
    while (true) {
      const whereParts = [sql`${backtests.id} > ${lastId}`]
      if (args.onlyNull && !args.force) whereParts.push(sql`${backtests.chunkedBatchStats} is null`)
      if (args.where) whereParts.push(sql.raw(`(${args.where})`))
      const whereSql = whereParts.length === 1 ? whereParts[0] : sql.join(whereParts, sql` AND `)

      const rows = await db
        .select({
          id: backtests.id,
          marketStats: backtests.marketStats,
          batchStats: backtests.batchStats,
        })
        .from(backtests)
        .where(whereSql)
        .orderBy(asc(backtests.id))
        .limit(args.batchSize)

      if (rows.length === 0) break

      batchIndex += 1

      for (const row of rows) {
        counters.processed += 1

        const markets = parseMarkets(row.marketStats)
        if (!markets) {
          counters.errors += 1
          await updateErrorRow(db, row.id, 'invalid market_stats')
          counters.updated += 1
          continue
        }

        const initialCapital = getInitialCapital(row.batchStats, row.id, counters)
        const chunked = computeChunkedBatchStats(markets, initialCapital, WINDOWS)

        await db
          .update(backtests)
          .set({ chunkedBatchStats: chunked })
          .where(eq(backtests.id, row.id))

        counters.updated += 1
      }

      lastId = rows[rows.length - 1]!.id

      console.log(
        `[rebuild-chunked-batch-stats] batch=${batchIndex} processed=${counters.processed} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.errors}`,
      )
    }
  } finally {
    await closeDb()
  }

  console.log(
    `[rebuild-chunked-batch-stats] done processed=${counters.processed} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.errors} warnings=${counters.warnings}`,
  )
}

run().catch((err) => {
  console.error('[rebuild-chunked-batch-stats] failed', err)
  process.exitCode = 1
})
