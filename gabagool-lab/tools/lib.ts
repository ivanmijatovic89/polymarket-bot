/**
 * gabagool-lab shared tool library.
 *
 * Fee math, window constants, per-market correction/validation, and DB
 * loading for the lab's readout tools. Everything here implements
 * EVALUATION.md §1–§4 1:1 — change that file first, then this one.
 *
 * Lab intent_meta convention (every lab strategy writes this per order):
 *   { e: 'E###-slug', leg: 'U'|'D', px: number, sz: number,
 *     k: 'r'|'x',           // 'r' = resting maker rung, 'x' = taker cross
 *     t: number,            // elapsed sec at placement
 *     acc?: { n, mFee, tFee, tSimFee, rej, dockU, dockD } }
 * Only FILLED orders' metas persist (marketStats dedups by clientOrderId),
 * so metas ARE the per-fill record: maker fills execute at their own px/sz
 * (all-or-nothing, verified). `acc` is ONE shared object per market,
 * mutated by the strategy on every fill — E001 proved it survives to the
 * DB by REFERENCE (every entry shows final totals), so when present it
 * carries EXACT realized economics (actual taker fill prices, per-leg
 * docked shares). computeMarketEcon prefers acc (highest n) and falls
 * back to static meta reconstruction; both are validated against the
 * sim's fees_paid (drift → quarantine).
 */
import { and, asc, eq, inArray, like } from 'drizzle-orm'
import {
  getDb,
  closeDb,
  backtestRuns,
  backtestRunMarkets,
  backtestRunSegments,
} from '../../src/db/index.js'

// ---------------------------------------------------------------- constants

/** EVALUATION §1 window boundaries (UTC, ms). --to-ms is INCLUSIVE (lte). */
export const WINDOWS = {
  searchFromMs: Date.UTC(2026, 3, 1), // 2026-04-01T00:00Z
  searchToMs: Date.UTC(2026, 5, 1) - 1, // 2026-05-31T23:59:59.999Z
  holdoutFromMs: Date.UTC(2026, 5, 1), // 2026-06-01T00:00Z
  holdoutToMs: Date.UTC(2026, 5, 14, 9, 30), // telonex coverage end
  transitionFromMs: Date.UTC(2026, 2, 6), // 2026-03-06
  transitionToMs: Date.UTC(2026, 3, 1) - 1,
} as const

export const SIM_TAKER_FEE_BPS = 156 // engine default, kept native
export const ERA_FEE_RATE = 0.07 // current-era taker fee: 0.07·p(1−p)/share
export const REBATE_SHARE = 0.2 // 20% of fee-equivalent, A22
export const REBATE_MIN_PER_MARKET = 1.0 // $1/market/day venue threshold

// ---------------------------------------------------------------- fee math

/** Sim's taker fee in $ for a fill (replicates src/trading/fees.ts). */
export function simFeeUsd(px: number, shares: number, bps = SIM_TAKER_FEE_BPS): number {
  if (!(px > 0) || !(shares > 0)) return 0
  const edge = Math.min(px, 1 - px)
  if (edge <= 0) return 0
  return (bps / 10_000) * edge * shares
}

/** Shares docked by the sim on a taker BUY (feeBase in fees.ts). */
export function simFeeShares(px: number, shares: number, bps = SIM_TAKER_FEE_BPS): number {
  if (!(px > 0)) return 0
  return simFeeUsd(px, shares, bps) / px
}

/** Era-correct (current) taker fee in $ per fill: 0.07·p(1−p)·shares. */
export function eraFeeUsd(px: number, shares: number): number {
  if (!(px > 0) || !(shares > 0) || px >= 1) return 0
  return ERA_FEE_RATE * px * (1 - px) * shares
}

