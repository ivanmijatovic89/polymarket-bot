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
 * Counts per-child state for one parent flow by intersecting the market
 * queue's active jobs with the batchUid prefix.
 */
export async function countActiveChildrenForBatch(batchUid: string): Promise<number> {
  const queue = getMarketQueue()
  const activeJobs = await queue.getJobs(['active'], 0, 200)
  let n = 0
  for (const j of activeJobs) {
    const id = j?.id
    if (typeof id === 'string' && id.startsWith(`${batchUid}-m-`)) n += 1
  }
  return n
}

export async function listActiveBatches(): Promise<ActiveBatchSummary[]> {
  const agg = getAggregateQueue()
  const jobs = await agg.getJobs(['waiting-children', 'waiting', 'active', 'delayed'], 0, 100)
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
    const activeChildren = await countActiveChildrenForBatch(batchUid)
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
