/**
 * Temporary diagnostic (EXP-002 one-legged fills): prints both asks ladders
 * whenever the dutch-book condition fires. Places no orders. Delete or keep
 * as a fixture; never quote results.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({
  maxPrints: z.coerce.number().int().positive().default(5),
})

export const definition: StrategyDefinition<z.infer<typeof ConfigSchema>> = {
  id: 'fable-debug-book',
  title: 'debug book ladders',
  description: 'Prints asks ladders when ask(UP)+ask(DOWN) < 0.99. No orders.',
  schema: ConfigSchema,
  create: (cfg) => {
    let prints = 0
    const onMarketTick = (
      tick: MarketTick,
      _p: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      const meta = ctx?.market
      if (!meta?.upAssetId || !meta?.downAssetId || prints >= cfg.maxPrints) return []
      const up = tick.snapshot.byAssetId[meta.upAssetId]
      const down = tick.snapshot.byAssetId[meta.downAssetId]
      if (!up?.bestAsk || !down?.bestAsk) return []
      if (up.bestAsk + down.bestAsk < 0.99) {
        prints += 1
        console.log('[debug-book] ts=', tick.snapshot.timestamp, 'upBestAsk=', up.bestAsk, 'downBestAsk=', down.bestAsk)
        console.log('  up.asks[0..3]  =', JSON.stringify(up.asks.slice(0, 4)))
        console.log('  up.bids[0..3]  =', JSON.stringify(up.bids.slice(0, 4)))
        console.log('  down.asks[0..3]=', JSON.stringify(down.asks.slice(0, 4)))
        console.log('  down.bids[0..3]=', JSON.stringify(down.bids.slice(0, 4)))
        if (prints === 1) {
          return [
            {
              kind: 'place_batch',
              orders: [
                { clientOrderId: `dbg:${meta.slug}:up`, assetId: meta.upAssetId, side: 'BUY', price: up.bestAsk, size: 10, orderType: 'FOK' },
                { clientOrderId: `dbg:${meta.slug}:down`, assetId: meta.downAssetId, side: 'BUY', price: down.bestAsk, size: 10, orderType: 'FOK' },
              ],
              reason: 'debug pair',
            },
          ]
        }
      }
      return []
    }
    const onAccountEvent: Strategy['onAccountEvent'] = (ev) => {
      console.log('[debug-book][account]', JSON.stringify(ev).slice(0, 300))
      return []
    }
    const strategy: Strategy = { name: 'fable-debug-book', onMarketTick, onAccountEvent }
    return { strategy }
  },
}