/** ISO week key (UTC), e.g. "2026-W18". */
export function isoWeek(ms: number): string {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

// ------------------------------------------------------------- meta parsing

export type LabOrderMeta = {
  e?: string
  leg?: 'U' | 'D'
  px?: number
  sz?: number
  k?: 'r' | 'x'
  t?: number
  acc?: {
    n?: number
    mN?: number
    tN?: number
    mFee?: number
    tFee?: number
    tSimFee?: number
    rej?: number
    dockU?: number
    dockD?: number
  }
}

export type MarketRow = {
  slug: string
  marketStartMs: number
  finalOutcome: 'UP' | 'DOWN' | null
  skipReason: string | null
  pnl: number
  tradeCount: number
  tradeAsMaker: number
  tradeAsTaker: number
  feesPaid: number
  upShares: number
  downShares: number
  mergableShares: number
  cost: number
  splitCost: number
  metas: LabOrderMeta[]
}

/** Per-market corrected economics (EVALUATION §3). */
export type MarketEcon = {
  slug: string
  weekKey: string
  pnlSim: number
  pnlCorr: number // era-fee-corrected trading pnl
  rebate: number // REB line, threshold applied
  rebateRaw: number // pre-threshold (scale diagnostic only, never in EL)
  el: number // pnlCorr + rebate
  makerFeeEquiv: number // Σ era fee-equiv over maker fills (pre-rebate)
  takerFeeEra: number
  takerFeeSimRecon: number // reconstructed sim fee $ (validation)
  makerFills: number
  takerFills: number
  imbalance: number // |up−down| / max(up+down, eps) at settlement
  pairRate: number // 2·min/ (up+down)
  outlay: number // cost column (buy-only: total spent)
  settleCheckOk: boolean // recomputed settlement == stored pnl
  settleCheckDiff: number
}

/**
 * Recompute settlement from raw components: pairs at $1 + winner remainder
 * − remaining cost basis − splitCost (marketStats.ts:141-169 arithmetic).
 */
export function settlementPnl(
  up: number,
  down: number,
  cost: number,
  splitCost: number,
  outcome: 'UP' | 'DOWN',
): number {
  const pairs = Math.min(up, down)
  const remUp = up - pairs
  const remDown = down - pairs
  const redeem = outcome === 'UP' ? remUp : remDown
  return pairs + redeem - cost - splitCost
}

/** Compute corrected per-market economics from a DB row (EVALUATION §3). */
export function computeMarketEcon(m: MarketRow): MarketEcon {
  const outcome = m.finalOutcome ?? 'UP'
  let makerFeeEquiv = 0
  let takerFeeEra = 0
  let takerFeeSimRecon = 0
  let dockedUp = 0
  let dockedDown = 0
  let makerFills = 0
  let takerFills = 0

  for (const meta of m.metas) {
    const px = Number(meta.px)
    const sz = Number(meta.sz)
    if (!(px > 0) || !(sz > 0)) continue
    if (meta.k === 'r') {
      makerFills += 1
      makerFeeEquiv += eraFeeUsd(px, sz)
    } else if (meta.k === 'x') {
      takerFills += 1
      takerFeeEra += eraFeeUsd(px, sz)
      takerFeeSimRecon += simFeeUsd(px, sz)
      const docked = simFeeShares(px, sz)
      if (meta.leg === 'U') dockedUp += docked
      else if (meta.leg === 'D') dockedDown += docked
    }
  }

  // Prefer the shared accumulator when present (exact realized economics;
  // proven reference-persistent by E001). Take the entry with highest n.
  let best: NonNullable<LabOrderMeta['acc']> | null = null
  for (const meta of m.metas) {
    const a = meta.acc
    if (a && typeof a.n === 'number' && (best === null || a.n > (best.n ?? 0))) best = a
  }
  if (best && typeof best.mFee === 'number') {
    makerFeeEquiv = best.mFee
    takerFeeEra = best.tFee ?? takerFeeEra
    takerFeeSimRecon = best.tSimFee ?? takerFeeSimRecon
    if (typeof best.dockU === 'number') dockedUp = best.dockU
    if (typeof best.dockD === 'number') dockedDown = best.dockD
    // Realized fill classification (rungs can convert to TAKER under
    // latency — placement-time k cannot see that).
    if (typeof best.mN === 'number') makerFills = best.mN
    if (typeof best.tN === 'number') takerFills = best.tN
  }

  // Undo the sim's share-docking, then charge the era fee in USDC (the
  // real venue charges takers in USDC, not shares). Trigger on realized
  // taker economics, not placement-time classification.
  const hasTakerEconomics = takerFeeEra > 0 || dockedUp > 0 || dockedDown > 0
  const pnlCorr = hasTakerEconomics
    ? settlementPnl(
        m.upShares + dockedUp,
        m.downShares + dockedDown,
        m.cost,
        m.splitCost,
        outcome,
      ) - takerFeeEra
    : m.pnl

  const rebateRaw = REBATE_SHARE * makerFeeEquiv
  const rebate = rebateRaw >= REBATE_MIN_PER_MARKET ? rebateRaw : 0

  const denom = m.upShares + m.downShares
  const settleRecon = settlementPnl(m.upShares, m.downShares, m.cost, m.splitCost, outcome)
  const settleCheckDiff = Math.abs(settleRecon - m.pnl)

  return {
    slug: m.slug,
    weekKey: isoWeek(m.marketStartMs),
    pnlSim: m.pnl,
    pnlCorr,
    rebate,
    rebateRaw,
    el: pnlCorr + rebate,
    makerFeeEquiv,
    takerFeeEra,
    takerFeeSimRecon,
    makerFills,
    takerFills,
    imbalance: denom > 0 ? Math.abs(m.upShares - m.downShares) / denom : 0,
    pairRate: denom > 0 ? (2 * m.mergableShares) / denom : 0,
    outlay: m.cost,
    settleCheckOk: settleCheckDiff <= 0.011 || m.tradeCount === 0,
    settleCheckDiff,
  }
}

// ------------------------------------------------------------------ stats

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}
export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
  return sorted[idx]!
}
export function tStat(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  const se = Math.sqrt(v / xs.length)
  return se > 0 ? m / se : 0
}

