import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import type { Plugin } from '../strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../strategy/plugins/TimeWindowVolatility.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'buyBoth.v1',
  title: 'BuyBoth v1',
  description: 'Strategy that checks weakBidRatioByLevel at depth 3 and triggers when ratio < 0.3',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(_cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  void _cfg
  const name = 'buyBoth.v1'

  const windows = {
    '1s': 1_000,
    '5s': 5_000,
    '10s': 10_000,
    '60s': 60_000,
  } as const

  const plugins: Plugin[] = [new TimeWindowVolatility({ windows })]

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio

    // Check orderbook metrics for weakBidRatioByLevel at depth 3
    // Array index 0 == L1, so depth 3 is at index 2 (if starting from 1)
    // If starting from 0, depth 3 would be at index 3
    const orderbookMetrics = ctx?.metrics?.orderbook
    if (orderbookMetrics?.weakBidRatioByLevel) {
      // Check depth 3: index 2 if levels start from 1, index 3 if levels start from 0
      const depth3RatioIndex2 = orderbookMetrics.weakBidRatioByLevel[2] // depth 3 if starting from 1
      const weakSide = orderbookMetrics.weakBidSideByLevel[2]

      // Get UP and DOWN assetIds from market meta
      const upAssetId = ctx?.market?.upAssetId ?? undefined
      const downAssetId = ctx?.market?.downAssetId ?? undefined

      // Get depth values at level 3 (index 2)
      let depthAtLevel3: number | undefined
      if (upAssetId && downAssetId) {
        const upBook = tick.snapshot.byAssetId[upAssetId]
        const downBook = tick.snapshot.byAssetId[downAssetId]
        if (upBook && downBook) {
          const upDepth = upBook.bidsDepthByLevel[2]
          const downDepth = downBook.bidsDepthByLevel[2]
          // Use the depth of the weak side, or show both
          if (weakSide === 'UP' && upDepth !== undefined) {
            depthAtLevel3 = upDepth
          } else if (weakSide === 'DOWN' && downDepth !== undefined) {
            depthAtLevel3 = downDepth
          } else {
            // If NONE or both available, use minimum (the weaker one)
            depthAtLevel3 = Math.min(
              upDepth !== undefined ? upDepth : Infinity,
              downDepth !== undefined ? downDepth : Infinity,
            )
            if (!Number.isFinite(depthAtLevel3)) depthAtLevel3 = undefined
          }
        }
      }

      // Check index 2 (depth 3 if starting from 1)
      if (depth3RatioIndex2 !== undefined && depth3RatioIndex2 < 0.1) {
        console.log(
          `[trigger] depth 3 (${depthAtLevel3 !== undefined ? depthAtLevel3 : 'N/A'}) ratio < 0.1, weak side: ${weakSide ?? 'N/A'}`,
        )
      }
      //   console.log(
      //     `[trigger] depth 3 (${depthAtLevel3 !== undefined ? depthAtLevel3 : 'N/A'}) ratio ${depth3RatioIndex2} < 0.1, weak side: ${weakSide ?? 'N/A'}`,
      //   )

      //   // Check index 3 (depth 3 if starting from 0)
      //   if (depth3RatioIndex3 !== undefined && depth3RatioIndex3 < 0.2) {
      //     console.log(['trigger', 'depth 3 ratio < 0.3'])
      //   }
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, _ctx) => {
    void _portfolio
    void _lastMarket
    void ev
    void _ctx

    return []
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy, plugins }
}
