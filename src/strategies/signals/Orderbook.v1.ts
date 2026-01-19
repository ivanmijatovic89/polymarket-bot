import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../../strategy/plugins/TimeWindowVolatility.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'orderbook.v1',
  title: 'Orderbook v1',
  description:
    'Signal strategy: reads orderbook metrics (weakBidRatioByLevel @ depth 3) and logs when below threshold',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy,
  plugins: Plugin[]
} {
  void cfg
  const name = 'orderbook.v1'

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
    const orderbookMetrics = ctx?.metrics?.orderbook
    if (orderbookMetrics?.weakBidRatioByLevel) {
      const depth3Ratio = orderbookMetrics.weakBidRatioByLevel[1]
      const weakSide = orderbookMetrics.weakBidSideByLevel[1]

      // Get UP and DOWN assetIds from market meta (Up/Down 15m markets)
      const upAssetId = ctx?.market?.upAssetId ?? undefined
      const downAssetId = ctx?.market?.downAssetId ?? undefined

      // Get depth values at level 3 (index 1)
      let depthAtLevel3: number | undefined
      let weekSideBook: OrderBookSnapshot | undefined
      if (upAssetId && downAssetId) {
        const upBook = tick.snapshot.byAssetId[upAssetId]
        const downBook = tick.snapshot.byAssetId[downAssetId]
        if (upBook && downBook) {
          const upDepth = upBook.bidsDepthByLevel[1]
          const downDepth = downBook.bidsDepthByLevel[1]

          // Use the depth of the weak side, else min(up, down)
          if (weakSide === 'UP' && upDepth !== undefined) {
            depthAtLevel3 = upDepth
            weekSideBook = upBook
          } else if (weakSide === 'DOWN' && downDepth !== undefined) {
            depthAtLevel3 = downDepth
            weekSideBook = downBook
          } else {
            depthAtLevel3 = Math.min(
              upDepth !== undefined ? upDepth : Infinity,
              downDepth !== undefined ? downDepth : Infinity,
            )
            if (!Number.isFinite(depthAtLevel3)) depthAtLevel3 = undefined
          }
        }

        if (depth3Ratio !== undefined && depth3Ratio < 0.1) {
          console.log(
            `[trigger] depth 3 (${depthAtLevel3 !== undefined ? depthAtLevel3 : 'N/A'}) ratio < 0.1, weak side: ${weakSide ?? 'N/A'} ${weekSideBook?.bestAsk}`,
          )
        }
      }

    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, ctx) => {
    void ev
    void _portfolio
    void _lastMarket
    void ctx

    return []
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy, plugins }
}