// -------------------------------------------------------------- DB loading

export type RunHeader = {
  id: number
  batchUid: string | null
  submissionUid: string | null
  status: string | null
  strategy: string | null
  params: unknown
  cmd: string | null
  marketsPersisted: number | null
  failuresCount: number | null
  createdAt: Date | null
}

export async function loadRunHeader(runId: number): Promise<RunHeader | null> {
  const db = getDb()
  const rows = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      submissionUid: backtestRuns.submissionUid,
      status: backtestRuns.status,
      strategy: backtestRuns.strategy,
      params: backtestRuns.params,
      cmd: backtestRuns.cmd,
      marketsPersisted: backtestRuns.marketsPersisted,
      failuresCount: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, runId))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return { ...r, id: Number(r.id) } as RunHeader
}

export async function findRunIdsByBatchUid(batchUid: string): Promise<number[]> {
  const db = getDb()
  const rows = await db
    .select({ id: backtestRuns.id })
    .from(backtestRuns)
    .where(eq(backtestRuns.batchUid, batchUid))
    .orderBy(asc(backtestRuns.id))
  return rows.map((r) => Number(r.id))
}

export async function findRunsByBatchUidPrefix(prefix: string): Promise<RunHeader[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: backtestRuns.id,
      batchUid: backtestRuns.batchUid,
      submissionUid: backtestRuns.submissionUid,
      status: backtestRuns.status,
      strategy: backtestRuns.strategy,
      params: backtestRuns.params,
      cmd: backtestRuns.cmd,
      marketsPersisted: backtestRuns.marketsPersisted,
      failuresCount: backtestRuns.failuresCount,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(like(backtestRuns.batchUid, `${prefix.replaceAll('%', '')}%`))
    .orderBy(asc(backtestRuns.id))
  return rows.map((r) => ({ ...r, id: Number(r.id) }) as RunHeader)
}

