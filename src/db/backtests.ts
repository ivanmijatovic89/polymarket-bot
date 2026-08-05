import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { BatchStats, BatchStatsFields } from '../backtest/stats/batchStats.js'
import {
  computeBacktestSegments,
  slugTs,
  type SegmentRow,
} from '../backtest/stats/backtestSegments.js'
import type { MarketExecutionMeta, MarketStats } from '../backtest/stats/marketStats.js'
import type { StrategyArtifactMeta } from '../strategy/artifacts/types.js'
import { getDb } from './index.js'
import {
  backtestRunFailures,
  backtestRunMarkets,
  backtestRunSegments,
  backtestRuns,
  telonexMarkets,
} from './schema.js'

function mustGetDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!db) {
    throw new Error('[db] getDb() returned null (unexpected)')
  }
  return db
}

export type BacktestFailureRecord = {
  jobId?: string
  idx: number | null
  slug: string | null
  reason: string
}

export type IndexedMarketStats = {
  idx: number
  stats: MarketStats
}

export type BacktestRunRecord = {
  id: number
  batchUid: string
  submissionUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  slugs: string[] | null
  limit: number | null
  inputMarketsTotal?: number | null
  random: boolean
  latest: boolean
  baselineId: string | null
  cmd: string | null
  comment: string | null
  protocol: string | null
  model: string | null
  capitalInitial: number
  capitalFinal: number
  pnlTotal: number
  totalFeesPaid: number
  qualitySystem: number | null
  qualityTrade: number | null
  evPerMarketPlayed: number
  evPerMarketTotal: number
  marketsTotal: number
  marketsSkipped: number
  marketsNoInWindowActivity: number
  marketsFlatWithTrades: number
  marketsPlayed: number
  marketsWon: number
  marketsLost: number
  winRate: number
  winRatePct: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  pnlAvgWin: number
  pnlAvgLose: number
  pnlMaxWin: number
  pnlMaxLose: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  streakMaxSkipped: number
  marketStats: MarketStats[]
  failedMarkets: BacktestFailureRecord[]
  createdAt: Date
}

export type BacktestRunSummary = {
  id: number
  batchUid: string
  submissionUid: string
  marketsPersisted: number
  failuresCount: number
  createdAt: Date
}

type InsertBacktestRunRow = {
  batchUid: string
  submissionUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  protocol: string | null
  model: string | null
  strategy: string
  params: Record<string, unknown>
  /** External artifact provenance (issue #211). Null for registry strategies. */
  strategyArtifactSha256?: string | null
  strategyArtifactMeta?: StrategyArtifactMeta | null
  symbol: string | null
  // Optional run-shape metadata. Populated for telonex runs so the dashboard
  // coverage feature can identify the eligible universe a run targeted
  // without parsing `cmd`. Null for recorded-mode runs.
  timeframe: string | null
  inputMode: string | null
  converter: string | null
  readFrom: string | null
  slugs: string[] | null
  limit: number | null
  inputMarketsTotal?: number | null
  random: boolean
  latest: boolean
  batchStats: BatchStats
  marketStats: unknown[]
  segments: SegmentRow[]
  failedMarkets?: BacktestFailureRecord[] | null
}

const MARKET_INSERT_BATCH_SIZE = 250
const SEGMENT_INSERT_BATCH_SIZE = 500

function toDecimal(value: number): string {
  return String(value)
}

function segmentRowToInsert(runId: number, s: SegmentRow) {
  return {
    runId,
    segmentKind: s.segmentKind,
    segmentKey: s.segmentKey,
    segmentOrd: s.segmentOrd,
    fromMs: s.fromMs,
    toMs: s.toMs,
    capitalInitial: toDecimal(s.stats.capitalInitial),
    capitalFinal: toDecimal(s.stats.capitalFinal),
    pnlTotal: toDecimal(s.stats.pnlTotal),
    totalFeesPaid: toDecimal(s.stats.totalFeesPaid),
    qualitySystem: s.stats.qualitySystem === null ? null : toDecimal(s.stats.qualitySystem),
    qualityTrade: s.stats.qualityTrade === null ? null : toDecimal(s.stats.qualityTrade),
    evPerMarketPlayed: toDecimal(s.stats.evPerMarketPlayed),
    evPerMarketTotal: toDecimal(s.stats.evPerMarketTotal),
    marketsTotal: s.stats.marketsTotal,
    marketsSkipped: s.stats.marketsSkipped,
    marketsNoInWindowActivity: s.stats.marketsNoInWindowActivity,
    marketsFlatWithTrades: s.stats.marketsFlatWithTrades,
    marketsPlayed: s.stats.marketsPlayed,
    marketsWon: s.stats.marketsWon,
    marketsLost: s.stats.marketsLost,
    winRate: toDecimal(s.stats.winRate),
    winRatePct: toDecimal(s.stats.winRatePct),
    tradesTotal: s.stats.tradesTotal,
    tradesMaker: s.stats.tradesMaker,
    tradesTaker: s.stats.tradesTaker,
    pnlAvgWin: toDecimal(s.stats.pnlAvgWin),
    pnlAvgLose: toDecimal(s.stats.pnlAvgLose),
    pnlMaxWin: toDecimal(s.stats.pnlMaxWin),
    pnlMaxLose: toDecimal(s.stats.pnlMaxLose),
    streakMaxWin: s.stats.streakMaxWin,
    streakMaxLose: s.stats.streakMaxLose,
    streakMaxWinPnl: toDecimal(s.stats.streakMaxWinPnl),
    streakMaxLosePnl: toDecimal(s.stats.streakMaxLosePnl),
    streakMaxSkipped: s.stats.streakMaxSkipped,
    durationTotalMs: s.stats.durationTotalMs,
    durationAvgMs: toDecimal(s.stats.durationAvgMs),
    durationWallClockMs: s.stats.durationWallClockMs,
  }
}

