import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'

/**
 * Parse market start time from Gamma raw JSON.
 * Tries eventStartTime first, then startDate.
 */
function parseGammaMarketStartMs(market?: unknown): number | null {
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

type TimeWindowGate = {
  check(args: { nowMs: number; market?: unknown }): boolean
  reset(): void
}

function createTimeWindowGate(cfg: {
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

export type TimeWindowGateSnapshot = {
  withinWindow: boolean
  startMs: number | null
  nowMs: number | null
  elapsedMs: number | null
}

export class TimeWindowGatePlugin implements Plugin {
  readonly id = 'timeWindowGate'

  private readonly gate: ReturnType<typeof createTimeWindowGate>
  private cached: TimeWindowGateSnapshot = {
    withinWindow: false,
    startMs: null,
    nowMs: null,
    elapsedMs: null,
  }

  constructor(cfg: Parameters<typeof createTimeWindowGate>[0]) {
    this.gate = createTimeWindowGate(cfg)
  }

  reset(): void {
    this.gate.reset()
    this.cached = { withinWindow: false, startMs: null, nowMs: null, elapsedMs: null }
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    const nowMs = typeof tick.snapshot.timestamp === 'number' && Number.isFinite(tick.snapshot.timestamp) ? tick.snapshot.timestamp : null
    const startMs = parseGammaMarketStartMs(ctx?.market)
    const elapsedMs = nowMs !== null && startMs !== null ? nowMs - startMs : null
    const withinWindow = nowMs !== null ? this.gate.check({ nowMs, market: ctx?.market }) : false
    this.cached = { withinWindow, startMs, nowMs, elapsedMs }
  }

  snapshot(): TimeWindowGateSnapshot {
    return this.cached
  }
}

