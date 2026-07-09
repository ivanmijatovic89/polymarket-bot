/**
 * EXP-004 — depth-imbalance drift (`flow-momentum`).
 *
 * Mechanism: one-sided resting-depth pressure predicts the sign of the
 * short-horizon implied-probability move — the book tips before the price
 * moves. If the pressure is informative about the window outcome, buying
 * the pressured direction wins more often than its ask implies.
 *
 * Behavior: each tick, compute UP-book depth imbalance over the top
 * `levels` price levels: imb = (Σbid − Σask) / (Σbid + Σask) ∈ [−1, 1].
 * When |imb| has stayed ≥ `minImb` with a constant sign for at least
 * `persistSec` seconds (every tick in the window agrees), FOK-buy the
 * pressured direction (UP if imb > 0, DOWN if imb < 0) at its bestAsk,
 * bounded to [minAsk, maxAsk] (keeps this mechanism away from the
 * tail-overpricing zone), sized to visible depth (capped at `shares`).
 * One entry per market; hold to resolution. Taker-only, no exits.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp only;
 * deterministic clientOrderId; pure function of tick history in-closure.
 * Crossed-book guard per LESSONS E6.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Book levels per side included in the imbalance sum. */
  levels: z.coerce.number().int().min(1).max(50).default(10),
  /** Minimum |imbalance| that counts as pressure. */
  minImb: z.coerce.number().finite().gt(0).lt(1).default(0.6),
  /** Seconds the signed pressure must persist (every tick in the window). */
  persistSec: z.coerce.number().finite().positive().max(120).default(5),
  /** Entry ask bounds — keeps this mechanism away from the >=0.9 tail zone. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.15),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.85),
  /** Episode-elapsed entry window (seconds). */
  minElapsedSec: z.coerce.number().finite().min(0).max(899).default(60),
  maxElapsedSec: z.coerce.number().finite().min(0).max(899).default(840),
  /** Max shares (clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

const WINDOW_MS = 900_000

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-004',
  title: 'EXP-004 depth-imbalance drift',
  description: 'Taker-buy the direction of persistent top-of-book depth imbalance; hold to resolution.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let imbHistory: Array<{ ts: number; imb: number }> = []

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
        imbHistory = []
      }
      if (entered) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      if (up == null) return []

      let bidDepth = 0
      let askDepth = 0
      for (const lvl of up.bids.slice(0, cfg.levels)) bidDepth += lvl.size
      for (const lvl of up.asks.slice(0, cfg.levels)) askDepth += lvl.size
      const total = bidDepth + askDepth
      if (total <= 0) return []
      const imb = (bidDepth - askDepth) / total

      const ts = tick.snapshot.timestamp
      imbHistory.push({ ts, imb })
      const cutoff = ts - cfg.persistSec * 1000
      while (imbHistory.length > 0 && imbHistory[0].ts < cutoff) imbHistory.shift()

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = ts - Number(epochMatch[1]) * 1000
      if (elapsedMs < cfg.minElapsedSec * 1000 || elapsedMs > cfg.maxElapsedSec * 1000) return []
      if (elapsedMs >= WINDOW_MS) return []

      // Persistence: the window must span persistSec and every tick must
      // agree on a sign with |imb| >= minImb.
      if (imbHistory.length < 2) return []
      if (imbHistory[0].ts > cutoff + 1000) return [] // window not yet full
      let dir: 'UP' | 'DOWN' | null = null
      if (imbHistory.every((h) => h.imb >= cfg.minImb)) dir = 'UP'
      else if (imbHistory.every((h) => h.imb <= -cfg.minImb)) dir = 'DOWN'
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
          clientOrderId: `exp004:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'EXP-004',
            side: dir,
            entryAsk: ask,
            imb,
            windowTicks: imbHistory.length,
            elapsedSec: Math.floor(elapsedMs / 1000),
            depthAtAsk: depth,
          },
          reason: 'depth-imbalance drift entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-exp-004',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
