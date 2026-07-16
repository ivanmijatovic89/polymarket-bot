import type { MarketTick } from '../Strategy.js'
import type { Plugin } from './PluginSet.js'

// Keep this in sync with Strategy.requiredFeeds shape, but avoid importing Strategy types here.
export type ExternalFeedsRequestConfig = {
  rtdsCryptoPrices?: {
    binanceSymbols?: string[]
    chainlinkSymbols?: string[]
  }
  binanceWsSpotPrice?: {
    symbol?: string
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
 * - Backtests (`--feeds ...`) fulfill it with a point-in-time provider that
 *   reads the current tick (`src/backtest/feeds/wireBacktestExternalFeeds.ts`);
 *   the live provider ignores the tick argument. Unfulfilled, it stays absent
 *   from `ctx.plugins` — the pre-`--feeds` behavior.
 */
export class ExternalFeedsRequestPlugin implements Plugin {
  readonly id = 'externalFeeds'

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
