import type { IndicatorsSnapshot } from '../indicators/IndicatorSet.js'
import type { ExternalFeedsSnapshot } from '../trading/feeds/externalFeeds.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { PositionMetrics } from './Strategy.js'

export type StrategyContext = {
  indicators?: IndicatorsSnapshot
  feeds?: ExternalFeedsSnapshot
  market?: GammaMarketMeta
  positionMetrics?: PositionMetrics
}


