import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'
import { parseGammaMarketStartMs } from '../strategyToolkit.js'

type TimeWindowGate = {
  check(args: { nowMs: number; market?: unknown }): boolean
  reset(): void
}

function createTimeWindowGate(cfg: {
  allowAfterMs: number
  disableAfterMs: number
  /** Enable logging with optional interval and change-only mode */
  log?:
    | boolean
    | {
        everyMs?: number
        /** Only log on state transitions (active <-> inactive) */
        logChangeOnly?: boolean
      }
}): TimeWindowGate {
  const enableLog = !!cfg.log
  const logEveryMs =
    cfg.log === true ? 5000 : typeof cfg.log === 'object' ? (cfg.log.everyMs ?? 5000) : 5000
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
            console.log(
              `⏳ 🟢 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | ends in ${endsInSec} sec`,
            )
          } else if (elapsed < cfg.allowAfterMs) {
            const startsInSec = allowAfterSec - currentSec
            console.log(
              `⌛️ 🔴 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | starts in ${startsInSec} sec`,
            )
          } else {
            console.log(
              `⌛️ 🔴 ${currentSec}/${disableAfterSec} | ${allowAfterSec}-${disableAfterSec} | ended`,
            )
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
  allowAfterMs: number
  disableAfterMs: number
  withinWindow: boolean
  startMs: number | null
  nowMs: number | null
  elapsedMs: number | null
}

export class TimeWindowGatePlugin implements Plugin {
  readonly id = 'timeWindowGate'

  private readonly allowAfterMs: number
  private readonly disableAfterMs: number
  private readonly gate: ReturnType<typeof createTimeWindowGate>
  private cached: TimeWindowGateSnapshot = {
    allowAfterMs: 0,
    disableAfterMs: 0,
    withinWindow: false,
    startMs: null,
    nowMs: null,
    elapsedMs: null,
  }

  constructor(cfg: Parameters<typeof createTimeWindowGate>[0]) {
    this.allowAfterMs = cfg.allowAfterMs
    this.disableAfterMs = cfg.disableAfterMs
    this.gate = createTimeWindowGate(cfg)
    this.cached = {
      allowAfterMs: this.allowAfterMs,
      disableAfterMs: this.disableAfterMs,
      withinWindow: false,
      startMs: null,
      nowMs: null,
      elapsedMs: null,
    }
  }

  reset(): void {
    this.gate.reset()
    this.cached = {
      allowAfterMs: this.allowAfterMs,
      disableAfterMs: this.disableAfterMs,
      withinWindow: false,
      startMs: null,
      nowMs: null,
      elapsedMs: null,
    }
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    const nowMs =
      typeof tick.snapshot.timestamp === 'number' && Number.isFinite(tick.snapshot.timestamp)
        ? tick.snapshot.timestamp
        : null
    const startMs = parseGammaMarketStartMs(ctx?.market)
    const elapsedMs = nowMs !== null && startMs !== null ? nowMs - startMs : null
    const withinWindow = nowMs !== null ? this.gate.check({ nowMs, market: ctx?.market }) : false
    this.cached = {
      allowAfterMs: this.allowAfterMs,
      disableAfterMs: this.disableAfterMs,
      withinWindow,
      startMs,
      nowMs,
      elapsedMs,
    }
  }

  snapshot(): TimeWindowGateSnapshot {
    return this.cached
  }
}
