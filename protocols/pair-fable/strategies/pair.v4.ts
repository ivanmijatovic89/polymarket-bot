/**
 * pair-fable-v4 — v1 with BOTH-SIDES start quoting (pair-v4 family).
 *
 * The cadence probe (pair-v1.md §Cadence extension, E-013) proved start rate
 * S is FILL-LIMITED: fills happen when price trades through bestBid, and v1
 * quotes only ONE side at a time, missing every crossing on the unquoted
 * side. v4 rests one start bid on EACH side simultaneously (joined at that
 * side's bestBid, joint pair gate), which is the only way to raise S without
 * leaving top-of-book. Break-even S* = q·(1+avgE/g_sh) ≈ 2.7–3.0 at gate
 * 0.93 vs v1's S = 1.64 (pair-v1.md §Cadence model).
 *
 * Mechanism:
 *   - BALANCED: rest one GTD bid per side at that side's bestBid, each only
 *     while the JOINT gate holds (projected avgUp+avgDown ≤ maxPairCost after
 *     both increments fill). A side requotes independently after its order
 *     terminates (per-side cooldown). Double fill in the latency race =
 *     instant pair at bid-sum cost (bonus, not a bug).
 *   - IMBALANCED (one leg filled): cancel any resting start (both ids, parity
 *     §5.1), then run v1's repair verbatim — one bid on the lesser side at
 *     its full gate cap, strictly below the ask.
 *   - v1's structural fixes retained: join-only starts, repair-at-cap,
 *     3-minute end-of-window start cutoff (repair allowed to the end).
 *
 * Same 6 params as v0/v1 (no new tunables — guard 2). No sells, no merges;
 * holds to settlement. Parity conventions per memory/capabilities/parity.md
 * §5 (≤2 open orders, cancel with both ids, fill-chunking indifferent).
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
  /** Shares per resting bid (M5-bounded: sim fills entire size on cross). */
  incrementSize: z.coerce.number().finite().positive().max(100).default(10),
  /** Per-market capital cap in $ (binding evaluator convention). */
  capPerMarket: z.coerce.number().finite().positive().default(50),
  /** Fee-inclusive pair budget: projected up_avg+down_avg must stay ≤ this. */
  maxPairCost: z.coerce.number().finite().positive().max(0.999).default(0.98),
  /** Resting bid lifetime (GTD). Engine minimum is now+60s. */
  ttlSec: z.coerce.number().finite().int().min(61).default(90),
  /** Hard guard: never let |up_shares − down_shares| exceed this after a full fill. */
  maxImbalance: z.coerce.number().finite().positive().default(20),
  /** Ticks a SIDE waits after its order ends before requoting. */
  cooldownTicks: z.coerce.number().finite().int().nonnegative().default(25),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v4',
  title: 'pair-fable v4 (both-sides start quoting)',
  description:
    'v1 mechanism with a resting start bid on BOTH sides while balanced (joint pair gate at top-of-book), per-side requote cooldown; on imbalance cancels resting starts and repairs at the gate cap like v1. No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type Side = 'UP' | 'DOWN'

type OpenOrder = { cid: string; kind: 'S' | 'R' }

