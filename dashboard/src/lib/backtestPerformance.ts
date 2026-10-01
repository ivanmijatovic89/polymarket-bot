export type PerformanceMarket = {
  marketStartMs?: number | null
  slug: string | null
  pnl: number
}

export type PerformancePoint = {
  x: number
  timestamp: number | null
  marketNumber: number
  pnl: number
  cumulative: number
  drawdown: number
}

function marketTimestamp(market: PerformanceMarket): number | null {
  const stored = market.marketStartMs
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored
  const epoch = market.slug?.match(/-(\d{10})$/)?.[1]
  return epoch ? Number(epoch) * 1000 : null
}

/** Use calendar order when available; retain every result if dates are missing. */
export function buildPerformanceSeries(markets: readonly PerformanceMarket[]) {
  const rows = markets.map((market, index) => ({
    ...market,
    timestamp: marketTimestamp(market),
    index,
  }))
  const hasDates = rows.length > 0 && rows.every((row) => row.timestamp !== null)
  if (hasDates) {
    rows.sort((a, b) => a.timestamp! - b.timestamp! || a.index - b.index)
  }

  let cumulative = 0
  let peak = 0
  let peakIndex: number | null = null
  let maxDrawdown = 0
  let drawdownIndex: number | null = null
  let drawdownPeak = 0
  const points: PerformancePoint[] = rows.map((row, index) => {
    cumulative += row.pnl
    if (cumulative > peak) {
      peak = cumulative
      peakIndex = index
    }
    const drawdown = peak - cumulative
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      drawdownIndex = index
      drawdownPeak = peak
    }
    return {
      x: hasDates ? row.timestamp! : index + 1,
      timestamp: row.timestamp,
      marketNumber: index + 1,
      pnl: row.pnl,
      cumulative,
      drawdown,
    }
  })

  return { points, hasDates, peak, peakIndex, maxDrawdown, drawdownIndex, drawdownPeak }
}

/** Full trailing windows only. Zero-PnL markets count; fees are already in PnL. */
export function rollingMarketAverages(points: readonly PerformancePoint[], window: number) {
  if (!Number.isInteger(window) || window < 1) throw new Error('Window must be a positive integer')
  return points.map((point, index) => {
    if (index + 1 < window) return null
    const before = index >= window ? points[index - window].cumulative : 0
    return (point.cumulative - before) / window
  })
}

export function trailingMarketSummary(points: readonly PerformancePoint[], window: number) {
  if (points.length < window) return null
  const total = points.at(-1)!.cumulative - (points.at(-window - 1)?.cumulative ?? 0)
  return { total, average: total / window }
}

export function nearestPerformancePoint(points: readonly PerformancePoint[], x: number): number {
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid].x < x) low = mid + 1
    else high = mid
  }
  return low > 0 && Math.abs(points[low - 1].x - x) <= Math.abs(points[low].x - x) ? low - 1 : low
}
