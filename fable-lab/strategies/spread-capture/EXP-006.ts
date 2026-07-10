/**
 * EXP-006 — quiet-regime two-sided quoting (`spread-capture`).
 *
 * Mechanism: impatient takers cross the spread in quiet mid-episode
 * stretches; a passive bidder δ below fair on BOTH sides (BUY UP and
 * BUY DOWN — buying DOWN is the no-short way to sell UP) is compensated:
 * completed pairs cost ≈ 1 − 2δ and settle at $1, one-sided inventory is
 * bought at a discount to fair. Under the worst-queue model every fill is a
 * punch-through (ask crosses strictly below the bid); the bet is that in
 * quiet regimes punch-throughs are noise (revert), not information (trend).
 *
 * Behavior: when the trailing `quietWindowSec` range of the UP mid is
 * ≤ quietRangeMax, the episode clock is inside
 * [minElapsedSec, 900 − stopBeforeEndSec], and both books are uncrossed
 * (LESSONS E6), maintain a GTC BUY on each side at
 * floor((fair − offset)·100)/100, fair(UP)=upMid, fair(DOWN)=1−upMid.
 * Requote a side when its fair drifts ≥ requoteDelta from the quote basis.
 * Cancel all quotes when the gate closes (loud, crossed, out of window).
 * Stop bidding a side at maxInventory shares. Hold inventory to settlement
 * (pairs valued $1 at episode end; never merge — LESSONS E4). No taker
 * orders, no exits: the model's maker fee is zero, so gross = net.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp only;
 * deterministic sequential clientOrderIds; fills tracked via `fill` events
 * (E5 — maker fills emit no order-status updates), inventory read from the
 * portfolio snapshot.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Bid distance below fair (fair(UP)=upMid, fair(DOWN)=1−upMid). */
  offset: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  /** Trailing window (seconds) over which the UP-mid range defines "quiet". */
  quietWindowSec: z.coerce.number().finite().positive().max(600).default(60),
  /** Max UP-mid range over the trailing window for the regime to be quiet. */
  quietRangeMax: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  /** Requote a side when its fair drifts this far from the quote basis. */
  requoteDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.01),
  /** Do not quote before this many seconds into the episode. */
  minElapsedSec: z.coerce.number().finite().nonnegative().max(800).default(60),
  /** Stop quoting (and cancel) this many seconds before episode end. */
  stopBeforeEndSec: z.coerce.number().finite().positive().max(800).default(120),
  /** Shares per quote (kept tiny — full-size-fill optimism, CAPABILITIES §4). */
  shares: z.coerce.number().finite().positive().max(1500).default(10),
  /** Stop bidding a side once its position reaches this many shares. */
  maxInventory: z.coerce.number().finite().positive().max(1900).default(50),
  /** Only place bids whose price lies inside [minPrice, maxPrice]. */
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.05),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.95),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Quote = { clientOrderId: string; price: number; basisFair: number }

