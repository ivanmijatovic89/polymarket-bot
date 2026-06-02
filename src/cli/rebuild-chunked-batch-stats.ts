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
import { backtestRuns, closeDb, getDb } from '../db/index.js'
import { getBacktestRunById } from '../db/backtests.js'
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'

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
        throw new Error(
          `[rebuild-chunked-batch-stats] --batchSize must be a positive integer, got: ${String(raw)}`,
        )
      }
      batchSize = n
      i += 1
      continue
    }

    if (arg.startsWith('--batchSize=')) {
      const raw = arg.slice('--batchSize='.length)
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(
          `[rebuild-chunked-batch-stats] --batchSize must be a positive integer, got: ${String(raw)}`,
        )
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

function getInitialCapital(raw: unknown, rowId: number, counters: Counters): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n)) return n

  counters.warnings += 1
  console.warn(
    `[rebuild-chunked-batch-stats] id=${rowId} missing capitalInitial, default=${DEFAULT_INITIAL_CAPITAL}`,
  )
  return DEFAULT_INITIAL_CAPITAL
}

async function updateErrorRow(db: ReturnType<typeof getDb>, id: number, reason: string) {
  await db
    .update(backtestRuns)
    .set({ chunkedBatchStats: { error: reason, version: 1 } })
    .where(eq(backtestRuns.id, id))
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
      const whereParts = [sql`${backtestRuns.id} > ${lastId}`]
      if (args.onlyNull && !args.force) {
        whereParts.push(sql`${backtestRuns.chunkedBatchStats} is null`)
      }
      if (args.where) whereParts.push(sql.raw(`(${args.where})`))
      const whereSql = whereParts.length === 1 ? whereParts[0] : sql.join(whereParts, sql` AND `)

      const rows = await db
        .select({
          id: backtestRuns.id,
          capitalInitial: backtestRuns.capitalInitial,
        })
        .from(backtestRuns)
        .where(whereSql)
        .orderBy(asc(backtestRuns.id))
        .limit(args.batchSize)

      if (rows.length === 0) break

      batchIndex += 1

      for (const row of rows) {
        counters.processed += 1

        const detail = await getBacktestRunById(row.id)
        if (!detail || detail.marketStats.length === 0) {
          counters.errors += 1
          await updateErrorRow(db, row.id, 'invalid market rows')
          counters.updated += 1
          continue
        }

        const initialCapital = getInitialCapital(row.capitalInitial, row.id, counters)
        const chunked = computeChunkedBatchStats(detail.marketStats, initialCapital, WINDOWS)

        await db
          .update(backtestRuns)
          .set({ chunkedBatchStats: chunked })
          .where(eq(backtestRuns.id, row.id))

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
