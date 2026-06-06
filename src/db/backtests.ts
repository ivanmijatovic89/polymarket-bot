import { and, asc, eq, sql } from 'drizzle-orm'
import { computeBatchStats, type BatchStats } from '../backtest/stats/batchStats.js'
import { computeChunkedBatchStats, slugTs } from '../backtest/stats/chunkedBatchStats.js'
import type { MarketExecutionMeta, MarketStats } from '../backtest/stats/marketStats.js'
import { getDb } from './index.js'
import { backtestRunFailures, backtestRunMarkets, backtestRuns, telonexMarkets } from './schema.js'

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

export type BacktestRunRecord = {
  id: number
  batchUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  slugs: string[] | null
  limit: number | null
  random: boolean
  latest: boolean
  baselineId: string | null
  cmd: string | null
  comment: string | null
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
  chunkedBatchStats: Record<string, unknown> | null
  failedMarkets: BacktestFailureRecord[]
  createdAt: Date
}

export type BacktestRunSummary = {
  id: number
  batchUid: string
  marketsPersisted: number
  failuresCount: number
  createdAt: Date
}

type InsertBacktestRunRow = {
  batchUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  strategy: string
  params: Record<string, unknown>
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
  random: boolean
  latest: boolean
  batchStats: BatchStats
  marketStats: unknown[]
  chunkedBatchStats?: Record<string, unknown> | null
  failedMarkets?: BacktestFailureRecord[] | null
}

const MARKET_INSERT_BATCH_SIZE = 250

function toDecimal(value: number): string {
  return String(value)
}

function coerceMarketStats(raw: unknown[]): MarketStats[] {
  return raw.map((m, idx): MarketStats => {
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
  })
}

function runStatus(marketCount: number, failedCount: number): 'completed' | 'partial' | 'failed' {
  if (failedCount === 0) return 'completed'
  return marketCount > 0 ? 'partial' : 'failed'
}

