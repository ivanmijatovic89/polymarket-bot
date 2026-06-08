import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { backtestRunSegments, backtestRuns } from '@/lib/schema'

export const dynamic = 'force-dynamic'

const SEGMENT_KINDS = ['all', 'last_n', 'daily', 'weekly', 'monthly'] as const
type SegmentKind = (typeof SEGMENT_KINDS)[number]

function parseKind(raw: string | null): SegmentKind | null {
  if (!raw) return null
  return (SEGMENT_KINDS as readonly string[]).includes(raw) ? (raw as SegmentKind) : null
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Row shape returned by `/api/backtests/[id]/chunks`. Matches
 * `BacktestSummary` so it can be rendered by `BacktestSummaryTable`.
 */
export type ChunkSegmentRow = {
  segmentKind: SegmentKind
  segmentKey: string
  segmentOrd: number
  fromMs: number
  toMs: number
  status: 'completed'
  strategy: string
  symbol: string | null
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  failuresCount: 0
  pnlTotal: number
  winRatePct: number
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
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  capitalInitial: number
  capitalFinal: number
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await context.params
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const kind = parseKind(req.nextUrl.searchParams.get('kind'))
  const db = getDb()

  const [run] = await db
    .select({ strategy: backtestRuns.strategy, symbol: backtestRuns.symbol })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, id))
    .limit(1)
  if (!run) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const where = kind
    ? and(eq(backtestRunSegments.runId, id), eq(backtestRunSegments.segmentKind, kind))
    : eq(backtestRunSegments.runId, id)

  const rows = await db
    .select()
    .from(backtestRunSegments)
    .where(where)
    .orderBy(asc(backtestRunSegments.segmentKind), asc(backtestRunSegments.segmentOrd))

  const segments: ChunkSegmentRow[] = rows.map((r) => ({
    segmentKind: r.segmentKind,
    segmentKey: r.segmentKey,
    segmentOrd: r.segmentOrd,
    fromMs: r.fromMs,
    toMs: r.toMs,
    status: 'completed',
    strategy: run.strategy,
    symbol: run.symbol,
    marketsTotal: r.marketsTotal,
    marketsPlayed: r.marketsPlayed,
    marketsSkipped: r.marketsSkipped,
    failuresCount: 0,
    pnlTotal: toNumber(r.pnlTotal),
    winRatePct: toNumber(r.winRatePct),
    pnlAvgWin: toNumber(r.pnlAvgWin),
    pnlAvgLose: toNumber(r.pnlAvgLose),
    evPerMarketPlayed: toNumber(r.evPerMarketPlayed),
    evPerMarketTotal: toNumber(r.evPerMarketTotal),
    streakMaxWin: r.streakMaxWin,
    streakMaxLose: r.streakMaxLose,
    streakMaxWinPnl: toNumber(r.streakMaxWinPnl),
    streakMaxLosePnl: toNumber(r.streakMaxLosePnl),
    qualitySystem: r.qualitySystem === null ? null : toNumber(r.qualitySystem),
    qualityTrade: r.qualityTrade === null ? null : toNumber(r.qualityTrade),
    totalFeesPaid: toNumber(r.totalFeesPaid),
    tradesTotal: r.tradesTotal,
    tradesMaker: r.tradesMaker,
    tradesTaker: r.tradesTaker,
    capitalInitial: toNumber(r.capitalInitial),
    capitalFinal: toNumber(r.capitalFinal),
  }))

  return NextResponse.json({ segments })
}