function coerceMarketStatsRow(m: unknown, idx: number): MarketStats {
  if (!m || typeof m !== 'object') {
    throw new Error(`[db/backtests] invalid marketStats row at index ${idx}`)
  }
  const r = m as Partial<MarketStats>
  const ok =
    typeof r.marketId === 'string' &&
    typeof r.slug === 'string' &&
    (r.finalOutcome === 'UP' || r.finalOutcome === 'DOWN') &&
    typeof r.pnl === 'number'
  if (!ok) throw new Error(`[db/backtests] invalid marketStats row at index ${idx}`)
  return r as MarketStats
}

function isIndexedMarketStatsRow(m: unknown): m is IndexedMarketStats {
  if (!m || typeof m !== 'object') return false
  const r = m as Partial<IndexedMarketStats>
  return typeof r.idx === 'number' && Number.isInteger(r.idx) && r.idx >= 0 && 'stats' in r
}

export function coerceIndexedMarketStats(raw: unknown[]): IndexedMarketStats[] {
  return raw.map((m, idx): IndexedMarketStats => {
    if (isIndexedMarketStatsRow(m)) {
      return { idx: m.idx, stats: coerceMarketStatsRow(m.stats, idx) }
    }
    return { idx, stats: coerceMarketStatsRow(m, idx) }
  })
}

function runStatus(marketCount: number, failedCount: number): 'completed' | 'partial' | 'failed' {
  if (failedCount === 0) return 'completed'
  return marketCount > 0 ? 'partial' : 'failed'
}

export function computeExtendedFailureCount(
  parentFailuresCount: number,
  newFailuresCount: number,
  resolvedFailureCount: number,
): number {
  return Math.max(0, parentFailuresCount + newFailuresCount - resolvedFailureCount)
}

/**
 * All runs sharing a batch label, newest first. `batch_uid` is a non-unique
 * group label — e.g. every cell of one param sweep shares it.
 */
export async function listBacktestRunSummariesByBatchUid(
  batchUid: string,
): Promise<BacktestRunSummary[]> {
  const db = mustGetDb()
  return db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      submissionUid: backtestRuns.submissionUid,
      marketsPersisted: backtestRuns.marketsPersisted,
      failuresCount: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
    .orderBy(desc(backtestRuns.createdAt))
}

export async function getBacktestRunSummaryBySubmissionUid(
  submissionUid: string,
): Promise<BacktestRunSummary | null> {
  const db = mustGetDb()
  const [run] = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      submissionUid: backtestRuns.submissionUid,
      marketsPersisted: backtestRuns.marketsPersisted,
      failuresCount: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.submissionUid, submissionUid))
    .limit(1)
  return run ?? null
}

