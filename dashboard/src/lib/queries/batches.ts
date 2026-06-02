import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { backtestRunFailures, backtestRunMarkets, backtestRuns } from '../schema'
import { aggregateJobId, getAggregateQueue, getMarketQueue } from '../queue'

export type ActiveBatchSummary = {
  batchUid: string
  strategy: string
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  parentState: string | undefined
}

/**
 * Fetches ALL currently-active market jobs, paginating until exhausted,
 * and groups counts by batchUid prefix. Used by both `listActiveBatches`
 * (called once per request, shared across parents) and
 * `getActiveBatchDetail` (single-parent path).
 *
 * Pagination matters: BullMQ's `getJobs(['active'], 0, 200)` silently caps
 * at 200; with concurrency × #parallel-batches > 200 the per-batch count
 * would be undercounted and `waitingChildren = unprocessed - active`
 * inflated. We walk in 200-row pages until a short page is returned.
 */
async function countActiveChildrenByBatch(): Promise<Map<string, number>> {
  const queue = getMarketQueue()
  const pageSize = 200
  const counts = new Map<string, number>()
  let start = 0
  // Hard ceiling so a runaway queue can't lock the dashboard request — at
  // ~50k active jobs something is very wrong and we should bail anyway.
  const maxScanned = 50_000
  while (start < maxScanned) {
    const page = await queue.getJobs(['active'], start, start + pageSize - 1)
    if (page.length === 0) break
    for (const j of page) {
      const id = j?.id
      if (typeof id !== 'string') continue
      const m = id.match(/^(.+)-m-\d+$/)
      if (!m) continue
      const uid = m[1]
      counts.set(uid, (counts.get(uid) ?? 0) + 1)
    }
    if (page.length < pageSize) break
    start += pageSize
  }
  return counts
}

/**
 * Counts active children for a single batchUid. Kept as a convenience for
 * the single-parent detail path; `listActiveBatches` uses the grouped
 * version directly to avoid N redundant scans.
 */
export async function countActiveChildrenForBatch(batchUid: string): Promise<number> {
  const all = await countActiveChildrenByBatch()
  return all.get(batchUid) ?? 0
}

export async function listActiveBatches(): Promise<ActiveBatchSummary[]> {
  const agg = getAggregateQueue()
  const jobs = await agg.getJobs(['waiting-children', 'waiting', 'active', 'delayed'], 0, 100)
  // Fetch the active-children count ONCE for all batches, then look up
  // per-parent below. Previously this was called inside the loop, causing
  // an N×scan-of-200-jobs hot path on every dashboard poll.
  const activeByBatch = await countActiveChildrenByBatch()
  const out: ActiveBatchSummary[] = []
  for (const job of jobs) {
    if (!job) continue
    const data = job.data as {
      batchUid?: string
      totalMarkets?: number
      insertMeta?: { strategy?: string }
    }
    const batchUid = data.batchUid ?? job.id ?? 'unknown'
    const totalMarkets = data.totalMarkets ?? 0
    const dependencies = await job.getDependenciesCount({ processed: true, unprocessed: true })
    const state = await job.getState()

    const failedChildrenValues = await job.getFailedChildrenValues()
    const failedChildren = Object.keys(failedChildrenValues).length
    const processedTotal = dependencies.processed ?? 0
    const completedChildren = Math.max(0, processedTotal - failedChildren)
    const unprocessedTotal = dependencies.unprocessed ?? 0
    const activeChildren = activeByBatch.get(batchUid) ?? 0
    const waitingChildren = Math.max(0, unprocessedTotal - activeChildren)

    out.push({
      batchUid,
      strategy: data.insertMeta?.strategy ?? 'unknown',
      totalMarkets,
      waitingChildren,
      activeChildren,
      completedChildren,
      failedChildren,
      parentState: state,
    })
  }
  return out
}

