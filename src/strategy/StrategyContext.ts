import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { Metrics } from './Strategy.js'
import type { PluginsSnapshot } from './plugins/PluginSet.js'
import type { BalanceSnapshot } from '../blockchain/balanceTracker.js'

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
  plugins?: PluginsSnapshot
  market?: GammaMarketMeta
  metrics?: Metrics
  balance?: BalanceSnapshot
  /** Live-only: token warmup readiness (used to gate order placement). */
  warmup?: WarmupSnapshot
}

