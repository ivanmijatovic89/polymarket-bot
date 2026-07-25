import type { MarketTick } from '../Strategy.js'
import type { Plugin } from './PluginSet.js'

// Keep this in sync with Strategy.requiredFeeds shape, but avoid importing Strategy types here.
export type ExternalFeedsRequestConfig = {
  rtdsCryptoPrices?: {
    binanceSymbols?: string[]
    chainlinkSymbols?: string[]
    /** Reserved for the chainlink synthetic-tick follow-up (see ADR). */
    tickOnUpdate?: boolean
  }
  binanceWsSpotPrice?: {
    symbol?: string
    /**
     * Opt-in synthetic strategy ticks on every Binance aggTrade
     * (event_type 'binance_agg_trade'), live and replay identically.
     * Default false: behavior is bit-identical to before the feature.
     */
    tickOnUpdate?: boolean
  }
  polymarketPriceToBeat?: {
    enabled?: boolean
  }
}

/**
 * Declarative (side-effect free) request for external feeds.
 *
 * - Strategies can include this in their `plugins: []` list.
 * - Live runtime (trading-bot) reads this config and starts the actual feed clients + store.
 * - Runtime then fulfills this plugin by injecting a snapshot provider.
 * - Backtests fulfill it the same strategy-driven way with a point-in-time
 *   provider that reads the current tick
 *   (`src/backtest/feeds/wireBacktestExternalFeeds.ts`); the live provider
 *   ignores the tick argument. Unfulfilled (e.g. no backtest data source for
 *   the requested sub-feed), it stays absent from `ctx.plugins`.
 */
export class ExternalFeedsRequestPlugin implements Plugin {
  readonly id = 'externalFeeds'

  // Must see synthetic ticks: lastTick drives the point-in-time provider, so a
  // synthetic tick's feed snapshot must be read as-of that tick's clock.
  readonly handlesSyntheticTicks = true

  readonly config: ExternalFeedsRequestConfig

  private getSnapshot: ((tick?: MarketTick) => unknown) | null = null

  private lastTick: MarketTick | undefined

  constructor(config: ExternalFeedsRequestConfig) {
    this.config = config
  }

  fulfill(getSnapshot: (tick?: MarketTick) => unknown): void {
    this.getSnapshot = getSnapshot
  }

  onMarketTick(tick: MarketTick): void {
    // PluginSet runs every plugin's onMarketTick before rebuilding snapshots,
    // so lastTick is always the current tick by the time snapshot() is called.
    this.lastTick = tick
  }

  snapshot(): unknown {
    if (!this.getSnapshot) return undefined
    return this.getSnapshot(this.lastTick)
  }

  reset(): void {
    this.lastTick = undefined
  }
}

/**
 * Structural detection of the request plugin. `instanceof` is NOT reliable
 * here: `strategyRegistry` loads strategy files via CJS `createRequire`, so a
 * strategy's plugin instance is built from a second copy of this class, while
 * runtimes (trading-bot / backtest feed wiring) import the ESM copy — two
 * class identities for the same source. Duck-typing on the stable surface
 * (`id` + `fulfill` + `config`) works across both module instances.
 */
export function isExternalFeedsRequestPlugin(p: Plugin): p is ExternalFeedsRequestPlugin {
  if (p instanceof ExternalFeedsRequestPlugin) return true
  const dup = p as Partial<ExternalFeedsRequestPlugin>
  return (
    p.id === 'externalFeeds' &&
    typeof dup.fulfill === 'function' &&
    typeof dup.config === 'object' &&
    dup.config !== null
  )
}
