import { and, asc, desc, eq } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { getDb } from '../db'
import {
  backtestRunFailures,
  backtestRunMarkets,
  backtestRunSegments,
  backtestRuns,
} from '../schema'
import { aggregateJobId, getAggregateQueue, getMarketQueue } from '../queue'
import { unionBusyMs } from '@polymarket-bot/stats/wallClock'

const ACTIVE_AGGREGATE_STATES = ['waiting-children', 'waiting', 'active', 'delayed'] as const

async function listActiveAggregateJobs(): Promise<Job[]> {
  const agg = getAggregateQueue()
  const pageSize = 200
  const maxScanned = 50_000
  const out: Job[] = []
  let start = 0
  while (start < maxScanned) {
    const page = await agg.getJobs([...ACTIVE_AGGREGATE_STATES], start, start + pageSize - 1)
    if (page.length === 0) break
    out.push(...page)
    if (page.length < pageSize) break
    start += pageSize
  }
  return out
}

export type ActiveBatchSummary = {
  batchUid: string
  submissionUid: string
  strategy: string
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  parentState: string | undefined
  attemptsMade: number
}

/**
 * Fetches ALL currently-active market jobs, paginating until exhausted,
 * and groups counts by submissionUid prefix (job ids are
 * `<submissionUid>-m-<idx>`). Used by both `listActiveBatches`
 * (called once per request, shared across parents) and
 * `getActiveBatchDetail` (single-parent path).
 *
 * Pagination matters: BullMQ's `getJobs(['active'], 0, 200)` silently caps
 * at 200; with concurrency × #parallel-batches > 200 the per-batch count
 * would be undercounted and `waitingChildren = unprocessed - active`
 * inflated. We walk in 200-row pages until a short page is returned.
 */
