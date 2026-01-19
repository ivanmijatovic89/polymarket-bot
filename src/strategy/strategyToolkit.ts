import type { PortfolioSnapshot } from './Strategy.js'
import type { StrategyContext } from './StrategyContext.js'

/**
 * Clamp Polymarket probability prices to [0,1].
 */
export function safeProbabilityPrice(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(1, p))
}

// ─────────────────────────────────────────────────────────────
// EXISTING HELPERS
// ─────────────────────────────────────────────────────────────

export type TradeStatusName = 'MATCHED' | 'MINED' | 'CONFIRMED'

export function requiredTradeRank(s: TradeStatusName): 1 | 2 | 3 {
  if (s === 'MATCHED') return 1
  if (s === 'MINED') return 2
  return 3
}

export function isOrderTradeStatusAtLeast(
  portfolio: PortfolioSnapshot,
  clientOrderId: string,
  atLeast: TradeStatusName,
): boolean {
  const o = portfolio.ordersByClientId[clientOrderId]
  if (!o) return false
  return (o.tradeStatusRank ?? 0) >= requiredTradeRank(atLeast)
}

export function isWarmed(ctx?: StrategyContext): boolean {
  const w = ctx?.warmup
  if (!w) return true
  if (w.status === 'warming') return false
  return true
}
