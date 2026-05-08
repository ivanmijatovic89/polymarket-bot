export type WalkForwardFoldMetrics = {
  wfMeanEv: number
  wfBadSegs: number
  stabilityPass: boolean
}

export type WalkForwardWindowMetrics = {
  segmentCount: number
  minEv: number
  tailPositivePct: number
  tailMeanEv: number
  wfMeanEv: number
  wfBadSegs: number
  feesPerMarketAll: number
  stabilityPass: boolean
  foldMode: 'fold3' | 'fold2' | 'none'
  fold2?: WalkForwardFoldMetrics
  fold3?: WalkForwardFoldMetrics
  version: number
}

const VERSION = 1

const TAIL_SIZE = 4
const FOLD2_START_OFFSET = 7
const FOLD3_START_OFFSET = 10

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stabilityGate(params: {
  tailPositivePct: number
  minEv: number
  segmentCount: number
}): boolean {
  return params.segmentCount >= 4 && params.tailPositivePct >= 1 && params.minEv >= -0.3
}

function computeTailStats(evs: number[]): {
  tailPositivePct: number
  tailMeanEv: number
} {
  const tail = evs.slice(-TAIL_SIZE)
  if (tail.length === 0) return { tailPositivePct: 0, tailMeanEv: 0 }
  const positive = tail.filter((ev) => ev >= 0).length
  return {
    tailPositivePct: positive / tail.length,
    tailMeanEv: mean(tail),
  }
}

function computeFoldMetrics(params: {
  evs: number[]
  tailPositivePct: number
  foldIndices: number[]
}): WalkForwardFoldMetrics {
  const foldEvs = params.foldIndices.map((i) => params.evs[i] ?? 0)
  const wfMeanEv = mean(foldEvs)
  const wfBadSegs = foldEvs.filter((ev) => ev < 0).length
  const minEv = foldEvs.length > 0 ? Math.min(...foldEvs) : 0
  const stabilityPass = stabilityGate({
    tailPositivePct: params.tailPositivePct,
    minEv,
    segmentCount: foldEvs.length,
  })

  return { wfMeanEv, wfBadSegs, stabilityPass }
}

function feesPerMarketAll(
  segments: Array<{ batch_stats: { totalFeesPaid: number; marketsTotal: number } }>,
): number {
  const totals = segments.reduce(
    (acc, seg) => {
      acc.fees += seg.batch_stats.totalFeesPaid
      acc.markets += seg.batch_stats.marketsTotal
      return acc
    },
    { fees: 0, markets: 0 },
  )
  if (totals.markets === 0) return 0
  return totals.fees / totals.markets
}

export function computeWalkForwardForRun(params: {
  segments: Array<{
    batch_stats: { evPerMarketTotal: number; totalFeesPaid: number; marketsTotal: number }
  }>
}): WalkForwardWindowMetrics {
  const evs = params.segments.map((s) => s.batch_stats.evPerMarketTotal)
  const segmentCount = evs.length
  const minEv = evs.length > 0 ? Math.min(...evs) : 0
  const { tailPositivePct, tailMeanEv } = computeTailStats(evs)
  const stabilityPass = stabilityGate({ tailPositivePct, minEv, segmentCount })

  let foldMode: WalkForwardWindowMetrics['foldMode'] = 'none'
  let fold2: WalkForwardFoldMetrics | undefined
  let fold3: WalkForwardFoldMetrics | undefined

  if (segmentCount >= FOLD3_START_OFFSET) {
    const start = segmentCount - FOLD3_START_OFFSET
    const foldIndices = [
      start,
      start + 1,
      start + 2,
      start + 3,
      start + 4,
      start + 5,
      segmentCount - 4,
      segmentCount - 3,
      segmentCount - 2,
      segmentCount - 1,
    ]
    fold3 = computeFoldMetrics({ evs, tailPositivePct, foldIndices })
    foldMode = 'fold3'
  }

  if (segmentCount >= FOLD2_START_OFFSET) {
    const start = segmentCount - FOLD2_START_OFFSET
    const foldIndices = [
      start,
      start + 1,
      start + 2,
      segmentCount - 4,
      segmentCount - 3,
      segmentCount - 2,
      segmentCount - 1,
    ]
    fold2 = computeFoldMetrics({ evs, tailPositivePct, foldIndices })
    if (foldMode === 'none') foldMode = 'fold2'
  }

  const activeFold = foldMode === 'fold3' ? fold3 : foldMode === 'fold2' ? fold2 : undefined
  const wfMeanEv = activeFold?.wfMeanEv ?? 0
  const wfBadSegs = activeFold?.wfBadSegs ?? 0

  return {
    segmentCount,
    minEv,
    tailPositivePct,
    tailMeanEv,
    wfMeanEv,
    wfBadSegs,
    feesPerMarketAll: feesPerMarketAll(params.segments),
    stabilityPass,
    foldMode,
    ...(fold2 ? { fold2 } : {}),
    ...(fold3 ? { fold3 } : {}),
    version: VERSION,
  }
}
