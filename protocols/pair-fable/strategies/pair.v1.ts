/**
 * pair-fable-v1 — v0 with the three loss-anatomy fixes (pair-v1 family).
 *
 * v0's stationary −2.24/market loss is unpaired residue: deep first-leg bids
 * fill preferentially when the market moves against them (worst-queue), the
 * completion leg then never fills, and end-of-window starts leave residue
 * with no time to repair (memory/experiments/pair-v0.md §Loss anatomy).
 *
 * v1 changes (structural — same 6 params as v0, no new tunables):
 *   1. START discipline: a new increment (balanced book) is placed ONLY by
 *      joining bestBid, and only when the pair gate holds at that join price
 *      (⇒ bestBid(side) + otherRef ≤ maxPairCost). v0's deep below-bid first
 *      legs — its main adverse-selection source — are gone: if the pair is
 *      not completable at top-of-book, we do not play.
 *   2. REPAIR aggression: when sides are imbalanced, the completion bid is
 *      priced at its full gate cap (floorToGrid(maxP)), even ABOVE bestBid —
 *      improving the level so price trades through it sooner — capped
 *      strictly below bestAsk (still maker, $0 fees).
 *   3. END-OF-WINDOW cutoff: no NEW pair starts in the last 3 minutes of the
 *      15m window (repair stays allowed to the end). Residue risk
 *      concentrates there. Window end derives from the slug epoch —
 *      identical live and replay.
 *
 * Everything else is v0 verbatim: one resting GTD bid at a time, lesser-side
 * selection, cooldown, capPerMarket, maxImbalance backstop, no sells, no
 * merge intents, parity conventions per memory/capabilities/parity.md §5.
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
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v1',
  title: 'pair-fable v1 (entry discipline + repair + end cutoff)',
  description:
    'v0 mechanism with structural fixes for the unpaired-residue loss: new pairs only by joining bestBid when completable at top-of-book, completion leg priced at its gate cap (still maker), no new starts in the last 3 minutes. No sells, no merges; holds to settlement.',
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
  const name = 'pair-fable-v1'
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

    // Fix 3: no NEW pair starts near window end; repair stays allowed.
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

    // Max price p keeping projAvg(side) + otherRef ≤ maxPairCost after a
    // full fill (maker fills carry $0 fees).
    const myCost = portfolio.positionsByAssetId[assetId]?.costBasis ?? 0
    const maxP = ((cfg.maxPairCost - otherRef) * (myQty + size) - myCost) / size
    if (!Number.isFinite(maxP)) return []
    const gateCap = floorToGrid(maxP)

    let price: number
    if (balanced) {
      // Fix 1: START only by joining bestBid — if the gate does not hold at
      // the join price, the pair is not completable at top-of-book: skip.
      if (bestBid > gateCap + 1e-9) return []
      price = round2(bestBid)
    } else {
      // Fix 2: REPAIR at the full gate cap — may improve above bestBid.
      price = round2(gateCap)
    }
    // Stay maker: never quote at/through the ask.
    if (price >= bestAsk) price = round2(bestAsk - GRID)
    if (price < GRID) return []

    if (pos.total_cost + price * size > cfg.capPerMarket) return []

    const i = state.seq
    state.seq += 1
    state.lastSide = side
    const clientOrderId = `pf1:${marketId}:${i}`
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
        meta: { t: 'pf1', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: balanced ? 'S' : 'R' },
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
