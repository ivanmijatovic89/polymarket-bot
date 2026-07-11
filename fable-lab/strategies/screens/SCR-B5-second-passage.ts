/**
 * SCR-B5 second-passage template (`fable-scr-2pass`, BATCH-005 FINAL RUN).
 *
 * Covers SCR-029: SCR-001 measured the FIRST passage of a conviction
 * barrier (killed: the book has already moved). The Nth passage is a
 * different path shape — the price reached the barrier, was rejected,
 * and came back. Multi-crossing counts are not expressible in the CAL
 * fixed-offset scans and were never conditioned on. The mechanism bet:
 * a barrier that survives a rejection and is re-attained carries more
 * information than the first touch (failed reversals exhaust the
 * contrarian side).
 *
 * Behavior: count upward crossings of B by the UP mid (re-armed only
 * after falling back below B − rearmDelta), and mirror crossings of
 * 1 − B from above for the DOWN side. On the passageIndex-th crossing
 * on either side, FOK-buy that side; hold to settlement.
 *
 * Replay-safe: deterministic; time from tick.snapshot.timestamp; E6
 * guard; depth-clamped; one entry per market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Barrier on UP implied probability (> 0.5); mirror 1 − B implied. */
  barrier: z.coerce.number().finite().gt(0.5).lt(1).default(0.8),
  /** Enter on this crossing count (2 = second passage). */
  passageIndex: z.coerce.number().int().min(2).max(10).default(2),
  /** Re-arm hysteresis: must fall back below B − this to count a new crossing. */
  rearmDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(60),
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(870),
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-2pass',
  title: 'SCR-B5 second-passage barrier (re-attained conviction level)',
  description: 'FOK-buy the crossing side on the Nth passage of a conviction barrier; hold to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    // Per-side crossing state: armed = currently below the barrier zone.
    let upCrossings = 0
    let upArmed = false
    let dnCrossings = 0
    let dnArmed = false

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
        upCrossings = 0
        upArmed = false
        dnCrossings = 0
        dnArmed = false
      }
      if (entered) return []
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = tick.snapshot.timestamp - Number(epochMatch[1]) * 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (upBid == null || upAsk == null || upBid >= upAsk) return [] // E6 guard
      const upMid = (upBid + upAsk) / 2
      const dnMid = 1 - upMid
      const lower = 1 - cfg.barrier

      // Crossing bookkeeping runs the whole episode (crossings before the
      // entry window still count — the INDEX is what matters).
      let trigger: 'UP' | 'DOWN' | null = null
      if (upMid < cfg.barrier - cfg.rearmDelta) upArmed = true
      else if (upArmed && upMid >= cfg.barrier) {
        upArmed = false
        upCrossings += 1
        if (upCrossings === cfg.passageIndex) trigger = 'UP'
      }
      if (dnMid < cfg.barrier - cfg.rearmDelta) dnArmed = true
      else if (dnArmed && dnMid >= cfg.barrier) {
        dnArmed = false
        dnCrossings += 1
        if (dnCrossings === cfg.passageIndex) trigger = 'DOWN'
      }
      void lower
      if (trigger === null) return []
      if (elapsedMs < cfg.minElapsedSec * 1000 || elapsedMs > cfg.maxElapsedSec * 1000) return []

      const down = tick.snapshot.byAssetId[downAssetId]
      const book = trigger === 'UP' ? up : down
      const assetId = trigger === 'UP' ? upAssetId : downAssetId
      const ask = book?.bestAsk
      if (book == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (book.bestBid != null && book.bestBid >= ask) return [] // E6 guard

      let depth = 0
      for (const lvl of book.asks) {
        if (lvl.price > ask) break
        depth += lvl.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []

      entered = true
      return [
        {
          kind: 'place_limit',
          clientOrderId: `scr2p:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: { exp: 'SCR-B5-2pass', side: trigger, crossings: cfg.passageIndex, entryAsk: ask },
          reason: 'second-passage entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-2pass',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
