import type { IndicatorsSnapshot } from '../indicators/IndicatorSet.js'
import type { ExternalFeedsSnapshot } from '../trading/feeds/externalFeeds.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { Metrics } from './Strategy.js'

export type WarmupSnapshot = {
  status: 'warming' | 'warmed' | 'error'
  /** Optional market slug / identifier for debugging. */
  slug?: string
  /** Token IDs (assetIds) that were intended to be warmed (typically UP+DOWN). */
  assetIds: string[]
  startedAtMs: number
  finishedAtMs?: number
  error?: string
}

export type StrategyContext = {
  indicators?: IndicatorsSnapshot
  feeds?: ExternalFeedsSnapshot
  market?: GammaMarketMeta
  metrics?: Metrics
  /** Live-only: token warmup readiness (used to gate order placement). */
  warmup?: WarmupSnapshot
}


