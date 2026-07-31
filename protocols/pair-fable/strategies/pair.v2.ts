/**
 * pair-fable-v2 — v1 with repair-persistence fixes (pair-v2 family).
 *
 * v1's anatomy (runs 872/873, memory/experiments/pair-v1.md): the entire loss
 * is unpaired residue — 344 of 345 residue markets lose (the unrepaired side
 * is by construction the side price ran away from), ~$4.4 per doomed market,
 * while completed pairs earn only ~$0.28–0.59. Repair rate 80% needs ~94% to
 * break even. v1's repair leg stops chasing at the START gate (maxPairCost),
 * although completing anywhere below pair cost 1.00 is still profitable —
 * the gate blocks profitable repairs and eats the full residue loss instead.
 *
 * v2 changes vs v1 (structural — same 6 params, no new tunables):
 *   4. REPAIR CHASE-TO-BREAKEVEN: the repair budget uses design constant
 *      REPAIR_PAIR_COST = 0.995 instead of cfg.maxPairCost. The start gate
 *      keeps cfg.maxPairCost (selection quality unchanged); only the
 *      completion leg may pay up toward (but never beyond) breakeven.
 *   5. NO REPAIR BLACKOUT: cooldownTicks applies only after START-mode
 *      orders end. A repair leg that expires/cancels is re-placed on the next
 *      tick — v1 left the imbalance unquoted for the cooldown while the book
 *      kept drifting. Repair is persistent; starts are paced.
 *   6. REPAIR TAKER GUARD: repair quotes at most bestAsk − 2·GRID (v1 used
 *      ask − 1 tick; one tick of book drift across the ~140ms latency turned
 *      13–16% of fills taker — the S3-killing pattern). Starts still join
 *      bestBid (their taker contribution measured negligible: 15/415).
 *
 * Everything else is v1 verbatim: join-only starts gated at top-of-book,
 * 3-minute end-of-window start cutoff, one resting GTD bid at a time,
 * lesser-side selection, capPerMarket, maxImbalance backstop, no sells, no
 * merges, holds to settlement.
 */
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  /**
   * Shares per resting bid (the accumulation increment). Bounded (M5): the
   * simulator fills the ENTIRE resting size when price trades through the
   * level, with no depth constraint.
   */
  incrementSize: z.coerce.number().finite().positive().max(100).default(10),
  /** Per-market capital cap in $ (binding evaluator convention — the sweep knob). */
  capPerMarket: z.coerce.number().finite().positive().default(50),
  /** Fee-inclusive pair budget for STARTS: projected up_avg+down_avg must stay ≤ this. */
  maxPairCost: z.coerce.number().finite().positive().max(0.999).default(0.98),
  /** Resting bid lifetime (GTD). Engine minimum is now+60s. */
  ttlSec: z.coerce.number().finite().int().min(61).default(90),
  /** Hard guard: never let |up_shares − down_shares| exceed this after a full fill. */
  maxImbalance: z.coerce.number().finite().positive().default(20),
  /** Ticks to wait after a START order ends before placing the next one (fix 5: repairs skip it). */
  cooldownTicks: z.coerce.number().finite().int().nonnegative().default(25),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v2',
  title: 'pair-fable v2 (repair persistence: chase-to-breakeven, no blackout, taker guard)',
  description:
    'v1 mechanism with repair-persistence fixes: the completion leg chases up to pair cost 0.995 (start gate unchanged), repair orders skip the cooldown, and repair quotes stay 2 ticks below the ask. No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type State = {
  marketId: string
  tickCount: number
  seq: number
  lastSide: 'UP' | 'DOWN' | null
  openCid: string | null
  /** Mode of the currently open order — cooldown applies to 'S' only (fix 5). */
  openMode: 'S' | 'R' | null
  readyAtTick: number
  windowEndMs: number | null
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constants (not tunables — must earn a param slot per guard 2). */
const START_CUTOFF_MS = 180_000
const REPAIR_PAIR_COST = 0.995
const REPAIR_ASK_GUARD_TICKS = 2
const WINDOW_MS = 15 * 60 * 1000

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v2'
  let state: State | null = null

  const orderGone = (clientOrderId: string | undefined): void => {
    if (!state || !clientOrderId || state.openCid !== clientOrderId) return
    const wasStart = state.openMode === 'S'
    state.openCid = null
    state.openMode = null
    // Fix 5: only starts are paced; a gone repair leg re-places next tick.
    if (wasStart) state.readyAtTick = state.tickCount + cfg.cooldownTicks
  }

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const marketId = tick.snapshot.market ?? 'unknown_market'
    if (!state || state.marketId !== marketId) {
      state = {
        marketId,
        tickCount: 0,
        seq: 0,
        lastSide: null,
        openCid: null,
        openMode: null,
        readyAtTick: 0,
        windowEndMs: windowEndFromSlug(ctx?.market?.slug),
      }
    }
    state.tickCount += 1
    if (state.windowEndMs === null) state.windowEndMs = windowEndFromSlug(ctx?.market?.slug)

    if (state.openCid) {
      const o = portfolio.openOrdersByClientId[state.openCid]
      if (o && TERMINAL.has(o.state)) orderGone(state.openCid)
      if (state.openCid) return []
    }
    if (state.tickCount < state.readyAtTick) return []

    const upAssetId = ctx?.market?.upAssetId
    const downAssetId = ctx?.market?.downAssetId
    if (!upAssetId || !downAssetId) return []
    const pos = ctx?.metrics?.position
    if (!pos) return []

    const upQty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
    const downQty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
    const balanced = upQty === downQty
    const nowMs = tick.snapshot.timestamp || 0

    // Fix 3 (v1): no NEW pair starts near window end; repair stays allowed.
    if (balanced && state.windowEndMs !== null && nowMs > state.windowEndMs - START_CUTOFF_MS)
      return []

    let side: 'UP' | 'DOWN'
    if (upQty < downQty) side = 'UP'
    else if (downQty < upQty) side = 'DOWN'
    else side = state.lastSide === 'UP' ? 'DOWN' : 'UP'

    const assetId = side === 'UP' ? upAssetId : downAssetId
    const otherAssetId = side === 'UP' ? downAssetId : upAssetId
    const myQty = side === 'UP' ? upQty : downQty
    const otherQty = side === 'UP' ? downQty : upQty
    const size = cfg.incrementSize

    if (myQty + size - otherQty > cfg.maxImbalance) return []

    const book = tick.snapshot.byAssetId[assetId]
    const otherBook = tick.snapshot.byAssetId[otherAssetId]
    const bestBid = book?.bestBid
    const bestAsk = book?.bestAsk
    if (bestBid == null || !Number.isFinite(bestBid) || bestBid <= 0) return []
    if (bestAsk == null || !Number.isFinite(bestAsk)) return []

    const other = portfolio.positionsByAssetId[otherAssetId]
    const otherRef =
      other && other.qty > 0 ? other.costBasis / other.qty : (otherBook?.bestBid ?? null)
    if (otherRef == null || !Number.isFinite(otherRef) || otherRef <= 0) return []

    // Max price p keeping projAvg(side) + otherRef ≤ budget after a full fill
    // (maker fills carry $0 fees). Budget: start gate = cfg.maxPairCost;
    // repair chases to REPAIR_PAIR_COST (fix 4).
    const budget = balanced ? cfg.maxPairCost : REPAIR_PAIR_COST
    const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
    const maxP = ((budget - otherRef) * (myQty + size) - myCost) / size
    if (!Number.isFinite(maxP)) return []
    const gateCap = floorToGrid(maxP)

    let price: number
    if (balanced) {
      // Fix 1 (v1): START only by joining bestBid — if the gate does not hold
      // at the join price, the pair is not completable at top-of-book: skip.
      if (bestBid > gateCap + 1e-9) return []
      price = round2(bestBid)
      // Stay maker: never quote at/through the ask.
      if (price >= bestAsk) price = round2(bestAsk - GRID)
    } else {
      // Fix 2 (v1) + fixes 4/6: REPAIR at the chase cap, at most 2 ticks
      // below the ask so latency drift cannot cross the book.
      price = round2(Math.min(gateCap, bestAsk - REPAIR_ASK_GUARD_TICKS * GRID))
    }
    if (price < GRID) return []

    if (pos.total_cost + price * size > cfg.capPerMarket) return []

    const i = state.seq
    state.seq += 1
    state.lastSide = side
    const clientOrderId = `pf2:${marketId}:${i}`
    state.openCid = clientOrderId
    state.openMode = balanced ? 'S' : 'R'

    return [
      {
        kind: 'place_limit',
        clientOrderId,
        assetId,
        side: 'BUY',
        price,
        size,
        orderType: 'GTD',
        expireAtMs: nowMs + cfg.ttlSec * 1000,
        meta: { t: 'pf2', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: balanced ? 'S' : 'R' },
        reason: `${balanced ? 'start' : 'repair'}_${side.toLowerCase()}_pair_gate_${cfg.maxPairCost}`,
      },
    ]
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind === 'order_rejected' || ev.kind === 'order_done') orderGone(ev.clientOrderId)
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
