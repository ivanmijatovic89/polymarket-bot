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
 *
 * Backtests should not fulfill it (and it will stay absent from `ctx.plugins`).
 */
export class ExternalFeedsRequestPlugin implements Plugin {
  readonly id = 'externalFeeds'

  readonly config: ExternalFeedsRequestConfig

  private getSnapshot: (() => unknown) | null = null

  constructor(config: ExternalFeedsRequestConfig) {
    this.config = config
  }

  fulfill(getSnapshot: () => unknown): void {
    this.getSnapshot = getSnapshot
  }

  onMarketTick(tick: MarketTick): void {
    void tick
  }

  snapshot(): unknown {
    if (!this.getSnapshot) return undefined
    return this.getSnapshot()
  }
}
