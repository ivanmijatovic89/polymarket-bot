// chunkedBatchStats.ts

import type { MarketStats } from './marketStats.js'
import type { BatchStats } from './batchStats.js'
import { computeBatchStats } from './batchStats.js'
import { computeWalkForwardForRun, type WalkForwardWindowMetrics } from './walkForwardRank.js'

export type ChunkedBatchStatsRun = {
  window: number

  segments: Array<{
    i: number
    fromTs: number
    toTs: number
    marketsTotal: number
    batch_stats: BatchStats
  }>

  segmentsCount: number
  positivePct: number
  maxConsecutiveNegative: number
  stabilityPass: boolean
  walkForward: WalkForwardWindowMetrics
  version: number
}

export type ChunkedBatchStats = {
  windows: ChunkedBatchStatsRun[]
  version: number
}

const VERSION = 4

function slugTs(slug: string): number {
  return Number(slug.split('-').pop())
}

/**
 * Chunk into fixed windows and ALWAYS append remainder to the last chunk.
 * Example: 1350 @ 300 => 300,300,300,450
 */
function chunkWithRemainderToLast<T>(arr: T[], window: number): T[][] {
  if (window <= 0) throw new Error(`window must be > 0, got ${window}`)
  if (arr.length === 0) return []

  const fullCount = Math.floor(arr.length / window)
  const rem = arr.length % window

  // if everything fits in one chunk
  if (fullCount === 0) return [arr.slice()]

  const out: T[][] = []
  for (let i = 0; i < fullCount; i++) {
    out.push(arr.slice(i * window, (i + 1) * window))
  }

  // append remainder to last chunk
  if (rem > 0) {
    const tail = arr.slice(fullCount * window)
    out[out.length - 1] = out[out.length - 1].concat(tail)
  }

  return out
}

function computeMaxConsecutiveNegative(evs: number[]): number {
  let cur = 0
  let best = 0

  for (const ev of evs) {
    if (ev < 0) {
      cur += 1
      if (cur > best) best = cur
    } else {
      cur = 0
    }
  }

  return best
}

function computeChunkedRun(
  marketsSorted: MarketStats[],
  initialCapital: number,
  window: number,
): ChunkedBatchStatsRun {
  const chunks = chunkWithRemainderToLast(marketsSorted, window)

  let runningCapital = initialCapital

  const segments = chunks.map((chunk, i) => {
    const fromTs = slugTs(chunk[0].slug)
    const toTs = slugTs(chunk[chunk.length - 1].slug)

    const batch_stats = computeBatchStats(chunk, runningCapital)
    runningCapital = batch_stats.capitalFinal

    return {
      i,
      fromTs,
      toTs,
      marketsTotal: chunk.length,
      batch_stats,
    }
  })

  const evs = segments.map((s) => s.batch_stats.evPerMarketTotal)
  const positive = evs.filter((ev) => ev >= 0).length
  const positivePct = evs.length > 0 ? positive / evs.length : 0
  const maxConsecutiveNegative = computeMaxConsecutiveNegative(evs)

  const stabilityPass = positivePct >= 0.7

  return {
    window,
    segments,
    segmentsCount: segments.length,
    positivePct,
    maxConsecutiveNegative,
    stabilityPass,
    walkForward: computeWalkForwardForRun({ segments }),
    version: VERSION,
  }
}

/**
 * Computes chunked batch_stats for multiple windows (default: 96 / 200 / 300).
 */
export function computeChunkedBatchStats(
  markets: MarketStats[],
  initialCapital: number,
  windows: number[] = [96],
): ChunkedBatchStats {
  const marketsSorted = [...markets].sort(
    (a, b) => slugTs(a.slug) - slugTs(b.slug),
  )

  const runs = windows.map((window) =>
    computeChunkedRun(marketsSorted, initialCapital, window),
  )

  return {
    windows: runs,
    version: VERSION,
  }
}