type State = {
  marketId: string
  tickCount: number
  seq: number
  open: Record<Side, OpenOrder | null>
  readyAtTick: Record<Side, number>
  /** cids we have emitted a cancel for and are waiting to see terminal. */
  cancelling: Set<string>
  windowEndMs: number | null
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constant (not a tunable — must earn a param slot per guard 2). */
const START_CUTOFF_MS = 180_000
const WINDOW_MS = 15 * 60 * 1000
const SIDES: Side[] = ['UP', 'DOWN']

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v4'
  let state: State | null = null

  const orderGone = (clientOrderId: string | undefined): void => {
    if (!state || !clientOrderId) return
    for (const side of SIDES) {
      const o = state.open[side]
      if (o && o.cid === clientOrderId) {
        state.open[side] = null
        state.readyAtTick[side] = state.tickCount + cfg.cooldownTicks
        state.cancelling.delete(clientOrderId)
      }
    }
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
        open: { UP: null, DOWN: null },
        readyAtTick: { UP: 0, DOWN: 0 },
        cancelling: new Set(),
        windowEndMs: windowEndFromSlug(ctx?.market?.slug),
      }
    }
    state.tickCount += 1
    if (state.windowEndMs === null) state.windowEndMs = windowEndFromSlug(ctx?.market?.slug)

    // Reconcile terminal orders (fills/cancels/expiries seen via portfolio).
    for (const side of SIDES) {
      const o = state.open[side]
      if (!o) continue
      const po = portfolio.openOrdersByClientId[o.cid]
      if (po && TERMINAL.has(po.state)) orderGone(o.cid)
    }

    const upAssetId = ctx?.market?.upAssetId
    const downAssetId = ctx?.market?.downAssetId
    if (!upAssetId || !downAssetId) return []
    const pos = ctx?.metrics?.position
    if (!pos) return []

    const assetIdOf = (side: Side): string => (side === 'UP' ? upAssetId : downAssetId)
    const upQty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
    const downQty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
    const balanced = upQty === downQty
    const nowMs = tick.snapshot.timestamp || 0

    // Pending notional of live resting orders (cap discipline covers them).
    let pendingCost = 0
    for (const side of SIDES) {
      const o = state.open[side]
      if (!o) continue
      const po = portfolio.openOrdersByClientId[o.cid]
      if (po && !TERMINAL.has(po.state)) pendingCost += po.price * po.remaining
    }

    if (!balanced) {
      // REPAIR MODE. First: cancel any resting START orders (a stale start on
      // the surplus side would deepen the imbalance; the lesser-side start is
      // superseded by the more aggressive repair quote). Both ids (§5.1).
      const cancels: Intent[] = []
      for (const side of SIDES) {
        const o = state.open[side]
        if (o && o.kind === 'S' && !state.cancelling.has(o.cid)) {
          state.cancelling.add(o.cid)
          const orderId = portfolio.openOrdersByClientId[o.cid]?.orderId
          cancels.push({
            kind: 'cancel_order',
            clientOrderId: o.cid,
            ...(orderId !== undefined ? { orderId } : {}),
            reason: 'imbalance_supersedes_start',
          })
        }
      }
      if (cancels.length > 0) return cancels
      if (state.open.UP || state.open.DOWN) return [] // wait for terminal events

      const side: Side = upQty < downQty ? 'UP' : 'DOWN'
      if (state.tickCount < state.readyAtTick[side]) return []

      const assetId = assetIdOf(side)
      const otherAssetId = assetIdOf(side === 'UP' ? 'DOWN' : 'UP')
      const myQty = side === 'UP' ? upQty : downQty
      const size = cfg.incrementSize
      const otherQty = side === 'UP' ? downQty : upQty
      if (myQty + size - otherQty > cfg.maxImbalance) return []

      const book = tick.snapshot.byAssetId[assetId]
      const bestBid = book?.bestBid
      const bestAsk = book?.bestAsk
      if (bestBid == null || !Number.isFinite(bestBid) || bestBid <= 0) return []
      if (bestAsk == null || !Number.isFinite(bestAsk)) return []

      const other = portfolio.positionsByAssetId[otherAssetId]
      const otherRef = other && other.qty > 0 ? other.costBasis / other.qty : null
      if (otherRef == null || !Number.isFinite(otherRef) || otherRef <= 0) return []

      const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
      const maxP = ((cfg.maxPairCost - otherRef) * (myQty + size) - myCost) / size
      if (!Number.isFinite(maxP)) return []
      let price = round2(floorToGrid(maxP))
      if (price >= bestAsk) price = round2(bestAsk - GRID)
      if (price < GRID) return []
      if (pos.total_cost + pendingCost + price * size > cfg.capPerMarket) return []

      const i = state.seq
      state.seq += 1
      const clientOrderId = `pf4:${marketId}:${i}`
      state.open[side] = { cid: clientOrderId, kind: 'R' }
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
          meta: { t: 'pf4', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: 'R' },
          reason: `repair_${side.toLowerCase()}_pair_gate_${cfg.maxPairCost}`,
        },
      ]
    }

    // BALANCED — START MODE: rest one bid per side while the joint gate holds.
    if (state.windowEndMs !== null && nowMs > state.windowEndMs - START_CUTOFF_MS) return []

    const upBook = tick.snapshot.byAssetId[upAssetId]
    const downBook = tick.snapshot.byAssetId[downAssetId]
    const bidUp = upBook?.bestBid
    const askUp = upBook?.bestAsk
    const bidDown = downBook?.bestBid
    const askDown = downBook?.bestAsk
    if (bidUp == null || !Number.isFinite(bidUp) || bidUp <= 0) return []
    if (bidDown == null || !Number.isFinite(bidDown) || bidDown <= 0) return []
    if (askUp == null || !Number.isFinite(askUp)) return []
    if (askDown == null || !Number.isFinite(askDown)) return []

    const size = cfg.incrementSize
    if (size > cfg.maxImbalance) return [] // a single one-sided fill would breach the guard

    // Joint gate: projected avgUp + avgDown ≤ maxPairCost after BOTH
    // increments fill (existing balanced position included at cost basis).
    const upCost = portfolio.positionsByAssetId[upAssetId]?.costBasis ?? 0
    const downCost = portfolio.positionsByAssetId[downAssetId]?.costBasis ?? 0
    const projUp = (upCost + bidUp * size) / (upQty + size)
    const projDown = (downCost + bidDown * size) / (downQty + size)
    if (projUp + projDown > cfg.maxPairCost + 1e-9) return []

    const intents: Intent[] = []
    let budget = cfg.capPerMarket - pos.total_cost - pendingCost
    for (const side of SIDES) {
      if (state.open[side]) continue
      if (state.tickCount < state.readyAtTick[side]) continue
      const bid = side === 'UP' ? bidUp : bidDown
      const ask = side === 'UP' ? askUp : askDown
      const price = round2(bid)
      if (price >= ask) continue // crossed/locked book — stay maker
      if (price * size > budget) continue
      budget -= price * size

      const i = state.seq
      state.seq += 1
      const clientOrderId = `pf4:${marketId}:${i}`
      state.open[side] = { cid: clientOrderId, kind: 'S' }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: assetIdOf(side),
        side: 'BUY',
        price,
        size,
        orderType: 'GTD',
        expireAtMs: nowMs + cfg.ttlSec * 1000,
        meta: { t: 'pf4', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: 'S' },
        reason: `start_${side.toLowerCase()}_pair_gate_${cfg.maxPairCost}`,
      })
    }
    return intents
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind === 'order_rejected' || ev.kind === 'order_done') orderGone(ev.clientOrderId)
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