function parseJsonValue<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function parseDecimal(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function emptyRunStats(capitalInitial: number): BatchStatsFields {
  return {
    capitalInitial,
    capitalFinal: capitalInitial,
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
    durationTotalMs: 0,
    durationAvgMs: 0,
    durationWallClockMs: 0,
  }
}

function segmentStatsToRunFields(
  segment: typeof backtestRunSegments.$inferSelect,
): BatchStatsFields {
  return {
    capitalInitial: parseDecimal(segment.capitalInitial),
    capitalFinal: parseDecimal(segment.capitalFinal),
    pnlTotal: parseDecimal(segment.pnlTotal),
    totalFeesPaid: parseDecimal(segment.totalFeesPaid),
    qualitySystem: segment.qualitySystem === null ? null : parseDecimal(segment.qualitySystem),
    qualityTrade: segment.qualityTrade === null ? null : parseDecimal(segment.qualityTrade),
    evPerMarketPlayed: parseDecimal(segment.evPerMarketPlayed),
    evPerMarketTotal: parseDecimal(segment.evPerMarketTotal),
    marketsTotal: segment.marketsTotal,
    marketsSkipped: segment.marketsSkipped,
    marketsNoInWindowActivity: segment.marketsNoInWindowActivity,
    marketsFlatWithTrades: segment.marketsFlatWithTrades,
    marketsPlayed: segment.marketsPlayed,
    marketsWon: segment.marketsWon,
    marketsLost: segment.marketsLost,
    winRate: parseDecimal(segment.winRate),
    winRatePct: parseDecimal(segment.winRatePct),
    tradesTotal: segment.tradesTotal,
    tradesMaker: segment.tradesMaker,
    tradesTaker: segment.tradesTaker,
    pnlAvgWin: parseDecimal(segment.pnlAvgWin),
    pnlAvgLose: parseDecimal(segment.pnlAvgLose),
    pnlMaxWin: parseDecimal(segment.pnlMaxWin),
    pnlMaxLose: parseDecimal(segment.pnlMaxLose),
    streakMaxWin: segment.streakMaxWin,
    streakMaxLose: segment.streakMaxLose,
    streakMaxWinPnl: parseDecimal(segment.streakMaxWinPnl),
    streakMaxLosePnl: parseDecimal(segment.streakMaxLosePnl),
    streakMaxSkipped: segment.streakMaxSkipped,
    durationTotalMs: segment.durationTotalMs ?? 0,
    durationAvgMs: segment.durationAvgMs === null ? 0 : parseDecimal(segment.durationAvgMs),
    durationWallClockMs: segment.durationWallClockMs ?? 0,
  }
}

async function getAllSegmentForRun(
  runId: number,
): Promise<typeof backtestRunSegments.$inferSelect | null> {
  const db = mustGetDb()
  const [segment] = await db
    .select()
    .from(backtestRunSegments)
    .where(
      and(
        eq(backtestRunSegments.runId, runId),
        eq(backtestRunSegments.segmentKind, 'all'),
        eq(backtestRunSegments.segmentKey, 'all'),
      ),
    )
    .limit(1)
  return segment ?? null
}

function runStatsFromAllSegment(
  run: typeof backtestRuns.$inferSelect,
  allSegment: typeof backtestRunSegments.$inferSelect | null,
): BatchStatsFields {
  if (allSegment) return segmentStatsToRunFields(allSegment)
  if (run.marketsPersisted === 0) return emptyRunStats(parseDecimal(run.capitalInitial))
  throw new Error(`[db/backtests] missing all segment for run #${run.id}`)
}

export async function insertBacktestRun(row: InsertBacktestRunRow): Promise<void> {
  const db = mustGetDb()
  // batch_uid is a non-unique group label — duplicates are expected (e.g. a
  // param sweep). Identity is submission_uid, which is auto-generated per
  // submission; a duplicate means the same flow aggregated twice.
  const existing = await getBacktestRunSummaryBySubmissionUid(row.submissionUid)
  if (existing) {
    throw new Error(
      `[db/backtests] submissionUid already exists in MySQL: ${row.submissionUid} ` +
        `(id=${existing.id}, batchUid=${existing.batchUid}, ` +
        `marketsPersisted=${existing.marketsPersisted}). ` +
        `This flow's results were already persisted.`,
    )
  }

  const batchStats = row.batchStats.toRunColumns()
  const indexedMarketStats = coerceIndexedMarketStats(row.marketStats)
  const marketStats = indexedMarketStats.map((entry) => entry.stats)
  const failedMarkets = row.failedMarkets ?? []
  const status = runStatus(marketStats.length, failedMarkets.length)

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(backtestRuns)
      .values({
        batchUid: row.batchUid,
        submissionUid: row.submissionUid,
        status,
        baselineId: row.baselineId,
        cmd: row.cmd,
        comment: row.comment,
        protocol: row.protocol,
        model: row.model,
        strategy: row.strategy,
        params: row.params,
        strategyArtifactSha256: row.strategyArtifactSha256 ?? null,
        strategyArtifactMeta: row.strategyArtifactMeta ?? null,
        symbol: row.symbol,
        timeframe: row.timeframe,
        inputMode: row.inputMode,
        converter: row.converter,
        readFrom: row.readFrom,
        slugs: row.slugs,
        limit: row.limit,
        random: row.random,
        latest: row.latest,
        inputMarketsTotal: row.inputMarketsTotal ?? row.limit ?? row.slugs?.length ?? null,
        marketsPersisted: marketStats.length,
        failuresCount: failedMarkets.length,
        capitalInitial: toDecimal(batchStats.capitalInitial),
      })
      .$returningId()

    const runId = inserted[0]?.id
    if (typeof runId !== 'number') throw new Error('[db/backtests] insert did not return run id')

    for (let start = 0; start < indexedMarketStats.length; start += MARKET_INSERT_BATCH_SIZE) {
      const chunk = indexedMarketStats.slice(start, start + MARKET_INSERT_BATCH_SIZE)
      await tx.insert(backtestRunMarkets).values(
        chunk.map((entry) => ({
          runId,
          idx: entry.idx,
          marketId: entry.stats.marketId,
          slug: entry.stats.slug,
          marketStartMs: slugTs(entry.stats.slug),
          finalOutcome: entry.stats.finalOutcome,
          skipReason: entry.stats.skipReason ?? null,
          pnl: toDecimal(entry.stats.pnl),
          tradeCount: entry.stats.tradeCount,
          tradeAsMaker: entry.stats.tradeAsMaker,
          tradeAsTaker: entry.stats.tradeAsTaker,
          feesPaid: toDecimal(entry.stats.feesPaid),
          avgEntryPriceUp:
            entry.stats.avgEntryPriceUp === null ? null : toDecimal(entry.stats.avgEntryPriceUp),
          avgEntryPriceDown:
            entry.stats.avgEntryPriceDown === null
              ? null
              : toDecimal(entry.stats.avgEntryPriceDown),
          upShares: toDecimal(entry.stats.upShares),
          downShares: toDecimal(entry.stats.downShares),
          mergableShares: toDecimal(entry.stats.mergableShares),
          cost: toDecimal(entry.stats.cost),
          splitCost: toDecimal(entry.stats.splitCost),
          intentMeta: entry.stats.intentMeta,
          machineId: entry.stats.execution?.machineId ?? null,
          workerChildId: entry.stats.execution?.workerChildId ?? null,
          startedAtMs: entry.stats.execution?.startedAtMs ?? null,
          finishedAtMs: entry.stats.execution?.finishedAtMs ?? null,
          durationMs: entry.stats.execution?.durationMs ?? null,
          eventsProcessed: entry.stats.execution?.eventsProcessed ?? null,
          eventsByType: entry.stats.execution?.eventsByType ?? null,
          commitSha: entry.stats.execution?.commitSha ?? null,
        })),
      )
    }

    for (let start = 0; start < row.segments.length; start += SEGMENT_INSERT_BATCH_SIZE) {
      const chunk = row.segments.slice(start, start + SEGMENT_INSERT_BATCH_SIZE)
      if (chunk.length > 0) {
        await tx.insert(backtestRunSegments).values(chunk.map((s) => segmentRowToInsert(runId, s)))
      }
    }

    if (failedMarkets.length > 0) {
      await tx.insert(backtestRunFailures).values(
        failedMarkets.map((f) => ({
          runId,
          jobId: f.jobId ?? null,
          idx: f.idx,
          slug: f.slug,
          reason: f.reason,
        })),
      )
    }
  })
}

