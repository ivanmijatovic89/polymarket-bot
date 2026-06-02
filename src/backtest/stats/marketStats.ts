import type { Fill, Position, PositionsSplit } from '../../strategy/Strategy.js'
import { computePolymarketTakerFee } from '../../trading/fees.js'

export type TradeEvent = Fill

/**
 * Execution metadata captured per-market by `runSingleMarket`.
 * Records which machine processed the market, timing, and replay event counts.
 * Visible in the dashboard per-market view; not used in aggregation math.
 *
 * `machineId` is the stable per-machine id from `getMachineId()` (12-char
 * hex slice of the hardware UUID via `node-machine-id`). Used as the
 * grouping key on the leaderboard.
 */
export type MarketExecutionMeta = {
  machineId: string
  startedAtMs: number
  finishedAtMs: number
  durationMs: number
  eventsProcessed: number
  eventsByType: Record<string, number>
  commitSha: string
}

export type MarketStats = {
  marketId: string
  slug: string
  finalOutcome: 'UP' | 'DOWN'
  pnl: number
  tradeCount: number
  tradeAsMaker: number
  tradeAsTaker: number
  feesPaid: number
  avgEntryPriceUp: number | null
  avgEntryPriceDown: number | null
  upShares: number
  downShares: number
  mergableShares: number
  cost: number
  /**
   * Split collateral cost (USDC) inferred from synthetic split fills.
   * For binary splits we expect two BUY fills (UP+DOWN) each of size N; splitCost is N.
   */
  splitCost: number
  intentMeta: Array<Record<string, unknown>>
  /**
   * Optional classifier for why a zero-trade market row exists.
   * - `no_in_window_activity`: market row emitted to keep denominator stable,
   *   but strategy had no in-window trades/positions.
   */
  skipReason?: 'no_in_window_activity'
  /**
   * Optional execution metadata. Populated by `runSingleMarket`.
   * Not present on legacy/historical rows; not used by `computeBatchStats`
   * or `computeChunkedBatchStats` (those operate purely on outcome/pnl/trades).
   */
  execution?: MarketExecutionMeta
}

/**
 * Resolves final positions for a market and computes PnL.
 *
 * For UP/DOWN markets:
 * - Mergable shares = min(upShares, downShares) - can be merged for $1 per pair
 * - Remaining shares are redeemed at $1 if winning, $0 if losing
 *
 * @param marketId - Market identifier (e.g., slug or condition ID)
 * @param trades - All fills executed for this market
 * @param finalPositions - Final positions from Portfolio snapshot (before resolution)
 * @param realizedPnl - Cumulative realized PnL from Portfolio (from trades only)
 * @param finalOutcome - 'UP' or 'DOWN' - which outcome won
 * @param tokenMap - Map from outcome ("UP" | "DOWN") to assetId (tokenId)
 */
