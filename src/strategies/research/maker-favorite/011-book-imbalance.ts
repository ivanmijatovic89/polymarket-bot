import type {
  Intent,
  MarketTick,
  OpenOrder,
  PortfolioSnapshot,
  Strategy,
} from '../../../strategy/Strategy.js'
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
  cancelDelta: z.coerce.number().finite().positive().max(0.49).default(0.03),
  // Require the favorite book to be at least this bid-supported at entry:
  // bidDepth / (bidDepth + askDepth) over the top `imbLevels` cumulative levels.
  // High values reject ask-heavy (being-sold-into) favorite books, which the
  // convergence research measured as ~2.5c overpriced.
  minFavBidRatio: z.coerce.number().finite().min(0).max(1).default(0.5),
  imbLevels: z.coerce.number().int().positive().max(10).default(3),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

const ACTIVE_STATES: ReadonlySet<OpenOrder['state']> = new Set([
  'requested',
  'open',
  'partially_filled',
])

export const definition: StrategyDefinition<Config> = {
  id: 'maker-favorite.011-book-imbalance',
  title: 'Maker favorite book imbalance',
  description:
    'Places one delayed maker bid on a stronger favorite only when the favorite book is bid-supported (not ask-heavy), then cancels if that side weakens before fill.',
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

/**
 * Cumulative depth through the top `levels` price levels of a side, read from
 * the precomputed `*DepthByLevel` arrays (index 0 == L1). Falls back to 0 when
 * the arrays are missing or shorter than requested.
 */
function cumulativeDepth(depthByLevel: number[] | undefined, levels: number): number {
  if (!Array.isArray(depthByLevel) || depthByLevel.length === 0) return 0
  const idx = Math.min(levels, depthByLevel.length) - 1
  const v = depthByLevel[idx]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Bid-support ratio of a book over the top `levels`: bidDepth / (bidDepth +
 * askDepth). Returns null when there is no depth to measure (gate cannot judge
 * quality, so the caller should skip).
 */
function bidSupportRatio(book: UsableBook, levels: number): number | null {
  const bidDepth = cumulativeDepth(book.bidsDepthByLevel, levels)
  const askDepth = cumulativeDepth(book.asksDepthByLevel, levels)
  const total = bidDepth + askDepth
  if (total <= 0) return null
  return bidDepth / total
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

function activeOrder(portfolio: PortfolioSnapshot, clientOrderId: string | null): OpenOrder | null {
  if (!clientOrderId) return null
  const order = portfolio.openOrdersByClientId[clientOrderId]
  if (!order || !ACTIVE_STATES.has(order.state)) return null
  return order
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'maker-favorite.011-book-imbalance'

  let lastMarketKey: string | null = null
  let orderPlaced = false
  let cancelRequested = false
  let buyClientOrderId: string | null = null
  let boughtAssetId: string | null = null
  let entryMid: number | null = null

  const resetEpisode = () => {
    orderPlaced = false
    cancelRequested = false
    buyClientOrderId = null
    boughtAssetId = null
    entryMid = null
  }

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
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

    if (
      boughtAssetId &&
      buyClientOrderId &&
      entryMid != null &&
      !cancelRequested &&
      activeOrder(portfolio, buyClientOrderId)
    ) {
      const book = tick.snapshot.byAssetId[boughtAssetId]
      if (validBook(book) && book.mid <= entryMid - cfg.cancelDelta) {
        cancelRequested = true
        return [
          {
            kind: 'cancel_order',
            clientOrderId: buyClientOrderId,
            reason: `favorite_weakened mid=${book.mid.toFixed(4)} entry=${entryMid.toFixed(4)}`,
          },
        ]
      }
    }

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
    const fav = favAssetId === upAssetId ? up : down
    const favMid = fav.mid

    if (favMid < cfg.favThreshold) {
      orderPlaced = true
      return []
    }

    // Book-quality gate: reject ask-heavy favorite books (informed selling).
    // A tick with no measurable depth is skipped without arming the episode,
    // so a later tick with depth can still qualify.
    const bidRatio = bidSupportRatio(fav, cfg.imbLevels)
    if (bidRatio === null) return []
    if (bidRatio < cfg.minFavBidRatio) {
      orderPlaced = true
      return []
    }

    const bidPrice = safeProbabilityPrice(round2(favMid - cfg.discount))
    if (bidPrice < 0.01 || bidPrice > 0.99) {
      orderPlaced = true
      return []
    }

    orderPlaced = true
    boughtAssetId = favAssetId
    entryMid = favMid
    const side = favAssetId === upAssetId ? 'up' : 'down'
    buyClientOrderId = `${name}:${marketKey ?? 'mkt'}:${side}:buy`
    return [
      {
        kind: 'place_limit',
        clientOrderId: buyClientOrderId,
        assetId: favAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `bid-supported favorite ${side} elapsed=${elapsedSec.toFixed(1)}s mid=${favMid.toFixed(4)} bidRatio=${bidRatio.toFixed(3)} bid=${bidPrice.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
