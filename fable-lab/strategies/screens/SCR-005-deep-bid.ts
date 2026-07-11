/**
 * SCR-005 — deep resting bid / overshoot catcher (`screens`, BATCH-002).
 *
 * Mechanism: rest GTC bids far BELOW fair (depth ≈ 10c) on both sides and
 * hold fills to settlement. Under worst-queue a fill means the market
 * swept through the level — E16/E17 measured that NEAR-fair punch-through
 * (1-3c offsets) is informed. This screen tests the other end of the
 * distance continuum: a sweep that travels ≥ depth past pre-move fair in
 * one 15m binary window may be a liquidity vacuum (overshoot) rather than
 * information, and the deep fill price would more than compensate.
 *
 * Escape argument vs dead classes: EXP-006/007 quoted 1-3c from fair
 * (regime-gated); E19 bracketed the SAME cells at touch. No experiment
 * has measured maker economics at 5-15c distances. The taker analogue
 * (buy after a big move) is dead (E10/E21/E22) — but the maker version
 * enters AT the swept price with zero fee, not at the adjusted ask after.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp; E6
 * crossed-book guard; hold to settlement (no sells/merges).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Resting distance below the side's mid-implied fair. */
  depth: z.coerce.number().finite().gt(0.03).lt(0.5).default(0.1),
  /** Active quoting window (episode seconds). */
  startSec: z.coerce.number().finite().nonnegative().max(899).default(60),
  endSec: z.coerce.number().finite().positive().max(899).default(750),
  /** Requote when the target price moved by at least this much. */
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  /** Quote price bounds. */
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** Per-side inventory cap (shares). */
  maxInventory: z.coerce.number().finite().positive().max(1500).default(100),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-005',
  title: 'SCR-005 deep resting bid (overshoot catcher)',
  description: 'GTC bids ~10c below fair on both sides; fills only on sweeps through; hold to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    const quotes = new Map<Side, Quote>()

    const onMarketTick = (
      tick: MarketTick,
      portfolio: PortfolioSnapshot,
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
        seq = 0
        quotes.clear()
      }
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const intents: Intent[] = []
      const cancelSide = (side: Side, reason: string): void => {
        const q = quotes.get(side)
        if (!q) return
        intents.push({ kind: 'cancel_order', clientOrderId: q.clientOrderId, reason })
        quotes.delete(side)
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (up == null || down == null || upBid == null || upAsk == null || upBid >= upAsk) {
        cancelSide('UP', 'book unavailable/crossed')
        cancelSide('DOWN', 'book unavailable/crossed')
        return intents
      }
      const dnCrossed = down.bestBid != null && down.bestAsk != null && down.bestBid >= down.bestAsk
      if (dnCrossed) {
        cancelSide('UP', 'crossed')
        cancelSide('DOWN', 'crossed')
        return intents
      }
      const upMid = (upBid + upAsk) / 2
      const inWindow = elapsedSec >= cfg.startSec && elapsedSec <= cfg.endSec

      for (const side of ['UP', 'DOWN'] as Side[]) {
        const assetId = side === 'UP' ? upAssetId : downAssetId
        if (!inWindow) {
          cancelSide(side, 'gate closed')
          continue
        }
        const inv = portfolio.positionsByAssetId[assetId]?.qty ?? 0
        if (inv >= cfg.maxInventory) {
          cancelSide(side, 'inventory cap')
          continue
        }
        const fair = side === 'UP' ? upMid : 1 - upMid
        const price = Math.round((fair - cfg.depth) * 100) / 100
        if (price < cfg.minPrice || price > cfg.maxPrice) {
          cancelSide(side, 'no valid quote price')
          continue
        }
        const q = quotes.get(side)
        if (q && Math.abs(q.price - price) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        const clientOrderId = `scr005:${slug}:${side}:${seq++}`
        quotes.set(side, { clientOrderId, price })
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size: cfg.shares,
          orderType: 'GTC',
          meta: {
            exp: 'SCR-005',
            side,
            price,
            fair,
            upMid,
            elapsedSec: Math.floor(elapsedSec),
          },
          reason: `deep bid ${cfg.depth} below fair`,
        })
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-005',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
