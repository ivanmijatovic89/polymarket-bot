/**
 * SCR-008 — ungated DOWN-side at-touch bid (`screens`, BATCH-003).
 * Local touch-mode runs only; D18 rules bind (kill/escalate, never
 * advance).
 *
 * Mechanism: the venue's strongest measured regularity is the pooled G2
 * asymmetry (SIGNAL-001/E25, z=−5.2): UP-side buys lose ~1.16c gross on
 * average across ALL states while DOWN is flat — the UP ask carries a
 * persistent premium. Selling that premium requires inventory; by the
 * mirror identity (CAL-001 am. #12) resting an UP ask at price a is
 * exactly resting a DOWN bid at 1−a, so the mirror-consistent tradable
 * expression is a DOWN-side bid joined at touch, no state gate, whole
 * window. Fills held to settlement.
 *
 * Escape argument vs E19/E24 (required by EDGE-SPACE §4 for any new
 * touch cell): every killed touch cell timed INFORMED flow (regime
 * gates, tails, reversals, opening). This cell times nothing — it
 * harvests an unconditional one-sided pricing skew; the screen tests
 * whether that skew exceeds unconditional touch adverse selection.
 *
 * Crossed-book guard per E6. Inventory-capped.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Active window (whole window by default; late cutoff avoids the last-seconds settlement scramble). */
  startSec: z.coerce.number().finite().nonnegative().max(899).default(30),
  endSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Requote when the joined bid moved by at least this much. */
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  /** Quote price bounds. */
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** DOWN inventory cap (shares). */
  maxInventory: z.coerce.number().finite().positive().max(1500).default(100),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-008',
  title: 'SCR-008 ungated DOWN-side at-touch bid (G2 asymmetry)',
  description:
    'Join the DOWN bid at touch, no state gate, whole window; hold fills to settlement. Local touch-mode only (D18).',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let quote: Quote | null = null

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
      }
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const intents: Intent[] = []
      const cancelQuote = (reason: string): void => {
        if (!quote) return
        intents.push({ kind: 'cancel_order', clientOrderId: quote.clientOrderId, reason })
        quote = null
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upCrossed = up?.bestBid != null && up?.bestAsk != null && up.bestBid >= up.bestAsk
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
      if (quote && Math.abs(quote.price - price) < cfg.requoteDelta) return intents
      if (quote) cancelQuote('requote')
      const clientOrderId = `scr008:${slug}:${seq++}`
      quote = { clientOrderId, price }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: downAssetId,
        side: 'BUY',
        price,
        size: cfg.shares,
        orderType: 'GTC',
        meta: { exp: 'SCR-008', price, elapsedSec: Math.floor(elapsedSec) },
        reason: 'ungated DOWN at-touch bid',
      })
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-008',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
