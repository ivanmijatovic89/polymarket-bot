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
// TIME WINDOW GATE
// ─────────────────────────────────────────────────────────────

/**
 * Parse market start time from Gamma raw JSON.
 * Tries eventStartTime first, then startDate.
 */
export function parseGammaMarketStartMs(market?: unknown): number | null {
  const m = market as Record<string, unknown> | undefined
  const s =
    typeof m?.eventStartTime === 'string' && m.eventStartTime.length > 0
      ? m.eventStartTime
      : typeof m?.startDate === 'string' && m.startDate.length > 0
        ? m.startDate
        : null
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? Math.trunc(ms) : null
}

export type TimeWindowGate = {
  check(args: { nowMs: number; market?: unknown }): boolean
}

export function createTimeWindowGate(cfg: {
  allowAfterMs: number
  disableAfterMs: number
}): TimeWindowGate {
  return {
    check(args) {
      const startMs = parseGammaMarketStartMs(args.market)
      if (startMs === null) return false
      if (!Number.isFinite(args.nowMs)) return false
      const elapsed = args.nowMs - startMs
      return elapsed >= cfg.allowAfterMs && elapsed <= cfg.disableAfterMs
    },
  }
}

// ─────────────────────────────────────────────────────────────
// DWELL GATE (tracks UP and DOWN independently)
// ─────────────────────────────────────────────────────────────

type SingleDwellTracker = {
  update(nowMs: number, price: number | null | undefined): boolean
  reset(): void
}

function createSingleDwellTracker(from: number, to: number, requiredMs: number): SingleDwellTracker {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  let inRangeSinceMs: number | null = null

  return {
    update(nowMs, price) {
      const inRange = typeof price === 'number' && Number.isFinite(price) && price >= lo && price <= hi
      if (!inRange) {
        inRangeSinceMs = null
        return false
      }
      if (inRangeSinceMs === null) inRangeSinceMs = nowMs
      return nowMs - inRangeSinceMs >= requiredMs
    },
    reset() {
      inRangeSinceMs = null
    },
  }
}

export type DwellGate = {
  update(args: {
    nowMs: number
    upAssetId: string
    downAssetId: string
    snapshot: { byAssetId: Record<string, { bestBid?: number | null; bestAsk?: number | null }> }
  }): { dwellUpOk: boolean; dwellDownOk: boolean }
  reset(): void
}

export function createDwellGate(cfg: {
  from: number
  to: number
  requiredMs: number
  trackPrice: 'bid' | 'ask'
}): DwellGate {
  const dwellUp = createSingleDwellTracker(cfg.from, cfg.to, cfg.requiredMs)
  const dwellDown = createSingleDwellTracker(cfg.from, cfg.to, cfg.requiredMs)
  const trackBid = cfg.trackPrice === 'bid'

  return {
    update(args) {
      const upBook = args.snapshot.byAssetId[args.upAssetId]
      const downBook = args.snapshot.byAssetId[args.downAssetId]
      const upPrice = trackBid ? upBook?.bestBid : upBook?.bestAsk
      const downPrice = trackBid ? downBook?.bestBid : downBook?.bestAsk

      const dwellUpOk = dwellUp.update(args.nowMs, upPrice)
      const dwellDownOk = dwellDown.update(args.nowMs, downPrice)

      return { dwellUpOk, dwellDownOk }
    },
    reset() {
      dwellUp.reset()
      dwellDown.reset()
    },
  }
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