const num = (x: unknown): number => {
  const n = typeof x === 'string' ? Number(x) : (x as number)
  return Number.isFinite(n) ? n : 0
}

export async function loadMarketRows(runId: number): Promise<MarketRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      slug: backtestRunMarkets.slug,
      marketStartMs: backtestRunMarkets.marketStartMs,
      finalOutcome: backtestRunMarkets.finalOutcome,
      skipReason: backtestRunMarkets.skipReason,
      pnl: backtestRunMarkets.pnl,
      tradeCount: backtestRunMarkets.tradeCount,
      tradeAsMaker: backtestRunMarkets.tradeAsMaker,
      tradeAsTaker: backtestRunMarkets.tradeAsTaker,
      feesPaid: backtestRunMarkets.feesPaid,
      upShares: backtestRunMarkets.upShares,
      downShares: backtestRunMarkets.downShares,
      mergableShares: backtestRunMarkets.mergableShares,
      cost: backtestRunMarkets.cost,
      splitCost: backtestRunMarkets.splitCost,
      intentMeta: backtestRunMarkets.intentMeta,
    })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, runId))
    .orderBy(asc(backtestRunMarkets.marketStartMs))
  return rows.map((r) => ({
    slug: String(r.slug ?? ''),
    marketStartMs: Number(r.marketStartMs ?? 0),
    finalOutcome: (r.finalOutcome as 'UP' | 'DOWN' | null) ?? null,
    skipReason: (r.skipReason as string | null) ?? null,
    pnl: num(r.pnl),
    tradeCount: num(r.tradeCount),
    tradeAsMaker: num(r.tradeAsMaker),
    tradeAsTaker: num(r.tradeAsTaker),
    feesPaid: num(r.feesPaid),
    upShares: num(r.upShares),
    downShares: num(r.downShares),
    mergableShares: num(r.mergableShares),
    cost: num(r.cost),
    splitCost: num(r.splitCost),
    metas: Array.isArray(r.intentMeta) ? (r.intentMeta as LabOrderMeta[]) : [],
  }))
}

export type SegmentRow = {
  segmentKind: string
  segmentKey: string
  evPerMarketTotal: number
  totalFeesPaid: number
  marketsTotal: number
  marketsPlayed: number
  winRate: number
  tradesMaker: number
  tradesTaker: number
  pnlTotal: number
}

export async function loadSegments(runId: number, kinds?: string[]): Promise<SegmentRow[]> {
  const db = getDb()
  const where = kinds?.length
    ? and(eq(backtestRunSegments.runId, runId), inArray(backtestRunSegments.segmentKind, kinds))
    : eq(backtestRunSegments.runId, runId)
  const rows = await db
    .select({
      segmentKind: backtestRunSegments.segmentKind,
      segmentKey: backtestRunSegments.segmentKey,
      evPerMarketTotal: backtestRunSegments.evPerMarketTotal,
      totalFeesPaid: backtestRunSegments.totalFeesPaid,
      marketsTotal: backtestRunSegments.marketsTotal,
      marketsPlayed: backtestRunSegments.marketsPlayed,
      winRate: backtestRunSegments.winRate,
      tradesMaker: backtestRunSegments.tradesMaker,
      tradesTaker: backtestRunSegments.tradesTaker,
      pnlTotal: backtestRunSegments.pnlTotal,
    })
    .from(backtestRunSegments)
    .where(where)
    .orderBy(asc(backtestRunSegments.segmentOrd))
  return rows.map((r) => ({
    segmentKind: String(r.segmentKind),
    segmentKey: String(r.segmentKey),
    evPerMarketTotal: num(r.evPerMarketTotal),
    totalFeesPaid: num(r.totalFeesPaid),
    marketsTotal: num(r.marketsTotal),
    marketsPlayed: num(r.marketsPlayed),
    winRate: num(r.winRate),
    tradesMaker: num(r.tradesMaker),
    tradesTaker: num(r.tradesTaker),
    pnlTotal: num(r.pnlTotal),
  }))
}

export { closeDb }
