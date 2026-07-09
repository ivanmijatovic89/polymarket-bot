import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { isWarmed, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import * as z from 'zod'

/**
 * imbalance-hold 002-flow-trigger (branched from 000-baseline.ts).
 *
 * Same execution as the baseline — one FOK taker buy, hold to resolution
 * (single taker fee) — but the trigger is the CHANGE in the depth-imbalance
 * differential, not its level. The family has measured both levels dead:
 * the instantaneous read is a regime artifact (gross -0.10/mkt at 3000) and
 * the persistent read selects fairly-priced longshots. The remaining
 * mechanism is the first derivative: depth being added to one leg's bids /
 * pulled from its asks WITHIN a short window marks the book turning —
 * possibly informed action not yet fully priced.
 *
 * Per tick: sample `imb = ratio_up - ratio_down` (top `imbLevels` levels).
 * `flow` = current imb minus the newest sample at least `flowWindowSec`
 * old (episode-local buffer; no cross-episode state). Once per episode, on
 * the first tick where elapsed >= `startSec`, |flow| >= `minFlow`, and the
 * target leg's `bestAsk` <= `maxEntryPrice`, buy the leg the book is
 * turning toward (flow > 0 = up). FOK limit = bestAsk + `slippageTol`.
 */
export const ConfigSchema = z.strictObject({
  imbLevels: z.coerce.number().int().min(1).max(10).default(1),
  flowWindowSec: z.coerce.number().finite().positive().default(30),
  minFlow: z.coerce.number().finite().positive().max(2).default(0.3),
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
  id: 'imbalance-hold.002-flow-trigger',
  title: 'Imbalance hold flow trigger',
  description:
    'Taker-buys the leg the depth-imbalance differential is turning toward (change >= minFlow within flowWindowSec), then holds to resolution (single taker fee).',
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
  const name = 'imbalance-hold.002-flow-trigger'

  let lastMarketKey: string | null = null
  let t0: number | null = null
  let entered = false
  /** Episode-local (ts, imb) samples, oldest first; pruned to the flow window. */
  let samples: Array<{ ts: number; imb: number }> = []

  const resetEpisode = () => {
    t0 = null
    entered = false
    samples = []
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

    const ratioUp = bidRatio(up, cfg.imbLevels)
    const ratioDown = bidRatio(down, cfg.imbLevels)
    if (ratioUp == null || ratioDown == null) return []

    const imb = ratioUp - ratioDown
    const windowMs = cfg.flowWindowSec * 1000

    // Anchor = the NEWEST sample at least flowWindowSec old. Keep exactly one
    // sample older than the window so the anchor always spans a full window.
    samples.push({ ts: now, imb })
    let anchorIdx = -1
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i]
      if (s && now - s.ts >= windowMs) {
        anchorIdx = i
        break
      }
    }
    if (anchorIdx > 0) samples.splice(0, anchorIdx)

    if (entered) return []

    const elapsedSec = (now - t0) / 1000
    if (elapsedSec < cfg.startSec) return []

    const anchor = samples[0]
    if (!anchor || now - anchor.ts < windowMs) return []

    const flow = imb - anchor.imb

    let side: 'up' | 'down' | null = null
    if (flow >= cfg.minFlow) side = 'up'
    else if (flow <= -cfg.minFlow) side = 'down'
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
        reason: `flow ${side} flow=${flow.toFixed(4)} imb=${imb.toFixed(4)} ask=${book.bestAsk.toFixed(
          2,
        )} limit=${limit.toFixed(2)}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent } }
}
