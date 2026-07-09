/**
 * EXP-003 — post-jump stale ladder (`stale-quote`).
 *
 * Mechanism: after a fast repricing (implied-probability jump), resting
 * orders behind the touch lag for a moment; a taker buying the jump
 * direction still pays a price that reflects pre-jump probability. If the
 * jump is informative, win rate exceeds the post-jump entry ask.
 *
 * Behavior: track UP mid over a rolling window; on the FIRST tick where
 * mid moved by >= jumpSize within <= jumpWindowSec, FOK-buy the jump
 * direction at its bestAsk (crossed-book guard per LESSONS E6; ask bounded
 * to [minAsk, maxAsk] to keep this mechanism separate from tail-overpricing
 * near expiry), sized to visible depth (capped at `shares`). One entry per
 * market; hold to resolution. Taker-only, no exits, no merges.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp only;
 * deterministic clientOrderId; pure function of tick history in-closure.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Minimum UP-mid move (absolute) that counts as a jump. */
  jumpSize: z.coerce.number().finite().gt(0).lt(1).default(0.15),
  /** Window (seconds) within which the move must occur. */
  jumpWindowSec: z.coerce.number().finite().positive().max(120).default(10),
  /** Entry ask bounds — keeps this mechanism away from the >=0.9 tail zone. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.15),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.85),
  /** Episode-elapsed entry window (seconds). */
  minElapsedSec: z.coerce.number().finite().min(0).max(899).default(30),
  maxElapsedSec: z.coerce.number().finite().min(0).max(899).default(840),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

const WINDOW_MS = 900_000

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-003',
  title: 'EXP-003 post-jump stale ladder',
  description: 'Taker-buy the direction of a fast implied-probability jump; hold to resolution.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let midHistory: Array<{ ts: number; mid: number }> = []

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
        midHistory = []
      }
      if (entered) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upMid = up?.mid
      if (upMid == null) return []

      const ts = tick.snapshot.timestamp
      midHistory.push({ ts, mid: upMid })
      const cutoff = ts - cfg.jumpWindowSec * 1000
      while (midHistory.length > 0 && midHistory[0].ts < cutoff) midHistory.shift()

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = ts - Number(epochMatch[1]) * 1000
      if (elapsedMs < cfg.minElapsedSec * 1000 || elapsedMs > cfg.maxElapsedSec * 1000) return []
      if (elapsedMs >= WINDOW_MS) return []

      // Jump = extreme-to-now move within the window.
      let minMid = Infinity
      let maxMid = -Infinity
      for (const h of midHistory) {
        if (h.mid < minMid) minMid = h.mid
        if (h.mid > maxMid) maxMid = h.mid
      }
      const upMove = upMid - minMid
      const downMove = maxMid - upMid
      let dir: 'UP' | 'DOWN' | null = null
      if (upMove >= cfg.jumpSize && upMove >= downMove) dir = 'UP'
      else if (downMove >= cfg.jumpSize) dir = 'DOWN'
      if (!dir) return []

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
          clientOrderId: `exp003:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'EXP-003',
            side: dir,
            entryAsk: ask,
            jump: dir === 'UP' ? upMove : downMove,
            windowTicks: midHistory.length,
            elapsedSec: Math.floor(elapsedMs / 1000),
            depthAtAsk: depth,
          },
          reason: 'post-jump stale-ladder entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-exp-003',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
