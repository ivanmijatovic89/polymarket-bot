import type { MarketTick } from '../../strategy/Strategy.js'
import type { SettlementDetection } from '../types.js'
import type { SettlementDetector } from '../SettlementDetector.js'

/**
 * Detects market settlement based on market rotation (when market ID changes).
 *
 * Primary detector for backtests where each parquet file = one 15-minute market.
 * When we see a new market ID, we know the previous market has ended.
 *
 * Example:
 * - File 1: market = "btc-updown-15m-1766364300"
 * - File 2: market = "btc-updown-15m-1766365200" (new market!)
 * - Detector triggers settlement for "btc-updown-15m-1766364300"
 */
export class MarketRotationDetector implements SettlementDetector {
  checkMarketEnd(params: {
    currentTick: MarketTick
    lastMarket?: string
    lastTickTime?: number
  }): SettlementDetection | null {
    const currentMarket = params.currentTick.snapshot.market

    // No previous market = first tick ever, nothing to settle
    if (!params.lastMarket) {
      return null
    }

    // Same market = no rotation, no settlement
    if (currentMarket === params.lastMarket) {
      return null
    }

    // Different market = rotation detected, settle the OLD market
    return {
      shouldSettle: true,
      market: params.lastMarket,
      reason: 'market_rotated',
      timestampMs: params.currentTick.snapshot.timestamp || Date.now(),
    }
  }

  triggerSettlement(market: string, reason: string): SettlementDetection {
    return {
      shouldSettle: true,
      market,
      reason: 'explicit_trigger',
      timestampMs: Date.now(),
    }
  }
}