export async function getBacktestRunById(id: number): Promise<BacktestRunRecord | null> {
  const db = mustGetDb()
  const [run] = await db.select().from(backtestRuns).where(eq(backtestRuns.id, id)).limit(1)
  if (!run) return null
  return hydrateBacktestRun(run)
}

/**
 * Load a run by its batch label. `batch_uid` is non-unique; this helper is
 * for callers that expect the label to identify exactly one run (e.g.
 * verify-backtest-diff) — it throws when the label is ambiguous so nobody
 * silently compares the wrong row. Use run ids for multi-run labels.
 */
export async function getBacktestRunByBatchUid(
  batchUid: string,
): Promise<BacktestRunRecord | null> {
  const db = mustGetDb()
  const runs = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
    .limit(2)
  if (runs.length === 0) return null
  if (runs.length > 1) {
    throw new Error(
      `[db/backtests] batchUid "${batchUid}" matches more than one run — ` +
        `it is a group label. Reference the specific run by id instead.`,
    )
  }
  return hydrateBacktestRun(runs[0]!)
}

async function hydrateBacktestRun(
  run: typeof backtestRuns.$inferSelect,
): Promise<BacktestRunRecord> {
  const db = mustGetDb()
  const [marketRows, failureRows, allSegment] = await Promise.all([
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
    getAllSegmentForRun(run.id),
  ])
  const stats = runStatsFromAllSegment(run, allSegment)

  const marketStats: MarketStats[] = marketRows.map((m) => {
    const execution: MarketExecutionMeta | undefined =
      m.machineId !== null &&
      m.startedAtMs !== null &&
      m.finishedAtMs !== null &&
      m.durationMs !== null &&
      m.eventsProcessed !== null
        ? {
            machineId: m.machineId,
            workerChildId: m.workerChildId,
            startedAtMs: m.startedAtMs,
            finishedAtMs: m.finishedAtMs,
            durationMs: m.durationMs,
            eventsProcessed: m.eventsProcessed,
            eventsByType: parseJsonValue<Record<string, number>>(m.eventsByType ?? {}),
            commitSha: m.commitSha ?? '',
          }
        : undefined

    return {
      marketId: m.marketId,
      slug: m.slug,
      finalOutcome: m.finalOutcome,
      pnl: parseDecimal(m.pnl),
      tradeCount: m.tradeCount,
      tradeAsMaker: m.tradeAsMaker,
      tradeAsTaker: m.tradeAsTaker,
      feesPaid: parseDecimal(m.feesPaid),
      avgEntryPriceUp: m.avgEntryPriceUp === null ? null : parseDecimal(m.avgEntryPriceUp),
      avgEntryPriceDown: m.avgEntryPriceDown === null ? null : parseDecimal(m.avgEntryPriceDown),
      upShares: parseDecimal(m.upShares),
      downShares: parseDecimal(m.downShares),
      mergableShares: parseDecimal(m.mergableShares),
      cost: parseDecimal(m.cost),
      splitCost: parseDecimal(m.splitCost),
      intentMeta: parseJsonValue<Array<Record<string, unknown>>>(m.intentMeta),
      ...(m.skipReason ? { skipReason: m.skipReason } : {}),
      ...(execution ? { execution } : {}),
    }
  })

  return {
    id: run.id,
    batchUid: run.batchUid,
    submissionUid: run.submissionUid,
    status: run.status,
    strategy: run.strategy,
    params: parseJsonValue<Record<string, unknown>>(run.params),
    symbol: run.symbol,
    slugs: parseJsonValue<string[] | null>(run.slugs),
    limit: run.limit,
    inputMarketsTotal: run.inputMarketsTotal,
    random: run.random,
    latest: run.latest,
    baselineId: run.baselineId,
    cmd: run.cmd,
    comment: run.comment,
    protocol: run.protocol,
    model: run.model,
    ...stats,
    marketStats,
    failedMarkets: failureRows.map((f) => ({
      ...(f.jobId ? { jobId: f.jobId } : {}),
      idx: f.idx,
      slug: f.slug,
      reason: f.reason,
    })),
    createdAt: run.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Extension helpers (PR: feat/backtest-extend)
//
// These centralise reads/writes that the extension flow needs so neither the
// CLI planner nor the aggregateProcessor reaches into `backtest_run_markets`
// or recomputes stats inline. Single source of truth.
// ---------------------------------------------------------------------------

/**
 * Return the set of slugs already covered by `runId`. Used by the extension
 * planner to compute the missing universe (eligible \ covered) and by
 * `applyExtensionToRun` to determine the next free `idx`.
 *
 * Index: `idx_backtest_run_markets_run_slug` makes this a covering-index
 * lookup — sub-millisecond even at 200k+ rows per run.
 */
export async function getCoveredSlugsForRun(runId: number): Promise<Set<string>> {
  const db = mustGetDb()
  const rows = await db
    .select({ slug: backtestRunMarkets.slug })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, runId))
  return new Set(rows.map((r) => r.slug))
}

