import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { isWarmed, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

/**
 * momentum-hold baseline.
 *
 * Driver: follow intra-episode price momentum with a TAKER entry, then HOLD to
 * resolution so only a single taker fee is paid (redemption is fee-free).
 *
 * Once per episode, on the first tick where the elapsed episode time is at least
 * `startSec`, a leg's mid has risen by at least `minMomentum` over the last
 * `lookbackSec`, and that leg's `bestAsk` is at most `maxEntryPrice`, cross the
 * spread with one FOK BUY of `size` shares (limit = bestAsk + `slippageTol`) and
 * hold whatever fills to resolution. Nothing else is placed, cancelled, or sold.
 */
export const ConfigSchema = z.strictObject({
  lookbackSec: z.coerce.number().finite().positive().default(60),
  minMomentum: z.coerce.number().finite().positive().max(0.5).default(0.03),
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
  id: 'momentum-hold.000-baseline',
  title: 'Momentum hold baseline',
  description:
    'Takes the leg whose mid has risen by at least minMomentum over lookbackSec with one FOK buy, then holds to resolution (single taker fee).',
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

type Sample = { ts: number; up: number; down: number }

export function createStrategy(cfg: Config): { strategy: Strategy } {
  const name = 'momentum-hold.000-baseline'

  let lastMarketKey: string | null = null
  let t0: number | null = null
  let entered = false
  let samples: Sample[] = []

  const resetEpisode = () => {
    t0 = null
    entered = false
    samples = []
  }

  /** Newest sample at or before `cutoffTs`, or null if none is old enough yet. */
  const sampleAtOrBefore = (cutoffTs: number): Sample | null => {
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      const s = samples[i]
      if (s && s.ts <= cutoffTs) return s
    }
    return null
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

    // Maintain a bounded per-episode history of both legs' mids.
    samples.push({ ts: now, up: up.mid, down: down.mid })
    const keepFromTs = now - cfg.lookbackSec * 1000 - 5000
    if (samples.length > 1 && samples[0] && samples[0].ts < keepFromTs) {
      samples = samples.filter((s) => s.ts >= keepFromTs)
    }

    if (entered) return []

    const elapsedSec = (now - t0) / 1000
    if (elapsedSec < cfg.startSec) return []

    const past = sampleAtOrBefore(now - cfg.lookbackSec * 1000)
    if (!past) return []

    const momUp = up.mid - past.up
    const momDown = down.mid - past.down

    let side: 'up' | 'down' | null = null
    if (momUp >= cfg.minMomentum && momUp >= momDown) side = 'up'
    else if (momDown >= cfg.minMomentum) side = 'down'
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
        reason: `momentum ${side} mom=${(side === 'up' ? momUp : momDown).toFixed(
          4,
        )} ask=${book.bestAsk.toFixed(2)} limit=${limit.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
