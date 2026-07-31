/**
 * pair-fable-v15 — continuous two-sided inventory accumulation controller
 * (pair-v15 family, E-030; human rulings inbox 90d94c56 + 93482fcb).
 *
 * Unlike the v0–v12 accumulation loop (one-rest, ~1–2 increments of standing
 * inventory, binary balanced/imbalanced mode switch), v15 quotes BOTH sides
 * through most of the window and treats imbalance as a controlled state
 * variable. Spec: memory/experiments/pair-v15.md §8 (frozen before this file
 * existed). Mechanisms:
 *
 *   - BAND GUARD: side s is quoted only while a fill keeps its surplus over
 *     the other side within imbalanceBand (from T−180s: only deficit-reducing
 *     buys — no new net exposure).
 *   - GRADED LAG PRICING: within the band, join bestBid (worst-queue, $0
 *     fees); beyond it, improve toward ask−1tick proportionally to the
 *     deficit overhang — v1's repair-at-cap generalized to a continuum.
 *     Never keyed on own VWAP (E-026 constraint).
 *   - VWAP CEILING: every maker price is capped so the projected pair VWAP
 *     stays ≤ pairTarget, with any projected deficit priced
 *     completability-conservatively: band-internal shares at the opponent's
 *     bestBid (a standing lag quote fills there on oscillation), excess at
 *     the opponent's taker cost (ask + fee). Bootstrap reduces exactly to
 *     the v1/v4 start gate (bid_s + bid_o ≤ pairTarget).
 *   - CAPITAL RESERVATION: a deficit-creating buy must leave room to
 *     complete the projected deficit at current taker cost within
 *     capPerMarket.
 *   - IN-BAND LAG AGGRESSION (v15.3, §11): with lagAggr γ > 0 the lag-side
 *     maker quote improves above bestBid as soon as ANY deficit exists
 *     (knee at ι = 0): target = bid + min(1, γ·ι)·(ask − 1tick − bid).
 *     Attacks the completion premium at maker prices ($0 fee) before the
 *     winner runs away; the VWAP ceiling still caps the quote, so deep-doom
 *     chasing stays blocked. γ = 0 keeps the legacy knee at ι = 1.
 *   - TAKER COMPLETION (FOK, one in flight — E-020 guard): a lag-side
 *     deficit is FOK-completed when the projected cumulative pair VWAP
 *     ≤ P_lock (derived: pairTarget − 0.01). The v15.1 graded debt ceiling
 *     (debtCap) was removed in v15.3 — E-031/E-031b measured it as a 1:1
 *     substitute for the doom backstop (pair-v15.md §10.5).
 *   - DOOM BACKSTOP (v15.2, §10.3): in true doom markets the cumulative
 *     pair VWAP exceeds any reasonable ceiling, yet completing at unit cost
 *     ask + fee < 1 beats holding a doomed lead to zero regardless of
 *     cumulative VWAP. When the lead bid ≤ 0.20 and ask + fee ≤ doomUnitMax,
 *     the deficit is FOK-completed even where the lock rule refuses. May
 *     push the pair VWAP above $1 (ruling amendment 4).
 *
 * No sells, no merge intents; holds to settlement. Fill-mode tags (meta.m):
 * S maker rest joined at bestBid · R maker rest placed strictly above
 * bestBid (aggressive lag quote) · C completion with projected pair VWAP
 * ≤ P_lock · D doom backstop (lock rule refused, unit-cost bound admitted).
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

export const ConfigSchema = z
  .strictObject({
    /** Per-market capital cap in $ (binding evaluator convention — sweep knob). */
    capPerMarket: z.coerce.number().finite().positive().max(2000).default(500),
    /** Target settled pair VWAP; every maker price is ceiling-capped to project ≤ this. */
    pairTarget: z.coerce.number().finite().min(0.9).max(0.99).default(0.96),
    /** Shares of tolerated unmatched inventory (the band; hard trending halt). */
    imbalanceBand: z.coerce.number().finite().min(1).max(800).default(40),
    /** Shares per resting bid (M5-bounded: sim fills entire size on cross; max 400 ≈ the E-028b measured ToB depth ceiling 300–450 — beyond it whole-size fills stop being a defensible approximation). */
    orderSize: z.coerce.number().finite().positive().max(400).default(25),
    /** Doom backstop (v15.2): when lead bid ≤ 0.20 and ask+fee ≤ this, FOK-complete regardless of cumulative pair VWAP. 0 disables. */
    doomUnitMax: z.coerce
      .number()
      .finite()
      .refine((v) => v === 0 || (v >= 0.5 && v <= 0.995), 'doomUnitMax must be 0 or in [0.5, 0.995]')
      .default(0),
    /** In-band lag-side maker aggression (v15.3): fraction of the bid→(ask−1tick) gap quoted per unit normalized deficit, knee at ι = 0. 0 = legacy knee at ι = 1. */
    lagAggr: z.coerce.number().finite().min(0).max(1).default(0),
    /** Post-terminal (fill/cancel/expiry) per-side requote cooldown in ticks (v15.4, §15 — promoted from a design constant; FOK cooldown stays fixed). */
    cooldownTicks: z.coerce.number().int().min(0).max(25).default(5),
    /** GTD rest TTL in seconds (v15.4, §15 — promoted from a design constant). Floor 61: OrderManager rejects GTD expiry < now+60s (§15.3). */
    ttlSec: z.coerce.number().finite().min(61).max(300).default(90),
  })
  .refine((c) => c.orderSize <= c.imbalanceBand, {
    message: 'orderSize must be ≤ imbalanceBand (a single fill may not breach the band)',
  })

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v15',
  title: 'pair-fable v15 (continuous two-sided inventory controller)',
  description:
    'Quotes both sides continuously with an imbalance band, in-band graded lag-side maker aggression (lagAggr: quote improves above bestBid proportionally to the deficit, knee at zero), a cumulative pair-VWAP ceiling with completability-conservative deficit pricing, capital reservation, FOK taker completion at projected pair VWAP ≤ P_lock (pairTarget−0.01), and an optional doom backstop completing at unit cost ≤ doomUnitMax when the lead bid ≤ 0.20 (may complete above $1). No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

