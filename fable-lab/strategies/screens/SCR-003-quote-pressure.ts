/**
 * SCR-003 — quote-pressure before the move (`screens`, BATCH-001).
 *
 * Mechanism: directional intent shows up as one-sided top-of-book quote
 * REVISIONS (bid stepping up / ask lifting away) before it shows up as a
 * mid move. Count top-of-book revisions over a trailing window: upward
 * revisions (bestBid rose or bestAsk rose) minus downward ones. When the
 * net count clears a threshold while the mid has barely moved, buy the
 * pressured side at ask, hold to resolution.
 *
 * Escape argument vs dead classes: E11 measured RESTING depth (a stock);
 * this measures the revision FLOW (a rate) — E11's lesson ("resting depth
 * is not flow") is the motivation, not the refuted claim. E20-E23 scan
 * price states/moves, not revision counts; SIGNAL-001's rate60 counts
 * total activity without direction.
 *
 * Replay-safety: deterministic snapshot-diff; E6 guard; one entry/market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Net signed revisions over the window required to trigger. */
  minNet: z.coerce.number().finite().positive().default(12),
  /** Trailing window in seconds. */
  windowSec: z.coerce.number().finite().positive().max(300).default(60),
  /** |mid now − mid at window start| must be ≤ this (pressure BEFORE move). */
  maxMidMove: z.coerce.number().finite().nonnegative().lt(1).default(0.02),
  /** Entry window (episode seconds). */
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(120),
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Entry ask bounds. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.1),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.9),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-003',
  title: 'SCR-003 quote-pressure',
  description: 'Buy the side one-sided top-of-book revision flow points to, before the mid moves.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let prevBid = NaN
    let prevAsk = NaN
    // Ring of (elapsedSec, signedRevision, mid); pruned lazily.
    let ring: { t: number; s: number; mid: number }[] = []
    let ringHead = 0
    let net = 0 // running sum of s over the live window

    const onMarketTick = (
      tick: MarketTick,
      _portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      if (!isWarmed(ctx)) return []
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []
      if (stateSlug !== slug) {
        stateSlug = slug
        entered = false
        prevBid = NaN
        prevAsk = NaN
        ring = []
        ringHead = 0
        net = 0
      }
      if (entered) return []

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (upBid == null || upAsk == null || upBid >= upAsk) return [] // E6 guard
      const mid = (upBid + upAsk) / 2

      // Signed revision: +1 per side that moved up, −1 per side that moved
      // down (both sides moving the same way counts ±2).
      let s = 0
      if (!Number.isNaN(prevBid)) {
        if (upBid > prevBid) s++
        else if (upBid < prevBid) s--
        if (upAsk > prevAsk) s++
        else if (upAsk < prevAsk) s--
      }
      prevBid = upBid
      prevAsk = upAsk
      if (s !== 0) {
        ring.push({ t: elapsedSec, s, mid })
        net += s
      }
      while (ringHead < ring.length && ring[ringHead].t < elapsedSec - cfg.windowSec) {
        net -= ring[ringHead].s
        ringHead++
      }

      if (elapsedSec < cfg.minElapsedSec || elapsedSec > cfg.maxElapsedSec) return []
      if (Math.abs(net) < cfg.minNet) return []
      const refMid = ringHead < ring.length ? ring[ringHead].mid : mid
      if (Math.abs(mid - refMid) > cfg.maxMidMove) return []

      const dir: 'UP' | 'DOWN' = net > 0 ? 'UP' : 'DOWN'
      const book = dir === 'UP' ? up : down
      const assetId = dir === 'UP' ? upAssetId : downAssetId
      const ask = book?.bestAsk
      if (book == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (book.bestBid != null && book.bestBid >= ask) return []

      let depth = 0
      for (const l of book.asks) {
        if (l.price > ask) break
        depth += l.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []

      entered = true
      return [
        {
          kind: 'place_limit',
          clientOrderId: `scr003:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'SCR-003',
            side: dir,
            entryAsk: ask,
            net,
            elapsedSec: Math.floor(elapsedSec),
          },
          reason: 'quote-pressure entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-003',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
