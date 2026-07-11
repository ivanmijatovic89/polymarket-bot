/**
 * SCR-004 — at-touch maker cells outside E19 (`screens`, BATCH-001).
 * THREE gates in one parametric strategy (local touch-mode runs only;
 * D18 rules bind: outcomes are kill/escalate, never advance):
 *
 *   gate=tail     — join the bid at touch on the ≥minFavMid favorite from
 *                   startSec to endSec. E14 killed TAKING the tail at ask
 *                   (paying fee + spread); making the tail bid earns the
 *                   spread at zero fee — different economics, new cell
 *                   (E19 cells were regime-gated mid-window quotes).
 *   gate=reversal — the E22 monetization: after a big up-segment
 *                   (450→600) reverses with a big down-segment (600→750),
 *                   the UP ask is measured stale-high ≈4.4c gross; the
 *                   taker mirror nets only +2.38c (sub-bar). Joining the
 *                   DOWN bid at touch removes fee AND spread from the
 *                   cost side of that same continuation. Bid DOWN at
 *                   touch 750→endSec when the shape fires.
 *   gate=open     — two-sided at-touch quoting in the opening window
 *                   (5s→openEndSec), cancel after; harvest pre-information
 *                   spread. E19's quiet cell was regime-gated ALL-window;
 *                   this is time-gated at the open only.
 *
 * All fills held to settlement. Inventory-capped per side. Crossed-book
 * guard per E6 (never rest quotes into crossed states).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  gate: z.enum(['tail', 'reversal', 'open']),
  /** tail: favorite threshold on that side's mid. */
  minFavMid: z.coerce.number().finite().gt(0.5).lt(1).default(0.9),
  /** tail/reversal: active window. */
  startSec: z.coerce.number().finite().nonnegative().max(899).default(750),
  endSec: z.coerce.number().finite().positive().max(899).default(880),
  /** reversal: |segment| sizes (up 450→600, down 600→750). */
  minSeg: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  /** open: window end. */
  openEndSec: z.coerce.number().finite().positive().max(300).default(90),
  /** Requote when the joined bid moved by at least this much. */
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
type Quote = { clientOrderId: string; price: number; side: Side }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-004',
  title: 'SCR-004 at-touch maker cells (tail/reversal/open)',
  description: 'Join the bid at touch under three gates outside the E19 cells; local touch-mode only.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    const quotes = new Map<Side, Quote>()
    // reversal gate: first mid at-or-after 450/600/750s
    let m450: number | null = null
    let m600: number | null = null
    let m750: number | null = null

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
        m450 = m600 = m750 = null
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
      if (elapsedSec >= 450 && m450 === null) m450 = upMid
      if (elapsedSec >= 600 && m600 === null) m600 = upMid
      if (elapsedSec >= 750 && m750 === null) m750 = upMid

      // Which sides does the gate want quoted right now?
      const want: Side[] = []
      if (cfg.gate === 'tail') {
        if (elapsedSec >= cfg.startSec && elapsedSec <= cfg.endSec) {
          if (upMid >= cfg.minFavMid) want.push('UP')
          else if (1 - upMid >= cfg.minFavMid) want.push('DOWN')
        }
      } else if (cfg.gate === 'reversal') {
        if (
          elapsedSec >= cfg.startSec &&
          elapsedSec <= cfg.endSec &&
          m450 !== null &&
          m600 !== null &&
          m750 !== null &&
          m600 - m450 >= cfg.minSeg &&
          m750 - m600 <= -cfg.minSeg
        ) {
          want.push('DOWN')
        }
      } else {
        if (elapsedSec >= 5 && elapsedSec <= cfg.openEndSec) want.push('UP', 'DOWN')
      }

      for (const side of ['UP', 'DOWN'] as Side[]) {
        const book = side === 'UP' ? up : down
        const assetId = side === 'UP' ? upAssetId : downAssetId
        if (!want.includes(side)) {
          cancelSide(side, 'gate closed')
          continue
        }
        const inv = portfolio.positionsByAssetId[assetId]?.qty ?? 0
        if (inv >= cfg.maxInventory) {
          cancelSide(side, 'inventory cap')
          continue
        }
        const bid = book.bestBid
        const ask = book.bestAsk
        if (bid == null || ask == null) {
          cancelSide(side, 'no touch to join')
          continue
        }
        const price = bid // join the touch
        if (price >= ask || price < cfg.minPrice || price > cfg.maxPrice) {
          cancelSide(side, 'no valid quote price')
          continue
        }
        const q = quotes.get(side)
        if (q && Math.abs(q.price - price) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        const clientOrderId = `scr004:${slug}:${side}:${seq++}`
        quotes.set(side, { clientOrderId, price, side })
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size: cfg.shares,
          orderType: 'GTC',
          meta: {
            exp: 'SCR-004',
            gate: cfg.gate,
            side,
            price,
            upMid,
            elapsedSec: Math.floor(elapsedSec),
            m450,
            m600,
            m750,
          },
          reason: `at-touch ${cfg.gate} bid`,
        })
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-004',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