type SideName = 'UP' | 'DOWN'

type OpenRest = { cid: string; kind: 'S' | 'R'; price: number }

type State = {
  marketId: string
  tickCount: number
  seq: number
  open: Record<SideName, OpenRest | null>
  readyAtTick: Record<SideName, number>
  /** cids we have emitted a cancel for and are waiting to see terminal. */
  cancelling: Set<string>
  /** In-flight FOK cid (one at a time — E-020 guard). */
  fokCid: string | null
  fokReadyAtTick: number
  windowEndMs: number | null
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constants (pair-v15.md §8.1 — not tunables, guard 2; ttl/cooldown promoted to params in v15.4, §15). */
const FOK_COOLDOWN_TICKS = 25
const LEAD_STOP_MS = 180_000
const CANCEL_ALL_MS = 60_000
/** Doom proxy for the v15.2 backstop (§10.3): lead bid at/below this = doomed. */
const DOOM_BID = 0.2
const WINDOW_MS = 15 * 60 * 1000
/** Taker fee model matching the simulator (700 bps · p · (1−p)). */
const TAKER_FEE_RATE = 0.07
const SIDES: SideName[] = ['UP', 'DOWN']

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
const roundToGrid = (p: number): number => Math.round(p / GRID) * GRID
const round2 = (p: number): number => Math.round(p * 100) / 100
const fee = (p: number): number => TAKER_FEE_RATE * p * (1 - p)

/** btc-updown-15m-<epochSeconds> → window end in ms; null if unparsable. */
const windowEndFromSlug = (slug: string | undefined): number | null => {
  const m = slug ? /-(\d{9,11})$/.exec(slug) : null
  return m ? Number(m[1]) * 1000 + WINDOW_MS : null
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'pair-fable-v15'
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
    if (state.fokCid === clientOrderId) state.fokCid = null
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
        fokCid: null,
        fokReadyAtTick: 0,
        windowEndMs: windowEndFromSlug(ctx?.market?.slug),
      }
    }
    state.tickCount += 1
    if (state.windowEndMs === null) state.windowEndMs = windowEndFromSlug(ctx?.market?.slug)

    // Reconcile terminal orders seen via the portfolio.
    for (const side of SIDES) {
      const o = state.open[side]
      if (!o) continue
      const po = portfolio.openOrdersByClientId[o.cid]
      if (po && TERMINAL.has(po.state)) orderGone(o.cid)
    }
    if (state.fokCid) {
      const po = portfolio.openOrdersByClientId[state.fokCid]
      if (po && TERMINAL.has(po.state)) state.fokCid = null
    }

    const upAssetId = ctx?.market?.upAssetId
    const downAssetId = ctx?.market?.downAssetId
    if (!upAssetId || !downAssetId) return []
    const pos = ctx?.metrics?.position
    if (!pos) return []

    const assetIdOf = (side: SideName): string => (side === 'UP' ? upAssetId : downAssetId)
    const qty: Record<SideName, number> = {
      UP: portfolio.positionsByAssetId[upAssetId]?.qty ?? 0,
      DOWN: portfolio.positionsByAssetId[downAssetId]?.qty ?? 0,
    }
    const cost: Record<SideName, number> = {
      UP: portfolio.positionsByAssetId[upAssetId]?.costBasis ?? 0,
      DOWN: portfolio.positionsByAssetId[downAssetId]?.costBasis ?? 0,
    }
    const nowMs = tick.snapshot.timestamp || 0
    const endMs = state.windowEndMs
    const leadStop = endMs !== null && nowMs > endMs - LEAD_STOP_MS
    const makerStop = endMs !== null && nowMs > endMs - CANCEL_ALL_MS

    const book: Record<SideName, { bid: number; ask: number; askSize: number } | null> = {
      UP: null,
      DOWN: null,
    }
    for (const side of SIDES) {
      const b = tick.snapshot.byAssetId[assetIdOf(side)]
      const bid = b?.bestBid
      const ask = b?.bestAsk
      if (bid == null || !Number.isFinite(bid) || bid <= 0) continue
      if (ask == null || !Number.isFinite(ask) || ask <= 0 || ask >= 1) continue
      const askLevel = b?.asks?.[0]
      const askSize =
        askLevel && Math.abs(askLevel.price - ask) < 1e-9 && Number.isFinite(askLevel.size)
          ? askLevel.size
          : 0
      book[side] = { bid, ask, askSize }
    }

    // Pending notional of live resting orders (cap discipline covers them).
    let pendingCost = 0
    for (const cid of [state.open.UP?.cid, state.open.DOWN?.cid, state.fokCid]) {
      if (!cid) continue
      const po = portfolio.openOrdersByClientId[cid]
      if (po && !TERMINAL.has(po.state)) pendingCost += po.price * po.remaining
    }

    const q = cfg.orderSize
    const Ib = cfg.imbalanceBand

    // ── Taker completion (§11.1 lock rule + §10.3 backstop): one FOK in flight.
    const pLock = cfg.pairTarget - 0.01
    if (!state.fokCid && state.tickCount >= state.fokReadyAtTick) {
      for (const side of SIDES) {
        const o = side === 'UP' ? 'DOWN' : 'UP'
        const deficit = qty[o] - qty[side]
        const bk = book[side]
        const leadBk = book[o]
        if (deficit <= 0 || !bk || bk.askSize <= 0) continue
        const x = Math.min(deficit, bk.askSize)
        if (x < 1) continue
        const a = bk.ask
        const unitCost = a + fee(a)
        // Projected cumulative settled pair VWAP after the completion.
        const projSelf = (cost[side] + x * unitCost) / (qty[side] + x)
        const projPair = qty[o] > 0 ? projSelf + cost[o] / qty[o] : Number.POSITIVE_INFINITY
        const lockTrig = projPair <= pLock + 1e-9
        // Doom backstop: completing at ask+fee < 1 beats holding a doomed lead
        // to zero regardless of cumulative pair VWAP.
        const doomTrig =
          cfg.doomUnitMax > 0 &&
          leadBk !== null &&
          leadBk.bid <= DOOM_BID + 1e-9 &&
          unitCost <= cfg.doomUnitMax + 1e-9
        if (!lockTrig && !doomTrig) continue
        const mode = lockTrig ? 'C' : 'D'
        const price = round2(a)
        if (pos.total_cost + pendingCost + price * x > cfg.capPerMarket) continue

        const intents: Intent[] = []
        const rest = state.open[side]
        if (rest && !state.cancelling.has(rest.cid)) {
          state.cancelling.add(rest.cid)
          const orderId = portfolio.openOrdersByClientId[rest.cid]?.orderId
          intents.push({
            kind: 'cancel_order',
            clientOrderId: rest.cid,
            ...(orderId !== undefined ? { orderId } : {}),
            reason: 'superseded_by_fok_completion',
          })
        }
        const i = state.seq
        state.seq += 1
        const clientOrderId = `pf15:${marketId}:${i}`
        state.fokCid = clientOrderId
        state.fokReadyAtTick = state.tickCount + FOK_COOLDOWN_TICKS
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId: assetIdOf(side),
          side: 'BUY',
          price,
          size: x,
          orderType: 'FOK',
          meta: {
            t: 'pf15',
            i,
            side,
            ot: 'FOK',
            p: price,
            s: x,
            ts: nowMs,
            m: mode,
          },
          reason:
            mode === 'C'
              ? `fok_lock_${side.toLowerCase()}_projpair_${round2(projPair)}`
              : `fok_doom_${side.toLowerCase()}_unitcost_${round2(unitCost)}_leadbid_${leadBk ? leadBk.bid : 'na'}`,
        })
        return intents
      }
    }

    // ── End of window: cancel all resting from T−60s (FOK rules stay live).
    if (makerStop) {
      const cancels: Intent[] = []
      for (const side of SIDES) {
        const o = state.open[side]
        if (o && !state.cancelling.has(o.cid)) {
          state.cancelling.add(o.cid)
          const orderId = portfolio.openOrdersByClientId[o.cid]?.orderId
          cancels.push({
            kind: 'cancel_order',
            clientOrderId: o.cid,
            ...(orderId !== undefined ? { orderId } : {}),
            reason: 'end_of_window_cancel',
          })
        }
      }
      return cancels
    }

    // ── Maker quoting (§8.3): per-side target, requote on ≥1-tick move.
    const intents: Intent[] = []
    let budget = cfg.capPerMarket - pos.total_cost - pendingCost
    for (const side of SIDES) {
      const o = side === 'UP' ? 'DOWN' : 'UP'
      const bk = book[side]
      const obk = book[o]

      // 1. Band guard (+ no new net exposure from T−180s).
      const surplusAfter = qty[side] + q - qty[o]
      const quotable =
        bk !== null && obk !== null && surplusAfter <= (leadStop ? 0 : Ib) + 1e-9

      let target: number | null = null
      if (quotable && bk && obk) {
        // 2. Graded lag pricing (§11.1): lagAggr > 0 ⇒ knee at ι = 0 (improve
        // above bid on ANY deficit); lagAggr = 0 ⇒ legacy knee at ι = 1.
        const deficit = Math.max(0, qty[o] - qty[side])
        const iota = deficit / Ib
        const f =
          cfg.lagAggr > 0
            ? Math.min(1, cfg.lagAggr * iota)
            : Math.min(Math.max(iota - 1, 0), 1)
        // Round-to-nearest-grid (§11.3): a sub-tick graded improvement must
        // not be floored away; the ceiling below keeps floor semantics.
        target = roundToGrid(bk.bid + f * Math.max(0, bk.ask - GRID - bk.bid))
        // 3. VWAP ceiling with completability-conservative deficit pricing.
        const Qs2 = qty[side] + q
        const D = Math.max(0, Qs2 - qty[o])
        const Dband = Math.min(D, Ib)
        const Dexc = D - Dband
        const vOProj =
          D > 0
            ? (cost[o] + Dband * obk.bid + Dexc * (obk.ask + fee(obk.ask))) / Qs2
            : cost[o] / qty[o]
        const pHat = ((cfg.pairTarget - vOProj) * Qs2 - cost[side]) / q
        if (!Number.isFinite(pHat)) target = null
        else {
          // 4. Maker discipline: on-grid, strictly below the ask.
          let price = floorToGrid(Math.min(target, pHat))
          if (price >= bk.ask) price = round2(bk.ask - GRID)
          target = price >= GRID - 1e-9 ? round2(price) : null
        }
      }

      const rest = state.open[side]
      if (rest) {
        // 6. Requote: cancel when the target moved ≥1 tick or side unquotable.
        const stale = target === null || Math.abs(rest.price - target) >= GRID - 1e-9
        if (stale && !state.cancelling.has(rest.cid)) {
          state.cancelling.add(rest.cid)
          const orderId = portfolio.openOrdersByClientId[rest.cid]?.orderId
          intents.push({
            kind: 'cancel_order',
            clientOrderId: rest.cid,
            ...(orderId !== undefined ? { orderId } : {}),
            reason: target === null ? 'side_unquotable' : 'requote_target_moved',
          })
        }
        continue
      }
      if (target === null || !bk || !obk) continue
      if (state.tickCount < state.readyAtTick[side]) continue

      // 5. Capital + reservation (deficit completion priced at current taker).
      const reserve =
        surplusAfter > 0 ? surplusAfter * (obk.ask + fee(obk.ask)) : 0
      if (target * q + reserve > budget) continue
      budget -= target * q

      // Tag by final price (§11.1): R = placed strictly above bestBid.
      const mode: 'S' | 'R' = target > bk.bid + 1e-9 ? 'R' : 'S'
      const i = state.seq
      state.seq += 1
      const clientOrderId = `pf15:${marketId}:${i}`
      state.open[side] = { cid: clientOrderId, kind: mode, price: target }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: assetIdOf(side),
        side: 'BUY',
        price: target,
        size: q,
        orderType: 'GTD',
        expireAtMs: nowMs + cfg.ttlSec * 1000,
        meta: { t: 'pf15', i, side, ot: 'GTD', p: target, s: q, ts: nowMs, m: mode },
        reason: `${mode === 'S' ? 'accumulate' : 'repair'}_${side.toLowerCase()}_band_${Ib}_target_${cfg.pairTarget}`,
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
