/**
 * pair-fable-v0 — baseline of the RULES strategy (simplest honest version).
 *
 * Accumulates BOTH sides (UP and DOWN) in small maker increments, always adding
 * to the side with FEWER shares (tie → alternate), one resting GTD bid at a
 * time, gated so the projected fee-inclusive pair cost stays below
 * `maxPairCost`. Maker fills pay $0 fees, so pair cost == pair_avg; if a bid
 * ever crossed it would become taker and the gate would be optimistic — prices
 * are therefore capped strictly below the ask. No sells, no merge intents
 * (RULES backtest merge ban); pairs are valued at settlement.
 *
 * Purpose (PLAN `baseline-pair-strategy`): prove the research loop end-to-end.
 * Not tuned for profitability.
 *
 * Parity conventions honored (memory/capabilities/parity.md §5): no cancels
 * (GTD expiry retires stale bids → no id-space trap), never gates on
 * MINED/CONFIRMED, order_rejected and order_done(killed|expired|canceled|
 * filled) handled uniformly as "order gone", book-derived 0.01-grid prices,
 * unique clientOrderId + meta stamped per evaluator.md, sizes far inside the
 * shared risk walls, capital-cap param `capPerMarket` per the evaluator
 * convention.
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
  /** Shares per resting bid (the accumulation increment). */
  incrementSize: z.coerce.number().finite().positive().default(10),
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
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v0',
  title: 'pair-fable baseline v0',
  description:
    'Alternating small-increment maker BUY accumulation on both sides, one GTD bid at a time on the lesser side, gated on projected fee-inclusive pair cost < maxPairCost. No sells, no merges; holds to settlement.',
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
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v0'
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
      state = { marketId, tickCount: 0, seq: 0, lastSide: null, openCid: null, readyAtTick: 0 }
    }
    state.tickCount += 1

    // Reconcile in-flight order via portfolio (belt-and-braces for event-based
    // clearing; live partial fills leave state 'partially_filled' — not gone).
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

    // Always add to the lesser side; on a tie alternate (imbalance thus stays
    // structurally ≤ incrementSize; maxImbalance is a hard backstop).
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

    // Expected cost to complete the pair on the other side: actual avg once we
    // hold shares there, else its current best bid (our expected maker entry).
    const other = portfolio.positionsByAssetId[otherAssetId]
    const otherRef =
      other && other.qty > 0 ? other.costBasis / other.qty : (otherBook?.bestBid ?? null)
    if (otherRef == null || !Number.isFinite(otherRef) || otherRef <= 0) return []

    // Max price p such that the projected side avg after this fill keeps
    // projAvg(side) + otherRef ≤ maxPairCost (maker fills carry $0 fees).
    const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
    const maxP = ((cfg.maxPairCost - otherRef) * (myQty + size) - myCost) / size
    if (!Number.isFinite(maxP)) return []

    let price = round2(Math.min(bestBid, floorToGrid(maxP)))
    // Stay maker: never quote at/through the ask (a crossing bid would fill as
    // taker and the $0-fee pair gate above would understate the pair cost).
    if (price >= bestAsk) price = round2(bestAsk - GRID)
    if (price < GRID) return []

    if (pos.total_cost + price * size > cfg.capPerMarket) return []

    const nowMs = tick.snapshot.timestamp || 0
    const i = state.seq
    state.seq += 1
    state.lastSide = side
    const clientOrderId = `pf0:${marketId}:${i}`
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
        meta: { t: 'pf0', i, side, ot: 'GTD', p: price, s: size, ts: nowMs },
        reason: `accumulate_${side.toLowerCase()}_pair_gate_${cfg.maxPairCost}`,
      },
    ]
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind === 'order_rejected' || ev.kind === 'order_done') orderGone(ev.clientOrderId)
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
