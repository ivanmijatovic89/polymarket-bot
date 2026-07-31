/**
 * pair-fable-v10 — v1 plus the taker-completion module (pair-v10 family,
 * E-020; human ruling inbox 8758567d, axes 2+3 — shared machinery).
 *
 * The v1 family's loss is the stranded side (L_s ≈ $0.44/share): the
 * worst-queue maker repair only fills on a continued move, so hover paths
 * (held side rose, deficit side cheap but not falling through the rest) and
 * collapse paths (held side doomed, deficit ask above the gate) both strand.
 * v10 adds one FOK taker rule with two triggers, per
 * memory/experiments/pair-v10.md (design-ts 3767786):
 *
 *   A. PROFIT LOCK (`completeCapTotal` C, 0=off): when imbalanced and
 *      h + ask + fee ≤ C (h = surplus-side avg cost, ask = deficit bestAsk,
 *      fee = 0.07·ask·(1−ask)), FOK-buy the full imbalance at the ask —
 *      locks ≥ 1−C margin per pair. Book sums ≈ 1.02 at entry, so this
 *      fires only after the held side has genuinely risen.
 *   B. DOOM SALVAGE (`doomBid` D, 0=off): when imbalanced, bestBid(held)
 *      ≤ D and ask + fee ≤ 0.99, FOK-buy the imbalance — completing at
 *      total τ loses τ−1 < h = the certain-doom loss (save ≥ 1¢/share).
 *
 * State machine: the trigger bypasses the open-order gate for a resting
 * GTD repair (cancel with both ids + FOK in the same tick) but NOT for
 * its own in-flight FOK — one FOK at a time, resolved via order_done,
 * plus a tick-based cooldown as defense-in-depth. The in-flight gate is
 * the E-020 bug fix: the first build rate-limited FOKs by ticks only,
 * and 25 ticks can elapse inside the 140 ms fill latency, so bursts of
 * duplicate FOKs fired against a stale portfolio (run 900: 320 vs 50
 * shares, $159.92 invested vs capPerMarket=50). Everything else is v1
 * verbatim; ttlSec=90, cooldownTicks=25, maxImbalance=20 are demoted to
 * design constants so C and D fit the 6-param budget (guard 2).
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
  /** Profit-lock trigger: FOK-complete when h + ask + fee ≤ this. 0 disables. */
  completeCapTotal: z.coerce.number().finite().nonnegative().max(0.999).default(0),
  /** Doom-salvage trigger: FOK-complete when bestBid(held) ≤ this and ask+fee ≤ 0.99. 0 disables. */
  doomBid: z.coerce.number().finite().nonnegative().max(0.49).default(0),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v10',
  title: 'pair-fable v10 (v1 + taker-completion module)',
  description:
    'v1 mechanism plus one FOK taker rule on the deficit side: profit-lock completion when the pair total locks ≥ 1−C margin (held side rose), and doom salvage when the held side bid is ≤ D and completing beats holding to zero. No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type State = {
  marketId: string
  tickCount: number
  seq: number
  lastSide: 'UP' | 'DOWN' | null
  openCid: string | null
  /** True while openCid refers to an in-flight FOK completion (not a GTD rest). */
  openIsFok: boolean
  readyAtTick: number
  fokReadyAtTick: number
  windowEndMs: number | null
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constants (not tunables — must earn a param slot per guard 2). */
const START_CUTOFF_MS = 180_000
const WINDOW_MS = 15 * 60 * 1000
const TTL_SEC = 90
const COOLDOWN_TICKS = 25
const MAX_IMBALANCE = 20
/** Taker fee model matching the simulator (700 bps · p · (1−p)). */
const TAKER_FEE_RATE = 0.07

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v10'
  let state: State | null = null

  const orderGone = (clientOrderId: string | undefined): void => {
    if (!state || !clientOrderId || state.openCid !== clientOrderId) return
    state.openCid = null
    state.openIsFok = false
    state.readyAtTick = state.tickCount + COOLDOWN_TICKS
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
        openIsFok: false,
        readyAtTick: 0,
        fokReadyAtTick: 0,
        windowEndMs: windowEndFromSlug(ctx?.market?.slug),
      }
    }
    state.tickCount += 1
    if (state.windowEndMs === null) state.windowEndMs = windowEndFromSlug(ctx?.market?.slug)

    const upAssetId = ctx?.market?.upAssetId
    const downAssetId = ctx?.market?.downAssetId
    if (!upAssetId || !downAssetId) return []
    const pos = ctx?.metrics?.position
    if (!pos) return []

    const upQty = portfolio.positionsByAssetId[upAssetId]?.qty ?? 0
    const downQty = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
    const balanced = upQty === downQty
    const nowMs = tick.snapshot.timestamp || 0

    // ── Taker-completion module (E-020): checked before the maker machinery,
    // bypasses the open-order gate; FOK attempts rate-limit via their own slot.
    if (
      !balanced &&
      (cfg.completeCapTotal > 0 || cfg.doomBid > 0) &&
      state.tickCount >= state.fokReadyAtTick &&
      // One FOK in flight at a time (E-020 bug fix): a resting GTD may be
      // canceled and superseded, but an unresolved FOK must settle first —
      // its fill is not in the portfolio yet, so re-firing double-buys.
      !(state.openCid && state.openIsFok)
    ) {
      const deficit: 'UP' | 'DOWN' = upQty < downQty ? 'UP' : 'DOWN'
      const deficitAssetId = deficit === 'UP' ? upAssetId : downAssetId
      const heldAssetId = deficit === 'UP' ? downAssetId : upAssetId
      const imbalance = Math.abs(upQty - downQty)
      const held = portfolio.positionsByAssetId[heldAssetId]
      const ask = tick.snapshot.byAssetId[deficitAssetId]?.bestAsk
      const heldBid = tick.snapshot.byAssetId[heldAssetId]?.bestBid
      if (
        held &&
        held.qty > 0 &&
        imbalance > 0 &&
        ask != null &&
        Number.isFinite(ask) &&
        ask > 0 &&
        ask < 1
      ) {
        const h = held.costBasis / held.qty
        const fee = TAKER_FEE_RATE * ask * (1 - ask)
        const lockTrig = cfg.completeCapTotal > 0 && h + ask + fee <= cfg.completeCapTotal + 1e-9
        const doomTrig =
          cfg.doomBid > 0 &&
          heldBid != null &&
          Number.isFinite(heldBid) &&
          heldBid <= cfg.doomBid + 1e-9 &&
          ask + fee <= 0.99 + 1e-9
        const price = round2(ask)
        if (
          (lockTrig || doomTrig) &&
          pos.total_cost + price * imbalance <= cfg.capPerMarket
        ) {
          const intents: Intent[] = []
          if (state.openCid) {
            const open = portfolio.openOrdersByClientId[state.openCid]
            intents.push({
              kind: 'cancel_order',
              clientOrderId: state.openCid,
              ...(open?.orderId ? { orderId: open.orderId } : {}),
              reason: 'superseded_by_fok_completion',
            })
          }
          const i = state.seq
          state.seq += 1
          const clientOrderId = `pf10:${marketId}:${i}`
          state.openCid = clientOrderId
          state.openIsFok = true
          state.fokReadyAtTick = state.tickCount + COOLDOWN_TICKS
          intents.push({
            kind: 'place_limit',
            clientOrderId,
            assetId: deficitAssetId,
            side: 'BUY',
            price,
            size: imbalance,
            orderType: 'FOK',
            meta: {
              t: 'pf10',
              i,
              side: deficit,
              ot: 'FOK',
              p: price,
              s: imbalance,
              ts: nowMs,
              m: 'C',
              trig: lockTrig ? (doomTrig ? 'ab' : 'a') : 'b',
            },
            reason: lockTrig
              ? `fok_lock_${deficit.toLowerCase()}_total_${round2(h + ask + fee)}`
              : `fok_salvage_${deficit.toLowerCase()}_heldbid_${heldBid}`,
          })
          return intents
        }
      }
    }

    if (state.openCid) {
      const o = portfolio.openOrdersByClientId[state.openCid]
      if (o && TERMINAL.has(o.state)) orderGone(state.openCid)
      if (state.openCid) return []
    }
    if (state.tickCount < state.readyAtTick) return []

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

    if (myQty + size - otherQty > MAX_IMBALANCE) return []

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
    const clientOrderId = `pf10:${marketId}:${i}`
    state.openCid = clientOrderId
    state.openIsFok = false

    return [
      {
        kind: 'place_limit',
        clientOrderId,
        assetId,
        side: 'BUY',
        price,
        size,
        orderType: 'GTD',
        expireAtMs: nowMs + TTL_SEC * 1000,
        meta: { t: 'pf10', i, side, ot: 'GTD', p: price, s: size, ts: nowMs, m: balanced ? 'S' : 'R' },
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
