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
 *   - TAKER RULES (FOK, one in flight — E-020 guard): C pair-lock completes
 *     a deficit when the projected cumulative pair VWAP ≤ lockTarget (the
 *     cross-subsidy lever; deliberately NOT v10's per-pair trigger); V doom
 *     salvage completes when the lead side looks doomed (bid ≤ 0.20) and
 *     ask+fee ≤ salvageMax — may push the pair VWAP above $1 (ruling
 *     amendment 4: beats holding a doomed lead to zero).
 *
 * No sells, no merge intents; holds to settlement. Fill-mode tags (meta.m):
 * S band accumulation · R graded repair (placed beyond band) · C pair-lock
 * FOK · V salvage FOK.
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
    imbalanceBand: z.coerce.number().finite().min(1).max(200).default(40),
    /** Shares per resting bid (M5-bounded: sim fills entire size on cross). */
    orderSize: z.coerce.number().finite().positive().max(100).default(25),
    /** C-rule: FOK-complete a deficit when projected pair VWAP ≤ this. 0 disables. */
    lockTarget: z.coerce
      .number()
      .finite()
      .refine((v) => v === 0 || (v >= 0.5 && v <= 0.99), 'lockTarget must be 0 or in [0.5, 0.99]')
      .default(0.95),
    /** V-rule: doom-salvage FOK when lead bid ≤ 0.20 and ask+fee ≤ this (may push pair VWAP above $1). 0 disables. */
    salvageMax: z.coerce.number().finite().min(0).max(0.995).default(0),
  })
  .refine((c) => c.orderSize <= c.imbalanceBand, {
    message: 'orderSize must be ≤ imbalanceBand (a single fill may not breach the band)',
  })

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v15',
  title: 'pair-fable v15 (continuous two-sided inventory controller)',
  description:
    'Quotes both sides continuously with an imbalance band, graded lag-side pricing, a cumulative pair-VWAP ceiling with completability-conservative deficit pricing, capital reservation, and FOK taker completion (pair-lock + optional above-$1 doom salvage). No sells, no merges; holds to settlement.',
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
/** Design constants (pair-v15.md §8.1 — not tunables, guard 2). */
const TTL_SEC = 90
const COOLDOWN_TICKS = 5
const FOK_COOLDOWN_TICKS = 25
const LEAD_STOP_MS = 180_000
const CANCEL_ALL_MS = 60_000
const DOOM_BID = 0.2
const WINDOW_MS = 15 * 60 * 1000
/** Taker fee model matching the simulator (700 bps · p · (1−p)). */
const TAKER_FEE_RATE = 0.07
const SIDES: SideName[] = ['UP', 'DOWN']

const floorToGrid = (p: number): number => Math.floor(p / GRID + 1e-9) * GRID
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
        state.readyAtTick[side] = state.tickCount + COOLDOWN_TICKS
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

    // ── Taker rules (§8.4): one FOK in flight, tick cooldown, run to T.
    if (
      !state.fokCid &&
      state.tickCount >= state.fokReadyAtTick &&
      (cfg.lockTarget > 0 || cfg.salvageMax > 0)
    ) {
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
        // C — pair lock: projected cumulative pair VWAP ≤ lockTarget.
        const projSelf = (cost[side] + x * unitCost) / (qty[side] + x)
        const projPair = qty[o] > 0 ? projSelf + cost[o] / qty[o] : Number.POSITIVE_INFINITY
        const lockTrig = cfg.lockTarget > 0 && projPair <= cfg.lockTarget + 1e-9
        // V — doom salvage: lead side looks doomed, completing beats holding to zero.
        const doomTrig =
          cfg.salvageMax > 0 &&
          leadBk !== null &&
          leadBk.bid <= DOOM_BID + 1e-9 &&
          unitCost <= cfg.salvageMax + 1e-9
        if (!lockTrig && !doomTrig) continue
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
            m: lockTrig ? 'C' : 'V',
          },
          reason: lockTrig
            ? `fok_lock_${side.toLowerCase()}_projpair_${round2(projPair)}`
            : `fok_salvage_${side.toLowerCase()}_leadbid_${leadBk ? leadBk.bid : 'na'}`,
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
      let mode: 'S' | 'R' = 'S'
      if (quotable && bk && obk) {
        // 2. Graded pricing by deficit overhang.
        const deficit = Math.max(0, qty[o] - qty[side])
        const iota = deficit / Ib
        if (iota <= 1) {
          target = bk.bid
        } else {
          mode = 'R'
          target = bk.bid + Math.min(iota - 1, 1) * (bk.ask - GRID - bk.bid)
        }
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
        expireAtMs: nowMs + TTL_SEC * 1000,
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