/**
 * Returns `{ minMs, maxMs }` for the parent run's covered slug set, joined
 * against `telonex_markets.market_start_ms`. Used by the extension planner
 * to anchor the auto-direction filter ("just before covered" /
 * "just after covered"). Returns nulls if covered is empty.
 *
 * One join, indexed both sides (`run_id` on `backtest_run_markets`,
 * `slug` on `telonex_markets`).
 */
export async function getCoveredRangeForRun(
  runId: number,
): Promise<{ minMs: number | null; maxMs: number | null }> {
  const db = mustGetDb()
  const rows = await db
    .select({
      minMs: sql<number | null>`MIN(${telonexMarkets.marketStartMs})`,
      maxMs: sql<number | null>`MAX(${telonexMarkets.marketStartMs})`,
    })
    .from(backtestRunMarkets)
    .innerJoin(telonexMarkets, eq(telonexMarkets.slug, backtestRunMarkets.slug))
    .where(eq(backtestRunMarkets.runId, runId))
  const row = rows[0]
  if (!row || row.minMs === null) return { minMs: null, maxMs: null }
  return { minMs: Number(row.minMs), maxMs: Number(row.maxMs) }
}

/** Subset of `backtest_runs` columns needed to plan an extension. */
export type ExtensibleRun = {
  id: number
  batchUid: string
  protocol: string | null
  model: string | null
  /** Launch command of the parent run — extensions inherit its latency flags. */
  cmd: string | null
  strategy: string
  params: Record<string, unknown>
  /** External artifact sha (issue #211). Null for registry strategies. */
  strategyArtifactSha256: string | null
  /** Run-row copy of the artifact meta — the extend fallback when the strategy_artifacts row is gone. */
  strategyArtifactMeta: StrategyArtifactMeta | null
  symbol: string
  timeframe: string
  inputMode: string
  converter: string
  readFrom: string
  capitalInitial: number
  comment: string | null
  extendingAt: Date | null
}

/**
 * Loads the minimum columns the extension planner needs from
 * `backtest_runs`. Returns null if the run isn't found or is missing the
 * coverage metadata (e.g. a legacy `recorded` run, or a pre-PR#30 row that
 * wasn't backfilled). Errors are intentionally specific so the CLI can
 * surface clear guidance.
 */
export async function getRunForExtension(
  runId: number,
): Promise<
  | { kind: 'ok'; run: ExtensibleRun }
  | { kind: 'not-found' }
  | { kind: 'not-telonex'; inputMode: string | null }
  | { kind: 'missing-metadata'; missing: string[] }
