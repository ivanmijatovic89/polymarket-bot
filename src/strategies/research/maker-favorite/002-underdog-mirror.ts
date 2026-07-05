import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { isWarmed, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  maxUnderdogMid: z.coerce.number().finite().min(0.01).max(0.5).default(0.45),
  discount: z.coerce.number().finite().positive().max(0.49).default(0.01),
  size: z.coerce.number().finite().positive().default(40),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'maker-favorite.002-underdog-mirror',
  title: 'Maker favorite underdog mirror',
  description:
    'Places one resting maker bid below mid on the currently lower-mid leg, then holds any fill to resolution.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

function round2(p: number): number {
  return Math.round(p * 100) / 100
}

function validBook(book: AssetBook | undefined): book is UsableBook {
  return (
    book?.bestBid != null &&
    book.bestAsk != null &&
    book.mid != null &&
    Number.isFinite(book.bestBid) &&
    Number.isFinite(book.bestAsk) &&
    Number.isFinite(book.mid)
  )
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'maker-favorite.002-underdog-mirror'

  let lastMarketKey: string | null = null
  let orderPlaced = false

  const resetEpisode = () => {
    orderPlaced = false
  }

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    if (!isWarmed(ctx)) return []

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    const marketKey = tick.snapshot.market ?? ctx?.market?.slug ?? null
    if (marketKey && lastMarketKey && marketKey !== lastMarketKey) resetEpisode()
    if (marketKey) lastMarketKey = marketKey
    if (orderPlaced) return []

    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]
    if (!validBook(up) || !validBook(down)) return []

    const upMid = up.mid
    const downMid = down.mid

    const underdogAssetId = upMid <= downMid ? upAssetId : downAssetId
    const underdogMid = Math.min(upMid, downMid)
    if (underdogMid > cfg.maxUnderdogMid) {
      orderPlaced = true
      return []
    }

    const bidPrice = safeProbabilityPrice(round2(underdogMid - cfg.discount))
    if (bidPrice < 0.01 || bidPrice > 0.99) {
      orderPlaced = true
      return []
    }

    orderPlaced = true
    const side = underdogAssetId === upAssetId ? 'up' : 'down'
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${side}`,
        assetId: underdogAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `underdog ${side} mid=${underdogMid.toFixed(4)} bid=${bidPrice.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
