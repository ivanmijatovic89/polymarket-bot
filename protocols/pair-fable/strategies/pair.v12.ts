/**
 * pair-fable-v12 — v1 plus averaging-down accumulation (pair-v12 family,
 * ruling axis 4b; pre-registered memory/experiments/pair-v12.md §E-026,
 * design-ts commit 9a864a9 BEFORE this file existed).
 *
 * Exact copy of pair.v1.ts except the unbalanced branch: when the HELD
 * (excess) side's bestBid has fallen at least `avgDownDiscount` below its
 * average cost, buy another increment of the held side by joining its
 * bestBid (maker) — lowering the held average and raising the deficit
 * side's joint-gate repair cap — instead of resting the deficit repair
 * that cycle. Guards: maxImbalance (bounds rounds), completability
 * (maxPairCost − newAvg ≥ one grid step), capPerMarket, and the 3-minute
 * start cutoff (avg-down INCREASES exposure, so it obeys the start
 * cutoff; deficit repair still runs to window end). Trigger never firing
 * (avgDownDiscount=0.99) must reproduce pair-fable-v1 exactly — that is
 * the grid's regression config.
 *
 * Everything else is v1 verbatim: join-only starts gated at the join
 * price, repair at the full gate cap, one resting GTD bid at a time,
 * cooldown, no sells, no merges, holds to settlement.
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
  /** Fee-inclusive pair budget: projected up_avg+down_avg must stay ≤ this. */
  maxPairCost: z.coerce.number().finite().positive().max(0.999).default(0.98),
  /** Resting bid lifetime (GTD). Engine minimum is now+60s. */
  ttlSec: z.coerce.number().finite().int().min(61).default(90),
  /** Hard guard: never let |up_shares − down_shares| exceed this after a full fill. */
  maxImbalance: z.coerce.number().finite().positive().default(20),
  /** Ticks to wait after an order ends before placing the next one. */
  cooldownTicks: z.coerce.number().finite().int().nonnegative().default(25),
  /**
   * Averaging-down trigger: buy another increment of the HELD (excess) side
   * when its bestBid ≤ heldAvgCost − avgDownDiscount. 0.99 disables the
   * trigger (v1-equivalent regression config).
   */
  avgDownDiscount: z.coerce.number().finite().positive().max(0.99).default(0.1),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v12',
  title: 'pair-fable v12 (v1 + averaging-down accumulation)',
  description:
    'v1 mechanism plus state-contingent averaging down: when the held side falls below its average cost by avgDownDiscount, join its bestBid for another increment (maker), lowering the held average and raising the deficit-side repair cap. No sells, no merges; holds to settlement.',
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
/** Design constant (not a tunable — must earn a param slot per guard 2). */
const START_CUTOFF_MS = 180_000
const WINDOW_MS = 15 * 60 * 1000

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v12'
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
    const size = cfg.incrementSize
    const beforeCutoff =
      state.windowEndMs === null || nowMs <= state.windowEndMs - START_CUTOFF_MS

    // Fix 3 (v1): no NEW pair starts near window end; repair stays allowed.
    if (balanced && !beforeCutoff) return []

    // v12: averaging-down check on the HELD (excess) side, before the
    // deficit-side selection. All five pre-registered guards must hold.
    if (!balanced && beforeCutoff) {
      const heldSide: 'UP' | 'DOWN' = upQty > downQty ? 'UP' : 'DOWN'
      const heldAssetId = heldSide === 'UP' ? upAssetId : downAssetId
      const heldQty = heldSide === 'UP' ? upQty : downQty
      const deficitQty = heldSide === 'UP' ? downQty : upQty
      const held = portfolio.positionsByAssetId[heldAssetId]
      const heldBook = tick.snapshot.byAssetId[heldAssetId]
      const hBid = heldBook?.bestBid
      const hAsk = heldBook?.bestAsk
      if (
        held &&
        held.qty > 0 &&
        hBid != null &&
        Number.isFinite(hBid) &&
        hBid > 0 &&
        hAsk != null &&
        Number.isFinite(hAsk)
      ) {
        const heldAvg = held.costBasis / held.qty
        const withinImbalance = heldQty + size - deficitQty <= cfg.maxImbalance
        // Join the held side's bestBid (maker; never at/through the ask).
        let price = round2(hBid)
        if (price >= hAsk) price = round2(hAsk - GRID)
        const newAvg = (held.costBasis + price * size) / (held.qty + size)
        const completable = cfg.maxPairCost - newAvg >= GRID - 1e-9
        const withinCap = pos.total_cost + price * size <= cfg.capPerMarket
        if (
          hBid <= heldAvg - cfg.avgDownDiscount + 1e-9 &&
          withinImbalance &&
          completable &&
          withinCap &&
          price >= GRID
        ) {
          const i = state.seq
          state.seq += 1
          state.lastSide = heldSide
          const clientOrderId = `pf12:${marketId}:${i}`
          state.openCid = clientOrderId
          return [
            {
              kind: 'place_limit',
              clientOrderId,
              assetId: heldAssetId,
              side: 'BUY',
              price,
              size,
              orderType: 'GTD',
              expireAtMs: nowMs + cfg.ttlSec * 1000,
              meta: { t: 'pf12', i, side: heldSide, ot: 'GTD', p: price, s: size, ts: nowMs, m: 'A' },
              reason: `avgdown_${heldSide.toLowerCase()}_disc_${cfg.avgDownDiscount}`,
            },
          ]
        }
      }
    }

    let side: 'UP' | 'DOWN'
    if (upQty < downQty) side = 'UP'
    else if (downQty < upQty) side = 'DOWN'
    else side = state.lastSide === 'UP' ? 'DOWN' : 'UP'

    const assetId = side === 'UP' ? upAssetId : downAssetId
    const otherAssetId = side === 'UP' ? downAssetId : upAssetId
    const myQty = side === 'UP' ? upQty : downQty
    const otherQty = side === 'UP' ? downQty : upQty

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

    // Max price p keeping projAvg(side) + otherRef ≤ maxPairCost after a
    // full fill (maker fills carry $0 fees).
    const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
    const maxP = ((cfg.maxPairCost - otherRef) * (myQty + size) - myCost) / size
    if (!Number.isFinite(maxP)) return []
    const gateCap = floorToGrid(maxP)

    let price: number
    if (balanced) {
      // Fix 1 (v1): START only by joining bestBid — if the gate does not
      // hold at the join price, the pair is not completable at ToB: skip.
      if (bestBid > gateCap + 1e-9) return []
      price = round2(bestBid)
    } else {
      // Fix 2 (v1): REPAIR at the full gate cap — may improve above bestBid.
      price = round2(gateCap)
    }
    // Stay maker: never quote at/through the ask.
    if (price >= bestAsk) price = round2(bestAsk - GRID)
    if (price < GRID) return []

    if (pos.total_cost + price * size > cfg.capPerMarket) return []

    const i = state.seq
    state.seq += 1
    state.lastSide = side
    const clientOrderId = `pf12:${marketId}:${i}`
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
        meta: { t: 'pf12', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: balanced ? 'S' : 'R' },
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