> {
  const db = mustGetDb()
  const [row] = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      protocol: backtestRuns.protocol,
      model: backtestRuns.model,
      cmd: backtestRuns.cmd,
      strategy: backtestRuns.strategy,
      params: backtestRuns.params,
      strategyArtifactSha256: backtestRuns.strategyArtifactSha256,
      strategyArtifactMeta: backtestRuns.strategyArtifactMeta,
      symbol: backtestRuns.symbol,
      timeframe: backtestRuns.timeframe,
      inputMode: backtestRuns.inputMode,
      converter: backtestRuns.converter,
      readFrom: backtestRuns.readFrom,
      capitalInitial: backtestRuns.capitalInitial,
      comment: backtestRuns.comment,
      extendingAt: backtestRuns.extendingAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, runId))
    .limit(1)

  if (!row) return { kind: 'not-found' }
  if (row.inputMode === null || row.inputMode === 'recorded') {
    return { kind: 'not-telonex', inputMode: row.inputMode }
  }
  const missing: string[] = []
  if (!row.symbol) missing.push('symbol')
  if (!row.timeframe) missing.push('timeframe')
  if (!row.converter) missing.push('converter')
  if (!row.readFrom) missing.push('read_from')
  if (missing.length > 0) return { kind: 'missing-metadata', missing }

  return {
    kind: 'ok',
    run: {
      id: row.id,
      batchUid: row.batchUid,
      protocol: row.protocol,
      model: row.model,
      cmd: row.cmd,
      strategy: row.strategy,
      params: parseJsonValue<Record<string, unknown>>(row.params),
      strategyArtifactSha256: row.strategyArtifactSha256,
      strategyArtifactMeta: row.strategyArtifactMeta ?? null,
      symbol: row.symbol!,
      timeframe: row.timeframe!,
      inputMode: row.inputMode,
      converter: row.converter!,
      readFrom: row.readFrom!,
      capitalInitial: parseDecimal(row.capitalInitial),
      comment: row.comment,
      extendingAt: row.extendingAt,
    },
  }
}

/**
 * Atomically take the concurrent-extend lock by setting
 * `extending_at = NOW()`.
 *
 * The UPDATE is guarded by `WHERE extending_at IS NULL` so two CLI
 * invocations racing each other cannot both succeed: the second one's
 * UPDATE matches zero rows and we throw.
 *
 * Note: this does NOT touch `cmd` or `batch_uid`. The original launch
 * command and label stay as the permanent record of how the run was
 * created; the extension flow is identified by its own submissionUid in
 * Redis only.
 *
 * Throws ExtensionLockHeldError if the lock is already held. Caller may
 * surface the error to the user with a recovery hint pointing at the
 * `UPDATE backtest_runs SET extending_at = NULL WHERE id = ...` escape hatch
 * for the rare case of a crashed extender.
 */
export class ExtensionLockHeldError extends Error {
  constructor(public readonly runId: number) {
    super(
      `[db/backtests] extension already in progress for run #${runId}. If the previous extender crashed, clear with: UPDATE backtest_runs SET extending_at = NULL WHERE id = ${runId};`,
    )
    this.name = 'ExtensionLockHeldError'
  }
}

export async function lockRunForExtension(runId: number): Promise<void> {
  const db = mustGetDb()
  const result = await db
    .update(backtestRuns)
    .set({ extendingAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(backtestRuns.id, runId), sql`${backtestRuns.extendingAt} IS NULL`))
  // mysql2 returns { affectedRows } on the first element of the tuple.
  const affected = Array.isArray(result)
    ? (result[0] as { affectedRows?: number })?.affectedRows
    : 0
  if (!affected || affected === 0) {
    throw new ExtensionLockHeldError(runId)
  }
}

/**
 * Merge an extension batch's results into the parent run. Inserts the new
 * per-market rows (continuing `idx` from `max(idx)+1`), inserts new failures,
 * recomputes segment stats over the UNION of existing + new markets, replaces
 * all `backtest_run_segments` rows for the run, and updates only lifecycle
 * columns on `backtest_runs`. All of this happens in a single DB transaction
 * so the run metadata never represents a half-applied extension.
 *
 * `cmd`, `batch_uid`, and `submission_uid` are NOT touched here — the parent
 * run keeps its original identity and label across extensions.
 */
