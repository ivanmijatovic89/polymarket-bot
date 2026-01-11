import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../market/orderbook/index.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { OrderbookMetrics, OrderbookWeakSide } from '../strategy/Strategy.js'

function n(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

function weakSideAndRatio(
  upDepth: number | undefined,
  downDepth: number | undefined,
): { side: OrderbookWeakSide; ratio: number } {
  const u = Math.max(0, n(upDepth))
  const d = Math.max(0, n(downDepth))

  if (u === d) return { side: 'NONE', ratio: 1 }

  const minV = Math.min(u, d)
  const maxV = Math.max(u, d)
  // if diff is 20% or less return none.
  // const diff = Math.abs(u - d) / Math.max(u, d)
  // if (diff <= 0.2) return { side: 'NONE', ratio: maxV > 0 ? minV / maxV : 0 }
  return {
    side: u < d ? 'UP' : 'DOWN',
    ratio: maxV > 0 ? minV / maxV : 0,
  }
}

export function computeOrderbookMetrics(args: {
  upBook: OrderBookSnapshot
  downBook: OrderBookSnapshot
}): OrderbookMetrics {
  const up = args.upBook
  const down = args.downBook

  const levels = Math.max(
    0,
    Math.min(
      Math.floor(n(up.depthLevels)),
      Math.floor(n(down.depthLevels)),
      up.bidsDepthByLevel?.length ?? 0,
      down.bidsDepthByLevel?.length ?? 0,
      up.asksDepthByLevel?.length ?? 0,
      down.asksDepthByLevel?.length ?? 0,
    ),
  )

  const weakBidSideByLevel: OrderbookWeakSide[] = []
  const weakBidRatioByLevel: number[] = []

  const weakAskSideByLevel: OrderbookWeakSide[] = []
  const weakAskRatioByLevel: number[] = []

  for (let i = 0; i < levels; i += 1) {
    const b = weakSideAndRatio(up.bidsDepthByLevel[i], down.bidsDepthByLevel[i])
    weakBidSideByLevel.push(b.side)
    weakBidRatioByLevel.push(b.ratio)

    const a = weakSideAndRatio(up.asksDepthByLevel[i], down.asksDepthByLevel[i])
    weakAskSideByLevel.push(a.side)
    weakAskRatioByLevel.push(a.ratio)
  }

  return {
    depthLevels: levels,
    weakBidSideByLevel,
    weakBidRatioByLevel,
    weakAskSideByLevel,
    weakAskRatioByLevel,
  }
}

/**
 * Convenience wrapper: resolve UP/DOWN assetIds from market meta, then compute orderbook metrics.
 *
 * Mirrors the PositionMetrics pattern so strategies can stay tiny.
 */
export function computeOrderbookMetricsFromMarket(args: {
  marketBooks: MarketOrderBooksSnapshot
  market?: GammaMarketMeta
}): OrderbookMetrics | undefined {
  const m = args.market
  if (!m) return undefined

  const upAssetId = m.upAssetId
  const downAssetId = m.downAssetId

  if (!upAssetId || !downAssetId) return undefined

  const upBook = args.marketBooks.byAssetId[upAssetId]
  const downBook = args.marketBooks.byAssetId[downAssetId]
  if (!upBook || !downBook) return undefined

  return computeOrderbookMetrics({ upBook, downBook })
}


