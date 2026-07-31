/**
 * pair-fable-v17m — DIRECTIONAL controller, signal (b), MAKER-ONLY tilt
 * acquisition (E-044; pair-v17m.md — frozen before this file).
 *
 * Delta over pair.v17.ts — ONE substitution + one schema drop:
 *
 *   - FOK completion deficit: tiltDef = min(T[side], 0) instead of the
 *     tiltUnitMax-gated T[side]. The taker path (C-lock and doom FOKs)
 *     never BUYS the tilt component — the leader is never chased at the
 *     ask — but held tilt is still RESPECTED (negative T on the laggard
 *     keeps completion from pairing the tilt away), and doom salvage of
 *     a collapsing tilt still fires (on a leader flip the ex-laggard's
 *     tiltDef becomes 0, so doom completes the full raw imbalance).
 *   - tiltUnitMax removed from the schema (it only gated the positive
 *     tilt component of FOKs, which no longer exists; E-041 CEIL-NULL).
 *
 * The maker band guard on the signed error is the ONLY tilt-acquisition
 * path: the leader side may maker-accumulate up to T + Ib while the
 * laggard stops at −T + Ib. Everything else — leader signal, graded lag
 * pricing, VWAP ceiling + RAW reservation, grid, cooldowns, TTL, doom,
 * end-of-window cancels, fill tags S/R/C/D, feeds — is byte-identical to
 * pair.v17.ts. tiltShares = 0 is behavior-identical to v17 τ0 (= v15.4
 * neutral). No sells, no merges; holds to settlement.
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
import type { ExternalFeedsSnapshot } from '../../../src/trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import * as z from 'zod'

export const ConfigSchema = z
  .strictObject({
    /** Per-market capital cap in $ (binding evaluator convention — sweep knob). */
    capPerMarket: z.coerce.number().finite().positive().max(2000).default(500),
    /** Target settled pair VWAP; every maker price is ceiling-capped to project ≤ this. */
    pairTarget: z.coerce.number().finite().min(0.9).max(0.99).default(0.96),
    /** Shares of tolerated unmatched inventory beyond the target (the band; hard trending halt). */
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
    /** Post-terminal (fill/cancel/expiry) per-side requote cooldown in ticks (v15.4, §15; FOK cooldown stays fixed). */
    cooldownTicks: z.coerce.number().int().min(0).max(25).default(5),
    /** GTD rest TTL in seconds (v15.4, §15). Floor 61: OrderManager rejects GTD expiry < now+60s. */
    ttlSec: z.coerce.number().finite().min(61).max(300).default(90),
    /** Signed inventory target in shares (v16, E-038): + = surplus on the feed-implied leader, − = on the laggard, 0 = neutral (exact v15.4). */
    tiltShares: z.coerce.number().finite().min(-800).max(800).default(0),
    /** v17 (E-042): min |spot − priceToBeat| in basis points of priceToBeat to declare a leader; inside the dead zone (or feeds absent) ⇒ neutral this tick. 0 = pure sign. */
    spotLeadBps: z.coerce.number().finite().min(0).max(200).default(10),
    /** v16.1 (E-039): the same side must lead for this many consecutive ticks before T ≠ 0; flips/no-leader reset the streak. 0 = off. */
    leadPersistTicks: z.coerce.number().int().min(0).max(20000).default(0),
  })
  .refine((c) => c.orderSize <= c.imbalanceBand, {
    message: 'orderSize must be ≤ imbalanceBand (a single fill may not breach the band)',
  })
  .refine((c) => Math.abs(c.tiltShares) <= c.imbalanceBand, {
    message: '|tiltShares| must be ≤ imbalanceBand (the target must be reachable inside the band)',
  })

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-fable-v17m',
  title: 'pair-fable v17m (directional controller, maker-only tilt acquisition)',
  description:
    'The v17 spot-vs-priceToBeat directional controller with maker-only tilt acquisition: the taker path (C-lock and doom FOKs) never buys the tilt component — tiltDef = min(T, 0) — so the tilt is accumulated exclusively through resting maker quotes under the signed band guard, while held tilt is respected by completions and doom salvage of a collapsing tilt still fires. tiltUnitMax is removed. tiltShares=0 is exactly v17 τ0 (= v15.4 neutral). No sells, no merges; holds to settlement.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
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
  /** v17: current feed-implied leader and its consecutive-tick streak. */
  leadSide: SideName | null
  leadStreak: number
}

