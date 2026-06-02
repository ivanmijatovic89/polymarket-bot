import { asc, eq } from 'drizzle-orm'
import type { BatchStats } from '../backtest/stats/batchStats.js'
import type { MarketExecutionMeta, MarketStats } from '../backtest/stats/marketStats.js'
import { getDb } from './index.js'
import { backtestRunFailures, backtestRunMarkets, backtestRuns } from './schema.js'

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
