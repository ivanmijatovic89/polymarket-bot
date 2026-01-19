import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'

export type PluginId = string

export interface Plugin {
  id: PluginId
  onMarketTick: (tick: MarketTick, ctx?: StrategyContext) => void
  snapshot?: () => unknown
  reset?: () => void
}

export type PluginsSnapshot = Record<PluginId, unknown>

/**
 * A per-runner plugin container.
 *
 * - StrategyRunner updates this once per market tick.
 * - StrategyRunner passes a cached `snapshot()` into strategy callbacks.
 */
export class PluginSet {
  private readonly plugins: Plugin[] = []
  private cached: PluginsSnapshot = {}

  register(p: Plugin): void {
    this.plugins.push(p)
  }

  list(): Plugin[] {
    return this.plugins.slice()
  }

  listIds(): PluginId[] {
    const out: PluginId[] = []
    const seen = new Set<string>()
    for (const p of this.plugins) {
      if (!p?.id) continue
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p.id)
    }
    return out
  }

  reset(): void {
    for (const p of this.plugins) p.reset?.()
    this.cached = {}
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    for (const p of this.plugins) p.onMarketTick(tick, ctx)

    // Build a single snapshot for this tick (O(1) reads for strategies/UI without triggering computation).
    const snap: PluginsSnapshot = {}
    for (const p of this.plugins) {
      if (!p?.id) continue
      if (typeof p.snapshot !== 'function') continue
      const v = p.snapshot()
      if (typeof v === 'undefined') continue
      snap[p.id] = v
    }
    this.cached = snap
  }

  snapshot(): PluginsSnapshot {
    return this.cached
  }
}

