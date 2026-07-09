/**
 * EXP-001 — expiry certainty discount (`tail-overpricing`).
 *
 * Mechanism: in the final minutes of a BTC 15m up/down episode, holders of
 * the near-certain winning side sell out below fair value to avoid redeem
 * friction, and late hedgers cross the spread. If real, buying the >= minAsk
 * side once, taker, and holding to resolution is +EV after fees.
 *
 * Behavior: one FOK BUY per market, at bestAsk, sized to the visible depth
 * at that price (FOK kills if not fully fillable), only when episode elapsed
 * time >= entryAfterSec and bestAsk in [minAsk, maxAsk]. Hold to settlement;
 * no exits, no maker orders, no merges.
 *
 * Replay-safety: no randomness; time only from tick.snapshot.timestamp and
 * the slug epoch; deterministic clientOrderId; entry decision is a pure
 * function of the tick snapshot.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Episode elapsed seconds after which entry is allowed (720 = last 3 min). */
  entryAfterSec: z.coerce.number().finite().int().min(0).max(899).default(720),
  /** Entry side's bestAsk lower bound (the "near-certain" threshold). */
  minAsk: z.coerce.number().finite().gt(0.5).lt(1).default(0.9),
  /** Entry side's bestAsk upper bound. */
  maxAsk: z.coerce.number().finite().gt(0.5).lt(1).default(0.99),
  /** Max shares to buy (order is clamped to visible depth at bestAsk). */
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

const WINDOW_MS = 900_000

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-001',
  title: 'EXP-001 expiry certainty discount',
  description: 'Taker-buy the >=minAsk side in the final minutes, hold to resolution.',
  schema: ConfigSchema,
  create: (cfg) => {
    // Per-episode state. Backtest constructs a fresh strategy per market;
    // live spans windows, so key the state by slug and reset on change.
    let enteredSlug: string | null = null

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
      if (enteredSlug === slug) return []

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const windowStartMs = Number(epochMatch[1]) * 1000
      const elapsedMs = tick.snapshot.timestamp - windowStartMs
      if (elapsedMs < cfg.entryAfterSec * 1000 || elapsedMs >= WINDOW_MS) return []

      // Candidate side: bestAsk within [minAsk, maxAsk]. Both sides cannot
      // qualify simultaneously (asks would sum > 1.8); if they somehow do,
      // take the more certain (higher-ask) side.
      let chosen: { assetId: string; side: 'UP' | 'DOWN'; ask: number; depth: number } | null = null
      for (const [assetId, sideName] of [
        [upAssetId, 'UP'],
        [downAssetId, 'DOWN'],
      ] as const) {
        const book = tick.snapshot.byAssetId[assetId]
        const ask = book?.bestAsk
        if (ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) continue
        // FOK fills only what is fillable at <= limit price; clamp to it.
        let depth = 0
        for (const lvl of book.asks) {
          if (lvl.price > ask) break
          depth += lvl.size
        }
        if (depth <= 0) continue
        if (!chosen || ask > chosen.ask) chosen = { assetId, side: sideName, ask, depth }
      }
      if (!chosen) return []

      const size = Math.min(cfg.shares, chosen.depth)
      if (size <= 0) return []

      enteredSlug = slug
      return [
        {
          kind: 'place_limit',
          clientOrderId: `exp001:${slug}:entry`,
          assetId: chosen.assetId,
          side: 'BUY',
          price: chosen.ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'EXP-001',
            side: chosen.side,
            entryAsk: chosen.ask,
            depthAtAsk: chosen.depth,
            elapsedSec: Math.floor(elapsedMs / 1000),
          },
          reason: 'expiry-certainty-discount entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-exp-001',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
