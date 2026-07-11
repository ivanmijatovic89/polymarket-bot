/**
 * SCR-007 — filled-maker instant lock (`screens`, BATCH-002).
 *
 * Mechanism: rest GTC bids a small delta below fair on both sides. When a
 * maker fill arrives at price p (a sweep through the level), IMMEDIATELY
 * FOK-buy the OTHER side at its current ask a. The pair settles at
 * exactly $1 regardless of outcome, so PnL per locked pair =
 * 1 − p − a − takerFee(hedge leg). Prediction: at the instant of a sweep
 * the opposite ask has not yet adjusted upward — transient two-sided
 * dislocation exists conditional on our fill, making E[1 − p − a − fee]
 * > 0. If instead books re-price atomically, p + a ≈ 1 and the screen
 * dies on hedge costs.
 *
 * Escape argument vs dead classes: EXP-002/E9 measured STANDING ask-sum
 * dutch books at top-of-book (none exist net of fees, uncrossed states).
 * This measures FILL-CONDITIONAL, transient dislocation — a state
 * EXP-002 never sampled (it had no position, so no fill to condition
 * on). Unlike every prior maker screen (EXP-006/007, E19, SCR-004*),
 * the maker fill's information content is IRRELEVANT if the lock
 * completes — the pair is outcome-neutral; the bet is on hedge-leg
 * latency in the book, not on direction. Unhedged residue (FOK misses)
 * stays directional and is expected to lose per E16 — disclosed; the
 * screen's EV includes it.
 *
 * Replay-safety: deterministic; E6 crossed guard; hedge uses the
 * lastMarket snapshot the engine passes to onAccountEvent (same-tick
 * book state; latency pinned 0/0 per D8). Hold everything to
 * settlement (no merges — settlement pays the pair $1; merge would only
 * change timing, and MINED-gating is a live-only concern per
 * CAPABILITIES).
 */
import * as z from 'zod'
import type {
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Resting distance below the side's mid-implied fair. */
  delta: z.coerce.number().finite().gt(0).lt(0.2).default(0.02),
  /** Active quoting window (episode seconds). */
  startSec: z.coerce.number().finite().nonnegative().max(899).default(30),
  endSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Requote when the target price moved by at least this much. */
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  /** Quote price bounds. */
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** Per-side inventory cap (shares). */
  maxInventory: z.coerce.number().finite().positive().max(1500).default(300),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
  /** Max hedge ask: never chase a hedge above this. */
  maxHedgeAsk: z.coerce.number().finite().gt(0).lt(1).default(0.98),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-007',
  title: 'SCR-007 filled-maker instant lock',
  description: 'Rest bids below fair both sides; on a maker fill, FOK the other side immediately — pair settles at $1.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    const quotes = new Map<Side, Quote>()
    let assetToSide = new Map<string, Side>()

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
        assetToSide = new Map([
          [upAssetId, 'UP'],
          [downAssetId, 'DOWN'],
        ])
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
        const price = Math.round((fair - cfg.delta) * 100) / 100
        if (price < cfg.minPrice || price > cfg.maxPrice) {
          cancelSide(side, 'no valid quote price')
          continue
        }
        const q = quotes.get(side)
        if (q && Math.abs(q.price - price) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        const clientOrderId = `scr007m:${slug}:${side}:${seq++}`
        quotes.set(side, { clientOrderId, price })
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size: cfg.shares,
          orderType: 'GTC',
          meta: { exp: 'SCR-007', leg: 'maker', side, price, upMid, elapsedSec: Math.floor(elapsedSec) },
          reason: 'lock maker leg',
        })
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-007',
      onMarketTick,
      onAccountEvent: (ev, _portfolio, lastMarket) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        // Only hedge our resting maker legs (hedge fills come back through
        // here too — their clientOrderId prefix differs, so no recursion).
        if (!fill.clientOrderId?.startsWith('scr007m:')) return []
        const filledSide = assetToSide.get(fill.assetId)
        if (!filledSide || !lastMarket) return []
        const otherAssetId = [...assetToSide.entries()].find(([, s]) => s !== filledSide)?.[0]
        if (!otherAssetId) return []
        const other = lastMarket.byAssetId[otherAssetId]
        const ask = other?.bestAsk
        if (other == null || ask == null) return []
        if (other.bestBid != null && other.bestBid >= ask) return [] // E6 guard
        if (ask > cfg.maxHedgeAsk) return []
        let depth = 0
        for (const lvl of other.asks) {
          if (lvl.price > ask) break
          depth += lvl.size
        }
        const size = Math.min(fill.size, depth)
        if (size <= 0) return []
        return [
          {
            kind: 'place_limit',
            clientOrderId: `scr007h:${stateSlug}:${seq++}`,
            assetId: otherAssetId,
            side: 'BUY',
            price: ask,
            size,
            orderType: 'FOK',
            meta: {
              exp: 'SCR-007',
              leg: 'hedge',
              makerPrice: fill.price,
              hedgeAsk: ask,
              pairSum: fill.price + ask,
            },
            reason: 'lock hedge leg',
          },
        ]
      },
    }
    return { strategy }
  },
}
