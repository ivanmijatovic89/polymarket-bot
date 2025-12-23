import type { PortfolioSnapshot, Position } from '../strategy/Strategy.js'

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

export type MergeOpportunity = {
  market: string
  assetIds: [string, string]
  mergeQty: number
  avgEntryPrices: [number, number]
  cost: number
  proceeds: number
  pnl: number
  /** pnl / cost * 100 */
  pnlPct: number
  leftovers: Record<string, number>
}

function pickTwoLargestPositions(pos: Position[]): [Position, Position] | null {
  const sorted = [...pos].sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))
  if (sorted.length < 2) return null
  return [sorted[0], sorted[1]]
}

/**
 * Compute "merge" PnL opportunities:
 * If a market has two outcome tokens (usually YES/NO), holding both can be merged into 1 collateral per pair.
 * This estimates: pnl = mergeQty * (1 - (avgYes + avgNo)) using avgEntryPrice as cost basis.
 *
 * Notes:
 * - Ignores fees (we don't currently track them in Portfolio PnL).
 * - Uses `marketByAssetId` to group assets; if missing, the asset is skipped.
 */
export function computeMergeOpportunities(p: PortfolioSnapshot): MergeOpportunity[] {
  const byMarket = new Map<string, Position[]>()

  for (const pos of Object.values(p.positionsByAssetId)) {
    const market = p.marketByAssetId?.[pos.assetId]
    if (!market) continue
    if (!Number.isFinite(pos.qty) || pos.qty <= 0) continue
    if (pos.avgEntryPrice === null || !Number.isFinite(pos.avgEntryPrice)) continue
    const arr = byMarket.get(market) ?? []
    arr.push(pos)
    byMarket.set(market, arr)
  }

  const out: MergeOpportunity[] = []

  for (const [market, positions] of byMarket.entries()) {
    const pair = pickTwoLargestPositions(positions)
    if (!pair) continue
    const [a, b] = pair

    const mergeQty = Math.min(a.qty, b.qty)
    if (!(mergeQty > 0)) continue

    const cost = mergeQty * ((a.avgEntryPrice ?? 0) + (b.avgEntryPrice ?? 0))
    const proceeds = mergeQty * 1.0
    const pnl = proceeds - cost
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0

    const leftovers: Record<string, number> = {}
    for (const pos of positions) leftovers[pos.assetId] = round8(pos.qty)
    leftovers[a.assetId] = round8(a.qty - mergeQty)
    leftovers[b.assetId] = round8(b.qty - mergeQty)

    out.push({
      market,
      assetIds: [a.assetId, b.assetId],
      mergeQty: round8(mergeQty),
      avgEntryPrices: [round8(a.avgEntryPrice!), round8(b.avgEntryPrice!)],
      cost: round8(cost),
      proceeds: round8(proceeds),
      pnl: round8(pnl),
      pnlPct: round8(pnlPct),
      leftovers,
    })
  }

  // Stable order for logs.
  out.sort((x, y) => x.market.localeCompare(y.market))
  return out
}

export function sumMergePnl(ops: MergeOpportunity[]): number {
  return round8(ops.reduce((acc, o) => acc + (Number.isFinite(o.pnl) ? o.pnl : 0), 0))
}

export function sumMergeCost(ops: MergeOpportunity[]): number {
  return round8(ops.reduce((acc, o) => acc + (Number.isFinite(o.cost) ? o.cost : 0), 0))
}

export function mergePnlPctTotal(ops: MergeOpportunity[]): number {
  const cost = sumMergeCost(ops)
  const pnl = sumMergePnl(ops)
  return round8(cost > 0 ? (pnl / cost) * 100 : 0)
}

