/**
 * EXP-007 — loud-regime countertrend liquidity provision (`spread-capture`).
 *
 * Mechanism: momentum takers and stop-outs pay for immediacy during fast
 * moves; a passive bid resting δ below fair on the FALLING side is their
 * counterparty. Under the worst-queue model a fill happens only when the
 * cascade punches strictly through the bid — being filled by a continuing
 * move IS the claim being paid for (LESSONS E16): the bet is that a loud
 * move that reaches the bid has overshot and reverts by settlement. If
 * loud punch-throughs are informative (the move keeps going), fills are
 * toxic and the mechanism is contradicted.
 *
 * Behavior: when the signed UP-mid displacement over the trailing
 * `jumpWindowSec` window has magnitude ≥ jumpSize, the episode clock is
 * inside [minElapsedSec, 900 − stopBeforeEndSec], and both books are
 * uncrossed (LESSONS E6), maintain ONE GTC BUY on the falling side
 * (UP-mid fell → BUY UP; rose → BUY DOWN) at floor((fair − offset)·100)/100
 * with fair(UP)=upMid, fair(DOWN)=1−upMid. Requote when fair drifts
 * ≥ requoteDelta from the quote basis (the bid chases the cascade; a fill
 * therefore needs a single-tick gap through the level — LESSONS E15).
 * Cancel when the gate closes (calm, wrong side, crossed, out of window).
 * Stop bidding a side at maxInventory shares. Hold inventory to settlement
 * (never merge — LESSONS E4). No taker orders, no exits: the model's maker
 * fee is zero, so gross = net.
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
  /** Trailing window (seconds) over which the signed UP-mid move is measured. */
  jumpWindowSec: z.coerce.number().finite().positive().max(600).default(10),
  /** Min |signed UP-mid move| over the trailing window for the regime to be loud. */
  jumpSize: z.coerce.number().finite().gt(0).lt(0.9).default(0.1),
  /** Requote when fair drifts this far from the quote basis. */
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
type Quote = { clientOrderId: string; price: number; basisFair: number; side: Side }
type MidSample = { ts: number; mid: number }

const EPISODE_MS = 900_000

/**
 * Sliding time-window view of the UP mid, O(1) amortized per tick. The
 * window covers (now − windowMs, now] PLUS one carried-in sample at or
 * before the cutoff (the book is piecewise-constant between ticks, so that
 * sample is the value at window start and also proves coverage). Exposes
 * the signed displacement mid(now) − mid(windowStart).
 */
class MidMoveWindow {
  private buf: MidSample[] = []
  private head = 0

  reset(): void {
    this.buf = []
    this.head = 0
  }

  /** Push the current sample, prune, and return coverage + signed move. */
  push(ts: number, mid: number, windowMs: number): { covered: boolean; move: number } {
    this.buf.push({ ts, mid })
    const cutoff = ts - windowMs
    // Keep one sample at/before the cutoff (carried-in window-start value).
    while (this.buf.length - this.head >= 2 && this.buf[this.head + 1].ts <= cutoff) this.head++
    if (this.head > 8192) {
      this.buf = this.buf.slice(this.head)
      this.head = 0
    }
    const start = this.buf[this.head]
    const covered = start.ts <= cutoff
    const move = covered ? mid - start.mid : 0
    return { covered, move }
  }
}

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-007',
  title: 'EXP-007 loud-regime countertrend liquidity provision',
  description:
    'Passive GTC bid δ below fair on the falling side during loud windows; hold punch-through fills to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let quote: Quote | null = null
    const midWindow = new MidMoveWindow()

    const clearQuoteById = (clientOrderId: string | undefined): void => {
      if (clientOrderId && quote?.clientOrderId === clientOrderId) quote = null
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
        quote = null
        midWindow.reset()
      }

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedMs = ts - Number(epochMatch[1]) * 1000

      const intents: Intent[] = []
      const cancelQuote = (reason: string): void => {
        if (!quote) return
        intents.push({ kind: 'cancel_order', clientOrderId: quote.clientOrderId, reason })
        quote = null
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upMid = up?.mid
      if (up == null || down == null || upMid == null) {
        cancelQuote('book unavailable')
        return intents
      }

      const { covered, move } = midWindow.push(ts, upMid, cfg.jumpWindowSec * 1000)
      const loud = covered && Math.abs(move) >= cfg.jumpSize

      const inWindow =
        elapsedMs >= cfg.minElapsedSec * 1000 &&
        elapsedMs <= EPISODE_MS - cfg.stopBeforeEndSec * 1000
      const crossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk
      // Crossed-book guard (LESSONS E6): never rest quotes into a book state
      // that can grant phantom fills; a same-tick phantom fill is
      // unpreventable, but standing exposure to crossed states is not.
      if (!inWindow || !loud || crossed(up) || crossed(down)) {
        cancelQuote('gate closed')
        return intents
      }

      // Falling side: UP-mid fell → UP got cheaper → BUY UP; rose → BUY DOWN.
      const side: Side = move < 0 ? 'UP' : 'DOWN'
      const assetId = side === 'UP' ? upAssetId : downAssetId
      const book = side === 'UP' ? up : down
      const fair = side === 'UP' ? upMid : 1 - upMid

      if (quote && quote.side !== side) cancelQuote('side flipped')

      const inv = portfolio.positionsByAssetId[assetId]?.qty ?? 0
      if (inv >= cfg.maxInventory) {
        cancelQuote('inventory cap')
        return intents
      }
      const price = Math.floor((fair - cfg.offset) * 100) / 100
      const ask = book.bestAsk
      // Strictly non-marketable (pure maker) and inside price bounds.
      if (ask == null || price >= ask || price < cfg.minPrice || price > cfg.maxPrice) {
        cancelQuote('no valid quote price')
        return intents
      }
      if (quote && Math.abs(fair - quote.basisFair) < cfg.requoteDelta) return intents
      if (quote) cancelQuote('requote')
      const clientOrderId = `exp007:${slug}:${side}:${seq++}`
      quote = { clientOrderId, price, basisFair: fair, side }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId,
        side: 'BUY',
        price,
        size: cfg.shares,
        orderType: 'GTC',
        meta: {
          exp: 'EXP-007',
          side,
          price,
          fair,
          upMid,
          move,
          spread: book.spread ?? null,
          elapsedSec: Math.floor(elapsedMs / 1000),
          invUp: portfolio.positionsByAssetId[upAssetId]?.qty ?? 0,
          invDown: portfolio.positionsByAssetId[downAssetId]?.qty ?? 0,
        },
        reason: 'loud-regime countertrend passive bid',
      })
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-exp-007',
      onMarketTick,
      onAccountEvent: (ev) => {
        // E5: maker fills emit only `fill` + `order_done` — clear the filled
        // quote so the next tick can repost (worst-queue fills are always
        // full size, so a fill ends the order). Rejections clear too, so a
        // phantom "active" quote never blocks the side.
        if (ev.kind === 'fill') clearQuoteById(ev.fill.clientOrderId)
        else if (ev.kind === 'order_rejected') clearQuoteById(ev.clientOrderId)
        else if (ev.kind === 'order_done' && ev.reason !== 'canceled') clearQuoteById(ev.clientOrderId)
        return []
      },
    }
    return { strategy }
  },
}