const EPISODE_MS = 900_000

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-006',
  title: 'EXP-006 quiet-regime two-sided quoting',
  description:
    'Passive GTC bids δ below fair on both sides during quiet mid-episode windows; hold fills to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    const quotes: Record<Side, Quote | null> = { UP: null, DOWN: null }
    let midBuf: Array<{ ts: number; mid: number }> = []

    const clearQuoteById = (clientOrderId: string | undefined): void => {
      if (!clientOrderId) return
      for (const side of ['UP', 'DOWN'] as const) {
        if (quotes[side]?.clientOrderId === clientOrderId) quotes[side] = null
      }
    }

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
        quotes.UP = null
        quotes.DOWN = null
        midBuf = []
      }

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedMs = ts - Number(epochMatch[1]) * 1000

      const intents: Intent[] = []
      const cancelSide = (side: Side, reason: string): void => {
        const q = quotes[side]
        if (!q) return
        quotes[side] = null
        intents.push({ kind: 'cancel_order', clientOrderId: q.clientOrderId, reason })
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upMid = up?.mid
      if (up == null || down == null || upMid == null) {
        cancelSide('UP', 'book unavailable')
        cancelSide('DOWN', 'book unavailable')
        return intents
      }

      // Trailing quiet window on the UP mid. Keep one sample at/before the
      // cutoff: the book is piecewise-constant between ticks, so that sample
      // is the window-start value and also proves the window is covered.
      midBuf.push({ ts, mid: upMid })
      const cutoff = ts - cfg.quietWindowSec * 1000
      while (midBuf.length >= 2 && midBuf[1].ts <= cutoff) midBuf.shift()
      const covered = midBuf[0].ts <= cutoff
      let range = Number.POSITIVE_INFINITY
      if (covered) {
        let mn = Number.POSITIVE_INFINITY
        let mx = Number.NEGATIVE_INFINITY
        for (const s of midBuf) {
          if (s.mid < mn) mn = s.mid
          if (s.mid > mx) mx = s.mid
        }
        range = mx - mn
      }
      const quiet = covered && range <= cfg.quietRangeMax

      const inWindow =
        elapsedMs >= cfg.minElapsedSec * 1000 &&
        elapsedMs <= EPISODE_MS - cfg.stopBeforeEndSec * 1000
      const crossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk
      // Crossed-book guard (LESSONS E6): never rest quotes into a book state
      // that can grant phantom fills; a same-tick phantom fill is
      // unpreventable, but standing exposure to crossed states is not.
      if (!inWindow || !quiet || crossed(up) || crossed(down)) {
        cancelSide('UP', 'gate closed')
        cancelSide('DOWN', 'gate closed')
        return intents
      }

      for (const side of ['UP', 'DOWN'] as const) {
        const assetId = side === 'UP' ? upAssetId : downAssetId
        const book = side === 'UP' ? up : down
        const fair = side === 'UP' ? upMid : 1 - upMid
        const inv = portfolio.positionsByAssetId[assetId]?.qty ?? 0
        if (inv >= cfg.maxInventory) {
          cancelSide(side, 'inventory cap')
          continue
        }
        const price = Math.floor((fair - cfg.offset) * 100) / 100
        const ask = book.bestAsk
        // Strictly non-marketable (pure maker) and inside price bounds.
        if (ask == null || price >= ask || price < cfg.minPrice || price > cfg.maxPrice) {
          cancelSide(side, 'no valid quote price')
          continue
        }
        const q = quotes[side]
        if (q && Math.abs(fair - q.basisFair) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        const clientOrderId = `exp006:${slug}:${side}:${seq++}`
        quotes[side] = { clientOrderId, price, basisFair: fair }
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size: cfg.shares,
          orderType: 'GTC',
          meta: {
            exp: 'EXP-006',
            side,
            price,
            fair,
            upMid,
            spread: book.spread ?? null,
            quietRange: range,
            elapsedSec: Math.floor(elapsedMs / 1000),
            invUp: portfolio.positionsByAssetId[upAssetId]?.qty ?? 0,
            invDown: portfolio.positionsByAssetId[downAssetId]?.qty ?? 0,
          },
          reason: 'quiet-regime passive bid',
        })
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-exp-006',
      onMarketTick,
      onAccountEvent: (ev) => {
        // E5: maker fills emit only `fill` + `order_done` — clear the filled
        // quote so the next tick can repost (worst-queue fills are always
        // full size, so a fill ends the order). Rejections clear too, so a
        // phantom "active" quote never blocks a side.
        if (ev.kind === 'fill') clearQuoteById(ev.fill.clientOrderId)
        else if (ev.kind === 'order_rejected') clearQuoteById(ev.clientOrderId)
        else if (ev.kind === 'order_done' && ev.reason !== 'canceled') clearQuoteById(ev.clientOrderId)
        return []
      },
    }
    return { strategy }
  },
}
