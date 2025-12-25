import type { MarketTick, PortfolioSnapshot, AccountEvent } from '../strategy/Strategy.js'
import type { SettlementDetector } from './SettlementDetector.js'
import type { PayoutResolver } from './PayoutResolver.js'
import type { SettlementConfig } from './types.js'

/**
 * Orchestrates settlement detection and payout resolution.
 *
 * Flow:
 * 1. Detect market end (via SettlementDetector)
 * 2. Get positions in expired market (from Portfolio)
 * 3. Resolve payouts (via PayoutResolver)
 * 4. Generate market_settled event
 *
 * Used by StrategyRunner to automatically settle markets in backtests.
 */
export class SettlementCoordinator {
  private detector: SettlementDetector
  private resolver: PayoutResolver
  private config: SettlementConfig

  constructor(
    detector: SettlementDetector,
    resolver: PayoutResolver,
    config: SettlementConfig,
  ) {
    this.detector = detector
    this.resolver = resolver
    this.config = config
  }

  /**
   * Check if settlement should occur and generate settlement event if needed.
   *
   * Called by StrategyRunner on each market tick.
   */
  async checkSettlement(params: {
    currentTick: MarketTick
    portfolio: PortfolioSnapshot
    lastMarket?: string
    lastTickTime?: number
  }): Promise<AccountEvent | null> {
    // 1. Detect if market should settle
    const detectionParams: {
      currentTick: MarketTick
      lastMarket?: string
      lastTickTime?: number
    } = { currentTick: params.currentTick }
    if (params.lastMarket !== undefined) detectionParams.lastMarket = params.lastMarket
    if (params.lastTickTime !== undefined) detectionParams.lastTickTime = params.lastTickTime

    const detection = this.detector.checkMarketEnd(detectionParams)

    if (!detection || !detection.shouldSettle) {
      return null
    }

    // 2. Get positions in the market that's ending
    const marketPositions = this.getMarketPositions(params.portfolio, detection.market)

    // No positions = no need to settle
    if (marketPositions.length === 0) {
      return null
    }

    const assetIds = marketPositions.map((p) => p.assetId)

    try {
      // 3. Resolve payouts
      const payoutInfo = await this.resolver.resolvePayouts({
        market: detection.market,
        assetIds,
        lastSnapshot: params.currentTick.snapshot,
      })

      // 4. Generate settlement event
      const settlementEvent: AccountEvent = {
        kind: 'market_settled',
        tsMs: detection.timestampMs,
        market: detection.market,
        payouts: payoutInfo.payouts,
        reason: detection.reason === 'market_ended' ? 'expired' : 'resolved',
      }

      return settlementEvent
    } catch (error) {
      console.error(`[SettlementCoordinator] Failed to resolve payouts for ${detection.market}:`, error)
      return null
    }
  }

  /**
   * Extract positions for a specific market from portfolio.
   * Uses marketByAssetId mapping to filter.
   */
  private getMarketPositions(
    portfolio: PortfolioSnapshot,
    market: string,
  ): Array<{ assetId: string; qty: number }> {
    const positions: Array<{ assetId: string; qty: number }> = []

    // Use marketByAssetId to find positions in this market
    for (const [assetId, m] of Object.entries(portfolio.marketByAssetId ?? {})) {
      if (m !== market) continue

      const pos = portfolio.positionsByAssetId[assetId]
      if (pos && pos.qty > 0) {
        positions.push({ assetId, qty: pos.qty })
      }
    }

    return positions
  }

  /**
   * Get current configuration
   */
  getConfig(): SettlementConfig {
    return { ...this.config }
  }
}