const GRID = 0.01
const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired', 'killed'])
/** Design constants (pair-v15.md §8.1 — not tunables, guard 2). */
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

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: ExternalFeedsRequestPlugin[]
} {
  const name = 'pair-fable-v17m'
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
        leadSide: null,
        leadStreak: 0,
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

    // ── v17: signed per-side inventory target from the SPOT-vs-STRIKE leader.
    // leader = UP when spot − priceToBeat ≥ spotLeadBps bps of the strike,
    // DOWN when ≤ −that; dead zone or absent feeds ⇒ no leader (neutral).
    const T: Record<SideName, number> = { UP: 0, DOWN: 0 }
    const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined
    const spot = feeds?.binanceWsSpotPrice?.value
    const strike = feeds?.polymarketPriceToBeat?.openPrice
    if (
      spot !== undefined &&
      Number.isFinite(spot) &&
      strike !== undefined &&
      Number.isFinite(strike) &&
      strike > 0
    ) {
      const thresh = strike * cfg.spotLeadBps * 1e-4
      const diff = spot - strike
      const lead: SideName | null = diff >= thresh ? 'UP' : diff <= -thresh ? 'DOWN' : null
      // Consecutive-tick leader streak; flips and no-leader ticks reset.
      if (lead !== null && lead === state.leadSide) state.leadStreak += 1
      else {
        state.leadSide = lead
        state.leadStreak = lead === null ? 0 : 1
      }
      if (cfg.tiltShares !== 0 && lead !== null && state.leadStreak > cfg.leadPersistTicks) {
        T[lead] = cfg.tiltShares
        T[lead === 'UP' ? 'DOWN' : 'UP'] = -cfg.tiltShares
      }
    } else {
      state.leadSide = null
      state.leadStreak = 0
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
    // v16: completion amount is toward the TARGET, not raw match.
    const pLock = cfg.pairTarget - 0.01
    if (!state.fokCid && state.tickCount >= state.fokReadyAtTick) {
      for (const side of SIDES) {
        const o = side === 'UP' ? 'DOWN' : 'UP'
        const bk = book[side]
        const leadBk = book[o]
        if (!bk || bk.askSize <= 0) continue
        const a = bk.ask
        const unitCost = a + fee(a)
        // v17m (E-044): the taker path never BUYS the tilt component — only
        // the laggard-side negative target survives, so completion respects
        // held tilt without ever chasing the leader at the ask.
        const tiltDef = Math.min(T[side], 0)
        const deficit = qty[o] - qty[side] + tiltDef
        if (deficit <= 0) continue
        const x = Math.min(deficit, bk.askSize)
        if (x < 1) continue
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
        const clientOrderId = `pf17m:${marketId}:${i}`
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
            t: 'pf17m',
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

      // 1. Band guard on the signed error vs target (+ only error-reducing
      // buys from T−180s — the tilt is HELD through the end).
      const surplusAfter = qty[side] + q - qty[o]
      const errAfter = surplusAfter - T[side]
      const quotable =
        bk !== null && obk !== null && errAfter <= (leadStop ? 0 : Ib) + 1e-9

      let target: number | null = null
      if (quotable && bk && obk) {
        // 2. Graded lag pricing (§11.1) on the target-relative deficit.
        const deficit = Math.max(0, qty[o] - qty[side] + T[side])
        const iota = deficit / Ib
        const f =
          cfg.lagAggr > 0
            ? Math.min(1, cfg.lagAggr * iota)
            : Math.min(Math.max(iota - 1, 0), 1)
        // Round-to-nearest-grid (§11.3): a sub-tick graded improvement must
        // not be floored away; the ceiling below keeps floor semantics.
        target = roundToGrid(bk.bid + f * Math.max(0, bk.ask - GRID - bk.bid))
        // 3. VWAP ceiling with completability-conservative deficit pricing —
        // RAW quantities by design (pair-v16.md §1 deviation 1).
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

      // 5. Capital + reservation — RAW surplus by design (pair-v16.md §1
      // deviation 2): completion capital reserved even for shares the
      // target says will ride unpaired.
      const reserve =
        surplusAfter > 0 ? surplusAfter * (obk.ask + fee(obk.ask)) : 0
      if (target * q + reserve > budget) continue
      budget -= target * q

      // Tag by final price (§11.1): R = placed strictly above bestBid.
      const mode: 'S' | 'R' = target > bk.bid + 1e-9 ? 'R' : 'S'
      const i = state.seq
      state.seq += 1
      const clientOrderId = `pf17m:${marketId}:${i}`
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
        meta: { t: 'pf17m', i, side, ot: 'GTD', p: target, s: q, ts: nowMs, m: mode },
        reason: `${mode === 'S' ? 'accumulate' : 'repair'}_${side.toLowerCase()}_band_${Ib}_target_${cfg.pairTarget}`,
      })
    }
    return intents
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind === 'order_rejected' || ev.kind === 'order_done') orderGone(ev.clientOrderId)
    return []
  }

  const strategy: Strategy = { name, onMarketTick, onAccountEvent }
  return {
    strategy,
    plugins: [
      new ExternalFeedsRequestPlugin({
        binanceWsSpotPrice: {}, // pair follows the market slug in backtests
        polymarketPriceToBeat: { enabled: true },
      }),
    ],
  }
}
