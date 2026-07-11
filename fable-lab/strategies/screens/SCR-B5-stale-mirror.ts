/**
 * SCR-B5 staleness-mirror template (`fable-scr-stm`, BATCH-005 FINAL RUN).
 *
 * Covers SCR-024/SCR-025: the tradable mirrors of the two measured
 * buyer-adverse staleness structures — E21 (single-segment late big
 * down-move: post-move UP asks stale-high ≈1.5-2.4c gross → buy DOWN)
 * and E22 (up-then-down reversal: ≈4.4c gross → buy DOWN). Fixed
 * offsets per the CAL convention (first book state at-or-after the
 * offset), taker entry at the trigger offset, hold to settlement.
 *
 * IN-SAMPLE DISCLOSURE (binding, stated in the batch file too): both
 * signals were FOUND on the discovery window these screens re-sample.
 * A positive readout is winner's-curse-inflated and confirms nothing
 * (CONFIRM-010 remains the only pre-registered confirmation path);
 * a kill is decisive against the tradable version at screen grade.
 *
 * Replay-safe: deterministic; time from tick.snapshot.timestamp;
 * E6 guard; depth-clamped FOK; one entry per market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Offsets (episode seconds): t0 < t1 < t2; 'dn' uses t1/t2 only. */
  t0Sec: z.coerce.number().finite().nonnegative().max(880).default(450),
  t1Sec: z.coerce.number().finite().positive().max(880).default(600),
  t2Sec: z.coerce.number().finite().positive().max(895).default(750),
  /** dn: mid(t2)−mid(t1) ≤ −segThresh2 → buy DOWN.
   *  updn: additionally mid(t1)−mid(t0) ≥ +segThresh1. */
  shape: z.enum(['dn', 'updn']).default('dn'),
  segThresh1: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  segThresh2: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-stm',
  title: 'SCR-B5 staleness-mirror template (E21/E22 shapes)',
  description:
    'Buy DOWN taker at t2 after a big down segment (dn) or an up-then-down reversal (updn), fixed CAL offsets; hold to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let mid0: number | null = null
    let mid1: number | null = null

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
        mid0 = null
        mid1 = null
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

      // First book state at-or-after each offset (CAL convention). A late
      // first tick past an offset records that offset from the same tick —
      // a market whose feed starts after t0/t1 simply never arms.
      if (mid0 == null && elapsedMs >= cfg.t0Sec * 1000 && elapsedMs < cfg.t1Sec * 1000) mid0 = upMid
      if (mid1 == null && elapsedMs >= cfg.t1Sec * 1000 && elapsedMs < cfg.t2Sec * 1000) mid1 = upMid
      if (elapsedMs < cfg.t2Sec * 1000) return []
      // At/after t2: evaluate once on the first such tick.
      entered = true
      if (mid1 == null) return []
      const seg2 = upMid - mid1
      if (seg2 > -cfg.segThresh2) return []
      if (cfg.shape === 'updn') {
        if (mid0 == null) return []
        const seg1 = mid1 - mid0
        if (seg1 < cfg.segThresh1) return []
      }

      const down = tick.snapshot.byAssetId[downAssetId]
      const ask = down?.bestAsk
      const bid = down?.bestBid
      if (down == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (bid != null && bid >= ask) return [] // E6 guard

      let depth = 0
      for (const lvl of down.asks) {
        if (lvl.price > ask) break
        depth += lvl.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []

      return [
        {
          kind: 'place_limit',
          clientOrderId: `scrstm:${slug}:entry`,
          assetId: downAssetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: { exp: 'SCR-B5-stm', shape: cfg.shape, seg2, entryAsk: ask },
          reason: 'staleness mirror entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-stm',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
