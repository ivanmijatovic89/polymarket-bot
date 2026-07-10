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
  /** Elapsed seconds into the 15m episode after which the one-shot entry triggers. */
  entryTimeSec: z.coerce.number().finite().min(0).max(899).default(897),
  /** Absolute resting bid price on the near-certain favorite (probability units). */
  bidPrice: z.coerce.number().finite().min(0.5).max(0.99).default(0.955),
  /** Favorite qualifies only if its best bid is at or above this (near-certainty gate). */
  certaintyThreshold: z.coerce.number().finite().min(0.5).max(0.99).default(0.95),
  /** Order size in shares. */
  size: z.coerce.number().finite().positive().default(40),
  /**
   * Cancel the resting bid once the favorite's best bid has dropped by at
   * least this much (probability units) from its level at placement.
   * Pre-fill toxicity control: a genuine last-second flip collapses the
   * favorite's bid side before/while the ask crashes through our price.
   */
  cancelDrop: z.coerce.number().finite().min(0.001).max(0.5).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'endgame-panic-bid.001-cancel-on-adverse-move',
  title: 'Endgame panic bid with cancel-on-adverse-move',
  description:
    'Rests one late maker bid on the near-certain winning token (as 000-baseline) and cancels it if the favorite book deteriorates from its placement level, refusing fills that arrive during a genuine last-second flip.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

const EPISODE_LENGTH_SEC = 900

function round3(p: number): number {
  return Math.round(p * 1000) / 1000
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
  const name = 'endgame-panic-bid.001-cancel-on-adverse-move'

  let lastMarketKey: string | null = null
  let placed = false
  let canceled = false
  let placedClientOrderId: string | null = null
  let placedFavAssetId: string | null = null
  let placementFavBid: number | null = null

  const resetEpisode = () => {
    placed = false
    canceled = false
    placedClientOrderId = null
    placedFavAssetId = null
    placementFavBid = null
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

    // Post-placement lifecycle: watch the favorite's bid side and cancel on
    // adverse deterioration. Cancelling an already-filled order is a no-op.
    if (placed) {
      if (canceled) return []
      if (placedFavAssetId === null || placementFavBid === null || placedClientOrderId === null) {
        return []
      }
      const fav = tick.snapshot.byAssetId[placedFavAssetId]
      const favBid = fav?.bestBid
      const bidGone = favBid == null || !Number.isFinite(favBid)
      const dropped = !bidGone && placementFavBid - favBid >= cfg.cancelDrop
      if (bidGone || dropped) {
        canceled = true
        const level = bidGone ? 'gone' : favBid.toFixed(3)
        return [
          {
            kind: 'cancel_order',
            clientOrderId: placedClientOrderId,
            reason: `adverse move: favBid ${placementFavBid.toFixed(3)} -> ${level} (cancelDrop=${cfg.cancelDrop})`,
          },
        ]
      }
      return []
    }

    if (elapsedSec < cfg.entryTimeSec) return []
    if (elapsedSec >= EPISODE_LENGTH_SEC) {
      placed = true
      canceled = true
      return []
    }

    // Wait (without consuming the one shot) until both legs are two-sided:
    // the measured donor cell conditions on two-sided books.
    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]
    if (!validBook(up) || !validBook(down)) return []

    // Decide once, at the first eligible two-sided endgame tick.
    placed = true

    const favAssetId = up.mid >= down.mid ? upAssetId : downAssetId
    const fav = up.mid >= down.mid ? up : down

    // Certainty gate: bid-based, matching the measured bid-band conditioning.
    if (fav.bestBid < cfg.certaintyThreshold) {
      canceled = true
      return []
    }

    const bidPrice = safeProbabilityPrice(round3(cfg.bidPrice))
    if (bidPrice < 0.01 || bidPrice > 0.99) {
      canceled = true
      return []
    }

    // Maker-only guard: a GTC at or above the ask would cross and pay the
    // taker fee — the measured wrong-signed K-002 path. Skip the episode.
    if (fav.bestAsk <= bidPrice) {
      canceled = true
      return []
    }

    const side = favAssetId === upAssetId ? 'up' : 'down'
    placedClientOrderId = `${name}:${marketKey ?? 'mkt'}:${side}`
    placedFavAssetId = favAssetId
    placementFavBid = fav.bestBid
    return [
      {
        kind: 'place_limit',
        clientOrderId: placedClientOrderId,
        assetId: favAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `endgame ${side} elapsed=${elapsedSec.toFixed(1)}s favBid=${fav.bestBid.toFixed(3)} favAsk=${fav.bestAsk.toFixed(3)} bid=${bidPrice.toFixed(3)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
