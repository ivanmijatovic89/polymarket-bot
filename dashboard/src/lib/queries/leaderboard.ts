import { and, count, countDistinct, desc, gte, isNotNull, max, sql, sum } from 'drizzle-orm'
import { getDb } from '../db'
import { backtestRunMarkets } from '../schema'

export type LeaderboardRange = '24h' | '7d' | 'all'

export type LeaderboardRow = {
  machineId: string
  marketsDone: number
  eventsTotal: number
  workerSeconds: number
  /** `eventsTotal / workerSeconds`. Null when workerSeconds is 0 (avoids div-by-zero). */
  eventsPerWorkerSec: number | null
  lastActiveMs: number | null
  commitVersions: number
}

function rangeStartMs(range: LeaderboardRange): number | null {
  const now = Date.now()
  switch (range) {
    case '24h':
      return now - 24 * 60 * 60 * 1000
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000
    case 'all':
      return null
  }
}

/**
 * Aggregates `backtest_run_markets` by `machine_id`. Pure SQL — does not
 * touch Redis. Rows with `machine_id IS NULL` (legacy data from before
 * migration 0015) are excluded.
 */
export async function listLeaderboard(range: LeaderboardRange): Promise<LeaderboardRow[]> {
  const db = getDb()
  const startMs = rangeStartMs(range)

  const where = startMs === null
    ? isNotNull(backtestRunMarkets.machineId)
    : and(
        isNotNull(backtestRunMarkets.machineId),
        gte(backtestRunMarkets.finishedAtMs, startMs),
      )

  const rows = await db
    .select({
      machineId: backtestRunMarkets.machineId,
      marketsDone: count(),
      eventsTotal: sum(backtestRunMarkets.eventsProcessed),
      // Cast to UNSIGNED so MySQL doesn't promote `int` durationMs to a
      // signed bigint we'd then have to coerce on the JS side.
      workerMs: sum(backtestRunMarkets.durationMs),
      lastActiveMs: max(backtestRunMarkets.finishedAtMs),
      commitVersions: countDistinct(backtestRunMarkets.commitSha),
    })
    .from(backtestRunMarkets)
    .where(where)
    .groupBy(backtestRunMarkets.machineId)
    .orderBy(desc(sql`SUM(${backtestRunMarkets.eventsProcessed})`))

  return rows
    .filter((r): r is typeof r & { machineId: string } => r.machineId !== null)
    .map((r) => {
      const eventsTotal = Number(r.eventsTotal ?? 0)
      const workerMs = Number(r.workerMs ?? 0)
      const workerSeconds = workerMs / 1000
      return {
        machineId: r.machineId,
        marketsDone: Number(r.marketsDone ?? 0),
        eventsTotal,
        workerSeconds,
        eventsPerWorkerSec: workerSeconds > 0 ? eventsTotal / workerSeconds : null,
        lastActiveMs: r.lastActiveMs !== null ? Number(r.lastActiveMs) : null,
        commitVersions: Number(r.commitVersions ?? 0),
      }
    })
}
