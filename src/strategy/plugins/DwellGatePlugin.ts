import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'

type SingleDwellTracker = {
  update(
    nowMs: number,
    price: number | null | undefined,
  ): {
    ok: boolean
    inRange: boolean
    elapsedInRangeMs: number | null
    remainingMs: number | null
  }
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
      const inRange =
        typeof price === 'number' && Number.isFinite(price) && price >= lo && price <= hi

      if (!inRange) {
        if (cfg.label && inRangeSinceMs !== null) {
          console.log(
            `🕸️ ⏱️ 🔴 ${cfg.label} LEFT range [${lo.toFixed(2)}-${hi.toFixed(2)}] ${price}`,
          )
        }
        inRangeSinceMs = null
        lastLogBucket = -1
        return { ok: false, inRange: false, elapsedInRangeMs: null, remainingMs: null }
      }

      if (inRangeSinceMs === null) {
        inRangeSinceMs = nowMs
        lastLogBucket = -1
        if (cfg.label) {
          console.log(
            `🕸️ ⏱️ 🟢 ${cfg.label} ENTERED range [${lo.toFixed(2)}-${hi.toFixed(2)}] ${price}`,
          )
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

      const elapsedInRangeMs = nowMs - inRangeSinceMs
      const remainingMs = Math.max(0, cfg.requiredMs - elapsedInRangeMs)
      const ok = remainingMs === 0
      return { ok, inRange: true, elapsedInRangeMs, remainingMs }
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
  }): {
    dwellUpOk: boolean
    dwellDownOk: boolean
    up: { inRange: boolean; elapsedInRangeMs: number | null; remainingMs: number | null }
    down: { inRange: boolean; elapsedInRangeMs: number | null; remainingMs: number | null }
  }
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
  const logEveryMs =
    cfg.log === true ? 5000 : typeof cfg.log === 'object' ? (cfg.log.everyMs ?? 5000) : 5000

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

      const up = dwellUp.update(args.nowMs, upPrice)
      const down = dwellDown.update(args.nowMs, downPrice)
      const dwellUpOk = up.ok
      const dwellDownOk = down.ok

      return {
        dwellUpOk,
        dwellDownOk,
        up: {
          inRange: up.inRange,
          elapsedInRangeMs: up.elapsedInRangeMs,
          remainingMs: up.remainingMs,
        },
        down: {
          inRange: down.inRange,
          elapsedInRangeMs: down.elapsedInRangeMs,
          remainingMs: down.remainingMs,
        },
      }
    },
    reset() {
      dwellUp.reset()
      dwellDown.reset()
    },
  }
}

export type DwellGateSnapshot = {
  from: number
  to: number
  requiredMs: number
  trackPrice: 'bid' | 'ask'
  dwellUpOk: boolean
  dwellDownOk: boolean
  up: { inRange: boolean; elapsedInRangeMs: number | null; remainingMs: number | null }
  down: { inRange: boolean; elapsedInRangeMs: number | null; remainingMs: number | null }
}

export class DwellGatePlugin implements Plugin {
  readonly id = 'dwellGate'

  private readonly from: number
  private readonly to: number
  private readonly requiredMs: number
  private readonly trackPrice: 'bid' | 'ask'
  private readonly gate: ReturnType<typeof createDwellGate>
  private cached: DwellGateSnapshot = {
    from: 0,
    to: 0,
    requiredMs: 0,
    trackPrice: 'bid',
    dwellUpOk: false,
    dwellDownOk: false,
    up: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
    down: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
  }

  constructor(cfg: Parameters<typeof createDwellGate>[0]) {
    this.from = cfg.from
    this.to = cfg.to
    this.requiredMs = cfg.requiredMs
    this.trackPrice = cfg.trackPrice
    this.gate = createDwellGate(cfg)
    this.cached = {
      from: this.from,
      to: this.to,
      requiredMs: this.requiredMs,
      trackPrice: this.trackPrice,
      dwellUpOk: false,
      dwellDownOk: false,
      up: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
      down: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
    }
  }

  reset(): void {
    this.gate.reset()
    this.cached = {
      from: this.from,
      to: this.to,
      requiredMs: this.requiredMs,
      trackPrice: this.trackPrice,
      dwellUpOk: false,
      dwellDownOk: false,
      up: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
      down: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
    }
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      this.cached = {
        from: this.from,
        to: this.to,
        requiredMs: this.requiredMs,
        trackPrice: this.trackPrice,
        dwellUpOk: false,
        dwellDownOk: false,
        up: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
        down: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
      }
      return
    }

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) {
      this.cached = {
        from: this.from,
        to: this.to,
        requiredMs: this.requiredMs,
        trackPrice: this.trackPrice,
        dwellUpOk: false,
        dwellDownOk: false,
        up: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
        down: { inRange: false, elapsedInRangeMs: null, remainingMs: null },
      }
      return
    }

    const out = this.gate.update({
      nowMs,
      upAssetId,
      downAssetId,
      snapshot: tick.snapshot,
    })
    this.cached = {
      from: this.from,
      to: this.to,
      requiredMs: this.requiredMs,
      trackPrice: this.trackPrice,
      ...out,
    }
  }

  snapshot(): DwellGateSnapshot {
    return this.cached
  }
}
