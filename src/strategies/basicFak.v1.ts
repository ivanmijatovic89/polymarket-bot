import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

/**
 * Basic FAK strategy that buys once when bestAsk price reaches target price.
 * - Monitors bestAsk price from orderbook
 * - When bestAsk reaches 0.30, buys 5 shares using FOK order type
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
  description: 'Buys 5 shares when bestAsk reaches 0.30, executes only once.',
  schema: BasicFakConfigSchema,
  create: (params) => createBasicFakStrategy(params),
}

function pickAssetId(tick: MarketTick, preferred?: string): string | null {
  if (preferred && tick.snapshot.byAssetId[preferred]) return preferred
  const ids = Object.keys(tick.snapshot.byAssetId)
  return ids[0] ?? null
}

export function createBasicFakStrategy(cfg: BasicFakConfig): Strategy {
  const name = 'basic_fak'
  let hasPurchased = false

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    // Strategy can only execute once
    if (hasPurchased) return []

    const assetId = pickAssetId(tick, cfg.assetId)
    if (!assetId) return []

    const book = tick.snapshot.byAssetId[assetId]
    if (!book || book.bestAsk === null) return []

    // console log both buy and sell best ask and bid
    // console.log('buy best ask', book.bestAsk)
    // console.log('sell best bid', book.bestBid)
    return [];

    // if (book.bestAsk > cfg.targetPrice) return []

    // // Price reached target, execute buy order
    // hasPurchased = true
    // const now = tick.snapshot.timestamp || Date.now()

    // return [
    //   {
    //     kind: 'place_limit',
    //     clientOrderId: `${name}:${assetId}:buy:${now}`,
    //     assetId,
    //     side: 'BUY',
    //     price: book.bestAsk,
    //     size: cfg.size,
    //     orderType: 'FOK',
    //     reason: 'target_price_reached',
    //   },
    // ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}

