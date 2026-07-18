/**
 * E003-pair-accumulator — the L2 workhorse: every campaign axis is a
 * parameter on ONE file, so axis sweeps are params-only experiments and
 * all comparisons are same-code (the worst-queue maker stream cancels
 * out of rankings — INHERITANCE §3 doctrine).
 *
 * Extends the E002 baseline shape with:
 *  - RELATIVE parity tolerance: quote the leading leg only while
 *    |up−down| < max(parityTolPct% of total, 2 clips) — the floor
 *    prevents cold-start deadlock (1 clip = 100% imbalance from zero).
 *  - Completion policy (H6, the margin knob): when the lag exceeds the
 *    parity tolerance, CROSS the lagging leg's ask iff the projected
 *    pair cost INCLUDING the era-correct taker fee stays ≤ completionCap
 *    ('cap' mode), always ('free' mode), or never ('none' = maker-only).
 *  - Time modes (A17/A20 priors): uniform (start 60s) | openAvoid
 *    (start 120s) | late (start 480s); stop always 840s (minute-14 cut).
 *  - E008 fair-value gate (fvGateMode/fvGateBps): suppress NEW rung
 *    placement on the side the Binance spot has left vs the window-open
 *    strike; feed requested only when the gate is on.
 *
 * Buy-only, GTC, never merge, hold to settlement. Lab meta convention
 * with shared acc (realized-liquidity classification, per-leg docks).
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  clipShares: z.coerce.number().finite().min(5).max(100).default(6),
  // Accepts a JSON string (CLI --param) OR a plain array — the backtest
  // pipeline persists TRANSFORMED params and re-validates them on
  // --extend, so schemas must round-trip their own output (E002 lesson:
  // its string-only schema made extensions impossible; file frozen).
  rungOffsets: z
    .union([z.string(), z.array(z.number())])
    .default('[0.01,0.03]')
    .transform((v, ctx) => {
      try {
        const arr = (typeof v === 'string' ? JSON.parse(v) : v) as unknown
        if (
          !Array.isArray(arr) ||
          !arr.length ||
          arr.length > 4 ||
          !arr.every((x) => typeof x === 'number' && x > 0 && x < 0.5)
        )
          throw new Error('bad')
        return arr as number[]
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rungOffsets must be a JSON array (or array) of 1..4 numbers in (0,0.5)',
        })
        return z.NEVER
      }
    }),
  /** Leading-leg quote gate: |up−down| < max(pct% of total, 2 clips). */
  parityTolPct: z.coerce.number().finite().min(0).max(100).default(10),
  /** Completion policy: none = maker-only; cap = cross iff projected
   *  pair cost incl. era fee ≤ completionCap; free = cross whenever
   *  lag exceeds tolerance. */
  completionMode: z.enum(['none', 'cap', 'free']).default('none'),
  completionCap: z.coerce.number().finite().gt(0.5).lt(1.1).default(0.99),
  /** Cancel a completion cross that hasn't filled after this many seconds
   *  (latency can leave it resting when the ask moves before arrival;
   *  without a TTL it blocks further completions for the whole window
   *  and can fill deep in the endgame). */
  completionTtlSec: z.coerce.number().finite().min(1).max(120).default(10),
  /** Never-overpay guard for RESTING rungs (maker side). */
  pairCostCap: z.coerce.number().finite().gt(0.5).lt(1.1).default(0.99),
  soloCap: z.coerce.number().finite().gt(0).lt(1).default(0.65),
  bandLo: z.coerce.number().finite().gt(0).lt(1).default(0.11),
  bandHi: z.coerce.number().finite().gt(0).lt(1).default(0.85),
  timeMode: z.enum(['uniform', 'openAvoid', 'late']).default('uniform'),
  stopSec: z.coerce.number().finite().positive().max(895).default(840),
  requoteDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  maxSharesPerSide: z.coerce.number().finite().positive().max(1500).default(120),
  /** E008 fair-value gate: with mode 'level', place NO new rungs on the
   *  side the spot has left — DOWN when (spot−strike)/strike > +fvGateBps,
   *  UP when < −fvGateBps (strike = spot at the first tick at/after window
   *  open; fail-open while no feed value exists). 'none' keeps the default
   *  path bit-identical to pre-E008 code: the feed is not even requested. */
  fvGateMode: z.enum(['none', 'level']).default('none'),
  fvGateBps: z.coerce.number().finite().min(0).max(500).default(9),
  /** E010 own-book momentum veto: with mode 'fall', place NO new rungs
   *  on a side whose own bestAsk fell ≥ momMinDrop over the last
   *  momWindowSec (KB A44: "caught the falling ask" = the adverse fill
   *  subset; the ask is also the worst_queue fill channel — D-012).
   *  Signal is per-side tick-snapshot asks (two-sided, uncrossed books
   *  only), as-of lookup, fail-open until the buffer spans the window.
   *  'none' keeps the default path bit-identical. */
  momVetoMode: z.enum(['none', 'fall']).default('none'),
  momWindowSec: z.coerce.number().finite().min(1).max(60).default(10),
  momMinDrop: z.coerce.number().finite().min(0.005).max(0.2).default(0.01),
})
export type Config = z.infer<typeof ConfigSchema>