export async function applyExtensionToRun(opts: {
  parentRunId: number
  marketStats: unknown[]
  failedMarkets?: BacktestFailureRecord[] | null
}): Promise<void> {
  const db = mustGetDb()
  const indexedNewMarketStats = coerceIndexedMarketStats(opts.marketStats)
  const newMarketStats = indexedNewMarketStats.map((entry) => entry.stats)
  const newFailures = opts.failedMarkets ?? []

  await db.transaction(async (tx) => {
    // Load parent + existing markets. SELECT FOR UPDATE locks the parent row
    // for the duration of the transaction so two concurrent extensions can't
    // race the UPDATE-stats step. MySQL escalates to row lock automatically
    // for primary key lookups.
    const [parent] = await tx
      .select({
        id: backtestRuns.id,
        capitalInitial: backtestRuns.capitalInitial,
        failuresCount: backtestRuns.failuresCount,
      })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, opts.parentRunId))
      .for('update')
      .limit(1)
    if (!parent) {
      throw new Error(`[db/backtests] applyExtensionToRun: run #${opts.parentRunId} not found`)
    }

    const existingRows = await tx
      .select()
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, opts.parentRunId))
      .orderBy(asc(backtestRunMarkets.idx))

    // Idempotency guard. BullMQ's stalled-job recovery is independent of
    // `attempts` and can re-deliver an aggregate that already committed its
    // merge. If every incoming slug is already present, this is a replay —
    // no-op and clear the lock. Partial overlap means planExtension raced
    // with a concurrent extender despite the extending_at lock (e.g. manual
    // clear) and inserting would corrupt stats; bail loudly. UNIQUE(run_id,
    // slug) is the schema backstop if this check is ever bypassed.
    if (newMarketStats.length > 0) {
      const existingSlugs = new Set(existingRows.map((r) => r.slug))
      const incomingSlugs = newMarketStats.map((m) => m.slug)
      const overlapping = incomingSlugs.filter((s) => existingSlugs.has(s))
      if (overlapping.length === incomingSlugs.length) {
        console.warn(
          `[db/backtests] applyExtensionToRun: all ${incomingSlugs.length} incoming slugs already present for run #${opts.parentRunId}; treating as idempotent retry (no-op).`,
        )
        await tx
          .update(backtestRuns)
          .set({ extendingAt: null })
          .where(eq(backtestRuns.id, opts.parentRunId))
        return
      }
      if (overlapping.length > 0) {
        const sample = overlapping.slice(0, 5).join(', ')
        throw new Error(
          `[db/backtests] applyExtensionToRun: partial slug overlap for run #${opts.parentRunId} (${overlapping.length}/${incomingSlugs.length} already present, e.g. ${sample}). ` +
            `This indicates planExtension raced with another extender. Refusing to insert to avoid stats corruption.`,
        )
      }
    }

    const existingStats: MarketStats[] = existingRows.map((m) => {
      const execution: MarketExecutionMeta | undefined =
        m.machineId !== null &&
        m.startedAtMs !== null &&
        m.finishedAtMs !== null &&
        m.durationMs !== null &&
        m.eventsProcessed !== null
          ? {
              machineId: m.machineId,
              workerChildId: m.workerChildId,
              startedAtMs: m.startedAtMs,
              finishedAtMs: m.finishedAtMs,
              durationMs: m.durationMs,
              eventsProcessed: m.eventsProcessed,
              eventsByType: parseJsonValue<Record<string, number>>(m.eventsByType ?? {}),
              commitSha: m.commitSha ?? '',
            }
          : undefined
      return {
        marketId: m.marketId,
        slug: m.slug,
        finalOutcome: m.finalOutcome,
        pnl: parseDecimal(m.pnl),
        tradeCount: m.tradeCount,
        tradeAsMaker: m.tradeAsMaker,
        tradeAsTaker: m.tradeAsTaker,
        feesPaid: parseDecimal(m.feesPaid),
        avgEntryPriceUp: m.avgEntryPriceUp === null ? null : parseDecimal(m.avgEntryPriceUp),
        avgEntryPriceDown: m.avgEntryPriceDown === null ? null : parseDecimal(m.avgEntryPriceDown),
        upShares: parseDecimal(m.upShares),
        downShares: parseDecimal(m.downShares),
        mergableShares: parseDecimal(m.mergableShares),
        cost: parseDecimal(m.cost),
        splitCost: parseDecimal(m.splitCost),
        intentMeta: parseJsonValue<Array<Record<string, unknown>>>(m.intentMeta),
        ...(m.skipReason ? { skipReason: m.skipReason } : {}),
        ...(execution ? { execution } : {}),
      }
    })

    // Insert new market rows with idx continuing from existing max.
    const nextIdx = existingRows.length > 0 ? existingRows[existingRows.length - 1]!.idx + 1 : 0
    for (let start = 0; start < indexedNewMarketStats.length; start += MARKET_INSERT_BATCH_SIZE) {
      const chunk = indexedNewMarketStats.slice(start, start + MARKET_INSERT_BATCH_SIZE)
      await tx.insert(backtestRunMarkets).values(
        chunk.map((entry) => ({
          runId: opts.parentRunId,
          idx: nextIdx + entry.idx,
          marketId: entry.stats.marketId,
          slug: entry.stats.slug,
          marketStartMs: slugTs(entry.stats.slug),
          finalOutcome: entry.stats.finalOutcome,
          skipReason: entry.stats.skipReason ?? null,
          pnl: toDecimal(entry.stats.pnl),
          tradeCount: entry.stats.tradeCount,
          tradeAsMaker: entry.stats.tradeAsMaker,
          tradeAsTaker: entry.stats.tradeAsTaker,
          feesPaid: toDecimal(entry.stats.feesPaid),
          avgEntryPriceUp:
            entry.stats.avgEntryPriceUp === null ? null : toDecimal(entry.stats.avgEntryPriceUp),
          avgEntryPriceDown:
            entry.stats.avgEntryPriceDown === null
              ? null
              : toDecimal(entry.stats.avgEntryPriceDown),
          upShares: toDecimal(entry.stats.upShares),
          downShares: toDecimal(entry.stats.downShares),
          mergableShares: toDecimal(entry.stats.mergableShares),
          cost: toDecimal(entry.stats.cost),
          splitCost: toDecimal(entry.stats.splitCost),
          intentMeta: entry.stats.intentMeta,
          machineId: entry.stats.execution?.machineId ?? null,
          workerChildId: entry.stats.execution?.workerChildId ?? null,
          startedAtMs: entry.stats.execution?.startedAtMs ?? null,
          finishedAtMs: entry.stats.execution?.finishedAtMs ?? null,
          durationMs: entry.stats.execution?.durationMs ?? null,
          eventsProcessed: entry.stats.execution?.eventsProcessed ?? null,
          eventsByType: entry.stats.execution?.eventsByType ?? null,
          commitSha: entry.stats.execution?.commitSha ?? null,
        })),
      )
    }

    let resolvedFailureCount = 0
    const successfulSlugs = Array.from(new Set(newMarketStats.map((m) => m.slug)))
    if (successfulSlugs.length > 0) {
      const resolvedRows = await tx
        .select({ id: backtestRunFailures.id })
        .from(backtestRunFailures)
        .where(
          and(
            eq(backtestRunFailures.runId, opts.parentRunId),
            inArray(backtestRunFailures.slug, successfulSlugs),
          ),
        )
      resolvedFailureCount = resolvedRows.length
      if (resolvedRows.length > 0) {
        await tx.delete(backtestRunFailures).where(
          inArray(
            backtestRunFailures.id,
            resolvedRows.map((row) => row.id),
          ),
        )
      }
    }

    // Insert new failures. Offset the local child idx (0..N-1 within the
    // extension batch) by `nextIdx` so the failure row's `idx` matches the
    // GLOBAL position within the parent run — same offset used for
    // successful market rows above. Without this, an extension child failing
    // at local idx=3 would write idx=3, colliding with the parent's
    // original idx=3 failure (if any) and pointing the dashboard at the
    // wrong run position.
    if (newFailures.length > 0) {
      await tx.insert(backtestRunFailures).values(
        newFailures.map((f) => ({
          runId: opts.parentRunId,
          jobId: f.jobId ?? null,
          idx: f.idx === null ? null : nextIdx + f.idx,
          slug: f.slug,
          reason: f.reason,
        })),
      )
    }

    // Recompute segments over the UNION. Segment stats are order-sensitive
    // (streak fields reduce in array order), so we MUST present markets in
    // chronological order — otherwise a backward extension (newMarketStats
    // older than existing) would yield different streaks than an equivalent
    // fresh full run over the same set.
    const allMarketsWithStartMs = [...existingStats, ...newMarketStats].map((m) => ({
      ...m,
      marketStartMs: slugTs(m.slug),
    }))
    allMarketsWithStartMs.sort((a, b) => a.marketStartMs - b.marketStartMs)
    const capitalInitial = parseDecimal(parent.capitalInitial)
    const segments = computeBacktestSegments(allMarketsWithStartMs, capitalInitial)
    const totalFailures = computeExtendedFailureCount(
      parent.failuresCount,
      newFailures.length,
      resolvedFailureCount,
    )
    const status = runStatus(allMarketsWithStartMs.length, totalFailures)

    // Replace all segments for this run with the freshly-computed set.
    // Inside the same transaction so callers never observe the new metadata
    // alongside a partial segment view.
    await tx.delete(backtestRunSegments).where(eq(backtestRunSegments.runId, opts.parentRunId))
    for (let start = 0; start < segments.length; start += SEGMENT_INSERT_BATCH_SIZE) {
      const chunk = segments.slice(start, start + SEGMENT_INSERT_BATCH_SIZE)
      if (chunk.length > 0) {
        await tx
          .insert(backtestRunSegments)
          .values(chunk.map((s) => segmentRowToInsert(opts.parentRunId, s)))
      }
    }

    await tx
      .update(backtestRuns)
      .set({
        status,
        marketsPersisted: allMarketsWithStartMs.length,
        failuresCount: totalFailures,
        // Release the concurrent-extend lock in the same transaction as the
        // merge UPDATE so the row is never visible as "no lock held" while
        // the new markets and segments aren't yet visible.
        extendingAt: null,
      })
      .where(eq(backtestRuns.id, opts.parentRunId))
  })
}