export function computeMarketStats(params: {
  marketId: string
  slug: string
  trades: TradeEvent[]
  splits?: PositionsSplit[]
  finalPositions: Record<string, Position>
  realizedPnl: number
  finalOutcome: 'UP' | 'DOWN'
  tokenMap: Record<string, string> // { "UP": assetId, "DOWN": assetId }
}): MarketStats {
  const { marketId, slug, trades, splits, finalPositions, realizedPnl, finalOutcome, tokenMap } =
    params

  // Get asset IDs from tokenMap
  const upAssetId = tokenMap['UP']
  const downAssetId = tokenMap['DOWN']

  if (!upAssetId || !downAssetId) {
    throw new Error(
      `[marketStats] Missing UP or DOWN assetId in tokenMap. tokenMap=${JSON.stringify(tokenMap)}`,
    )
  }

  // Get final positions
  const upPosition = finalPositions[upAssetId]
  const downPosition = finalPositions[downAssetId]
  const upShares = upPosition?.qty ?? 0
  const downShares = downPosition?.qty ?? 0

  // Calculate mergable shares (can be merged for $1 per pair)
  const mergableShares = Math.min(upShares, downShares)

  // Track total BUY notional for avg entry; PnL should use remaining cost basis.
  let totalUpBuySize = 0
  let totalUpBuyCost = 0
  let totalDownBuySize = 0
  let totalDownBuyCost = 0
  let feesPaid = 0

  for (const trade of trades) {
    if (trade.side === 'BUY') {
      const notional = trade.price * trade.size
      if (trade.assetId === upAssetId) {
        totalUpBuySize += trade.size
        totalUpBuyCost += notional
      } else if (trade.assetId === downAssetId) {
        totalDownBuySize += trade.size
        totalDownBuyCost += notional
      }
    }

    if (trade.liquidity === 'TAKER' && typeof trade.feeRateBps === 'number') {
      const fee = computePolymarketTakerFee({
        feeRateBps: trade.feeRateBps,
        price: trade.price,
        size: trade.size,
        side: trade.side,
      })
      feesPaid += fee.feeQuote + fee.feeBase * trade.price
    }
  }

  // Volume-weighted average entry prices
  const avgEntryPriceUp = totalUpBuySize > 0 ? totalUpBuyCost / totalUpBuySize : null
  const avgEntryPriceDown = totalDownBuySize > 0 ? totalDownBuyCost / totalDownBuySize : null

  // Calculate final PnL:
  // 1. Mergable shares: worth $1 per pair (both UP and DOWN)
  const mergeValue = mergableShares * 1.0

  // 2. Remaining shares after merge
  const remainingUp = upShares - mergableShares
  const remainingDown = downShares - mergableShares

  // 3. Redeem value based on outcome
  let redeemValue = 0
  if (finalOutcome === 'UP') {
    // UP shares worth $1, DOWN shares worth $0
    redeemValue = remainingUp * 1.0 + remainingDown * 0.0
  } else {
    // DOWN shares worth $1, UP shares worth $0
    redeemValue = remainingUp * 0.0 + remainingDown * 1.0
  }

  const splitCost = Array.isArray(splits)
    ? splits.reduce((sum, s) => sum + (Number.isFinite(s.splitCost) ? s.splitCost : 0), 0)
    : 0

  // Remaining cost basis (what is still invested).
  const remainingCostBasis =
    (typeof upPosition?.costBasis === 'number' ? upPosition.costBasis : 0) +
    (typeof downPosition?.costBasis === 'number' ? downPosition.costBasis : 0)

  // 4. Total PnL = realized (from sells) + merge + redeem - remaining cost basis - splitCost
  const pnl = realizedPnl + mergeValue + redeemValue - remainingCostBasis - splitCost

  const intentMeta: Array<Record<string, unknown>> = []
  const seenOrderIds = new Set<string>()
  for (const t of trades) {
    if (!t.intentMeta || typeof t.intentMeta !== 'object') continue
    if (t.clientOrderId) {
      if (seenOrderIds.has(t.clientOrderId)) continue
      seenOrderIds.add(t.clientOrderId)
    }
    intentMeta.push(t.intentMeta as Record<string, unknown>)
  }

  return {
    slug,
    marketId,
    finalOutcome,
    pnl: Math.round(pnl * 100) / 100, // Round to 2 decimals
    tradeCount: trades.length,
    tradeAsMaker: trades.filter((t) => t.liquidity === 'MAKER').length,
    tradeAsTaker: trades.filter((t) => t.liquidity === 'TAKER').length,
    feesPaid: Math.round(feesPaid * 100) / 100,
    avgEntryPriceUp: avgEntryPriceUp !== null ? Math.round(avgEntryPriceUp * 10000) / 10000 : null,
    avgEntryPriceDown:
      avgEntryPriceDown !== null ? Math.round(avgEntryPriceDown * 10000) / 10000 : null,
    upShares: Math.round(upShares * 100) / 100,
    downShares: Math.round(downShares * 100) / 100,
    mergableShares: Math.round(mergableShares * 100) / 100,
    cost: Math.round(remainingCostBasis * 100) / 100,
    splitCost: Math.round(splitCost * 100) / 100,
    intentMeta,
  }
}