type Side = 'UP' | 'DOWN'
type Acc = {
  n: number
  mN: number
  tN: number
  mFee: number
  tFee: number
  tSimFee: number
  rej: number
  dockU: number
  dockD: number
  /** E008: per-side placement opportunities suppressed by the fv gate. */
  gs: number
  /** E010: placement opportunities suppressed by the momentum veto. */
  ms: number
}
type SideQuotes = { basisBid: number; clientOrderIds: string[] }

const EXP = 'E003-pair-accumulator'
const eraFee = (px: number, sz: number): number => 0.07 * px * (1 - px) * sz
const simFeeUsd = (px: number, sz: number): number => (156 / 10_000) * Math.min(px, 1 - px) * sz

const START_SEC: Record<Config['timeMode'], number> = {
  uniform: 60,
  openAvoid: 120,
  late: 480,
}

export const definition: StrategyDefinition<Config> = {
  id: 'glab.E003-pair-accumulator',
  title: 'gabagool-lab E003 pair accumulator (parameterized campaign axes)',
  description:
    'Two-sided buy-only pair accumulator: relative parity, ladder shape, fee-aware taker completion, time modes. All L2 axes on one file.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let acc: Acc = {
      n: 0,
      mN: 0,
      tN: 0,
      mFee: 0,
      tFee: 0,
      tSimFee: 0,
      rej: 0,
      dockU: 0,
      dockD: 0,
      gs: 0,
      ms: 0,
    }
    let pendingCompletion: { id: string; placedAtSec: number } | null = null
    let fvStrike: number | null = null
    const quotes: Record<Side, SideQuotes | null> = { UP: null, DOWN: null }
    const askHist: Record<Side, { ts: number; ask: number }[]> = { UP: [], DOWN: [] }
    const startSec = START_SEC[cfg.timeMode]

    const resetFor = (slug: string): void => {
      stateSlug = slug
      seq = 0
      acc = {
        n: 0,
        mN: 0,
        tN: 0,
        mFee: 0,
        tFee: 0,
        tSimFee: 0,
        rej: 0,
        dockU: 0,
        dockD: 0,
        gs: 0,
        ms: 0,
      }
      pendingCompletion = null
      fvStrike = null
      quotes.UP = null
      quotes.DOWN = null
      askHist.UP = []
      askHist.DOWN = []
    }

    const removeOrderId = (clientOrderId: string | undefined): void => {
      if (!clientOrderId) return
      if (pendingCompletion?.id === clientOrderId) pendingCompletion = null
      for (const side of ['UP', 'DOWN'] as const) {
        const q = quotes[side]
        if (!q) continue
        const idx = q.clientOrderIds.indexOf(clientOrderId)
        if (idx >= 0) q.clientOrderIds.splice(idx, 1)
        if (q.clientOrderIds.length === 0) quotes[side] = null
      }
    }

    const onMarketTick = (
      tick: MarketTick,
      portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      if (!isWarmed(ctx)) return []
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []
      if (stateSlug !== slug) resetFor(slug)

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedSec = (ts - Number(epochMatch[1]) * 1000) / 1000

      // E008 fv gate (LEDGER §E008): strike = spot at the first tick at/after
      // window open; each tick classify the adverse side (the one price has
      // left by > fvGateBps). Fail-open — no feed value means no suppression.
      // Sits BEFORE the time gate so the strike is captured as close to the
      // open as the tick stream allows.
      let fvAdverse: Side | null = null
      if (cfg.fvGateMode === 'level') {
        const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined
        const spot = feeds?.binanceWsSpotPrice?.value
        if (spot != null && Number.isFinite(spot) && elapsedSec >= 0) {
          if (fvStrike === null) fvStrike = spot
          else {
            const dBps = ((spot - fvStrike) / fvStrike) * 1e4
            if (dBps > cfg.fvGateBps) fvAdverse = 'DOWN'
            else if (dBps < -cfg.fvGateBps) fvAdverse = 'UP'
          }
        }
      }

      const intents: Intent[] = []
      const cancelSide = (side: Side, reason: string): void => {
        const q = quotes[side]
        if (!q) return
        quotes[side] = null
        for (const id of q.clientOrderIds)
          intents.push({ kind: 'cancel_order', clientOrderId: id, reason })
      }
      // Clears tracking at issue time (like cancelSide), so the
      // order_done(canceled) guard below never needs to know about it.
      const cancelCompletion = (reason: string): void => {
        if (!pendingCompletion) return
        intents.push({ kind: 'cancel_order', clientOrderId: pendingCompletion.id, reason })
        pendingCompletion = null
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      if (!up || !down) return intents
      const isCrossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk

      // E010 momentum veto (LEDGER §E010): per-side own-book bestAsk
      // history (two-sided, uncrossed books only — D-012: the ask IS the
      // worst_queue fill channel and A44's measured signal); veto NEW
      // rung placement on a side whose ask fell ≥ momMinDrop over the
      // last momWindowSec. Fail-open until the buffer spans the window.
      // Sampled BEFORE the time gate so the buffer is warm at startSec.
      const momAdverse: Record<Side, boolean> = { UP: false, DOWN: false }
      if (cfg.momVetoMode === 'fall') {
        const horizonMs = cfg.momWindowSec * 1000
        for (const side of ['UP', 'DOWN'] as const) {
          const book = side === 'UP' ? up : down
          if (book.bestBid == null || book.bestAsk == null || isCrossed(book)) continue
          const ask = book.bestAsk
          const hist = askHist[side]
          hist.push({ ts, ask })
          while (hist.length && (hist[0]?.ts ?? Infinity) < ts - horizonMs - 5000) hist.shift()
          let ref: number | null = null
          for (let i = hist.length - 1; i >= 0; i--) {
            const s = hist[i]
            if (s && s.ts <= ts - horizonMs) {
              ref = s.ask
              break
            }
          }
          if (ref != null && ref - ask >= cfg.momMinDrop - 1e-9) momAdverse[side] = true
        }
      }

      if (elapsedSec < startSec || elapsedSec > cfg.stopSec || isCrossed(up) || isCrossed(down)) {
        cancelSide('UP', 'gate closed')
        cancelSide('DOWN', 'gate closed')
        cancelCompletion('gate closed')
        return intents
      }

      // A completion cross that missed (ask moved before arrival) must not
      // rest indefinitely: it blocks further completions and becomes pure
      // endgame leg-risk. Fill-before-cancel under latency stays possible —
      // that is realistic and the accounting handles it.
      if (pendingCompletion && elapsedSec - pendingCompletion.placedAtSec > cfg.completionTtlSec)
        cancelCompletion('completion ttl')

      const posUp = portfolio.positionsByAssetId[upAssetId]
      const posDown = portfolio.positionsByAssetId[downAssetId]
      const upQty = posUp?.qty ?? 0
      const downQty = posDown?.qty ?? 0
      const upCost = posUp?.costBasis ?? 0
      const downCost = posDown?.costBasis ?? 0
      const total = upQty + downQty
      const imbalance = Math.abs(upQty - downQty)
      const parityTolShares = Math.max((cfg.parityTolPct / 100) * total, 2 * cfg.clipShares)

      // ---- resting rungs (maker side) ----
      for (const side of ['UP', 'DOWN'] as const) {
        const assetId = side === 'UP' ? upAssetId : downAssetId
        const book = side === 'UP' ? up : down
        const bid = book.bestBid
        const ask = book.bestAsk
        const myQty = side === 'UP' ? upQty : downQty
        const otherQty = side === 'UP' ? downQty : upQty
        const myCost = side === 'UP' ? upCost : downCost
        const otherCost = side === 'UP' ? downCost : upCost

        const leading = myQty > otherQty
        if (leading && imbalance >= parityTolShares) {
          cancelSide(side, 'parity suspend')
          continue
        }
        if (myQty >= cfg.maxSharesPerSide) {
          cancelSide(side, 'side cap')
          continue
        }
        if (bid == null || ask == null) {
          cancelSide(side, 'book unavailable')
          continue
        }
        const q = quotes[side]
        if (q && Math.abs(bid - q.basisBid) < cfg.requoteDelta) continue
        if (q) cancelSide(side, 'requote')
        // E008: block NEW placement on the adverse side. Standing rungs are
        // untouched (they clear via the requote/parity/gate paths above).
        if (fvAdverse === side) {
          acc.gs += 1
          continue
        }
        // E010: same contract as the fv gate — NEW placement only.
        if (momAdverse[side]) {
          acc.ms += 1
          continue
        }

        const placed: string[] = []
        for (const off of cfg.rungOffsets) {
          const px = Math.round((bid - off) * 100) / 100
          if (px < cfg.bandLo || px > cfg.bandHi || px >= ask) continue
          if (otherQty <= 0) {
            if (px > cfg.soloCap) continue
          } else {
            const newAvg = (myCost + px * cfg.clipShares) / (myQty + cfg.clipShares)
            const otherAvg = otherCost / otherQty
            if (newAvg + otherAvg > cfg.pairCostCap) continue
          }
          const clientOrderId = `e003:${slug}:${side}:${seq++}`
          placed.push(clientOrderId)
          intents.push({
            kind: 'place_limit',
            clientOrderId,
            assetId,
            side: 'BUY',
            price: px,
            size: cfg.clipShares,
            orderType: 'GTC',
            meta: {
              e: EXP,
              leg: side === 'UP' ? 'U' : 'D',
              px,
              sz: cfg.clipShares,
              k: 'r',
              t: Math.floor(elapsedSec),
              acc,
            },
            reason: 'rung',
          })
        }
        if (placed.length) quotes[side] = { basisBid: bid, clientOrderIds: placed }
      }

      // ---- taker completion of the lagging leg (H6) ----
      if (
        cfg.completionMode !== 'none' &&
        pendingCompletion === null &&
        imbalance >= parityTolShares &&
        total > 0
      ) {
        const lagging: Side = upQty < downQty ? 'UP' : 'DOWN'
        const assetId = lagging === 'UP' ? upAssetId : downAssetId
        const book = lagging === 'UP' ? up : down
        const ask = book.bestAsk
        const myQty = lagging === 'UP' ? upQty : downQty
        const myCost = lagging === 'UP' ? upCost : downCost
        const otherQty = lagging === 'UP' ? downQty : upQty
        const otherCost = lagging === 'UP' ? downCost : upCost
        if (ask != null && otherQty > 0) {
          const sz = Math.max(5, Math.min(cfg.clipShares, Math.floor(imbalance)))
          const notionalOk = ask * sz >= 1.05
          const inBand = ask >= cfg.bandLo && ask <= cfg.bandHi
          let allowed = cfg.completionMode === 'free'
          if (cfg.completionMode === 'cap') {
            const fee = eraFee(ask, sz)
            const newAvg = (myCost + ask * sz + fee) / (myQty + sz)
            const otherAvg = otherCost / otherQty
            allowed = newAvg + otherAvg <= cfg.completionCap
          }
          if (allowed && notionalOk && inBand) {
            const clientOrderId = `e003:${slug}:X${lagging}:${seq++}`
            pendingCompletion = { id: clientOrderId, placedAtSec: elapsedSec }
            intents.push({
              kind: 'place_limit',
              clientOrderId,
              assetId,
              side: 'BUY',
              price: ask,
              size: sz,
              orderType: 'GTC',
              meta: {
                e: EXP,
                leg: lagging === 'UP' ? 'U' : 'D',
                px: ask,
                sz,
                k: 'x',
                t: Math.floor(elapsedSec),
                acc,
              },
              reason: 'completion cross',
            })
          }
        }
      }
      return intents
    }

    const strategy: Strategy = {
      name: 'glab.E003-pair-accumulator',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind === 'fill') {
          const f = ev.fill
          acc.n += 1
          if (f.liquidity === 'TAKER') {
            acc.tN += 1
            acc.tFee += eraFee(f.price, f.size)
            const sim = simFeeUsd(f.price, f.size)
            acc.tSimFee += sim
            const dock = f.price > 0 ? sim / f.price : 0
            if (f.clientOrderId?.includes(':UP:') || f.clientOrderId?.includes(':XUP:'))
              acc.dockU += dock
            else acc.dockD += dock
          } else {
            acc.mN += 1
            acc.mFee += eraFee(f.price, f.size)
          }
          removeOrderId(f.clientOrderId)
        } else if (ev.kind === 'order_rejected') {
          acc.rej += 1
          acc.n += 1
          removeOrderId(ev.clientOrderId)
        } else if (ev.kind === 'order_done' && ev.reason !== 'canceled') {
          removeOrderId(ev.clientOrderId)
        }
        return []
      },
    }
    // The feed is requested ONLY when the gate is on: the default ('none')
    // path stays bit-identical to pre-E008 code — no feed wiring, no
    // aggTrades requirement — preserving refs 708/703 as a reuse basis.
    if (cfg.fvGateMode !== 'none') {
      return { strategy, plugins: [new ExternalFeedsRequestPlugin({ binanceWsSpotPrice: {} })] }
    }
    return { strategy }
  },
}
