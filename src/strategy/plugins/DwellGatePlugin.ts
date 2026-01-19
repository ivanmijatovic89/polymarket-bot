import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'

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

type DwellGate = {
  update(args: {
    nowMs: number
    upAssetId: string
    downAssetId: string
    snapshot: { byAssetId: Record<string, { bestBid?: number | null; bestAsk?: number | null }> }
  }): { dwellUpOk: boolean; dwellDownOk: boolean }
  reset(): void
}

function createDwellGate(cfg: {
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

export type DwellGateSnapshot = {
  dwellUpOk: boolean
  dwellDownOk: boolean
}

export class DwellGatePlugin implements Plugin {
  readonly id = 'dwellGate'

  private readonly gate: ReturnType<typeof createDwellGate>
  private cached: DwellGateSnapshot = { dwellUpOk: false, dwellDownOk: false }

  constructor(cfg: Parameters<typeof createDwellGate>[0]) {
    this.gate = createDwellGate(cfg)
  }

  reset(): void {
    this.gate.reset()
    this.cached = { dwellUpOk: false, dwellDownOk: false }
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      this.cached = { dwellUpOk: false, dwellDownOk: false }
      return
    }

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) {
      this.cached = { dwellUpOk: false, dwellDownOk: false }
      return
    }

    this.cached = this.gate.update({
      nowMs,
      upAssetId,
      downAssetId,
      snapshot: tick.snapshot,
    })
  }

  snapshot(): DwellGateSnapshot {
    return this.cached
  }
}

