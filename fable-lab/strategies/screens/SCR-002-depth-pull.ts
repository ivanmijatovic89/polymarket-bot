/**
 * SCR-002 — liquidity-withdrawal momentum (`screens`, BATCH-001).
 *
 * Mechanism: makers pull resting depth ahead of adverse moves faster than
 * top-of-book PRICE adjusts. A collapse of cumulative 5-level ask-side
 * depth on the UP book (relative to its level `lookbackSec` ago) while the
 * mid has not yet moved predicts an up-move (sellers withdrawing); the
 * bid-side mirror predicts a down-move. Buy the side the withdrawal
 * points to, at ask, hold to resolution.
 *
 * Escape argument vs dead classes: E11 tested STATIC resting imbalance at
 * entry (level, not change). E20-E23 scanned states/moves of top-of-book
 * PRICES only — depth dynamics are not expressible in the CAL log at all
 * (SIGNAL-001 adds static depth; this screen tests its first difference,
 * which even SIGNAL-001 does not scan).
 *
 * Replay-safety: deterministic; snapshot-diff based (no event-side
 * decoding); E6 crossed-book guard; one entry per market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Current side-depth must be ≤ ratio × depth lookbackSec ago. */
  ratio: z.coerce.number().finite().gt(0).lt(1).default(0.4),
  /** Comparison horizon in seconds. */
  lookbackSec: z.coerce.number().finite().positive().max(300).default(30),
  /** |mid now − mid lookbackSec ago| must be ≤ this (withdrawal BEFORE the move). */
  maxMidMove: z.coerce.number().finite().nonnegative().lt(1).default(0.02),
  /** Entry window (episode seconds). */
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(120),
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Entry ask bounds. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.1),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.9),
  /** Depth floor: the reference depth must be ≥ this many shares (a 10→3 collapse is noise). */
  minRefDepth: z.coerce.number().finite().positive().default(200),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-002',
  title: 'SCR-002 depth-withdrawal momentum',
  description: 'Buy the side a 5-level depth collapse points to, before the mid moves.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    // Ring of (elapsedSec, bid5, ask5, mid) samples; head pruned lazily.
    let ring: { t: number; bid5: number; ask5: number; mid: number }[] = []
    let ringHead = 0

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
        ring = []
        ringHead = 0
      }
      if (entered) return []

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (up == null || upBid == null || upAsk == null || upBid >= upAsk) return []
      const mid = (upBid + upAsk) / 2
      const bd = up.bidsDepthByLevel
      const ad = up.asksDepthByLevel
      const lvl = (arr: number[], k: number): number =>
        arr.length === 0 ? 0 : arr[Math.min(k, arr.length - 1)]
      const bid5 = lvl(bd, 4)
      const ask5 = lvl(ad, 4)

      ring.push({ t: elapsedSec, bid5, ask5, mid })
      while (ringHead < ring.length && ring[ringHead].t < elapsedSec - cfg.lookbackSec) ringHead++
      const ref = ring[ringHead] // oldest sample within the lookback window
      const windowSpan = elapsedSec - ref.t

      if (elapsedSec < cfg.minElapsedSec || elapsedSec > cfg.maxElapsedSec) return []
      // Need a reference genuinely ~lookbackSec old (75% of the horizon).
      if (windowSpan < cfg.lookbackSec * 0.75) return []
      if (Math.abs(mid - ref.mid) > cfg.maxMidMove) return []

      let dir: 'UP' | 'DOWN' | null = null
      if (ref.ask5 >= cfg.minRefDepth && ask5 <= cfg.ratio * ref.ask5) dir = 'UP'
      else if (ref.bid5 >= cfg.minRefDepth && bid5 <= cfg.ratio * ref.bid5) dir = 'DOWN'
      if (dir === null) return []

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
          clientOrderId: `scr002:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'SCR-002',
            side: dir,
            entryAsk: ask,
            refAsk5: ref.ask5,
            refBid5: ref.bid5,
            ask5,
            bid5,
            elapsedSec: Math.floor(elapsedSec),
          },
          reason: 'depth-withdrawal momentum entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-002',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
