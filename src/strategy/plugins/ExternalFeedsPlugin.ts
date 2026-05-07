import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { MarketTick } from '../Strategy.js'
import type { Plugin } from './PluginSet.js'

export class ExternalFeedsPlugin implements Plugin {
  readonly id = 'externalFeeds'

  private readonly getSnapshot: () => ExternalFeedsSnapshot

  constructor(getSnapshot: () => ExternalFeedsSnapshot) {
    this.getSnapshot = getSnapshot
  }

  // External feeds are updated out-of-band; StrategyRunner snapshots them once per tick.
  onMarketTick(tick: MarketTick): void {
    void tick
  }

  snapshot(): ExternalFeedsSnapshot {
    return this.getSnapshot()
  }
}
