/**
 * E002-baseline — the L1 reference: archetype-faithful parity ladder.
 *
 * The simplest honest expression of the gabagool concept (KB BRIEF §1,
 * H1): passive two-sided BUY-only GTC ladder; parity-driven side
 * selection (always quote the lagging leg; quote the leading leg only
 * while the share imbalance is small); a never-overpay guard that
 * blocks any bid whose projected combined average pair cost exceeds
 * `pairCostCap`; band limits; endgame stop; hold everything to
 * settlement (pairs auto-credit $1, remainder redeems — never merge).
 *
 * Maker-only by design: TRADE_corr ≡ TRADE_sim (no taker fees in either
 * model), so this baseline is immune to the fee-shape correction and
 * measures pure worst-queue pair-accumulation economics. Taker
 * completion is a separate axis (H6), measured against this reference.
 *
 * Engine-correct patterns (INHERITANCE trap list): crossed-book guard,
 * fill-event quote clearing, strictly-non-marketable rungs (px < ask),
 * deterministic clientOrderIds, per-market state reset, ≤4 standing
 * orders (maxOpenOrders=20 cap respected), buy-only (maxLossStop inert).
 * Lab meta convention on every order incl. the shared `acc` (E001:
 * persists by reference; exact per-fill economics).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Shares per rung (min order 5; keep small — sim size scaling lies). */
  clipShares: z.coerce.number().finite().min(5).max(100).default(6),
  /** Ladder rung offsets below best bid, cents as decimals. JSON array. */
  rungOffsets: z
    .string()
    .default('[0.01,0.03]')
    .transform((s, ctx) => {
      try {
        const arr = JSON.parse(s) as unknown
        if (!Array.isArray(arr) || !arr.length || !arr.every((x) => typeof x === 'number' && x > 0 && x < 0.5))
          throw new Error('bad')
        return arr as number[]
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rungOffsets must be a JSON array of (0,0.5) numbers' })
        return z.NEVER
      }
    }),
  /** Quote the leading leg only while |up−down| shares < this. */
  parityTolShares: z.coerce.number().finite().positive().max(1000).default(12),
  /** Never-overpay: projected avgUp + avgDown must stay ≤ this. */
  pairCostCap: z.coerce.number().finite().gt(0.5).lt(1.1).default(0.99),
  /** Max bid price while the OTHER leg has no shares yet. */
  soloCap: z.coerce.number().finite().gt(0).lt(1).default(0.65),
  /** Quote band (archetype effective band p5–p95 ≈ 0.11–0.85). */
  bandLo: z.coerce.number().finite().gt(0).lt(1).default(0.11),
  bandHi: z.coerce.number().finite().gt(0).lt(1).default(0.85),
  /** Do not quote before/after (seconds into the 15m episode). */
  startSec: z.coerce.number().finite().nonnegative().max(800).default(60),
  stopSec: z.coerce.number().finite().positive().max(895).default(840),
  /** Requote a side when its best bid drifts this far from the basis. */
  requoteDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  /** Hard cap per side (shares) — outlay bound, far under risk caps. */
  maxSharesPerSide: z.coerce.number().finite().positive().max(1500).default(120),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Acc = {
  n: number
  mN: number
  tN: number
  mFee: number
  tFee: number
  tSimFee: number
  rej: number
  dockU: number
  dockD: number
}
type SideQuotes = { basisBid: number; clientOrderIds: string[] }

const EXP = 'E002-baseline'
const eraFee = (px: number, sz: number): number => 0.07 * px * (1 - px) * sz

