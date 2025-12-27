import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

/**
 * Basic FAK strategy that buys once when bestAsk price reaches target price.
 * - Monitors bestAsk price from orderbook for both assets (UP/DOWN)
 * - When bestAsk reaches targetPrice on either asset, buys that asset using FOK order type
 * - Executes only once per strategy instance
 */
export const BasicFakConfigSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  size: z.coerce.number().finite().default(5),
  targetPrice: z.coerce.number().finite().default(0.30),
})

export type BasicFakConfig = z.infer<typeof BasicFakConfigSchema>

export const definition: StrategyDefinition<BasicFakConfig> = {
  id: 'basicFak.v1',
  title: 'Basic FAK v1',
  description: 'Buys 5 shares when bestAsk reaches 0.30 on either asset, executes only once.',
  schema: BasicFakConfigSchema,
  create: (params) => createBasicFakStrategy(params),
}

function pickTwoAssetIds(tick: MarketTick, preferred?: string): [string, string] | null {
  // If preferred asset is specified, still check both assets but prioritize preferred
  if (preferred && tick.snapshot.byAssetId[preferred]) {
    const ids = Object.keys(tick.snapshot.byAssetId).sort()
    const otherId = ids.find(id => id !== preferred)
    if (otherId) return [preferred, otherId]
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

export function createBasicFakStrategy(cfg: BasicFakConfig): Strategy {
  const name = 'basic_fak'
  let hasPurchased = false

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    // Strategy can only execute once
    if (hasPurchased) return []

    const assetIds = pickTwoAssetIds(tick, cfg.assetId)
    if (!assetIds) return []

    const [assetA, assetB] = assetIds

    // Check both assets to see which one (if any) has reached target price
    const bookA = tick.snapshot.byAssetId[assetA]
    const bookB = tick.snapshot.byAssetId[assetB]

    // Check asset A
    if (bookA && bookA.bestAsk !== null && bookA.bestAsk <= cfg.targetPrice) {
      hasPurchased = true
      const now = tick.snapshot.timestamp || Date.now()
      console.log('placing buy order', {
        kind: 'place_limit',
        clientOrderId: `${name}:${assetA}:buy:${now}`,
        assetId: assetA,
        side: 'BUY',
        price: bookA.bestAsk,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'target_price_reached',
      })
      return [
        {
          kind: 'place_limit',
          clientOrderId: `${name}:${assetA}:buy:${now}`,
          assetId: assetA,
          side: 'BUY',
          price: bookA.bestAsk,
          size: cfg.size,
          orderType: 'FOK',
          reason: 'target_price_reached',
        },
      ]
    }

    // Check asset B
    if (bookB && bookB.bestAsk !== null && bookB.bestAsk <= cfg.targetPrice) {
      hasPurchased = true
      const now = tick.snapshot.timestamp || Date.now()
      console.log('placing buy order', {
        kind: 'place_limit',
        clientOrderId: `${name}:${assetB}:buy:${now}`,
        assetId: assetB,
        side: 'BUY',
        price: bookB.bestAsk,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'target_price_reached',
      })
      return [
        {
          kind: 'place_limit',
          clientOrderId: `${name}:${assetB}:buy:${now}`,
          assetId: assetB,
          side: 'BUY',
          price: bookB.bestAsk,
          size: cfg.size,
          orderType: 'FOK',
          reason: 'target_price_reached',
        },
      ]
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}

