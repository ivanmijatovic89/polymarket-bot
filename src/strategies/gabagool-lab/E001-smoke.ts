/**
 * E001-smoke — gabagool-lab pipeline probe (PROBE type; never evidence).
 *
 * Purpose: prove the full path strategy → backtest → DB → results.ts and
 * empirically settle three mechanics the lab depends on (LEDGER E001):
 *  1. intent_meta lands per filled order with the lab meta convention
 *     {e, leg, px, sz, k, t} (+ shared acc object — reference-vs-clone
 *     semantics decided by what the DB shows).
 *  2. Maker fills execute at own px/sz (settlement recheck must pass).
 *  3. The taker-cross path: one deliberate small cross per market at
 *     minute 8, so fee reconstruction can be validated against the
 *     sim's fees_paid column.
 *
 * Behavior (deterministic, tiny): after t>=60s, rest one GTC BUY rung
 * 1c below best bid on EACH leg (requote on 3c drift); at t>=480s cross
 * the cheaper leg's ask once (6 shares). Stop everything at t>=840s.
 * Buy-only, no merges, hold to settlement (INHERITANCE trap list).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  shares: z.coerce.number().finite().positive().max(100).default(6),
  rungOffset: z.coerce.number().finite().gt(0).lt(0.2).default(0.01),
  requoteDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  maxInventory: z.coerce.number().finite().positive().max(500).default(30),
  takerProbe: z.coerce.boolean().default(true),
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.05),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.9),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Acc = { n: number; mFee: number; tFee: number; tSimFee: number; rej: number }
type Quote = { clientOrderId: string; px: number }

const EPISODE_MS = 900_000
const EXP = 'E001-smoke'

const eraFee = (px: number, sz: number): number => 0.07 * px * (1 - px) * sz
const simFee = (px: number, sz: number): number => (156 / 10_000) * Math.min(px, 1 - px) * sz

export const definition: StrategyDefinition<Config> = {
  id: 'glab.E001-smoke',
  title: 'gabagool-lab E001 pipeline smoke',
  description: 'Probe: two maker rungs + one taker cross; validates meta/fee/settlement plumbing.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let takerDone = false
    let acc: Acc = { n: 0, mFee: 0, tFee: 0, tSimFee: 0, rej: 0 }
    const quotes: Record<Side, Quote | null> = { UP: null, DOWN: null }
    // Order registry so fills can be classified maker-rung vs taker-cross.
    const orders = new Map<string, { k: 'r' | 'x' }>()

    const resetFor = (slug: string): void => {
      stateSlug = slug
      seq = 0
      takerDone = false
      acc = { n: 0, mFee: 0, tFee: 0, tSimFee: 0, rej: 0 }
      quotes.UP = null
      quotes.DOWN = null
      orders.clear()
    }

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
      if (stateSlug !== slug) resetFor(slug)

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedMs = ts - Number(epochMatch[1]) * 1000
      const elapsedSec = Math.floor(elapsedMs / 1000)

      const intents: Intent[] = []
      const cancelSide = (side: Side, reason: string): void => {
        const q = quotes[side]
        if (!q) return
        quotes[side] = null
        intents.push({ kind: 'cancel_order', clientOrderId: q.clientOrderId, reason })
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      if (!up || !down) return intents
      const crossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk

      if (elapsedMs < 60_000 || elapsedMs > 840_000 || crossed(up) || crossed(down)) {
        cancelSide('UP', 'gate closed')
        cancelSide('DOWN', 'gate closed')
        return intents
      }

      // Maker rungs: 1c below best bid, each leg.
      for (const side of ['UP', 'DOWN'] as const) {
        const assetId = side === 'UP' ? upAssetId : downAssetId
        const book = side === 'UP' ? up : down
        const bid = book.bestBid
        const ask = book.bestAsk
        const inv = portfolio.positionsByAssetId[assetId]?.qty ?? 0
        if (inv >= cfg.maxInventory) {
          cancelSide(side, 'inventory cap')
          continue
        }
        if (bid == null || ask == null) {
          cancelSide(side, 'book unavailable')
          continue
        }
        const px = Math.round((bid - cfg.rungOffset) * 100) / 100
        // Never-overpay + pure-maker guard: strictly below the ask.
        if (px >= ask || px < cfg.minPrice || px > cfg.maxPrice) {
          cancelSide(side, 'no valid rung price')
          continue
        }
        const q = quotes[side]
        if (q && Math.abs(q.px - px) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        const clientOrderId = `e001:${slug}:${side}:${seq++}`
        quotes[side] = { clientOrderId, px }
        orders.set(clientOrderId, { k: 'r' })
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price: px,
          size: cfg.shares,
          orderType: 'GTC',
          meta: { e: EXP, leg: side === 'UP' ? 'U' : 'D', px, sz: cfg.shares, k: 'r', t: elapsedSec, acc },
          reason: 'smoke maker rung',
        })
      }

      // One deliberate taker cross at t>=480s on the cheaper leg.
      if (cfg.takerProbe && !takerDone && elapsedMs >= 480_000) {
        const upAsk = up.bestAsk
        const downAsk = down.bestAsk
        if (upAsk != null && downAsk != null) {
          const side: Side = upAsk <= downAsk ? 'UP' : 'DOWN'
          const assetId = side === 'UP' ? upAssetId : downAssetId
          const ask = side === 'UP' ? upAsk : downAsk
          if (ask >= 0.1 && ask <= 0.9 && ask * cfg.shares >= 1.05) {
            takerDone = true
            const clientOrderId = `e001:${slug}:X${side}:${seq++}`
            orders.set(clientOrderId, { k: 'x' })
            intents.push({
              kind: 'place_limit',
              clientOrderId,
              assetId,
              side: 'BUY',
              price: ask,
              size: cfg.shares,
              orderType: 'GTC',
              meta: {
                e: EXP,
                leg: side === 'UP' ? 'U' : 'D',
                px: ask,
                sz: cfg.shares,
                k: 'x',
                t: elapsedSec,
                acc,
              },
              reason: 'smoke taker probe',
            })
          }
        }
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'glab.E001-smoke',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind === 'fill') {
          const f = ev.fill
          const reg = f.clientOrderId ? orders.get(f.clientOrderId) : undefined
          const px = f.price
          const sz = f.size
          acc.n += 1
          if (reg?.k === 'x' || f.liquidity === 'TAKER') {
            acc.tFee += eraFee(px, sz)
            acc.tSimFee += simFee(px, sz)
          } else {
            acc.mFee += eraFee(px, sz)
          }
          clearQuoteById(f.clientOrderId)
        } else if (ev.kind === 'order_rejected') {
          acc.rej += 1
          acc.n += 1
          clearQuoteById(ev.clientOrderId)
        } else if (ev.kind === 'order_done' && ev.reason !== 'canceled') {
          clearQuoteById(ev.clientOrderId)
        }
        return []
      },
    }
    return { strategy }
  },
}
