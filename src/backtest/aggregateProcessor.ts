import type { Job } from 'bullmq'
import { computeBatchStats } from './stats/batchStats.js'
import { computeChunkedBatchStats } from './stats/chunkedBatchStats.js'
import type { MarketStats } from './stats/marketStats.js'
import { insertBacktestRun } from '../db/backtests.js'
import { getMarketQueue } from './queue.js'
import type {
  AggregateJobData,
  AggregateJobResult,
  FailedMarketRecord,
  MarketJobResult,
} from './jobTypes.js'

/**
 * Parses the trailing `-m-<idx>` segment from a BullMQ child jobId.
 * Returns null if it doesn't match (e.g. legacy ids).
 */
function idxFromChildJobId(jobId: string | undefined): number | null {
  if (!jobId) return null
  const m = jobId.match(/-m-(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * BullMQ processor for the aggregate parent job.
 *
 * Runs after every child market job has either completed or exhausted retries.
 * Pulls each child's return value, sorts by idx, and produces the final
 * batchStats / chunkedBatchStats — preserving the bit-identical invariant
 * that depends on processing order matching the producer's input order.
 *
 * After the row is persisted, child jobs are removed from Redis to bound memory.
 */
export async function aggregateProcessor(job: Job<AggregateJobData>): Promise<AggregateJobResult> {
  const data = job.data

  const childrenValues = (await job.getChildrenValues()) as Record<string, MarketJobResult | null>
  const failedChildren = (await job.getFailedChildrenValues()) as Record<string, string>

  // Collect successes (with usable marketStats) and skips separately.
  const ordered: MarketJobResult[] = []
  for (const v of Object.values(childrenValues)) {
    if (v && typeof v === 'object') ordered.push(v)
  }

  // CRITICAL: sort by idx so streak/chunk aggregation matches the original
  // input ordering regardless of which worker finished when.
  ordered.sort((a, b) => a.idx - b.idx)

  const marketStats: MarketStats[] = []
  let totalSkipped = 0
  for (const result of ordered) {
    if (result.marketStats) {
      marketStats.push(result.marketStats)
    } else {
      totalSkipped += 1
    }
  }

  const batchStats = computeBatchStats(marketStats, data.initialCapital)
  const chunkedBatchStats = computeChunkedBatchStats(
    marketStats,
    data.initialCapital,
    [96, 200, 300],
  )

  const failed: FailedMarketRecord[] = []
  for (const [jobId, reason] of Object.entries(failedChildren)) {
    const idx = idxFromChildJobId(jobId)
    // failed children don't surface their returnValue, so slug isn't recoverable here.
    const rec: FailedMarketRecord = { idx, slug: null, reason: String(reason) }
    if (jobId !== undefined) rec.jobId = jobId
    failed.push(rec)
  }
  failed.sort((a, b) => (a.idx ?? Number.MAX_SAFE_INTEGER) - (b.idx ?? Number.MAX_SAFE_INTEGER))

  await insertBacktestRun({
    batchUid: data.batchUid,
    baselineId: data.insertMeta.baselineId,
    cmd: data.insertMeta.cmd,
    comment: data.insertMeta.comment,
    strategy: data.insertMeta.strategy,
    params: data.insertMeta.params,
    symbol: data.insertMeta.symbol,
    slugs: data.insertMeta.slugs,
    limit: data.insertMeta.limit,
    random: data.insertMeta.random,
    latest: data.insertMeta.latest,
    batchStats: batchStats as unknown as Record<string, unknown>,
    chunkedBatchStats: chunkedBatchStats as unknown as Record<string, unknown>,
    marketStats: marketStats as unknown as unknown[],
    failedMarkets: failed,
  })

  // Cleanup: remove children jobs from Redis to bound memory. Best-effort.
  const queue = getMarketQueue()
  const childIds = Object.keys(childrenValues).concat(Object.keys(failedChildren))
  await Promise.allSettled(childIds.map((id) => queue.remove(id)))

  return {
    batchUid: data.batchUid,
    totalSucceeded: marketStats.length,
    totalFailed: failed.length,
    totalSkipped,
    marketsPersisted: marketStats.length,
  }
}
