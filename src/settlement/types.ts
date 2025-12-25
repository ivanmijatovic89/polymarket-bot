/**
 * Settlement system types for Polymarket trading bot
 *
 * Simulates on-chain settlement behavior in backtests where markets automatically
 * settle via Chainlink oracles (winners get $1.00, losers get $0.00)
 */

export type SettlementConfig = {
  // Detection strategy
  detector: 'time' | 'event' | 'market_rotation' | 'none'

  // Payout resolution strategy
  resolver: 'gamma_api' | 'orderbook_inference' | 'manual'

  // Time-based detection params (for live trading)
  marketDurationMs?: number // e.g., 900_000 for 15min
  settlementDelayMs?: number // e.g., 60_000 buffer after market end

  // Orderbook inference params (fallback)
  orderbookInference?: {
    enabled: boolean
    fallbackToInference: boolean // Use if API fails
  }

  // Manual resolver params (for testing)
  manualPayouts?: Record<string, Record<string, number>> // market -> assetId -> payout

  // Gamma API params
  gammaApiUrl?: string
  gammaApiKey?: string
  cacheResults?: boolean // Cache API responses for repeated backtests
}

export type SettlementDetection = {
  shouldSettle: boolean
  market: string
  reason: 'market_ended' | 'market_rotated' | 'explicit_trigger'
  timestampMs: number
}

export type PayoutInfo = {
  market: string
  payouts: Record<string, number> // assetId -> payout per share (0.0 or 1.0)
  winningOutcome?: string // e.g., "UP" or "DOWN"
  resolvedAt: number
  source: 'gamma_api' | 'orderbook_inference' | 'manual'
}
