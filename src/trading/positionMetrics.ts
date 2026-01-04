import type { PortfolioSnapshot, PositionMetrics } from '../strategy/Strategy.js'

function n(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

/**
 * Compute "Position Metrics" for a single UP/DOWN market given the two asset IDs.
 *
 * Assumptions (matching the user's current simplified formulas):
 * - `total_cost` is computed from average-cost `costBasis` for UP + DOWN positions.
 * - "profits" are computed as shares - total_cost (treating $1 payout at settlement).
 */
export function computePositionMetrics(args: {
  portfolio: PortfolioSnapshot
  upAssetId?: string
  downAssetId?: string
}): PositionMetrics | undefined {
  const upId = args.upAssetId
  const downId = args.downAssetId
  if (!upId || !downId) return undefined

  const up = args.portfolio.positionsByAssetId[upId]
  const down = args.portfolio.positionsByAssetId[downId]

  const up_shares = n(up?.qty)
  const down_shares = n(down?.qty)

  const up_cost = n(up?.costBasis)
  const down_cost = n(down?.costBasis)
  const total_cost = up_cost + down_cost

  const up_avg = up_shares > 0 ? up_cost / up_shares : null
  const down_avg = down_shares > 0 ? down_cost / down_shares : null

  const shares_mergeable = Math.min(up_shares, down_shares)
  const shares_up_unpaired = up_shares - shares_mergeable
  const shares_down_unpaired = down_shares - shares_mergeable
  const is_fully_hedged = up_shares === down_shares

  // Overall blended avg cost/share across UP+DOWN combined (not just mergeable portion).
  const total_shares = up_shares + down_shares
  const pair_avg = total_shares > 0 ? total_cost / total_shares : null

  return {
    shares_mergeable,
    shares_up_unpaired,
    shares_down_unpaired,
    is_fully_hedged,
    pair_avg,
    up_avg,
    down_avg,
    up_cost,
    down_cost,
    total_cost,
    pnl_merge: shares_mergeable - total_cost,
    pnl_if_up_wins: up_shares - total_cost,
    pnl_if_down_wins: down_shares - total_cost,
    net_shares: up_shares - down_shares,
  }
}


