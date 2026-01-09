import type { PortfolioSnapshot } from './Strategy.js'
import type { StrategyContext } from './StrategyContext.js'

/**
 * Clamp Polymarket probability prices to [0,1].
 */
export function safeProbabilityPrice(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(1, p))
}

export type TradeStatusName = 'MATCHED' | 'MINED' | 'CONFIRMED'

export function requiredTradeRank(s: TradeStatusName): 1 | 2 | 3 {
  if (s === 'MATCHED') return 1
  if (s === 'MINED') return 2
  return 3
}

/**
 * Strategy-friendly helper: checks if a given clientOrderId has reached the desired trade status threshold.
 *
 * Uses PortfolioSnapshot.ordersByClientId (OrderSnapshot) so strategies don't need to correlate events.
 */
export function isOrderTradeStatusAtLeast(
  portfolio: PortfolioSnapshot,
  clientOrderId: string,
  atLeast: TradeStatusName,
): boolean {
  const o = portfolio.ordersByClientId[clientOrderId]
  if (!o) return false
  return (o.tradeStatusRank ?? 0) >= requiredTradeRank(atLeast)
}

/**
 * Live-only warmup gating helper.
 *
 * Semantics:
 * - If ctx.warmup is missing (e.g. backtests / runners that don't implement warmup), treat as warmed.
 * - If warmup is in progress, treat as NOT warmed.
 * - If warmup succeeded, warmed.
 * - If warmup errored, still treat as warmed (so we don't deadlock trading), but strategies may log it.
 */
export function isWarmed(ctx?: StrategyContext): boolean {
  const w = ctx?.warmup
  if (!w) return true
  if (w.status === 'warming') return false
  return true
}


