import type { MarketTick } from '../strategy/Strategy.js'
import type { SettlementDetection } from './types.js'

/**
 * Interface for detecting when a market should be settled.
 *
 * Different implementations for different contexts:
 * - MarketRotationDetector: For backtests (detects when market ID changes)
 * - TimeBasedDetector: For live trading (detects when 15min window expires)
 * - EventBasedDetector: For synthetic events (future)
 */
export interface SettlementDetector {
  /**
   * Called on every market tick to check if settlement should occur.
   *
   * @returns SettlementDetection if market should settle, null otherwise
   */
  checkMarketEnd(params: {
    currentTick: MarketTick
    lastMarket?: string
    lastTickTime?: number
  }): SettlementDetection | null

  /**
   * Explicitly trigger settlement for a market.
   * Used for manual testing or synthetic events.
   */
  triggerSettlement(market: string, reason: string): SettlementDetection
}
