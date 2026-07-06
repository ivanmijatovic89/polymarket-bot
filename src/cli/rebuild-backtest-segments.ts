/**
 * Rebuild per-segment stats for backtests (`backtest_run_segments`).
 *
 * Usage:
 *   tsx src/cli/rebuild-backtest-segments.ts --onlyMissing
 *   tsx src/cli/rebuild-backtest-segments.ts --batchSize 1000
 *   tsx src/cli/rebuild-backtest-segments.ts --where "strategy = 'foo'"
 *
 * Without --onlyMissing (or with --force) every backtest run matched by
 * --where (or all runs) is rewritten: existing segment rows for the run are
 * deleted and recomputed in a single transaction.
 */
import '../config/env.js'
import { asc, eq, sql } from 'drizzle-orm'
import { backtestRuns, closeDb, getDb } from '../db/index.js'
import { backtestRunSegments } from '../db/schema.js'
import { getBacktestRunById } from '../db/backtests.js'
import {
  computeBacktestSegments,
  slugTs,
  type SegmentRow,
} from '../backtest/stats/backtestSegments.js'

type CliArgs = {
  batchSize: number
  onlyMissing: boolean
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
const SEGMENT_INSERT_BATCH_SIZE = 500

function parseArgs(argv: string[]): CliArgs {
  let batchSize = DEFAULT_BATCH_SIZE
  let onlyMissing = false
  let force = false
  let where: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--onlyMissing' || arg === '--onlyNull') {
      onlyMissing = true
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
          `[rebuild-backtest-segments] --batchSize must be a positive integer, got: ${String(raw)}`,
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
          `[rebuild-backtest-segments] --batchSize must be a positive integer, got: ${String(raw)}`,
        )
      }
      batchSize = n
      continue
    }

    if (arg === '--where') {
      const raw = argv[i + 1]
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('[rebuild-backtest-segments] missing value for --where')
      }
      where = raw
      i += 1
      continue
    }

    if (arg.startsWith('--where=')) {
      const raw = arg.slice('--where='.length)
      if (!raw) {
        throw new Error('[rebuild-backtest-segments] missing value for --where')
      }
      where = raw
      continue
    }
  }

  return { batchSize, onlyMissing, force, ...(where ? { where } : {}) }
}

function getInitialCapital(raw: unknown, rowId: number, counters: Counters): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n)) return n

  counters.warnings += 1
  console.warn(
    `[rebuild-backtest-segments] id=${rowId} missing capitalInitial, default=${DEFAULT_INITIAL_CAPITAL}`,
  )
  return DEFAULT_INITIAL_CAPITAL
}

async function writeSegments(
  db: ReturnType<typeof getDb>,
  runId: number,
  segments: SegmentRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(backtestRunSegments).where(eq(backtestRunSegments.runId, runId))
    for (let start = 0; start < segments.length; start += SEGMENT_INSERT_BATCH_SIZE) {
      const chunk = segments.slice(start, start + SEGMENT_INSERT_BATCH_SIZE)
      if (chunk.length === 0) continue
      await tx.insert(backtestRunSegments).values(
        chunk.map((s) => ({
          runId,
          segmentKind: s.segmentKind,
          segmentKey: s.segmentKey,
          segmentOrd: s.segmentOrd,
          fromMs: s.fromMs,
          toMs: s.toMs,
          capitalInitial: String(s.stats.capitalInitial),
          capitalFinal: String(s.stats.capitalFinal),
          pnlTotal: String(s.stats.pnlTotal),
          totalFeesPaid: String(s.stats.totalFeesPaid),
          qualitySystem: s.stats.qualitySystem === null ? null : String(s.stats.qualitySystem),
          qualityTrade: s.stats.qualityTrade === null ? null : String(s.stats.qualityTrade),
          evPerMarketPlayed: String(s.stats.evPerMarketPlayed),
          evPerMarketTotal: String(s.stats.evPerMarketTotal),
          marketsTotal: s.stats.marketsTotal,
          marketsSkipped: s.stats.marketsSkipped,
          marketsNoInWindowActivity: s.stats.marketsNoInWindowActivity,
          marketsFlatWithTrades: s.stats.marketsFlatWithTrades,
          marketsPlayed: s.stats.marketsPlayed,
          marketsWon: s.stats.marketsWon,
          marketsLost: s.stats.marketsLost,
          winRate: String(s.stats.winRate),
          winRatePct: String(s.stats.winRatePct),
          tradesTotal: s.stats.tradesTotal,
          tradesMaker: s.stats.tradesMaker,
          tradesTaker: s.stats.tradesTaker,
          pnlAvgWin: String(s.stats.pnlAvgWin),
          pnlAvgLose: String(s.stats.pnlAvgLose),
          pnlMaxWin: String(s.stats.pnlMaxWin),
          pnlMaxLose: String(s.stats.pnlMaxLose),
          streakMaxWin: s.stats.streakMaxWin,
          streakMaxLose: s.stats.streakMaxLose,
          streakMaxWinPnl: String(s.stats.streakMaxWinPnl),
          streakMaxLosePnl: String(s.stats.streakMaxLosePnl),
          streakMaxSkipped: s.stats.streakMaxSkipped,
          durationTotalMs: s.stats.durationTotalMs,
          durationAvgMs: String(s.stats.durationAvgMs),
          durationWallClockMs: s.stats.durationWallClockMs,
        })),
      )
    }
  })
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
      if (args.onlyMissing && !args.force) {
        whereParts.push(
          sql`NOT EXISTS (SELECT 1 FROM ${backtestRunSegments} WHERE ${backtestRunSegments.runId} = ${backtestRuns.id})`,
        )
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
          console.warn(`[rebuild-backtest-segments] id=${row.id} has no market rows; skipping`)
          continue
        }

        const initialCapital = getInitialCapital(row.capitalInitial, row.id, counters)
        const withStartMs = detail.marketStats.map((m) => ({ ...m, marketStartMs: slugTs(m.slug) }))
        const segments = computeBacktestSegments(withStartMs, initialCapital)

        await writeSegments(db, row.id, segments)

        counters.updated += 1
      }

      lastId = rows[rows.length - 1]!.id

      console.log(
        `[rebuild-backtest-segments] batch=${batchIndex} processed=${counters.processed} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.errors}`,
      )
    }
  } finally {
    await closeDb()
  }

  console.log(
    `[rebuild-backtest-segments] done processed=${counters.processed} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.errors} warnings=${counters.warnings}`,
  )
}

run().catch((err) => {
  console.error('[rebuild-backtest-segments] failed', err)
  process.exitCode = 1
})