export async function getBacktestRunSummaryByBatchUid(
  batchUid: string,
): Promise<BacktestRunSummary | null> {
  const db = mustGetDb()
  const [run] = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      marketsPersisted: backtestRuns.marketsPersisted,
      failuresCount: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
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

export async function insertBacktestRun(row: InsertBacktestRunRow): Promise<void> {
  const db = mustGetDb()
  const existing = await getBacktestRunSummaryByBatchUid(row.batchUid)
  if (existing) {
    throw new Error(
      `[db/backtests] batchUid already exists in MySQL: ${row.batchUid} ` +
        `(id=${existing.id}, marketsPersisted=${existing.marketsPersisted}, ` +
        `failuresCount=${existing.failuresCount}). Pick a new --batchUid.`,
    )
  }

  const batchStats = row.batchStats.toRunColumns()
  const marketStats = coerceMarketStats(row.marketStats)
  const failedMarkets = row.failedMarkets ?? []
  const status = runStatus(marketStats.length, failedMarkets.length)

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(backtestRuns)
      .values({
        batchUid: row.batchUid,
        status,
        baselineId: row.baselineId,
        cmd: row.cmd,
        comment: row.comment,
        strategy: row.strategy,
        params: row.params,
        symbol: row.symbol,
        timeframe: row.timeframe,
        inputMode: row.inputMode,
        converter: row.converter,
        readFrom: row.readFrom,
        slugs: row.slugs,
        limit: row.limit,
        random: row.random,
        latest: row.latest,
        inputMarketsTotal: row.limit ?? row.slugs?.length ?? null,
        marketsPersisted: marketStats.length,
        failuresCount: failedMarkets.length,
        capitalInitial: toDecimal(batchStats.capitalInitial),
        capitalFinal: toDecimal(batchStats.capitalFinal),
        pnlTotal: toDecimal(batchStats.pnlTotal),
        totalFeesPaid: toDecimal(batchStats.totalFeesPaid),
        qualitySystem:
          batchStats.qualitySystem === null ? null : toDecimal(batchStats.qualitySystem),
        qualityTrade: batchStats.qualityTrade === null ? null : toDecimal(batchStats.qualityTrade),
        evPerMarketPlayed: toDecimal(batchStats.evPerMarketPlayed),
        evPerMarketTotal: toDecimal(batchStats.evPerMarketTotal),
        marketsTotal: batchStats.marketsTotal,
        marketsSkipped: batchStats.marketsSkipped,
        marketsNoInWindowActivity: batchStats.marketsNoInWindowActivity,
        marketsFlatWithTrades: batchStats.marketsFlatWithTrades,
        marketsPlayed: batchStats.marketsPlayed,
        marketsWon: batchStats.marketsWon,
        marketsLost: batchStats.marketsLost,
        winRate: toDecimal(batchStats.winRate),
        winRatePct: toDecimal(batchStats.winRatePct),
        tradesTotal: batchStats.tradesTotal,
        tradesMaker: batchStats.tradesMaker,
        tradesTaker: batchStats.tradesTaker,
        pnlAvgWin: toDecimal(batchStats.pnlAvgWin),
        pnlAvgLose: toDecimal(batchStats.pnlAvgLose),
        pnlMaxWin: toDecimal(batchStats.pnlMaxWin),
        pnlMaxLose: toDecimal(batchStats.pnlMaxLose),
        streakMaxWin: batchStats.streakMaxWin,
        streakMaxLose: batchStats.streakMaxLose,
        streakMaxWinPnl: toDecimal(batchStats.streakMaxWinPnl),
        streakMaxLosePnl: toDecimal(batchStats.streakMaxLosePnl),
        streakMaxSkipped: batchStats.streakMaxSkipped,
        chunkedBatchStats: row.chunkedBatchStats ?? null,
      })
      .$returningId()

    const runId = inserted[0]?.id
    if (typeof runId !== 'number') throw new Error('[db/backtests] insert did not return run id')

    for (let start = 0; start < marketStats.length; start += MARKET_INSERT_BATCH_SIZE) {
      const chunk = marketStats.slice(start, start + MARKET_INSERT_BATCH_SIZE)
      await tx.insert(backtestRunMarkets).values(
        chunk.map((m, offset) => ({
          runId,
          idx: start + offset,
          marketId: m.marketId,
          slug: m.slug,
          finalOutcome: m.finalOutcome,
          skipReason: m.skipReason ?? null,
          pnl: toDecimal(m.pnl),
          tradeCount: m.tradeCount,
          tradeAsMaker: m.tradeAsMaker,
          tradeAsTaker: m.tradeAsTaker,
          feesPaid: toDecimal(m.feesPaid),
          avgEntryPriceUp: m.avgEntryPriceUp === null ? null : toDecimal(m.avgEntryPriceUp),
          avgEntryPriceDown: m.avgEntryPriceDown === null ? null : toDecimal(m.avgEntryPriceDown),
          upShares: toDecimal(m.upShares),
          downShares: toDecimal(m.downShares),
          mergableShares: toDecimal(m.mergableShares),
          cost: toDecimal(m.cost),
          splitCost: toDecimal(m.splitCost),
          intentMeta: m.intentMeta,
          machineId: m.execution?.machineId ?? null,
          startedAtMs: m.execution?.startedAtMs ?? null,
          finishedAtMs: m.execution?.finishedAtMs ?? null,
          durationMs: m.execution?.durationMs ?? null,
          eventsProcessed: m.execution?.eventsProcessed ?? null,
          eventsByType: m.execution?.eventsByType ?? null,
          commitSha: m.execution?.commitSha ?? null,
        })),
      )
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

export async function getBacktestRunByBatchUid(
  batchUid: string,
): Promise<BacktestRunRecord | null> {
  const db = mustGetDb()
  const [run] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
    .limit(1)
  if (!run) return null
  return hydrateBacktestRun(run)
}

async function hydrateBacktestRun(
  run: typeof backtestRuns.$inferSelect,
): Promise<BacktestRunRecord> {
  const db = mustGetDb()
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

  const marketStats: MarketStats[] = marketRows.map((m) => {
    const execution: MarketExecutionMeta | undefined =
      m.machineId !== null &&
      m.startedAtMs !== null &&
      m.finishedAtMs !== null &&
      m.durationMs !== null &&
      m.eventsProcessed !== null
        ? {
            machineId: m.machineId,
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
    status: run.status,
    strategy: run.strategy,
    params: parseJsonValue<Record<string, unknown>>(run.params),
    symbol: run.symbol,
    slugs: parseJsonValue<string[] | null>(run.slugs),
    limit: run.limit,
    random: run.random,
    latest: run.latest,
    baselineId: run.baselineId,
    cmd: run.cmd,
    comment: run.comment,
    capitalInitial: parseDecimal(run.capitalInitial),
    capitalFinal: parseDecimal(run.capitalFinal),
    pnlTotal: parseDecimal(run.pnlTotal),
    totalFeesPaid: parseDecimal(run.totalFeesPaid),
    qualitySystem: run.qualitySystem === null ? null : parseDecimal(run.qualitySystem),
    qualityTrade: run.qualityTrade === null ? null : parseDecimal(run.qualityTrade),
    evPerMarketPlayed: parseDecimal(run.evPerMarketPlayed),
    evPerMarketTotal: parseDecimal(run.evPerMarketTotal),
    marketsTotal: run.marketsTotal,
    marketsSkipped: run.marketsSkipped,
    marketsNoInWindowActivity: run.marketsNoInWindowActivity,
    marketsFlatWithTrades: run.marketsFlatWithTrades,
    marketsPlayed: run.marketsPlayed,
    marketsWon: run.marketsWon,
    marketsLost: run.marketsLost,
    winRate: parseDecimal(run.winRate),
    winRatePct: parseDecimal(run.winRatePct),
    tradesTotal: run.tradesTotal,
    tradesMaker: run.tradesMaker,
    tradesTaker: run.tradesTaker,
    pnlAvgWin: parseDecimal(run.pnlAvgWin),
    pnlAvgLose: parseDecimal(run.pnlAvgLose),
    pnlMaxWin: parseDecimal(run.pnlMaxWin),
    pnlMaxLose: parseDecimal(run.pnlMaxLose),
    streakMaxWin: run.streakMaxWin,
    streakMaxLose: run.streakMaxLose,
    streakMaxWinPnl: parseDecimal(run.streakMaxWinPnl),
    streakMaxLosePnl: parseDecimal(run.streakMaxLosePnl),
    streakMaxSkipped: run.streakMaxSkipped,
    marketStats,
    chunkedBatchStats: parseJsonValue<Record<string, unknown> | null>(run.chunkedBatchStats),
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
  strategy: string
  params: Record<string, unknown>
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
      strategy: backtestRuns.strategy,
      params: backtestRuns.params,
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
      strategy: row.strategy,
      params: parseJsonValue<Record<string, unknown>>(row.params),
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
 * Update the run's `batch_uid` eagerly when an extension flow is enqueued
 * AND atomically take the concurrent-extend lock by setting
 * `extending_at = NOW()`. Updating batch_uid before BullMQ enqueue means
 * the dashboard's `/batches/<batchUid>` lookup immediately finds the
 * parent run by the new batchUid, instead of 404-ing during processing.
 *
 * The lock + UPDATE is one statement guarded by `WHERE extending_at IS NULL`
 * so two CLI invocations racing each other cannot both succeed: the second
 * one's UPDATE matches zero rows and we throw.
 *
 * Note: this does NOT touch `cmd`. The original launch command stays as the
 * permanent record of how the run was created; per-extend invocations are
 * intentionally not recorded in this iteration. If you need an audit trail
 * later, the recovery is a `cmd_history` JSON column or a separate audit
 * table — both can be added without touching this function's contract.
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

export async function markRunForExtendingBatch(runId: number, newBatchUid: string): Promise<void> {
  const db = mustGetDb()
  const result = await db
    .update(backtestRuns)
    .set({ batchUid: newBatchUid, extendingAt: sql`CURRENT_TIMESTAMP` })
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
 * recomputes `batch_stats` and `chunked_batch_stats` over the UNION of
 * existing + new markets, and UPDATEs `backtest_runs` with the new derived
 * columns. All of this happens in a single DB transaction so the run's row
 * never represents a half-applied extension.
 *
 * `cmd` and `batch_uid` are NOT touched here — they were already updated by
 * `markRunForExtendingBatch` at enqueue time.
 */
export async function applyExtensionToRun(opts: {
  parentRunId: number
  marketStats: unknown[]
  failedMarkets?: BacktestFailureRecord[] | null
  chunkedWindows?: number[]
}): Promise<void> {
  const db = mustGetDb()
  const newMarketStats = coerceMarketStats(opts.marketStats)
  const newFailures = opts.failedMarkets ?? []
  const chunkedWindows = opts.chunkedWindows ?? [96, 200, 300]

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
    for (let start = 0; start < newMarketStats.length; start += MARKET_INSERT_BATCH_SIZE) {
      const chunk = newMarketStats.slice(start, start + MARKET_INSERT_BATCH_SIZE)
      await tx.insert(backtestRunMarkets).values(
        chunk.map((m, offset) => ({
          runId: opts.parentRunId,
          idx: nextIdx + start + offset,
          marketId: m.marketId,
          slug: m.slug,
          finalOutcome: m.finalOutcome,
          skipReason: m.skipReason ?? null,
          pnl: toDecimal(m.pnl),
          tradeCount: m.tradeCount,
          tradeAsMaker: m.tradeAsMaker,
          tradeAsTaker: m.tradeAsTaker,
          feesPaid: toDecimal(m.feesPaid),
          avgEntryPriceUp: m.avgEntryPriceUp === null ? null : toDecimal(m.avgEntryPriceUp),
          avgEntryPriceDown: m.avgEntryPriceDown === null ? null : toDecimal(m.avgEntryPriceDown),
          upShares: toDecimal(m.upShares),
          downShares: toDecimal(m.downShares),
          mergableShares: toDecimal(m.mergableShares),
          cost: toDecimal(m.cost),
          splitCost: toDecimal(m.splitCost),
          intentMeta: m.intentMeta,
          machineId: m.execution?.machineId ?? null,
          startedAtMs: m.execution?.startedAtMs ?? null,
          finishedAtMs: m.execution?.finishedAtMs ?? null,
          durationMs: m.execution?.durationMs ?? null,
          eventsProcessed: m.execution?.eventsProcessed ?? null,
          eventsByType: m.execution?.eventsByType ?? null,
          commitSha: m.execution?.commitSha ?? null,
        })),
      )
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

    // Recompute stats over the UNION. `computeBatchStats` is order-sensitive
    // (streak fields reduce in array order), so we MUST present markets in
    // chronological order — otherwise a backward extension (newMarketStats
    // older than existing) would yield different streaks than an equivalent
    // fresh full run over the same set. `computeChunkedBatchStats` re-sorts
    // by slugTs internally; sorting here harmonizes both.
    const allMarkets = [...existingStats, ...newMarketStats].sort(
      (a, b) => slugTs(a.slug) - slugTs(b.slug),
    )
    const capitalInitial = parseDecimal(parent.capitalInitial)
    const batchStats = computeBatchStats(allMarkets, capitalInitial)
    const chunkedBatchStats = computeChunkedBatchStats(allMarkets, capitalInitial, chunkedWindows)
    const totalFailures = parent.failuresCount + newFailures.length
    const status = runStatus(allMarkets.length, totalFailures)

    await tx
      .update(backtestRuns)
      .set({
        status,
        marketsPersisted: allMarkets.length,
        failuresCount: totalFailures,
        capitalFinal: toDecimal(batchStats.capitalFinal),
        pnlTotal: toDecimal(batchStats.pnlTotal),
        totalFeesPaid: toDecimal(batchStats.totalFeesPaid),
        qualitySystem:
          batchStats.qualitySystem === null ? null : toDecimal(batchStats.qualitySystem),
        qualityTrade: batchStats.qualityTrade === null ? null : toDecimal(batchStats.qualityTrade),
        evPerMarketPlayed: toDecimal(batchStats.evPerMarketPlayed),
        evPerMarketTotal: toDecimal(batchStats.evPerMarketTotal),
        marketsTotal: batchStats.marketsTotal,
        marketsSkipped: batchStats.marketsSkipped,
        marketsNoInWindowActivity: batchStats.marketsNoInWindowActivity,
        marketsFlatWithTrades: batchStats.marketsFlatWithTrades,
        marketsPlayed: batchStats.marketsPlayed,
        marketsWon: batchStats.marketsWon,
        marketsLost: batchStats.marketsLost,
        winRate: toDecimal(batchStats.winRate),
        winRatePct: toDecimal(batchStats.winRatePct),
        tradesTotal: batchStats.tradesTotal,
        tradesMaker: batchStats.tradesMaker,
        tradesTaker: batchStats.tradesTaker,
        pnlAvgWin: toDecimal(batchStats.pnlAvgWin),
        pnlAvgLose: toDecimal(batchStats.pnlAvgLose),
        pnlMaxWin: toDecimal(batchStats.pnlMaxWin),
        pnlMaxLose: toDecimal(batchStats.pnlMaxLose),
        streakMaxWin: batchStats.streakMaxWin,
        streakMaxLose: batchStats.streakMaxLose,
        streakMaxWinPnl: toDecimal(batchStats.streakMaxWinPnl),
        streakMaxLosePnl: toDecimal(batchStats.streakMaxLosePnl),
        streakMaxSkipped: batchStats.streakMaxSkipped,
        chunkedBatchStats: chunkedBatchStats as unknown as Record<string, unknown>,
        // Release the concurrent-extend lock in the same transaction as the
        // merge UPDATE — so the row is never visible as "no lock held" while
        // the new markets aren't yet visible.
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
