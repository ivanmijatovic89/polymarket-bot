/**
 * pair-fable-v9 — v1 with an ABSOLUTE per-side entry-price ceiling (pair-v9
 * family, E-019; human ruling inbox 8758567d, axis 1).
 *
 * The v1 family bounded only the JOINT pair cost, so a single side could be
 * bought up to ~0.98 − otherRef and a stranded share lost ≈ $0.44 (measured).
 * v9 attacks that L_s term directly: never buy ANY side above `maxEntryPrice`
 * (X). L_s ≤ X by construction; a completion (both legs ≤ X) locks a margin
 * of at least 1 − 2X. Design details and pre-registered verdict bars in
 * memory/experiments/pair-v9.md (design-ts 47fd391).
 *
 * Delta vs pair.v1.ts (everything else verbatim):
 *   1. START joins bestBid only when bestBid ≤ X (ceiling as entry gate).
 *   2. REPAIR prices at min(gateCap, X) — rests AT X while the other side
 *      trades above it, waiting for the oscillation across the strike.
 *   3. The joint pair budget is a design CONSTANT (0.98 backstop, non-binding
 *      for X ≤ 0.45) instead of an exposed param — X takes its schema slot,
 *      keeping the 6-param budget (evaluator.md guard 2).
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
  /** Absolute per-side price ceiling X: never bid any side above this. */
  maxEntryPrice: z.coerce.number().finite().positive().max(0.49).default(0.35),
  /** Resting bid lifetime (GTD). Engine minimum is now+60s. */
  ttlSec: z.coerce.number().finite().int().min(61).default(90),
  /** Hard guard: never let |up_shares − down_shares| exceed this after a full fill. */
  maxImbalance: z.coerce.number().finite().positive().default(20),
  /** Ticks to wait after an order ends before placing the next one. */
  cooldownTicks: z.coerce.number().finite().int().nonnegative().default(25),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v9',
  title: 'pair-fable v9 (absolute entry-price ceiling)',
  description:
    'v1 mechanism with an absolute per-side price ceiling X: starts join bestBid only when bestBid ≤ X, repair legs rest at min(gate cap, X) waiting for the oscillation across the strike. Stranded-share loss is bounded by X; completions lock ≥ 1−2X margin. No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type State = {
  marketId: string
  tickCount: number
  seq: number
  lastSide: 'UP' | 'DOWN' | null
  openCid: string | null
  readyAtTick: number
  windowEndMs: number | null
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constants (not tunables — must earn a param slot per guard 2). */
const START_CUTOFF_MS = 180_000
const WINDOW_MS = 15 * 60 * 1000
/** Joint pair-cost backstop (v1's maxPairCost; non-binding for X ≤ 0.45). */
const PAIR_BUDGET = 0.98

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v9'
  let state: State | null = null

  const orderGone = (clientOrderId: string | undefined): void => {
    if (!state || !clientOrderId || state.openCid !== clientOrderId) return
    state.openCid = null
    state.readyAtTick = state.tickCount + cfg.cooldownTicks
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

    // No NEW pair starts near window end; repair stays allowed (v1 fix 3).
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

    // Max price p keeping projAvg(side) + otherRef ≤ PAIR_BUDGET after a
    // full fill (maker fills carry $0 fees). Backstop only under the ceiling.
    const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
    const maxP = ((PAIR_BUDGET - otherRef) * (myQty + size) - myCost) / size
    if (!Number.isFinite(maxP)) return []
    const gateCap = floorToGrid(maxP)
    const ceiling = floorToGrid(cfg.maxEntryPrice)

    let price: number
    if (balanced) {
      // START only by joining bestBid, and only when the side is absolutely
      // cheap: bestBid ≤ X (and the joint backstop holds at the join price).
      if (bestBid > ceiling + 1e-9) return []
      if (bestBid > gateCap + 1e-9) return []
      price = round2(bestBid)
    } else {
      // REPAIR at min(gate cap, X): rests AT X while the other side trades
      // above it — the oscillation-capture rest — and joins/improves as v1
      // when the other side is already at or below X.
      price = round2(Math.min(gateCap, ceiling))
    }
    // Stay maker: never quote at/through the ask.
    if (price >= bestAsk) price = round2(bestAsk - GRID)
    if (price < GRID) return []

    if (pos.total_cost + price * size > cfg.capPerMarket) return []

    const i = state.seq
    state.seq += 1
    state.lastSide = side
    const clientOrderId = `pf9:${marketId}:${i}`
    state.openCid = clientOrderId

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
        meta: { t: 'pf9', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: balanced ? 'S' : 'R' },
        reason: `${balanced ? 'start' : 'repair'}_${side.toLowerCase()}_ceiling_${cfg.maxEntryPrice}`,
      },
    ]
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind === 'order_rejected' || ev.kind === 'order_done') orderGone(ev.clientOrderId)
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
