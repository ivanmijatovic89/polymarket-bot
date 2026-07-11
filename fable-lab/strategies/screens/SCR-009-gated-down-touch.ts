/**
 * SCR-009 — SIGNAL-003-gated DOWN-side at-touch bid (`screens`, BATCH-004).
 * Local touch-mode runs only; D18 rules bind (kill/escalate, never
 * advance).
 *
 * Mechanism: the SCR-008 run-472 cell (ungated DOWN at-touch, exact same
 * quoting logic) MINUS the one candidate toxic cell found by the
 * SIGNAL-003 per-fill scan (knowledge/SIGNAL-FILLS.md §7): fills at
 * MID prices [0.35, 0.65] taken while the UP-book 10-level depth
 * imbalance l10Imb is in its discovery top quintile (≥ 0.6400) averaged
 * −5.54c residual (z=−4.30, n=1,435 of 8,130). The gate is the
 * MECHANICAL complement per SIGNAL-FILLS amendment 1b: suppress the
 * quote exactly when (quote price ∈ [0.35, 0.65]) AND (latest valid
 * l10Imb ≥ 0.6400). Nothing else differs from SCR-008.
 *
 * l10Imb is computed identically to the diag-fill fixture: cumulative
 * UP-book bid depth at level 10 / (bid + ask cumulative depth at level
 * 10), from bidsDepthByLevel/asksDepthByLevel, 0.5 when empty; the gate
 * uses the value from the last VALID up-book tick (same staleness
 * semantics as the scan's lastState block). If no valid up-book state
 * has been seen yet, the gate does not fire (the scan dropped such
 * fills; structurally near-empty under the mirror invariant).
 *
 * Crossed-book guard per E6. Inventory-capped. Fills held to settlement.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  startSec: z.coerce.number().finite().nonnegative().max(899).default(30),
  endSec: z.coerce.number().finite().positive().max(899).default(870),
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  maxInventory: z.coerce.number().finite().positive().max(1500).default(100),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
  /** SIGNAL-003 gate: MID stratum bounds and the frozen l10Imb q5 boundary. */
  gateMidLo: z.coerce.number().finite().gt(0).lt(1).default(0.35),
  gateMidHi: z.coerce.number().finite().gt(0).lt(1).default(0.65),
  gateImbMin: z.coerce.number().finite().gt(0).lt(1).default(0.64),
})
export type Config = z.infer<typeof ConfigSchema>

type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-009',
  title: 'SCR-009 SIGNAL-003-gated DOWN-side at-touch bid',
  description:
    'SCR-008 run-472 cell with the SIGNAL-003 candidate cell excluded (MID price × l10Imb top quintile). Local touch-mode only (D18).',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let quote: Quote | null = null
    let lastL10Imb = NaN

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
        quote = null
        lastL10Imb = NaN
      }
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk

      // Gate feature update — identical semantics to diag-fill.ts lastState:
      // only ticks with a valid (uncrossed) UP book and a present DOWN book
      // refresh l10Imb; otherwise the last valid value persists.
      const upValid = upBid != null && upAsk != null && upBid < upAsk
      if (upValid && elapsedSec < 900 && down?.bestBid != null && down?.bestAsk != null) {
        const bd = up.bidsDepthByLevel
        const ad = up.asksDepthByLevel
        const lvl = (arr: number[], k: number): number =>
          arr.length === 0 ? 0 : arr[Math.min(k, arr.length - 1)]
        const b10 = lvl(bd, 9)
        const a10 = lvl(ad, 9)
        lastL10Imb = b10 + a10 > 0 ? b10 / (b10 + a10) : 0.5
      }

      const intents: Intent[] = []
      const cancelQuote = (reason: string): void => {
        if (!quote) return
        intents.push({ kind: 'cancel_order', clientOrderId: quote.clientOrderId, reason })
        quote = null
      }

      const upCrossed = upBid != null && upAsk != null && upBid >= upAsk
      const dnBid = down?.bestBid
      const dnAsk = down?.bestAsk
      if (down == null || dnBid == null || dnAsk == null || dnBid >= dnAsk || upCrossed) {
        cancelQuote('book unavailable/crossed')
        return intents
      }
      if (elapsedSec < cfg.startSec || elapsedSec > cfg.endSec) {
        cancelQuote('outside window')
        return intents
      }
      const inv = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
      if (inv >= cfg.maxInventory) {
        cancelQuote('inventory cap')
        return intents
      }
      const price = dnBid // join the touch
      if (price >= dnAsk || price < cfg.minPrice || price > cfg.maxPrice) {
        cancelQuote('no valid quote price')
        return intents
      }
      // SIGNAL-003 mechanical complement gate (SIGNAL-FILLS §7 / amendment 1b).
      if (
        price >= cfg.gateMidLo &&
        price <= cfg.gateMidHi &&
        !Number.isNaN(lastL10Imb) &&
        lastL10Imb >= cfg.gateImbMin
      ) {
        cancelQuote('SIGNAL-003 gate: MID price + l10Imb top quintile')
        return intents
      }
      if (quote && Math.abs(quote.price - price) < cfg.requoteDelta) return intents
      if (quote) cancelQuote('requote')
      const clientOrderId = `scr009:${slug}:${seq++}`
      quote = { clientOrderId, price }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: downAssetId,
        side: 'BUY',
        price,
        size: cfg.shares,
        orderType: 'GTC',
        meta: { exp: 'SCR-009', price, elapsedSec: Math.floor(elapsedSec) },
        reason: 'gated DOWN at-touch bid',
      })
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-009',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
