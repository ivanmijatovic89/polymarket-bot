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
   * Pre-entry stability window in seconds. The episode qualifies only if,
   * over every observed tick in the last `stabilityWindowSec` seconds
   * before the trigger, the trigger tick's favorite leg was already the
   * favorite (no favorite flip). 0 disables all path conditioning.
   */
  stabilityWindowSec: z.coerce.number().finite().min(0).max(300).default(30),
  /**
   * Maximum favorite best-bid range (max - min, probability units) over
   * the stability window. 1 disables the range check (flip check only).
   */
  maxFavBidRange: z.coerce.number().finite().min(0.005).max(1).default(1),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'endgame-panic-bid.002-path-stability',
  title: 'Endgame panic bid with pre-entry path stability qualifier',
  description:
    'Rests one late maker bid on the near-certain winning token (as 000-baseline) only when the favorite leg has been the favorite throughout a pre-entry window (and optionally its bid stayed in a tight range), skipping freshly-flipped favorites.',
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

type PathSample = {
  tsMs: number
  /** 'up' | 'down' — which leg had the higher mid on this tick. */
  favLeg: 'up' | 'down'
  /** That leg's best bid on this tick. */
  favBid: number
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'endgame-panic-bid.002-path-stability'

  let lastMarketKey: string | null = null
  let done = false
  let history: PathSample[] = []

  const resetEpisode = () => {
    done = false
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
    if (done) return []

    const startMs = marketStartMs(tick, ctx)
    if (startMs === null) return []

    const elapsedSec = (nowMs - startMs) / 1000

    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]
    const bothUsable = validBook(up) && validBook(down)

    // Maintain the pre-entry path history on every two-sided tick inside
    // the tracking region (window start may precede entryTimeSec).
    const windowMs = cfg.stabilityWindowSec * 1000
    if (bothUsable && windowMs > 0 && elapsedSec >= cfg.entryTimeSec - cfg.stabilityWindowSec) {
      const favLeg: 'up' | 'down' = up.mid >= down.mid ? 'up' : 'down'
      const favBid = favLeg === 'up' ? up.bestBid : down.bestBid
      history.push({ tsMs: nowMs, favLeg, favBid })
      // Drop samples older than the window relative to the current tick.
      const cutoff = nowMs - windowMs
      while (history.length > 0 && history[0]!.tsMs < cutoff) history.shift()
    }

    if (elapsedSec < cfg.entryTimeSec) return []
    if (elapsedSec >= EPISODE_LENGTH_SEC) {
      done = true
      return []
    }

    // Wait (without consuming the one shot) until both legs are two-sided:
    // the measured donor cell conditions on two-sided books.
    if (!bothUsable || !validBook(up) || !validBook(down)) return []

    // Decide once, at the first eligible two-sided endgame tick.
    done = true

    const favAssetId = up.mid >= down.mid ? upAssetId : downAssetId
    const fav = up.mid >= down.mid ? up : down
    const favLeg: 'up' | 'down' = favAssetId === upAssetId ? 'up' : 'down'

    // Certainty gate: bid-based, matching the measured bid-band conditioning.
    if (fav.bestBid < cfg.certaintyThreshold) return []

    // Path stability qualifier (pre-placement — no race against fills):
    // every observed tick in the window must have the SAME favorite leg,
    // and optionally the favorite bid range must stay within bounds.
    if (windowMs > 0) {
      if (history.some((s) => s.favLeg !== favLeg)) return []
      if (cfg.maxFavBidRange < 1 && history.length > 0) {
        let lo = Infinity
        let hi = -Infinity
        for (const s of history) {
          if (s.favBid < lo) lo = s.favBid
          if (s.favBid > hi) hi = s.favBid
        }
        if (hi - lo > cfg.maxFavBidRange) return []
      }
    }

    const bidPrice = safeProbabilityPrice(round3(cfg.bidPrice))
    if (bidPrice < 0.01 || bidPrice > 0.99) return []

    // Maker-only guard: a GTC at or above the ask would cross and pay the
    // taker fee — the measured wrong-signed K-002 path. Skip the episode.
    if (fav.bestAsk <= bidPrice) return []

    const side = favLeg
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${side}`,
        assetId: favAssetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: `endgame ${side} elapsed=${elapsedSec.toFixed(1)}s favBid=${fav.bestBid.toFixed(3)} favAsk=${fav.bestAsk.toFixed(3)} bid=${bidPrice.toFixed(3)} pathN=${history.length}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