async function countActiveChildrenBySubmission(): Promise<Map<string, number>> {
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
 * Counts active children for a single submission. Kept as a convenience for
 * the single-parent detail path; `listActiveBatches` uses the grouped
 * version directly to avoid N redundant scans.
 */
export async function countActiveChildrenForSubmission(submissionUid: string): Promise<number> {
  const all = await countActiveChildrenBySubmission()
  return all.get(submissionUid) ?? 0
}

export async function listActiveBatches(): Promise<ActiveBatchSummary[]> {
  const jobs = await listActiveAggregateJobs()
  // Fetch the active-children count ONCE for all batches, then look up
  // per-parent below. Previously this was called inside the loop, causing
  // an N×scan-of-200-jobs hot path on every dashboard poll.
  const activeBySubmission = await countActiveChildrenBySubmission()
  const out: ActiveBatchSummary[] = []
  for (const job of jobs) {
    if (!job) continue
    const data = job.data as {
      submissionUid?: string
      batchUid?: string
      totalMarkets?: number
      insertMeta?: { strategy?: string }
    }
    const submissionUid = data.submissionUid ?? job.id?.replace(/-agg$/, '') ?? 'unknown'
    const batchUid = data.batchUid ?? submissionUid
    const totalMarkets = data.totalMarkets ?? 0
    const dependencies = await job.getDependenciesCount({ processed: true, unprocessed: true })
    const state = await job.getState()

    const failedChildrenValues = await job.getFailedChildrenValues()
    const failedChildren = Object.keys(failedChildrenValues).length
    const processedTotal = dependencies.processed ?? 0
    const completedChildren = Math.max(0, processedTotal - failedChildren)
    const unprocessedTotal = dependencies.unprocessed ?? 0
    const activeChildren = activeBySubmission.get(submissionUid) ?? 0
    const waitingChildren = Math.max(0, unprocessedTotal - activeChildren)

    out.push({
      batchUid,
      submissionUid,
      strategy: data.insertMeta?.strategy ?? 'unknown',
      totalMarkets,
      waitingChildren,
      activeChildren,
      completedChildren,
      failedChildren,
      parentState: state,
      attemptsMade: job.attemptsMade ?? 0,
    })
  }
  return out
}

export type HistoricalBatch = {
  id: number
  batchUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  params: Record<string, unknown> | null
  symbol: string | null
  limit: number | null
  inputMarketsTotal: number | null
  comment: string | null
  pnlTotal: number
  winRatePct: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  failuresCount: number
  cmd: string | null
  pnlAvgWin: number
  pnlAvgLose: number
  evPerMarketPlayed: number
  evPerMarketTotal: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  qualitySystem: number | null
  qualityTrade: number | null
  totalFeesPaid: number
  durationTotalMs: number | null
  durationAvgMs: number | null
  durationWallClockMs: number | null
  createdAt: Date
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

type AllSegmentRow = typeof backtestRunSegments.$inferSelect

function emptySegmentStats(capitalInitial: unknown) {
  const initial = toNumber(capitalInitial)
  return {
    capitalInitial: initial,
    capitalFinal: initial,
    pnlTotal: 0,
    totalFeesPaid: 0,
    qualitySystem: null,
    qualityTrade: null,
    evPerMarketPlayed: 0,
    evPerMarketTotal: 0,
    marketsTotal: 0,
    marketsSkipped: 0,
    marketsNoInWindowActivity: 0,
    marketsFlatWithTrades: 0,
    marketsPlayed: 0,
    marketsWon: 0,
    marketsLost: 0,
    winRate: 0,
    winRatePct: 0,
    tradesTotal: 0,
    tradesMaker: 0,
    tradesTaker: 0,
    pnlAvgWin: 0,
    pnlAvgLose: 0,
    pnlMaxWin: 0,
    pnlMaxLose: 0,
    streakMaxWin: 0,
    streakMaxLose: 0,
    streakMaxWinPnl: 0,
    streakMaxLosePnl: 0,
    streakMaxSkipped: 0,
    durationTotalMs: null,
    durationAvgMs: null,
    durationWallClockMs: null,
  }
}

function mapSegmentStats(segment: AllSegmentRow) {
  return {
    capitalInitial: toNumber(segment.capitalInitial),
    capitalFinal: toNumber(segment.capitalFinal),
    pnlTotal: toNumber(segment.pnlTotal),
    totalFeesPaid: toNumber(segment.totalFeesPaid),
    qualitySystem: segment.qualitySystem === null ? null : toNumber(segment.qualitySystem),
    qualityTrade: segment.qualityTrade === null ? null : toNumber(segment.qualityTrade),
    evPerMarketPlayed: toNumber(segment.evPerMarketPlayed),
    evPerMarketTotal: toNumber(segment.evPerMarketTotal),
    marketsTotal: segment.marketsTotal,
    marketsSkipped: segment.marketsSkipped,
    marketsNoInWindowActivity: segment.marketsNoInWindowActivity,
    marketsFlatWithTrades: segment.marketsFlatWithTrades,
    marketsPlayed: segment.marketsPlayed,
    marketsWon: segment.marketsWon,
    marketsLost: segment.marketsLost,
    winRate: toNumber(segment.winRate),
    winRatePct: toNumber(segment.winRatePct),
    tradesTotal: segment.tradesTotal,
    tradesMaker: segment.tradesMaker,
    tradesTaker: segment.tradesTaker,
    pnlAvgWin: toNumber(segment.pnlAvgWin),
    pnlAvgLose: toNumber(segment.pnlAvgLose),
    pnlMaxWin: toNumber(segment.pnlMaxWin),
    pnlMaxLose: toNumber(segment.pnlMaxLose),
    streakMaxWin: segment.streakMaxWin,
    streakMaxLose: segment.streakMaxLose,
    streakMaxWinPnl: toNumber(segment.streakMaxWinPnl),
    streakMaxLosePnl: toNumber(segment.streakMaxLosePnl),
    streakMaxSkipped: segment.streakMaxSkipped,
    durationTotalMs: segment.durationTotalMs ?? null,
    durationAvgMs: segment.durationAvgMs === null ? null : toNumber(segment.durationAvgMs),
    durationWallClockMs: segment.durationWallClockMs ?? null,
  }
}

function mapRunSummary(run: typeof backtestRuns.$inferSelect, allSegment: AllSegmentRow | null) {
  if (!allSegment && run.marketsPersisted > 0) {
    throw new Error(`[dashboard/batches] missing all segment for run #${run.id}`)
  }
  return {
    ...run,
    ...(allSegment ? mapSegmentStats(allSegment) : emptySegmentStats(run.capitalInitial)),
  }
}

/** Distinct strategy / symbol values across all backtests — used to populate
 * filter dropdowns on the /backtests page. Cheap because both columns are
 * varchar(10/255) with relatively few unique values. */
export async function listBacktestFilterOptions(): Promise<{
  strategies: string[]
  symbols: string[]
}> {
  const db = getDb()
  const [strategyRows, symbolRows] = await Promise.all([
    db
      .selectDistinct({ value: backtestRuns.strategy })
      .from(backtestRuns)
      .orderBy(asc(backtestRuns.strategy)),
    db
      .selectDistinct({ value: backtestRuns.symbol })
      .from(backtestRuns)
      .orderBy(asc(backtestRuns.symbol)),
  ])
  return {
    strategies: strategyRows.map((r) => r.value).filter((s): s is string => !!s),
    symbols: symbolRows.map((r) => r.value).filter((s): s is string => !!s),
  }
}

export type HistoricalBatchFilters = {
  strategy?: string
  symbol?: string
  status?: 'completed' | 'partial' | 'failed'
}

export async function listHistoricalBatches(
  limit: number,
  filters: HistoricalBatchFilters = {},
): Promise<HistoricalBatch[]> {
  const db = getDb()
  const conditions = []
  if (filters.strategy) {
    conditions.push(eq(backtestRuns.strategy, filters.strategy))
  }
  if (filters.symbol) {
    conditions.push(eq(backtestRuns.symbol, filters.symbol))
  }
  if (filters.status) {
    conditions.push(eq(backtestRuns.status, filters.status))
  }
  const rows = await db
    .select({ run: backtestRuns, allSegment: backtestRunSegments })
    .from(backtestRuns)
    .leftJoin(
      backtestRunSegments,
      and(
        eq(backtestRunSegments.runId, backtestRuns.id),
        eq(backtestRunSegments.segmentKind, 'all'),
        eq(backtestRunSegments.segmentKey, 'all'),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(backtestRuns.createdAt))
    .limit(limit)
  return rows.map(({ run, allSegment }) => {
    const summary = mapRunSummary(run, allSegment)
    return {
      id: summary.id,
      batchUid: summary.batchUid,
      status: summary.status,
      strategy: summary.strategy,
      params: summary.params,
      symbol: summary.symbol,
      limit: summary.limit,
      inputMarketsTotal: summary.inputMarketsTotal,
      comment: summary.comment,
      pnlTotal: summary.pnlTotal,
      winRatePct: summary.winRatePct,
      tradesTotal: summary.tradesTotal,
      tradesMaker: summary.tradesMaker,
      tradesTaker: summary.tradesTaker,
      marketsTotal: summary.marketsTotal,
      marketsPlayed: summary.marketsPlayed,
      marketsSkipped: summary.marketsSkipped,
      failuresCount: summary.failuresCount,
      cmd: summary.cmd,
      pnlAvgWin: summary.pnlAvgWin,
      pnlAvgLose: summary.pnlAvgLose,
      evPerMarketPlayed: summary.evPerMarketPlayed,
      evPerMarketTotal: summary.evPerMarketTotal,
      streakMaxWin: summary.streakMaxWin,
      streakMaxLose: summary.streakMaxLose,
      streakMaxWinPnl: summary.streakMaxWinPnl,
      streakMaxLosePnl: summary.streakMaxLosePnl,
      qualitySystem: summary.qualitySystem,
      qualityTrade: summary.qualityTrade,
      totalFeesPaid: summary.totalFeesPaid,
      durationTotalMs: summary.durationTotalMs,
      durationAvgMs: summary.durationAvgMs,
      durationWallClockMs: summary.durationWallClockMs,
      createdAt: summary.createdAt,
    }
  })
}

/**
 * Hydrate a finalized backtest run from MySQL — id-based, no Redis fallback.
 * The active-batch path lives at `/batches/[batchUid]` and uses
 * `getActiveBatchDetail`; this function is for `/backtests/[id]`.
 */
export async function getBacktestRunById(id: number) {
  const db = getDb()
  const [row] = await db
    .select({ run: backtestRuns, allSegment: backtestRunSegments })
    .from(backtestRuns)
    .leftJoin(
      backtestRunSegments,
      and(
        eq(backtestRunSegments.runId, backtestRuns.id),
        eq(backtestRunSegments.segmentKind, 'all'),
        eq(backtestRunSegments.segmentKey, 'all'),
      ),
    )
    .where(eq(backtestRuns.id, id))
    .limit(1)
  if (!row) return null
  return hydrateBacktestRunDetail(row.run, row.allSegment)
}

/**
 * All finalized runs sharing a batch label, oldest first (submission order).
 * `batch_uid` is a non-unique group label — e.g. every cell of one param
 * sweep shares it. Summaries only; per-market detail lives at
 * `/backtests/[id]`.
 */
export async function listBatchRuns(batchUid: string) {
  const db = getDb()
  const rows = await db
    .select({ run: backtestRuns, allSegment: backtestRunSegments })
    .from(backtestRuns)
    .leftJoin(
      backtestRunSegments,
      and(
        eq(backtestRunSegments.runId, backtestRuns.id),
        eq(backtestRunSegments.segmentKind, 'all'),
        eq(backtestRunSegments.segmentKey, 'all'),
      ),
    )
    .where(eq(backtestRuns.batchUid, batchUid))
    .orderBy(asc(backtestRuns.createdAt))
  return rows.map(({ run, allSegment }) => mapRunSummary(run, allSegment))
}

/** Per-machine slice of a run's execution work. */
export type MachineExecution = {
  machineId: string
  workers: number | null
  markets: number
  /** Summed per-market elapsed time, used only for per-machine rate diagnostics. */
  workerTimeMs: number
  eventsProcessed: number
  /** Share of total processed events, 0–100. */
  sharePct: number
}

/**
 * Aggregate timing for a run, derived in-memory from the already-loaded market
 * rows (no extra DB work). `wallClockMs` is the real elapsed busy time — the
 * union of the per-market busy intervals (see {@link unionBusyMs}), excluding
 * idle gaps — and matches the engine-persisted `duration_wall_clock_ms`.
 * `workerTimeMs` is the summed per-market processing time (total compute),
 * retained for rate diagnostics. `spansExtension` flags runs whose markets were
 * processed in disjoint time windows (e.g. via `--extend`): the outer span then
 * far exceeds the busy time, so wall-clock is reported gap-free but the run
 * was not continuous.
 */
export type ExecutionSummary = {
  wallClockMs: number
  workerTimeMs: number
  marketsWithTiming: number
  eventsTotal: number
  perMachine: MachineExecution[]
  spansExtension: boolean
}

type MarketRow = typeof backtestRunMarkets.$inferSelect

function buildExecutionSummary(rows: MarketRow[]): ExecutionSummary | null {
  const timed = rows.filter(
    (r) => r.machineId !== null && r.startedAtMs !== null && r.finishedAtMs !== null,
  )
  if (timed.length === 0) return null

  let minStarted = Infinity
  let maxFinished = -Infinity
  let workerTimeMs = 0
  let eventsTotal = 0
  const byMachine = new Map<string, MachineExecution>()

  for (const r of timed) {
    const started = r.startedAtMs as number
    const finished = r.finishedAtMs as number
    const duration = r.durationMs ?? Math.max(0, finished - started)
    const events = r.eventsProcessed ?? 0

    if (started < minStarted) minStarted = started
    if (finished > maxFinished) maxFinished = finished
    workerTimeMs += duration
    eventsTotal += events

    const m = byMachine.get(r.machineId as string) ?? {
      machineId: r.machineId as string,
      workers: null,
      markets: 0,
      workerTimeMs: 0,
      eventsProcessed: 0,
      sharePct: 0,
    }
    m.markets += 1
    m.workerTimeMs += duration
    m.eventsProcessed += events
    byMachine.set(m.machineId, m)
  }

  const workersByMachine = new Map<string, Set<number>>()
  for (const r of timed) {
    if (r.machineId === null || r.workerChildId === null) continue
    const set = workersByMachine.get(r.machineId) ?? new Set<number>()
    set.add(r.workerChildId)
    workersByMachine.set(r.machineId, set)
  }

  const perMachine = [...byMachine.values()]
    .map((m) => ({
      ...m,
      workers: workersByMachine.get(m.machineId)?.size ?? null,
      sharePct: eventsTotal > 0 ? (m.eventsProcessed / eventsTotal) * 100 : 0,
    }))
    .sort((a, b) => b.eventsProcessed - a.eventsProcessed)

  // Wall-clock = union of the per-market busy intervals, via the same shared
  // helper the engine uses to persist `duration_wall_clock_ms` (so the live
  // detail card and the persisted list value can't drift). Excludes idle gaps
  // between disjoint windows — e.g. an --extend that ran hours after the
  // original — which a naive max(finished) − min(started) span would count.
  const wallClockMs = unionBusyMs(
    timed.map((r) => [r.startedAtMs as number, r.finishedAtMs as number] as const),
  )

  // The run was split across disjoint windows (e.g. an --extend) when the outer
  // span meaningfully exceeds the merged busy time — surfaced as a hint so the
  // number isn't mistaken for a single continuous run.
  const outerSpanMs = maxFinished - minStarted
  const spansExtension = outerSpanMs - wallClockMs > 60_000

  return {
    wallClockMs,
    workerTimeMs,
    marketsWithTiming: timed.length,
    eventsTotal,
    perMachine,
    spansExtension,
  }
}

async function hydrateBacktestRunDetail(
  run: typeof backtestRuns.$inferSelect,
  allSegment: AllSegmentRow | null,
) {
  const db = getDb()

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
    ...mapRunSummary(run, allSegment),
    executionSummary: buildExecutionSummary(marketRows),
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
      ...(m.machineId && m.durationMs !== null && m.eventsProcessed !== null
        ? {
            execution: {
              machineId: m.machineId,
              workerChildId: m.workerChildId,
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
  submissionUid: string
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

export async function getActiveBatchDetail(
  submissionUid: string,
): Promise<ActiveBatchDetail | null> {
  const parent = await getAggregateQueue().getJob(aggregateJobId(submissionUid))
  if (!parent) return null
  const state = await parent.getState()
  const dependencies = await parent.getDependenciesCount({ processed: true, unprocessed: true })
  const failedChildrenValues = await parent.getFailedChildrenValues()
  const failedChildren = Object.keys(failedChildrenValues).length
  const completedChildren = Math.max(0, (dependencies.processed ?? 0) - failedChildren)
  const activeChildren = await countActiveChildrenForSubmission(submissionUid)
  const data = parent.data as {
    batchUid?: string
    totalMarkets?: number
    insertMeta?: { strategy?: string; comment?: string | null }
  }
  return {
    batchUid: data.batchUid ?? submissionUid,
    submissionUid,
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

/**
 * All in-flight submissions carrying a batch label. A label can have several
 * live submissions at once (e.g. a sweep enqueued cell-by-cell), so this
 * scans the aggregate queue and filters by `job.data.batchUid`.
 */
export async function listActiveBatchDetailsForLabel(
  batchUid: string,
): Promise<ActiveBatchDetail[]> {
  const jobs = await listActiveAggregateJobs()
  const out: ActiveBatchDetail[] = []
  for (const job of jobs) {
    if (!job) continue
    const data = job.data as { submissionUid?: string; batchUid?: string }
    if ((data.batchUid ?? data.submissionUid) !== batchUid) continue
    const submissionUid = data.submissionUid ?? job.id?.replace(/-agg$/, '')
    if (!submissionUid) continue
    const detail = await getActiveBatchDetail(submissionUid)
    if (detail) out.push(detail)
  }
  return out
}
