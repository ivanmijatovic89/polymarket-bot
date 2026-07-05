import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import {
  isWarmed,
  parseGammaMarketStartMs,
  safeProbabilityPrice,
} from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  favThreshold: z.coerce.number().finite().min(0.5).max(0.99).default(0.52),
  discount: z.coerce.number().finite().positive().max(0.49).default(0.01),
  size: z.coerce.number().finite().positive().default(40),
  startSec: z.coerce.number().finite().nonnegative().default(0),
  stopSec: z.coerce.number().finite().nonnegative().default(840),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'maker-favorite.001-entry-window',
  title: 'Maker favorite entry window',
  description:
    'Places the baseline favorite maker bid only inside a configured elapsed-time window, then holds any fill to resolution.',
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

function parseMarketStartMsFromSlug(slug: unknown): number | null {
  if (typeof slug !== 'string') return null
  const m = /-(\d{9,})$/.exec(slug)
  if (!m || !m[1]) return null
  const epochStartSec = Number(m[1])
  return Number.isFinite(epochStartSec) ? epochStartSec * 1000 : null
}

function marketStartMs(tick: MarketTick, ctx?: StrategyContext): number | null {
  return (
    parseGammaMarketStartMs(ctx?.market) ??
    parseMarketStartMsFromSlug(ctx?.market?.slug ?? tick.snapshot.market)
  )
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'maker-favorite.001-entry-window'

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

    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    const marketKey = tick.snapshot.market ?? ctx?.market?.slug ?? null
    if (marketKey && lastMarketKey && marketKey !== lastMarketKey) resetEpisode()
    if (marketKey) lastMarketKey = marketKey
    if (orderPlaced) return []

    const startMs = marketStartMs(tick, ctx)
    if (startMs === null) return []

    const elapsedSec = (nowMs - startMs) / 1000
    if (elapsedSec < cfg.startSec) return []
    if (elapsedSec > cfg.stopSec) {
      orderPlaced = true
      return []
    }

    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]
    if (!validBook(up) || !validBook(down)) return []

    const upMid = up.mid
    const downMid = down.mid

    const favAssetId = upMid >= downMid ? upAssetId : downAssetId
    const favMid = Math.max(upMid, downMid)
    if (favMid < cfg.favThreshold) {
      orderPlaced = true
      return []
    }

    const bidPrice = safeProbabilityPrice(round2(favMid - cfg.discount))
    if (bidPrice < 0.01 || bidPrice > 0.99) {
      orderPlaced = true
      return []
    }

    orderPlaced = true
    const side = favAssetId === upAssetId ? 'up' : 'down'
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${side}`,
        assetId: favAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `favorite ${side} elapsed=${elapsedSec.toFixed(1)}s mid=${favMid.toFixed(4)} bid=${bidPrice.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
