import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { isWarmed, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

/**
 * imbalance-hold baseline.
 *
 * Driver: current resting-liquidity distribution decides the side — take the
 * leg whose book shows stronger bid-depth support with a TAKER entry, then
 * HOLD to resolution so only a single taker fee is paid (redemption is
 * fee-free).
 *
 * Per leg, bid-support ratio = cumulative bid depth / (bid + ask depth) over
 * the top `imbLevels` book levels. The differential signal is
 * `ratio_up - ratio_down`. Once per episode, on the first tick where elapsed
 * episode time is at least `startSec`, the differential clears
 * `minImbalance` toward one leg, and that leg's `bestAsk` is at most
 * `maxEntryPrice`, cross the spread with one FOK BUY of `size` shares
 * (limit = bestAsk + `slippageTol`) and hold whatever fills to resolution.
 * Nothing else is placed, cancelled, or sold.
 */
export const ConfigSchema = z.strictObject({
  imbLevels: z.coerce.number().int().min(1).max(10).default(3),
  minImbalance: z.coerce.number().finite().positive().max(1).default(0.2),
  size: z.coerce.number().finite().positive().default(20),
  startSec: z.coerce.number().finite().min(0).default(60),
  maxEntryPrice: z.coerce.number().finite().min(0.01).max(0.99).default(0.8),
  slippageTol: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

type AssetBook = NonNullable<MarketTick['snapshot']['byAssetId'][string]>
type UsableBook = AssetBook & {
  bestBid: number
  bestAsk: number
  mid: number
}

export const definition: StrategyDefinition<Config> = {
  id: 'imbalance-hold.000-baseline',
  title: 'Imbalance hold baseline',
  description:
    'Takes the leg with the stronger top-of-book bid-depth support (ratio differential >= minImbalance) with one FOK buy, then holds to resolution (single taker fee).',
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

/** Cumulative depth at the top `n` levels (arrays are cumulative; index 0 = level 1). */
function depthAtLevels(cumulative: number[], n: number): number | null {
  if (cumulative.length === 0) return null
  const v = cumulative[Math.min(n, cumulative.length) - 1]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** Bid-support ratio in [0, 1] over the top `n` levels, or null when unusable. */
function bidRatio(book: UsableBook, n: number): number | null {
  const bid = depthAtLevels(book.bidsDepthByLevel, n)
  const ask = depthAtLevels(book.asksDepthByLevel, n)
  if (bid == null || ask == null) return null
  const total = bid + ask
  if (total <= 0) return null
  return bid / total
}

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'imbalance-hold.000-baseline'

  let lastMarketKey: string | null = null
  let t0: number | null = null
  let entered = false

  const resetEpisode = () => {
    t0 = null
    entered = false
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

    const up = tick.snapshot.byAssetId[upAssetId]
    const down = tick.snapshot.byAssetId[downAssetId]
    if (!validBook(up) || !validBook(down)) return []

    const now = tick.snapshot.timestamp
    if (!Number.isFinite(now)) return []
    if (t0 == null) t0 = now

    if (entered) return []

    const elapsedSec = (now - t0) / 1000
    if (elapsedSec < cfg.startSec) return []

    const ratioUp = bidRatio(up, cfg.imbLevels)
    const ratioDown = bidRatio(down, cfg.imbLevels)
    if (ratioUp == null || ratioDown == null) return []

    const imb = ratioUp - ratioDown

    let side: 'up' | 'down' | null = null
    if (imb >= cfg.minImbalance) side = 'up'
    else if (imb <= -cfg.minImbalance) side = 'down'
    if (!side) return []

    const book = side === 'up' ? up : down
    const assetId = side === 'up' ? upAssetId : downAssetId
    if (book.bestAsk > cfg.maxEntryPrice) return []

    const limit = safeProbabilityPrice(round2(Math.min(book.bestAsk + cfg.slippageTol, 0.98)))
    if (limit < book.bestAsk) return []

    entered = true
    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketKey ?? 'mkt'}:${side}`,
        assetId,
        side: 'BUY',
        price: limit,
        size: cfg.size,
        orderType: 'FOK',
        reason: `imbalance ${side} imb=${imb.toFixed(4)} ask=${book.bestAsk.toFixed(
          2,
        )} limit=${limit.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
