import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import { isSyntheticFeedTick } from '../../market/syntheticTick.js'

export type PluginId = string

export interface Plugin {
  id: PluginId
  onMarketTick: (tick: MarketTick, ctx?: StrategyContext) => void
  /**
   * Opt-in: when true, onMarketTick also fires for synthetic feed ticks
   * (event_type 'binance_agg_trade' / 'chainlink_round' — unchanged book,
   * re-stamped time). Default absent/false: the plugin only ever sees real
   * book ticks, so event-counting plugins (e.g. TimeWindowVolatility's
   * one-sample-per-tick) cannot silently regress when a strategy opts into
   * synthetic ticks. `snapshot()` is still rebuilt on every tick either way.
   * Structural (a data property), so it survives the CJS/ESM dual-class
   * loading described in isExternalFeedsRequestPlugin.
   *
   * NOTE: `snapshot()` IS still invoked on synthetic ticks even for skipped
   * plugins (the per-tick cache is always rebuilt) — keep snapshot() pure and
   * cheap; only onMarketTick is gated by this flag.
   */
  handlesSyntheticTicks?: boolean
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
    const synthetic = isSyntheticFeedTick(tick.msg)
    for (const p of this.plugins) {
      if (synthetic && p.handlesSyntheticTicks !== true) continue
      p.onMarketTick(tick, ctx)
    }
    this.cached = this.buildSnapshot()
  }

  snapshot(): PluginsSnapshot {
    return this.cached
  }

  refreshSnapshot(): PluginsSnapshot {
    this.cached = this.buildSnapshot()
    return this.cached
  }

  private buildSnapshot(): PluginsSnapshot {
    // Build a single snapshot for this tick (O(1) reads for strategies/UI without triggering computation).
    const snap: PluginsSnapshot = {}
    for (const p of this.plugins) {
      if (!p?.id) continue
      if (typeof p.snapshot !== 'function') continue
      const v = p.snapshot()
      if (typeof v === 'undefined') continue
      snap[p.id] = v
    }
    return snap
  }
}
