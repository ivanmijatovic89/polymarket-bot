import { NextResponse, type NextRequest } from 'next/server'
import { getBacktestRunById } from '@/lib/queries/batches'
import { computeBatchStats } from '@polymarket-bot/stats/batchStats'
import type { MarketStats } from '@polymarket-bot/stats/marketStats'

/**
 * Chunking algorithm — fixed window with trailing remainder rolled into
 * the last chunk. Mirrors `chunkWithRemainderToLast` from the root's
 * `chunkedBatchStats.ts`. Inlined here because importing the root's
 * `chunkedBatchStats` pulls in walkForwardRank.ts which we don't need
 * and triggers Turbopack's `.js → .ts` resolution gap for cross-package
 * relative imports. `computeBatchStats` itself has only a type-only
 * import (erased at compile), so it crosses the package boundary cleanly.
 */
function chunkWithRemainderToLast<T>(arr: T[], windowSize: number): T[][] {
  if (windowSize <= 0) throw new Error(`window must be > 0, got ${windowSize}`)
  if (arr.length === 0) return []
  const fullCount = Math.floor(arr.length / windowSize)
  const rem = arr.length % windowSize
  if (fullCount === 0) return [arr.slice()]
  const out: T[][] = []
  for (let i = 0; i < fullCount; i++) {
    out.push(arr.slice(i * windowSize, (i + 1) * windowSize))
  }
  if (rem > 0) {
    const tail = arr.slice(fullCount * windowSize)
    const lastChunk = out[out.length - 1]
    if (!lastChunk) throw new Error('internal error: missing last chunk')
    out[out.length - 1] = lastChunk.concat(tail)
  }
  return out
}

function slugTs(slug: string): number {
  return Number(slug.split('-').pop())
}

export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW = 96
const MIN_WINDOW = 1
const MAX_WINDOW = 10_000

export type ChunkSegmentRow = {
  chunkIndex: number
  fromMarketIdx: number
  toMarketIdx: number
  fromSlugTs: number
  toSlugTs: number
  status: 'completed'
  strategy: string
  symbol: string | null
  limit: number
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  failuresCount: number
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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await context.params
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const windowParam = Number(req.nextUrl.searchParams.get('window') ?? DEFAULT_WINDOW)
  const windowSize = Math.min(
    MAX_WINDOW,
    Math.max(
      MIN_WINDOW,
      Number.isFinite(windowParam) ? Math.floor(windowParam) : DEFAULT_WINDOW,
    ),
  )

  const run = await getBacktestRunById(id)
  if (!run) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const markets = run.marketStats ?? []
  if (markets.length === 0) {
    return NextResponse.json({ window: windowSize, segments: [] })
  }

  const sorted = [...(markets as MarketStats[])].sort(
    (a, b) => slugTs(a.slug) - slugTs(b.slug),
  )
  const chunks = chunkWithRemainderToLast(sorted, windowSize)

  const rows: ChunkSegmentRow[] = []
  let cursor = 0
  let runningCapital = run.capitalInitial
  chunks.forEach((chunk, i) => {
    const first = chunk[0]
    const last = chunk[chunk.length - 1]
    if (!first || !last) return
    const bs = computeBatchStats(chunk, runningCapital)
    runningCapital = bs.capitalFinal
    const from = cursor
    const to = cursor + chunk.length - 1
    cursor += chunk.length
    rows.push({
      chunkIndex: i,
      fromMarketIdx: from,
      toMarketIdx: to,
      fromSlugTs: slugTs(first.slug),
      toSlugTs: slugTs(last.slug),
      status: 'completed',
      strategy: run.strategy,
      symbol: run.symbol,
      limit: chunk.length,
      marketsTotal: bs.marketsTotal,
      marketsPlayed: bs.marketsPlayed,
      marketsSkipped: bs.marketsSkipped,
      failuresCount: 0,
      pnlTotal: bs.pnlTotal,
      winRatePct: bs.winRatePct,
      pnlAvgWin: bs.pnlAvgWin,
      pnlAvgLose: bs.pnlAvgLose,
      evPerMarketPlayed: bs.evPerMarketPlayed,
      evPerMarketTotal: bs.evPerMarketTotal,
      streakMaxWin: bs.streakMaxWin,
      streakMaxLose: bs.streakMaxLose,
      streakMaxWinPnl: bs.streakMaxWinPnl,
      streakMaxLosePnl: bs.streakMaxLosePnl,
      qualitySystem: bs.qualitySystem,
      qualityTrade: bs.qualityTrade,
      totalFeesPaid: bs.totalFeesPaid,
      tradesTotal: bs.tradesTotal,
      tradesMaker: bs.tradesMaker,
      tradesTaker: bs.tradesTaker,
      capitalInitial: bs.capitalInitial,
      capitalFinal: bs.capitalFinal,
    })
  })

  return NextResponse.json({ window: windowSize, segments: rows })
}