export type HistoricalBatch = {
  batchUid: string
  strategy: string
  comment: string | null
  pnlTotal: number
  winRatePct: number
  tradesTotal: number
  marketsTotal: number
  marketsPlayed: number
  createdAt: Date
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function mapRunSummary(run: typeof backtestRuns.$inferSelect) {
  return {
    ...run,
    capitalInitial: toNumber(run.capitalInitial),
    capitalFinal: toNumber(run.capitalFinal),
    pnlTotal: toNumber(run.pnlTotal),
    totalFeesPaid: toNumber(run.totalFeesPaid),
    qualitySystem: run.qualitySystem === null ? null : toNumber(run.qualitySystem),
    qualityTrade: run.qualityTrade === null ? null : toNumber(run.qualityTrade),
    evPerMarketPlayed: toNumber(run.evPerMarketPlayed),
    evPerMarketTotal: toNumber(run.evPerMarketTotal),
    winRate: toNumber(run.winRate),
    winRatePct: toNumber(run.winRatePct),
    pnlAvgWin: toNumber(run.pnlAvgWin),
    pnlAvgLose: toNumber(run.pnlAvgLose),
    pnlMaxWin: toNumber(run.pnlMaxWin),
    pnlMaxLose: toNumber(run.pnlMaxLose),
    streakMaxWinPnl: toNumber(run.streakMaxWinPnl),
    streakMaxLosePnl: toNumber(run.streakMaxLosePnl),
  }
}

export async function listHistoricalBatches(limit: number): Promise<HistoricalBatch[]> {
  const db = getDb()
  const rows = await db
    .select({
      batchUid: backtestRuns.batchUid,
      strategy: backtestRuns.strategy,
      comment: backtestRuns.comment,
      pnlTotal: backtestRuns.pnlTotal,
      winRatePct: backtestRuns.winRatePct,
      tradesTotal: backtestRuns.tradesTotal,
      marketsTotal: backtestRuns.marketsTotal,
      marketsPlayed: backtestRuns.marketsPlayed,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .orderBy(desc(backtestRuns.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    ...row,
    pnlTotal: toNumber(row.pnlTotal),
    winRatePct: toNumber(row.winRatePct),
  }))
}

export async function getBatchDetail(batchUid: string) {
  const db = getDb()
  const [run] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
    .limit(1)
  if (!run) return null

  const [marketRows, failureRows] = await Promise.all([
    db
      .select()
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, run.id))
      .orderBy(asc(backtestRunMarkets.idx)),
    db
      .select()
      .from(backtestRunFailures)
      .where(eq(backtestRunFailures.runId, run.id))
      .orderBy(asc(backtestRunFailures.idx)),
  ])

  return {
    ...mapRunSummary(run),
    marketStats: marketRows.map((m) => ({
      marketId: m.marketId,
      slug: m.slug,
      finalOutcome: m.finalOutcome,
      pnl: toNumber(m.pnl),
      tradeCount: m.tradeCount,
      tradeAsMaker: m.tradeAsMaker,
      tradeAsTaker: m.tradeAsTaker,
      feesPaid: toNumber(m.feesPaid),
      avgEntryPriceUp: m.avgEntryPriceUp === null ? null : toNumber(m.avgEntryPriceUp),
      avgEntryPriceDown: m.avgEntryPriceDown === null ? null : toNumber(m.avgEntryPriceDown),
      upShares: toNumber(m.upShares),
      downShares: toNumber(m.downShares),
      mergableShares: toNumber(m.mergableShares),
      cost: toNumber(m.cost),
      splitCost: toNumber(m.splitCost),
      intentMeta: m.intentMeta,
      ...(m.skipReason ? { skipReason: m.skipReason } : {}),
      ...(m.workerName && m.durationMs !== null && m.eventsProcessed !== null
        ? {
            execution: {
              workerName: m.workerName,
              durationMs: m.durationMs,
              eventsProcessed: m.eventsProcessed,
            },
          }
        : {}),
    })),
    failedMarkets: failureRows.map((f) => ({
      jobId: f.jobId ?? undefined,
      idx: f.idx,
      slug: f.slug,
      reason: f.reason,
    })),
  }
}

/**
 * Active batch live state from BullMQ (when the aggregate job still exists),
 * or null if no such job (probably already finalized to MySQL).
 */
export type ActiveBatchDetail = {
  batchUid: string
  parentState: string
  strategy: string
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  failedChildrenValues: Record<string, unknown>
  comment: string | null
}

export async function getActiveBatchDetail(batchUid: string): Promise<ActiveBatchDetail | null> {
  const parent = await getAggregateQueue().getJob(aggregateJobId(batchUid))
  if (!parent) return null
  const state = await parent.getState()
  const dependencies = await parent.getDependenciesCount({ processed: true, unprocessed: true })
  const failedChildrenValues = await parent.getFailedChildrenValues()
  const failedChildren = Object.keys(failedChildrenValues).length
  const completedChildren = Math.max(0, (dependencies.processed ?? 0) - failedChildren)
  const activeChildren = await countActiveChildrenForBatch(batchUid)
  const data = parent.data as {
    totalMarkets?: number
    insertMeta?: { strategy?: string; comment?: string | null }
  }
  return {
    batchUid,
    parentState: state,
    strategy: data.insertMeta?.strategy ?? 'unknown',
    totalMarkets: data.totalMarkets ?? 0,
    waitingChildren: Math.max(0, (dependencies.unprocessed ?? 0) - activeChildren),
    activeChildren,
    completedChildren,
    failedChildren,
    failedChildrenValues,
    comment: data.insertMeta?.comment ?? null,
  }
}
