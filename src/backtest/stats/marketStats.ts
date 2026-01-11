import type { Fill, Position } from '../../strategy/Strategy.js'

export type TradeEvent = Fill

export type MarketStats = {
  marketId: string
  finalOutcome: 'UP' | 'DOWN'
  pnl: number
  tradeCount: number
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
  trades: TradeEvent[]
  finalPositions: Record<string, Position>
  realizedPnl: number
  finalOutcome: 'UP' | 'DOWN'
  tokenMap: Record<string, string> // { "UP": assetId, "DOWN": assetId }
}): MarketStats {
  const { marketId, trades, finalPositions, realizedPnl, finalOutcome, tokenMap } = params

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

  // Calculate total cost (all BUY fills)
  let cost = 0
  let splitBuySizeSum = 0
  let totalUpBuySize = 0
  let totalUpBuyCost = 0
  let totalDownBuySize = 0
  let totalDownBuyCost = 0

  for (const trade of trades) {

    if (trade.side === 'BUY') {
      const notional = trade.price * trade.size
      cost += notional
      // If strategy sets costPerShare=0 for split, notional won't reflect collateral usage.
      // Infer splitCost from synthetic split fill ids.
      if (
        typeof trade.id === 'string' &&
        (trade.id.startsWith('bt-split:') || trade.id.startsWith('live-split:'))
      ) {
        splitBuySizeSum += trade.size
      }

      if (trade.assetId === upAssetId) {
        totalUpBuySize += trade.size
        totalUpBuyCost += notional
      } else if (trade.assetId === downAssetId) {
        totalDownBuySize += trade.size
        totalDownBuyCost += notional
      }
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

  // Split cost: for binary full-set split we get two BUY fills of size N (UP + DOWN),
  // so total size sum is 2N; collateral cost is N.
  const splitCost = splitBuySizeSum > 0 ? splitBuySizeSum / 2 : 0

  // 4. Total PnL = realized (from sells) + merge + redeem - cost - splitCost
  const pnl = realizedPnl + mergeValue + redeemValue - cost - splitCost

  return {
    marketId,
    finalOutcome,
    pnl: Math.round(pnl * 100) / 100, // Round to 2 decimals
    tradeCount: trades.length,
    avgEntryPriceUp: avgEntryPriceUp !== null ? Math.round(avgEntryPriceUp * 10000) / 10000 : null,
    avgEntryPriceDown:
      avgEntryPriceDown !== null ? Math.round(avgEntryPriceDown * 10000) / 10000 : null,
    upShares: Math.round(upShares * 100) / 100,
    downShares: Math.round(downShares * 100) / 100,
    mergableShares: Math.round(mergableShares * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    splitCost: Math.round(splitCost * 100) / 100,
  }
}
