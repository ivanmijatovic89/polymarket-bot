/**
 * EXP-005 — first-minute overreaction (`time-structure`).
 *
 * Mechanism: quotes in the first minute of an episode anchor before the
 * book has found the window's baseline; large early deviations of implied
 * probability from 0.5 overshoot. Fading them (buying the cheap side and
 * holding to resolution) wins more often than the cheap side's ask implies.
 *
 * Behavior: within the first `maxElapsedSec` seconds of the episode, on the
 * FIRST tick where |UP mid − 0.5| ≥ minDev, FOK-buy the CHEAP side (DOWN if
 * UP is rich, UP if UP is cheap) at its bestAsk (bounded to
 * [minAsk, maxAsk]), sized to visible depth (capped at `shares`). One entry
 * per market; hold to resolution. Taker-only, no exits.
 *
 * Late-start guard (CAPABILITIES §2): recording can begin mid-window; if
 * the first recorded tick of the market arrives later than
 * maxFirstTickSec into the episode, the market is skipped — "first minute"
 * must mean the episode's first minute, not the recording's.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp only;
 * deterministic clientOrderId; crossed-book guard per LESSONS E6.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Minimum |UP mid − 0.5| that counts as an early deviation. */
  minDev: z.coerce.number().finite().gt(0).lt(0.5).default(0.15),
  /** Entry must happen within this many seconds of episode start. */
  maxElapsedSec: z.coerce.number().finite().positive().max(300).default(60),
  /** First recorded tick must arrive within this many seconds of start. */
  maxFirstTickSec: z.coerce.number().finite().positive().max(300).default(30),
  /** Entry ask bounds for the cheap side. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.05),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.5),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-005',
  title: 'EXP-005 first-minute overreaction',
  description: 'Fade large first-minute deviations from 0.5 by buying the cheap side; hold to resolution.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let firstTickElapsedMs: number | null = null

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
        firstTickElapsedMs = null
      }
      if (entered) return []

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedMs = ts - Number(epochMatch[1]) * 1000

      if (firstTickElapsedMs == null) firstTickElapsedMs = elapsedMs
      // Late-start guard: the recording must actually cover the open.
      if (firstTickElapsedMs > cfg.maxFirstTickSec * 1000) return []
      if (elapsedMs > cfg.maxElapsedSec * 1000) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upMid = up?.mid
      if (upMid == null) return []

      const dev = upMid - 0.5
      if (Math.abs(dev) < cfg.minDev) return []
      // Fade: UP rich → buy DOWN; UP cheap → buy UP.
      const dir: 'UP' | 'DOWN' = dev > 0 ? 'DOWN' : 'UP'

      const book = dir === 'UP' ? up : down
      const assetId = dir === 'UP' ? upAssetId : downAssetId
      const ask = book?.bestAsk
      if (book == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      // Self-crossed book guard (LESSONS E6).
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
          clientOrderId: `exp005:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'EXP-005',
            side: dir,
            entryAsk: ask,
            dev,
            elapsedSec: Math.floor(elapsedMs / 1000),
            firstTickSec: Math.floor(firstTickElapsedMs / 1000),
            depthAtAsk: depth,
          },
          reason: 'first-minute overreaction fade entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-exp-005',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