export const definition: StrategyDefinition<Config> = {
  id: 'glab.E002-baseline',
  title: 'gabagool-lab E002 baseline parity ladder',
  description:
    'Two-sided buy-only maker ladder with parity-driven side selection, never-overpay pair-cost cap, band, endgame stop; hold to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let acc: Acc = { n: 0, mN: 0, tN: 0, mFee: 0, tFee: 0, tSimFee: 0, rej: 0, dockU: 0, dockD: 0 }
    const quotes: Record<Side, SideQuotes | null> = { UP: null, DOWN: null }

    const resetFor = (slug: string): void => {
      stateSlug = slug
      seq = 0
      acc = { n: 0, mN: 0, tN: 0, mFee: 0, tFee: 0, tSimFee: 0, rej: 0, dockU: 0, dockD: 0 }
      quotes.UP = null
      quotes.DOWN = null
    }

    const removeOrderId = (clientOrderId: string | undefined): void => {
      if (!clientOrderId) return
      for (const side of ['UP', 'DOWN'] as const) {
        const q = quotes[side]
        if (!q) continue
        const idx = q.clientOrderIds.indexOf(clientOrderId)
        if (idx >= 0) q.clientOrderIds.splice(idx, 1)
        if (q.clientOrderIds.length === 0) quotes[side] = null
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
      const elapsedSec = (ts - Number(epochMatch[1]) * 1000) / 1000

      const intents: Intent[] = []
      const cancelSide = (side: Side, reason: string): void => {
        const q = quotes[side]
        if (!q) return
        quotes[side] = null
        for (const id of q.clientOrderIds)
          intents.push({ kind: 'cancel_order', clientOrderId: id, reason })
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      if (!up || !down) return intents
      const crossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk

      if (elapsedSec < cfg.startSec || elapsedSec > cfg.stopSec || crossed(up) || crossed(down)) {
        cancelSide('UP', 'gate closed')
        cancelSide('DOWN', 'gate closed')
        return intents
      }

      const posUp = portfolio.positionsByAssetId[upAssetId]
      const posDown = portfolio.positionsByAssetId[downAssetId]
      const upQty = posUp?.qty ?? 0
      const downQty = posDown?.qty ?? 0
      const upCost = posUp?.costBasis ?? 0
      const downCost = posDown?.costBasis ?? 0

      for (const side of ['UP', 'DOWN'] as const) {
        const assetId = side === 'UP' ? upAssetId : downAssetId
        const book = side === 'UP' ? up : down
        const bid = book.bestBid
        const ask = book.bestAsk
        const myQty = side === 'UP' ? upQty : downQty
        const otherQty = side === 'UP' ? downQty : upQty
        const myCost = side === 'UP' ? upCost : downCost
        const otherCost = side === 'UP' ? downCost : upCost

        // Parity rule: the leading leg quotes only while imbalance small.
        const leading = myQty > otherQty
        const imbalance = Math.abs(upQty - downQty)
        if (leading && imbalance >= cfg.parityTolShares) {
          cancelSide(side, 'parity suspend')
          continue
        }
        if (myQty >= cfg.maxSharesPerSide) {
          cancelSide(side, 'side cap')
          continue
        }
        if (bid == null || ask == null) {
          cancelSide(side, 'book unavailable')
          continue
        }

        const q = quotes[side]
        if (q && Math.abs(bid - q.basisBid) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')

        const placed: string[] = []
        for (const off of cfg.rungOffsets) {
          const px = Math.round((bid - off) * 100) / 100
          // Band + pure-maker (never cross) + never-overpay guards.
          if (px < cfg.bandLo || px > cfg.bandHi || px >= ask) continue
          if (otherQty <= 0) {
            if (px > cfg.soloCap) continue
          } else {
            const newAvg = (myCost + px * cfg.clipShares) / (myQty + cfg.clipShares)
            const otherAvg = otherCost / otherQty
            if (newAvg + otherAvg > cfg.pairCostCap) continue
          }
          const clientOrderId = `e002:${slug}:${side}:${seq++}`
          placed.push(clientOrderId)
          intents.push({
            kind: 'place_limit',
            clientOrderId,
            assetId,
            side: 'BUY',
            price: px,
            size: cfg.clipShares,
            orderType: 'GTC',
            meta: {
              e: EXP,
              leg: side === 'UP' ? 'U' : 'D',
              px,
              sz: cfg.clipShares,
              k: 'r',
              t: Math.floor(elapsedSec),
              acc,
            },
            reason: 'baseline rung',
          })
        }
        if (placed.length) quotes[side] = { basisBid: bid, clientOrderIds: placed }
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'glab.E002-baseline',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind === 'fill') {
          const f = ev.fill
          acc.n += 1
          // Rungs can convert to TAKER when the book collapses into them
          // during the latency window (realistic; D2 saw 29–45% taker
          // completions live). Classify by REALIZED liquidity and track
          // docked shares per leg so the era-fee correction is exact.
          if (f.liquidity === 'TAKER') {
            acc.tN += 1
            acc.tFee += eraFee(f.price, f.size)
            const sim = (156 / 10_000) * Math.min(f.price, 1 - f.price) * f.size
            acc.tSimFee += sim
            const dock = f.price > 0 ? sim / f.price : 0
            if (f.clientOrderId?.includes(':UP:')) acc.dockU += dock
            else if (f.clientOrderId?.includes(':DOWN:')) acc.dockD += dock
          } else {
            acc.mN += 1
            acc.mFee += eraFee(f.price, f.size)
          }
          removeOrderId(f.clientOrderId)
        } else if (ev.kind === 'order_rejected') {
          acc.rej += 1
          acc.n += 1
          removeOrderId(ev.clientOrderId)
        } else if (ev.kind === 'order_done' && ev.reason !== 'canceled') {
          removeOrderId(ev.clientOrderId)
        }
        return []
      },
    }
    return { strategy }
  },
}
