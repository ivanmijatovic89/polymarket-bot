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
  reset(): void
}

export function createTimeWindowGate(cfg: {
  allowAfterMs: number
  disableAfterMs: number
  /** Enable logging with optional interval and change-only mode */
  log?: boolean | {
    everyMs?: number
    /** Only log on state transitions (active <-> inactive) */
    logChangeOnly?: boolean
  }
}): TimeWindowGate {
  const enableLog = !!cfg.log
  const logEveryMs = cfg.log === true ? 5000 : typeof cfg.log === 'object' ? (cfg.log.everyMs ?? 5000) : 5000
  const logChangeOnly = typeof cfg.log === 'object' ? !!cfg.log.logChangeOnly : false

  let lastLogBucket = -1
  let lastWasActive: boolean | null = null

  const allowAfterSec = Math.floor(cfg.allowAfterMs / 1000)
  const disableAfterSec = Math.floor(cfg.disableAfterMs / 1000)

  return {
    check(args) {
      const startMs = parseGammaMarketStartMs(args.market)
      if (startMs === null) return false
      if (!Number.isFinite(args.nowMs)) return false

      const elapsed = args.nowMs - startMs
      const currentSec = Math.floor(elapsed / 1000)
      const isActive = elapsed >= cfg.allowAfterMs && elapsed <= cfg.disableAfterMs

      if (enableLog) {
        const stateChanged = lastWasActive !== null && lastWasActive !== isActive
        const bucket = Math.floor(elapsed / logEveryMs)
        const shouldLog = stateChanged || (!logChangeOnly && bucket !== lastLogBucket)

        if (shouldLog) {
          lastLogBucket = bucket

          if (isActive) {
            const endsInSec = disableAfterSec - currentSec
            console.log(`⏳ 🟢 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | ends in ${endsInSec} sec`)
          } else if (elapsed < cfg.allowAfterMs) {
            const startsInSec = allowAfterSec - currentSec
            console.log(`⌛️ 🔴 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | starts in ${startsInSec} sec`)
          } else {
            console.log(`⌛️ 🔴 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | ended`)
          }
        }
        lastWasActive = isActive
      }

      return isActive
    },
    reset() {
      lastLogBucket = -1
      lastWasActive = null
    },
  }
}

// ─────────────────────────────────────────────────────────────
// DWELL GATE (tracks UP and DOWN independently, with optional logging)
// ─────────────────────────────────────────────────────────────

type SingleDwellTracker = {
  update(nowMs: number, price: number | null | undefined): boolean
  reset(): void
}

function createSingleDwellTracker(cfg: {
  from: number
  to: number
  requiredMs: number
  label?: string
  logEveryMs?: number
}): SingleDwellTracker {
  const lo = Math.min(cfg.from, cfg.to)
  const hi = Math.max(cfg.from, cfg.to)
  const logEveryMs = cfg.logEveryMs ?? 5000

  let inRangeSinceMs: number | null = null
  let lastLogBucket = -1

  return {
    update(nowMs, price) {
      const inRange = typeof price === 'number' && Number.isFinite(price) && price >= lo && price <= hi

      if (!inRange) {
        if (cfg.label && inRangeSinceMs !== null) {
          console.log(`🕸️ ⏱️ 🔴 ${cfg.label} LEFT range [${lo.toFixed(2)}-${hi.toFixed(2)}] ${price}`)
        }
        inRangeSinceMs = null
        lastLogBucket = -1
        return false
      }

      if (inRangeSinceMs === null) {
        inRangeSinceMs = nowMs
        lastLogBucket = -1
        if (cfg.label) {
          console.log(`🕸️ ⏱️ 🟢 ${cfg.label} ENTERED range [${lo.toFixed(2)}-${hi.toFixed(2)}] ${price}`)
        }
      }

      // Logging
      if (cfg.label) {
        const elapsedMs = nowMs - inRangeSinceMs
        const bucket = Math.floor(elapsedMs / logEveryMs)
        if (bucket !== lastLogBucket) {
          lastLogBucket = bucket
          console.log(
            `🕸️ ⏱️ 🟢 ${cfg.label} ${Math.floor(elapsedMs / 1000)}s IN RANGE ` +
              `[${lo.toFixed(2)}-${hi.toFixed(2)}] ${price}`,
          )
        }
      }

      return nowMs - inRangeSinceMs >= cfg.requiredMs
    },
    reset() {
      inRangeSinceMs = null
      lastLogBucket = -1
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
  /** Enable logging with optional interval (default 5000ms) */
  log?: boolean | { everyMs?: number }
}): DwellGate {
  const enableLog = !!cfg.log
  const logEveryMs = cfg.log === true ? 5000 : typeof cfg.log === 'object' ? (cfg.log.everyMs ?? 5000) : 5000

  const dwellUp = createSingleDwellTracker({
    from: cfg.from,
    to: cfg.to,
    requiredMs: cfg.requiredMs,
    ...(enableLog && { label: 'UP', logEveryMs }),
  })
  const dwellDown = createSingleDwellTracker({
    from: cfg.from,
    to: cfg.to,
    requiredMs: cfg.requiredMs,
    ...(enableLog && { label: 'DOWN', logEveryMs }),
  })
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
