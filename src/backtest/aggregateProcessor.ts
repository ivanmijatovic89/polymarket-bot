import type { Job } from 'bullmq'
import { computeBatchStats } from './stats/batchStats.js'
import { computeBacktestSegments, slugTs } from './stats/backtestSegments.js'
import type { MarketStats } from './stats/marketStats.js'
import {
  applyExtensionToRun,
  clearExtensionLock,
  insertBacktestRun,
  type IndexedMarketStats,
} from '../db/backtests.js'
import { getMarketQueue } from './queue.js'
import { AGGREGATE_JOB_PROTOCOL_VERSION, marketJobId } from './jobTypes.js'
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

function redisKeyToJobId(redisKey: string): string {
  return redisKey.split(':').pop() ?? redisKey
}

function nullMarketStatsReason(result: MarketJobResult): string {
  if (result.skipReason === 'unresolved_outcome') {
    return 'unresolved_outcome: market has no final outcome/result_id, so PnL cannot be computed'
  }
  if (result.skipReason === 'no_resolution') {
    return 'no_resolution: market token map or resolution data was unavailable'
  }
  if (result.skipReason === 'no_slug') {
    return 'no_slug: could not parse market slug from input file path'
  }
  return `no_market_stats: ${result.skipReason ?? 'unknown_reason'}`
}

/**
 * BullMQ processor for the aggregate parent job.
 *
 * Runs after every child market job has either completed or exhausted retries.
 * Pulls each child's return value, sorts by idx, and produces the final
 * run summary stats and per-segment stats — preserving the bit-identical
 * invariant that depends on processing order matching the producer's input order.
 *
 * After the row is persisted, child jobs are removed from Redis to bound memory.
 */