/**
 * Manually clear a stuck extension lock. Use when the extender process
 * crashed (terminal closed, kill -9, etc.) and `extending_at` stayed set.
 * Returns true if the lock was actually released, false if it was already
 * NULL.
 */
export type BacktestRunSegmentRow = typeof backtestRunSegments.$inferSelect

/**
 * List all segment rows for a run, ordered by kind then ord (so callers can
 * group on `segmentKind` and get the natural display order within each kind).
 */
export async function listSegmentsForRun(runId: number): Promise<BacktestRunSegmentRow[]> {
  const db = mustGetDb()
  return db
    .select()
    .from(backtestRunSegments)
    .where(eq(backtestRunSegments.runId, runId))
    .orderBy(asc(backtestRunSegments.segmentKind), asc(backtestRunSegments.segmentOrd))
}

export async function clearExtensionLock(runId: number): Promise<boolean> {
  const db = mustGetDb()
  const result = await db
    .update(backtestRuns)
    .set({ extendingAt: null })
    .where(and(eq(backtestRuns.id, runId), sql`${backtestRuns.extendingAt} IS NOT NULL`))
  const affected = Array.isArray(result)
    ? (result[0] as { affectedRows?: number })?.affectedRows
    : 0
  return Boolean(affected && affected > 0)
}
