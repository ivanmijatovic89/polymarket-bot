/**
 * SCR-001 — first-passage barrier entry (`screens`, BATCH-001).
 *
 * Mechanism: the first time implied probability crosses a barrier B is an
 * EVENT, not a state — fixed-time scans (CAL-001/E20) sample whoever
 * happens to sit near B at frozen offsets, first-passage conditions on the
 * path having just arrived there. mode=continue bets barrier momentum
 * (books under-adjust on first arrival at conviction levels); mode=fade
 * bets overshoot (first arrival at extreme levels overshoots).
 *
 * Behavior: after minElapsedSec, on the first tick where UP mid crosses B
 * from below (or symmetrically crosses 1−B from above — the DOWN-side
 * mirror event), FOK-buy: continue → the side that just got likelier
 * (ask near B); fade → the other side (ask near 1−B). One entry per
 * market; hold to resolution. Taker-only.
 *
 * Escape argument vs dead classes: E20 scanned state-at-fixed-time;
 * E21/E22 scanned fixed-segment moves between frozen offsets. First
 * passage is neither (event-time conditioning; the CAL log cannot even
 * express it). E12 faded first-minute deviations; this triggers any time
 * after minElapsedSec on level crossings, not deviation size.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp; E6
 * crossed-book guard; late-start guard: the pre-trigger side of the
 * barrier must have been OBSERVED (crossing needs a prior tick below B).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Barrier on UP implied probability, > 0.5; the 1−B mirror is implied. */
  barrier: z.coerce.number().finite().gt(0.5).lt(1).default(0.8),
  /** continue = buy the side that crossed toward certainty; fade = other side. */
  mode: z.enum(['continue', 'fade']).default('continue'),
  /** Ignore crossings before this episode time (opening noise). */
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(120),
  /** Latest entry time (leave runway to resolution). */
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Sanity bounds on the entry ask. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-001',
  title: 'SCR-001 first-passage barrier',
  description: 'FOK entry on first crossing of an implied-probability barrier; continue or fade.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let seenBelowUpper = false // observed upMid < barrier (arms the UP-crossing)
    let seenAboveLower = false // observed upMid > 1−barrier (arms the DOWN-crossing)

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
        seenBelowUpper = false
        seenAboveLower = false
      }
      if (entered) return []

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = tick.snapshot.timestamp - Number(epochMatch[1]) * 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (upBid == null || upAsk == null || upBid >= upAsk) return [] // E6 guard
      const upMid = (upBid + upAsk) / 2

      const lower = 1 - cfg.barrier
      // Arm/disarm BEFORE the entry window so a market that opens above the
      // barrier never counts as a "crossing" when the window starts.
      const wasBelowUpper = seenBelowUpper
      const wasAboveLower = seenAboveLower
      if (upMid < cfg.barrier) seenBelowUpper = true
      if (upMid > lower) seenAboveLower = true

      if (elapsedMs < cfg.minElapsedSec * 1000) return []
      if (elapsedMs > cfg.maxElapsedSec * 1000) return []

      // First passage: crossed up through B (UP got likely) or down through
      // 1−B (DOWN got likely).
      let crossedSide: 'UP' | 'DOWN' | null = null
      if (wasBelowUpper && upMid >= cfg.barrier) crossedSide = 'UP'
      else if (wasAboveLower && upMid <= lower) crossedSide = 'DOWN'
      if (crossedSide === null) return []

      const dir: 'UP' | 'DOWN' =
        cfg.mode === 'continue' ? crossedSide : crossedSide === 'UP' ? 'DOWN' : 'UP'
      const book = dir === 'UP' ? up : down
      const assetId = dir === 'UP' ? upAssetId : downAssetId
      const ask = book?.bestAsk
      if (book == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (book.bestBid != null && book.bestBid >= ask) return []

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
          clientOrderId: `scr001:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'SCR-001',
            mode: cfg.mode,
            crossedSide,
            side: dir,
            entryAsk: ask,
            upMid,
            elapsedSec: Math.floor(elapsedMs / 1000),
          },
          reason: 'first-passage barrier entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-001',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