export async function aggregateProcessor(job: Job<AggregateJobData>): Promise<AggregateJobResult> {
  const data = job.data
  if (data.protocolVersion !== AGGREGATE_JOB_PROTOCOL_VERSION) {
    throw new Error(
      `[aggregateProcessor] protocol mismatch for batchUid=${data.batchUid}: ` +
        `job=${String(data.protocolVersion)} worker=${AGGREGATE_JOB_PROTOCOL_VERSION}. ` +
        `Restart all backtest workers and re-enqueue the batch.`,
    )
  }
  if (!Array.isArray(data.expectedMarkets) || data.expectedMarkets.length !== data.totalMarkets) {
    throw new Error(
      `[aggregateProcessor] invalid expectedMarkets for batchUid=${data.batchUid}: ` +
        `expected ${data.totalMarkets}, got ${Array.isArray(data.expectedMarkets) ? data.expectedMarkets.length : 'missing'}. ` +
        `Restart all backtest workers and re-enqueue the batch.`,
    )
  }

  const childrenValues = (await job.getChildrenValues()) as Record<string, MarketJobResult | null>
  const failedChildren = (await job.getFailedChildrenValues()) as Record<string, string>
  const expectedMarkets = data.expectedMarkets ?? []
  const expectedByIdx = new Map(expectedMarkets.map((m) => [m.idx, m] as const))
  const completedIdxs = new Set<number>()
  const failedIdxs = new Set<number>()

  // Collect successes (with usable marketStats) and skips separately.
  const ordered: MarketJobResult[] = []
  for (const v of Object.values(childrenValues)) {
    if (v && typeof v === 'object') ordered.push(v)
  }

  // CRITICAL: sort by idx so streak/chunk aggregation matches the original
  // input ordering regardless of which worker finished when.
  ordered.sort((a, b) => a.idx - b.idx)

  const marketStats: MarketStats[] = []
  const indexedMarketStats: IndexedMarketStats[] = []
  const failed: FailedMarketRecord[] = []
  let totalSkipped = 0
  for (const result of ordered) {
    completedIdxs.add(result.idx)
    if (result.marketStats) {
      marketStats.push(result.marketStats)
      indexedMarketStats.push({ idx: result.idx, stats: result.marketStats })
    } else {
      totalSkipped += 1
      failed.push({
        jobId: marketJobId(data.batchUid, result.idx),
        idx: result.idx,
        slug: result.slug,
        reason: nullMarketStatsReason(result),
      })
    }
  }

  for (const [redisKey, reason] of Object.entries(failedChildren)) {
    // `getFailedChildrenValues()` returns Redis-key form
    // (`bull:<queue>:<jobId>`) — same caveat as `getChildrenValues()` noted
    // below. Normalize to the bare jobId so downstream consumers (dashboard,
    // re-enqueue tooling) can call `marketQueue.getJob(record.jobId)`.
    const idx = idxFromChildJobId(redisKey)
    if (idx !== null) failedIdxs.add(idx)
    const bareJobId = idx !== null ? marketJobId(data.batchUid, idx) : redisKeyToJobId(redisKey)
    const rec: FailedMarketRecord = {
      idx,
      slug: idx !== null ? (expectedByIdx.get(idx)?.slug ?? null) : null,
      reason: String(reason),
    }
    rec.jobId = bareJobId
    failed.push(rec)
  }

  for (const expected of expectedMarkets) {
    if (completedIdxs.has(expected.idx) || failedIdxs.has(expected.idx)) continue
    failed.push({
      jobId: marketJobId(data.batchUid, expected.idx),
      idx: expected.idx,
      slug: expected.slug,
      reason:
        'missing_child_result: aggregate job received no completed or failed child value for this market',
    })
  }
  failed.sort((a, b) => (a.idx ?? Number.MAX_SAFE_INTEGER) - (b.idx ?? Number.MAX_SAFE_INTEGER))

  if (data.extension) {
    // Extension flow: UPDATE the parent run with the new markets. Recompute
    // happens inside applyExtensionToRun over the union of existing + new.
    // `data.insertMeta` is still populated for backward compatibility with
    // listeners that look at job.data, but it's IGNORED by this branch.
    try {
      await applyExtensionToRun({
        parentRunId: data.extension.parentRunId,
        marketStats: indexedMarketStats as unknown as unknown[],
        failedMarkets: failed,
      })
    } catch (err) {
      // Transaction rolled back; extending_at would stay set forever
      // otherwise, blocking future extends until manually cleared.
      await clearExtensionLock(data.extension.parentRunId).catch(() => {})
      throw err
    }
  } else {
    const batchStats = computeBatchStats(marketStats, data.initialCapital)
    const marketsWithStartMs = marketStats.map((m) => ({ ...m, marketStartMs: slugTs(m.slug) }))
    const segments = computeBacktestSegments(marketsWithStartMs, data.initialCapital)
    await insertBacktestRun({
      batchUid: data.batchUid,
      baselineId: data.insertMeta.baselineId,
      cmd: data.insertMeta.cmd,
      comment: data.insertMeta.comment,
      strategy: data.insertMeta.strategy,
      params: data.insertMeta.params,
      symbol: data.insertMeta.symbol,
      timeframe: data.insertMeta.timeframe,
      inputMode: data.insertMeta.inputMode,
      converter: data.insertMeta.converter,
      readFrom: data.insertMeta.readFrom,
      slugs: data.insertMeta.slugs,
      limit: data.insertMeta.limit,
      inputMarketsTotal: data.totalMarkets,
      random: data.insertMeta.random,
      latest: data.insertMeta.latest,
      batchStats,
      segments,
      marketStats: indexedMarketStats as unknown as unknown[],
      failedMarkets: failed,
    })
  }

  // Cleanup: remove children from Redis so a future rerun with the same
  // batchUid isn't silently served from cache. We iterate the known idx
  // range instead of `Object.keys(childrenValues)` because BullMQ stores
  // those keys in `<prefix>:<queue>:<jobId>` form, which `queue.remove()`
  // doesn't accept. Best-effort: never fail the aggregator over cleanup.
  const queue = getMarketQueue()
  const totalKnown = Math.max(
    data.totalMarkets,
    Object.keys(childrenValues).length + Object.keys(failedChildren).length,
  )
  const childIdsToRemove: string[] = []
  for (let i = 0; i < totalKnown; i += 1) {
    childIdsToRemove.push(marketJobId(data.batchUid, i))
  }
  await Promise.allSettled(childIdsToRemove.map((id) => queue.remove(id)))

  // The aggregate parent itself is removed via `removeOnComplete: true`
  // on the aggregate job opts (see queue.ts) — letting BullMQ do it
  // after the processor returns avoids fighting with the active-job lock.

  return {
    batchUid: data.batchUid,
    totalSucceeded: marketStats.length,
    totalFailed: failed.length,
    totalSkipped,
    marketsPersisted: marketStats.length,
  }
}
