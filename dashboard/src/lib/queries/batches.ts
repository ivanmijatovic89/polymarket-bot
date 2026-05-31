import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { backtests } from '../schema'
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
  batchUid: string | null
  strategy: string
  comment: string | null
  batchStats: Record<string, unknown>
  createdAt: Date
}

export async function listHistoricalBatches(limit: number): Promise<HistoricalBatch[]> {
  const db = getDb()
  const rows = await db
    .select({
      batchUid: backtests.batchUid,
      strategy: backtests.strategy,
      comment: backtests.comment,
      batchStats: backtests.batchStats,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .orderBy(desc(backtests.createdAt))
    .limit(limit)
  return rows
}

export async function getBatchDetail(batchUid: string) {
  const db = getDb()
  const [row] = await db.select().from(backtests).where(eq(backtests.batchUid, batchUid)).limit(1)
  return row ?? null
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
