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
  favThreshold: z.coerce.number().finite().min(0.5).max(0.99).default(0.55),
  discount: z.coerce.number().finite().positive().max(0.49).default(0.02),
  size: z.coerce.number().finite().positive().default(40),
  startSec: z.coerce.number().finite().nonnegative().default(180),
  stopSec: z.coerce.number().finite().nonnegative().default(840),
  lookbackSec: z.coerce.number().finite().positive().default(120),
  maxRange: z.coerce.number().finite().positive().max(0.49).default(0.04),
  minSamples: z.coerce.number().finite().int().positive().default(3),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

type FavoriteObservation = {
  elapsedSec: number
  side: 'up' | 'down'
  assetId: string
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'maker-favorite.014-volatility-guard',
  title: 'Maker favorite volatility guard',
  description:
    'Places one delayed favorite maker bid only if the recent favorite side stayed stable and its mid range stayed small.',
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

function stableRecentRange(
  history: FavoriteObservation[],
  current: FavoriteObservation,
  cfg: Config,
): number | null {
  const minElapsed = current.elapsedSec - cfg.lookbackSec
  const recent = history.filter((obs) => obs.elapsedSec >= minElapsed)
  if (recent.length < cfg.minSamples) return null
  if (recent.some((obs) => obs.assetId !== current.assetId || obs.side !== current.side))
    return null

  let minMid = Number.POSITIVE_INFINITY
  let maxMid = Number.NEGATIVE_INFINITY
  for (const obs of recent) {
    minMid = Math.min(minMid, obs.mid)
    maxMid = Math.max(maxMid, obs.mid)
  }
  const range = maxMid - minMid
  return Number.isFinite(range) ? range : null
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'maker-favorite.014-volatility-guard'

  let lastMarketKey: string | null = null
  let orderPlaced = false
  let history: FavoriteObservation[] = []

  const resetEpisode = () => {
    orderPlaced = false
    history = []
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

    const startMs = marketStartMs(tick, ctx)
    if (startMs === null) return []

    const elapsedSec = (nowMs - startMs) / 1000
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
    const side = favAssetId === upAssetId ? 'up' : 'down'
    const current: FavoriteObservation = {
      elapsedSec,
      side,
      assetId: favAssetId,
      mid: favMid,
    }

    history.push(current)
    const minStoredElapsed = elapsedSec - cfg.lookbackSec
    while (history.length > 0 && history[0]!.elapsedSec < minStoredElapsed) history.shift()

    if (orderPlaced || elapsedSec < cfg.startSec) return []

    if (favMid < cfg.favThreshold) {
      orderPlaced = true
      return []
    }

    const recentRange = stableRecentRange(history, current, cfg)
    if (recentRange === null || recentRange > cfg.maxRange) {
      orderPlaced = true
      return []
    }

    const bidPrice = safeProbabilityPrice(round2(favMid - cfg.discount))
    if (bidPrice < 0.01 || bidPrice > 0.99) {
      orderPlaced = true
      return []
    }

    orderPlaced = true
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${side}:buy`,
        assetId: favAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `stable favorite ${side} elapsed=${elapsedSec.toFixed(1)}s mid=${favMid.toFixed(4)} range=${recentRange.toFixed(4)} bid=${bidPrice.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
