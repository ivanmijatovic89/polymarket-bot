import type { CandidateCounters } from '../../native/contract/generated.js'
import type { TraceRecord } from './trace.js'

/**
 * Parity trace comparison, diff rules v2 (native/spec/22-trace-ledger-journal.md
 * §3.4), implementing the binding ts-compat tolerance of 00 R5:
 *
 * - records are aligned by index after the `header`; headers agree on
 *   `format`, `version`, `slug`, `candidateKey`, `profile`;
 * - prices, sizes, `amountUsdc`, `filledSize` (and `sizeMatched`) are exact
 *   after conversion to micros (half away from zero at 1e-6);
 * - USDC fields (`fee`, split `cost`, `final.unrounded.*`) within 1e-4;
 * - integers, strings, booleans, null and key sets exact;
 * - reject/fail reasons compare the reason code (text before the first `(`);
 * - `final.stats` exact at persisted precision (2 dp, 4 dp, integers),
 *   `intentMeta` deep-equal with numbers within relative 1e-9;
 * - auto-classes `rounding_boundary`, `rounding_tie` and `fee_rounding_tie`
 *   are counted, not failures (60 §3.5).
 *
 * A record whose type or kind differs ends the comparison (sequence
 * divergence); field-only differences are collected and the diff continues
 * (60 HR-6).
 */

export const DIFF_RULES_VERSION = 2

/** 22 §3.4: USDC tolerance (00 R5). */
export const USDC_TOLERANCE = 1e-4
/** 22 §3.4: relative tolerance for strategy floats inside `intentMeta`; also plugin snapshot floats (14 V-5). */
export const RELATIVE_FLOAT_TOLERANCE = 1e-9

export type DiffKind =
  | 'mismatch'
  | 'sequence'
  | 'header'
  | 'reason_code_unmapped'
  | 'rounding_boundary'
  | 'rounding_tie'
  | 'fee_rounding_tie'

/** Kinds that are auto-classified (standing entries PE-R1..R3, 60 §3.5): counted, not failures. */
export const AUTO_CLASS_KINDS: ReadonlySet<DiffKind> = new Set([
  'rounding_boundary',
  'rounding_tie',
  'fee_rounding_tie',
])

export type FieldMismatch = {
  /** 0-based record index. */
  index: number
  /** Record type (`t`) and kind of the A-side record, for matchers (60 §3.2). */
  recordType: string
  recordKind: string | null
  path: string
  a: unknown
  b: unknown
  kind: DiffKind
}

export type TraceSummary = {
  records: number
  ticks: number
  syntheticTicks: number
  intents: Record<string, number>
  accountIntents: number
  events: Record<string, number>
  fills: { taker: number; maker: number }
  orderDone: Record<string, number>
  final: TraceRecord | undefined
}

export type TraceDiffResult = {
  /** No failing mismatch (auto-classes allowed) and both traces complete. */
  equal: boolean
  /** True only under the fixed v2 rules (VP-3); a tolerance override makes it false. */
  gating: boolean
  /** Index of the first record where type/kind differs or one trace ends; null if aligned throughout. */
  sequenceDivergence: number | null
  /** Every difference found, in record order (auto-classes included). */
  mismatches: FieldMismatch[]
  /** Mismatches that are not auto-classified (the first `MAX_STORED_MISMATCHES` kept). */
  failures: FieldMismatch[]
  /** Total number of failing mismatches, including those not stored. */
  failureTotal: number
  /** Count per auto-class kind. */
  autoClasses: Partial<Record<DiffKind, number>>
  summaryA: TraceSummary
  summaryB: TraceSummary
  notes: string[]
}

export type DiffOptions = {
  /**
   * Exploration override (22 §3.4 "Tolerance flags"): absolute tolerance for
   * price/size/USDC numbers. Marks the result non-gating.
   */
  tolerance?: number
}

/**
 * Reject reason codes of the engine (10 §10.2 `RejectReason`), keyed exactly
 * by the contract's `ordersRejected` vocabulary (21 §17): the object literal
 * is type-checked against the generated contract type, so a code added to or
 * removed from the Rust enum fails `code:typecheck` here until the list
 * follows. `unmapped` is excluded: it is the code of an unmapped exchange
 * reason, never a known code.
 */
const REJECT_REASON_CODES: Record<
  Exclude<keyof CandidateCounters['ordersRejected'], 'unmapped'>,
  true
> = {
  amount_precision: true,
  batch_too_large: true,
  gtd_expireAtMs_too_soon: true,
  gtd_lead_too_short: true,
  gtd_requires_expireAtMs: true,
  insufficient_capital: true,
  insufficient_exchange_balance: true,
  insufficient_inventory: true,
  invalid_price: true,
  invalid_size: true,
  invalid_tick: true,
  kill_switch: true,
  market_closed: true,
  meta_too_large: true,
  missing_assetId: true,
  not_found_after_ambiguous: true,
  notional_below_minimum: true,
  post_only_requires_gtc_or_gtd: true,
  post_only_would_cross: true,
  price_out_of_bounds: true,
  rate_limited: true,
  risk_loss_stop: true,
  risk_max_abs_position: true,
  risk_max_open_orders: true,
  risk_max_order_size: true,
  self_cross: true,
  size_below_minimum: true,
  size_precision: true,
  strategy_halted: true,
  trading_restricted: true,
}

/**
 * Cancel-fail codes (10 §10.2 `CancelFailReason`, strings of 02 D62:
 * `ConflictingRefs` = `conflicting_order_reference`, `TooManyIds` =
 * `invalid_cancel_batch_size`, as `src/trading/cancellation.ts:70,90` emits).
 */
export const CANCEL_FAIL_REASON_CODES: readonly string[] = [
  'unknown_client_order',
  'conflicting_order_reference',
  'missing_exchange_order_id',
  'not_cancelable_during_delay',
  'exchange_not_canceled',
  'invalid_cancel_batch_size',
  'ambiguous',
]

/**
 * Split/merge-fail codes (10 §10.2 `SplitFailReason`/`MergeFailReason`);
 * `InsufficientPairs` is the TS string `insufficient_uncommitted_positions`
 * (`src/trading/OrderManager.ts:429`, as pmb-core renders it).
 */
export const SPLIT_MERGE_FAIL_REASON_CODES: readonly string[] = [
  'invalid_size',
  'insufficient_collateral',
  'insufficient_uncommitted_positions',
  'tx_failed',
  'ambiguous',
]

/**
 * The "known code" of 22 §3.4 and 60 CL-8: a code from any 10 §10.2 reason
 * enum (reject, cancel-fail, split-fail, merge-fail; 02 D62).
 */
export const KNOWN_REASON_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(REJECT_REASON_CODES),
  ...CANCEL_FAIL_REASON_CODES,
  ...SPLIT_MERGE_FAIL_REASON_CODES,
])

const REASON_KINDS = new Set(['order_rejected', 'cancel_failed', 'split_failed', 'merge_failed'])
const MICROS_KEYS = new Set(['price', 'size', 'amountUsdc', 'filledSize', 'sizeMatched'])
const USDC_EVENT_KEYS = new Set(['fee', 'cost'])
/** Optional tick fields compared only when both sides have them (22 §3.2). */
const OPTIONAL_TICK_KEYS = new Set(['xts', 'vts'])

/** final.stats fields and their persisted precision (decimal places), src/backtest/stats/marketStats.ts:183-200. */
const STATS_PRECISION: Readonly<Record<string, number>> = {
  pnl: 2,
  feesPaid: 2,
  upShares: 2,
  downShares: 2,
  mergableShares: 2,
  cost: 2,
  splitCost: 2,
  avgEntryPriceUp: 4,
  avgEntryPriceDown: 4,
}

/** final.stats field → its unrounded counterpart (22 §3.4 rounding boundary). */
const STATS_UNROUNDED: Readonly<Record<string, string>> = {
  pnl: 'pnl',
  feesPaid: 'feesPaid',
  upShares: 'upShares',
  downShares: 'downShares',
  cost: 'cost',
  splitCost: 'splitCost',
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Round half away from zero at 10^-dp, as an integer number of units (R2, 10 R-1). */
export function toUnits(x: number, dp: number): number {
  const scale = 10 ** dp
  const r = Math.round(Math.abs(x) * scale)
  return x < 0 ? -r : r
}

/** Micros of a decimal value (22 §3.4: round half away from zero at 1e-6). */
export function toMicros(x: number): number {
  return toUnits(x, 6)
}

/** Reason code: text before the first `(` (22 §3.4). */
export function reasonCode(reason: unknown): string {
  if (typeof reason !== 'string') return ''
  const i = reason.indexOf('(')
  return (i >= 0 ? reason.slice(0, i) : reason).trim()
}

function relEqual(a: number, b: number): boolean {
  if (a === b) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= RELATIVE_FLOAT_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
}

type Ctx = {
  index: number
  recordType: string
  recordKind: string | null
  out: FieldMismatch[]
  tolerance: number | undefined
}

function push(ctx: Ctx, path: string, a: unknown, b: unknown, kind: DiffKind = 'mismatch'): void {
  ctx.out.push({
    index: ctx.index,
    recordType: ctx.recordType,
    recordKind: ctx.recordKind,
    path,
    a,
    b,
    kind,
  })
}

type NumberRule = (key: string, a: number, b: number) => boolean

/** Generic deep compare with a per-key number rule; strings/bools/null/key sets exact. */
function compareDeep(
  ctx: Ctx,
  a: unknown,
  b: unknown,
  path: string,
  rule: NumberRule,
  key = '',
): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!rule(key, a, b)) push(ctx, path, a, b)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      push(ctx, `${path}.length`, a.length, b.length)
      return
    }
    for (let i = 0; i < a.length; i++) compareDeep(ctx, a[i], b[i], `${path}[${i}]`, rule, key)
    return
  }
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const k of keys) {
      if (!(k in a) || !(k in b)) {
        push(ctx, `${path}.${k}`, a[k], b[k])
        continue
      }
      compareDeep(ctx, a[k], b[k], `${path}.${k}`, rule, k)
    }
    return
  }
  if (a !== b) push(ctx, path, a, b)
}

/** Number rule for tick/intent/event records (22 §3.4). */
function engineNumberRule(tolerance: number | undefined): NumberRule {
  return (key, a, b) => {
    if (MICROS_KEYS.has(key))
      return tolerance !== undefined ? Math.abs(a - b) <= tolerance : toMicros(a) === toMicros(b)
    if (USDC_EVENT_KEYS.has(key)) return Math.abs(a - b) <= (tolerance ?? USDC_TOLERANCE) + 1e-12
    return a === b
  }
}

/** Number rule for plugin snapshots: integers exact, floats relative 1e-9 (14 V-5). */
// D-PENDING: 22 §3.4 has no rule for `feeds.plugins`; chose 14 V-5 (integers exact, floats relative 1e-9). Feed values (binance/chainlink/priceToBeat) are exact (14 V-3).
const pluginNumberRule: NumberRule = (_key, a, b) =>
  Number.isInteger(a) && Number.isInteger(b) ? a === b : relEqual(a, b)

const exactNumberRule: NumberRule = (_key, a, b) => a === b
const metaNumberRule: NumberRule = (_key, a, b) => relEqual(a, b)

/**
 * Exact ts-compat fee `0.07 × p × (1 − p) × C` lies on a 4-dp half (60 §3.5
 * PE-R3), computed in exact integer arithmetic from the traced micros.
 */
export function isFeeHalfTie(price: number, size: number): boolean {
  const p = BigInt(toMicros(price))
  const c = BigInt(toMicros(size))
  // fee = 7/100 × p/1e6 × (1e6 − p)/1e6 × c/1e6 = N / 1e20 with N = 7·p·(1e6−p)·c.
  // fee × 1e5 = N / 1e15: a 4-dp half iff that is an integer ending in 5.
  const n = 7n * p * (1_000_000n - p) * c
  const d = 10n ** 15n
  if (n % d !== 0n) return false
  const q = n / d
  return (q < 0n ? -q : q) % 10n === 5n
}

function compareEngineRecord(ctx: Ctx, a: TraceRecord, b: TraceRecord, feeTies: FeeTie[]): void {
  const rule = engineNumberRule(ctx.tolerance)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const reasonRecord = a.t === 'event' && REASON_KINDS.has(String(a.kind))
  for (const k of keys) {
    const inA = k in a
    const inB = k in b
    if (a.t === 'tick' && OPTIONAL_TICK_KEYS.has(k)) {
      if (inA && inB && a[k] !== b[k]) push(ctx, `$.${k}`, a[k], b[k])
      continue
    }
    if (!inA || !inB) {
      push(ctx, `$.${k}`, a[k], b[k])
      continue
    }
    if (k === 'reason' && reasonRecord) {
      const ca = reasonCode(a[k])
      const cb = reasonCode(b[k])
      if (KNOWN_REASON_CODES.has(ca) && KNOWN_REASON_CODES.has(cb)) {
        if (ca !== cb) push(ctx, '$.reason', a[k], b[k])
      } else if (ca === '' || cb === '') push(ctx, '$.reason', a[k], b[k])
      else push(ctx, '$.reason', a[k], b[k], 'reason_code_unmapped')
      continue
    }
    if (k === 'fee' && a.t === 'event' && a.kind === 'fill') {
      const fa = a[k]
      const fb = b[k]
      if (typeof fa === 'number' && typeof fb === 'number') {
        // 60 §3.5 PE-R3: a fee exactly 100 micros apart on an exact 4-dp half
        // is counted as fee_rounding_tie (it is inside the 1e-4 tolerance, but
        // its delta is compensated in the final USDC fields).
        const deltaMicros = toMicros(fb) - toMicros(fa)
        if (
          ctx.tolerance === undefined &&
          Math.abs(deltaMicros) === 100 &&
          typeof a.price === 'number' &&
          typeof a.size === 'number' &&
          isFeeHalfTie(a.price, a.size)
        ) {
          push(ctx, '$.fee', fa, fb, 'fee_rounding_tie')
          feeTies.push({ deltaMicros, side: a.side === 'SELL' ? 'SELL' : 'BUY' })
        } else if (!rule(k, fa, fb)) push(ctx, '$.fee', fa, fb)
        continue
      }
    }
    compareDeep(ctx, a[k], b[k], `$.${k}`, rule, k)
  }
}

function compareFeedsRecord(ctx: Ctx, a: TraceRecord, b: TraceRecord): void {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const k of keys) {
    if (!(k in a) || !(k in b)) {
      push(ctx, `$.${k}`, a[k], b[k])
      continue
    }
    compareDeep(ctx, a[k], b[k], `$.${k}`, k === 'plugins' ? pluginNumberRule : exactNumberRule, k)
  }
}

type FeeTie = { deltaMicros: number; side: 'BUY' | 'SELL' }

/** Negative half tie at 2 dp (D08): JS rounds −x.xx5 toward +∞, Rust away from zero. */
function isNegativeHalfTie(x: number, dp: number): boolean {
  if (!(x < 0)) return false
  const micros = Math.abs(toMicros(x))
  const unit = 10 ** (6 - dp)
  return micros % unit === unit / 2
}

function compareFinal(ctx: Ctx, a: TraceRecord, b: TraceRecord, feeTies: FeeTie[]): void {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  // 60 §3.5 PE-R3: remove the effect of classified fee deltas (B − A) from the
  // USDC fields that include fees before the 1e-4 check.
  // D-PENDING: 60 §3.5 says "with each field's sign" without listing the signs; chose feesPaid +Δ, pnl −Δ, cost +Δ for BUY fills (the fee joins the cost basis), 0 for SELL fills.
  const feeDelta = feeTies.reduce((s, t) => s + t.deltaMicros, 0) / 1e6
  const buyFeeDelta =
    feeTies.filter((t) => t.side === 'BUY').reduce((s, t) => s + t.deltaMicros, 0) / 1e6
  const compensation: Record<string, number> = {
    feesPaid: feeDelta,
    pnl: -feeDelta,
    cost: buyFeeDelta,
  }
  const ua = isObj(a.unrounded) ? a.unrounded : null
  const ub = isObj(b.unrounded) ? b.unrounded : null
  for (const k of keys) {
    if (!(k in a) || !(k in b)) {
      push(ctx, `$.${k}`, a[k], b[k])
      continue
    }
    if (k === 'unrounded') {
      if (ua && ub) {
        const uk = [...new Set([...Object.keys(ua), ...Object.keys(ub)])].sort()
        for (const f of uk) {
          const va = ua[f]
          const vb = ub[f]
          if (typeof va === 'number' && typeof vb === 'number') {
            const tol = ctx.tolerance ?? USDC_TOLERANCE
            if (Math.abs(vb - va - (compensation[f] ?? 0)) > tol + 1e-12)
              push(ctx, `$.unrounded.${f}`, va, vb)
          } else compareDeep(ctx, va, vb, `$.unrounded.${f}`, exactNumberRule, f)
        }
      } else compareDeep(ctx, a[k], b[k], '$.unrounded', exactNumberRule)
      continue
    }
    if (k === 'stats') {
      compareStats(ctx, a.stats, b.stats, ua, ub, compensation)
      continue
    }
    compareDeep(ctx, a[k], b[k], `$.${k}`, exactNumberRule, k)
  }
}

function compareStats(
  ctx: Ctx,
  sa: unknown,
  sb: unknown,
  ua: Record<string, unknown> | null,
  ub: Record<string, unknown> | null,
  compensation: Record<string, number>,
): void {
  if (!isObj(sa) || !isObj(sb)) {
    compareDeep(ctx, sa, sb, '$.stats', exactNumberRule)
    return
  }
  const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort()
  for (const k of keys) {
    const path = `$.stats.${k}`
    if (!(k in sa) || !(k in sb)) {
      push(ctx, path, sa[k], sb[k])
      continue
    }
    const va = sa[k]
    const vb = sb[k]
    if (k === 'intentMeta') {
      compareDeep(ctx, va, vb, path, metaNumberRule)
      continue
    }
    const dp = STATS_PRECISION[k]
    if (dp !== undefined && typeof va === 'number' && typeof vb === 'number') {
      const same =
        ctx.tolerance !== undefined
          ? Math.abs(va - vb) <= ctx.tolerance
          : toUnits(va, dp) === toUnits(vb, dp)
      if (same) continue
      // Rounding boundary auto-class (22 §3.4): the quantized stat differs
      // while its unrounded counterpart agrees within 1e-4.
      const ukey = STATS_UNROUNDED[k]
      const unA = unroundedOf(ukey, ua)
      const unB = unroundedOf(ukey, ub)
      if (
        ctx.tolerance === undefined &&
        unA !== null &&
        unB !== null &&
        Math.abs(unB - unA - (ukey ? (compensation[ukey] ?? 0) : 0)) <= USDC_TOLERANCE + 1e-12
      ) {
        push(ctx, path, va, vb, isNegativeHalfTie(unA, dp) ? 'rounding_tie' : 'rounding_boundary')
      } else push(ctx, path, va, vb)
      continue
    }
    compareDeep(ctx, va, vb, path, exactNumberRule, k)
  }
}

function unroundedOf(ukey: string | undefined, u: Record<string, unknown> | null): number | null {
  // 02 D69: PE-R1 applies only to stats with a counterpart in
  // `final.unrounded` (22 §3.4); `mergableShares` and `avgEntryPrice*` have
  // none, so a difference there is always a failing mismatch (CL-1, CL-9).
  if (!u || !ukey) return null
  const v = u[ukey]
  return typeof v === 'number' ? v : null
}

/** Compare the two header records (22 §3.4 Alignment). */
function compareHeaders(ctx: Ctx, a: TraceRecord | undefined, b: TraceRecord | undefined): void {
  if (a?.t !== 'header' || b?.t !== 'header') {
    push(ctx, '$.t', a?.t, b?.t, 'header')
    return
  }
  for (const k of ['format', 'version', 'slug', 'candidateKey', 'profile'])
    if (a[k] !== b[k]) push(ctx, `$.${k}`, a[k], b[k], 'header')
}

function recordKind(r: TraceRecord): string | null {
  return typeof r.kind === 'string' ? r.kind : null
}

/** Compare two aligned records of the same type; used by the context printer. */
export function compareRecords(
  a: TraceRecord,
  b: TraceRecord,
  opts: DiffOptions = {},
): FieldMismatch[] {
  const ctx: Ctx = {
    index: 0,
    recordType: a.t,
    recordKind: recordKind(a),
    out: [],
    tolerance: opts.tolerance,
  }
  if (a.t !== b.t || recordKind(a) !== recordKind(b)) {
    push(ctx, '$', a, b, 'sequence')
    return ctx.out
  }
  if (a.t === 'header') compareHeaders(ctx, a, b)
  else if (a.t === 'final') compareFinal(ctx, a, b, [])
  else if (a.t === 'feeds') compareFeedsRecord(ctx, a, b)
  else compareEngineRecord(ctx, a, b, [])
  return ctx.out
}

/** Incremental trace summary (counts per record type and kind). */
export class TraceSummaryAcc {
  readonly s: TraceSummary = {
    records: 0,
    ticks: 0,
    syntheticTicks: 0,
    intents: {},
    accountIntents: 0,
    events: {},
    fills: { taker: 0, maker: 0 },
    orderDone: {},
    final: undefined,
  }

  add(r: TraceRecord): void {
    const s = this.s
    s.records++
    if (r.t === 'tick') {
      s.ticks++
      if (r.cause !== 'book' && r.cause !== 'price_change') s.syntheticTicks++
    } else if (r.t === 'intent') {
      const k = String(r.kind)
      s.intents[k] = (s.intents[k] ?? 0) + 1
      if (r.src === 'account') s.accountIntents++
    } else if (r.t === 'event') {
      const k = String(r.kind)
      s.events[k] = (s.events[k] ?? 0) + 1
      if (k === 'fill') {
        if (r.liquidity === 'TAKER') s.fills.taker++
        else if (r.liquidity === 'MAKER') s.fills.maker++
      }
      if (k === 'order_done') {
        const reason = String(r.reason)
        s.orderDone[reason] = (s.orderDone[reason] ?? 0) + 1
      }
    } else if (r.t === 'final') s.final = r
  }
}

export function summarizeTrace(records: readonly TraceRecord[]): TraceSummary {
  const acc = new TraceSummaryAcc()
  for (const r of records) acc.add(r)
  return acc.s
}

/**
 * Incremental v2 diff (22 §3.4) over two traces fed in lockstep, so traces of
 * any size are compared without holding them in memory. Feed every index
 * with `next(a, b)` (undefined once a side has ended) until both end, then
 * call `finish()`. Comparison stops at the first sequence divergence; the
 * summaries keep counting.
 */
/** Mismatches kept per market; later ones are only counted (bounded memory). */
export const MAX_STORED_MISMATCHES = 1000

export class TraceDiffer {
  private out: FieldMismatch[] = []
  private failureTotal = 0
  private readonly autoCounts: Partial<Record<DiffKind, number>> = {}
  private readonly feeTies: FeeTie[] = []
  private readonly sumA = new TraceSummaryAcc()
  private readonly sumB = new TraceSummaryAcc()
  private index = 0
  private lastA: TraceRecord | undefined
  private lastB: TraceRecord | undefined
  sequenceDivergence: number | null = null

  constructor(private readonly opts: DiffOptions = {}) {}

  private ctx(index: number, r: TraceRecord | undefined): Ctx {
    return {
      index,
      recordType: r?.t ?? 'EOF',
      recordKind: r ? recordKind(r) : null,
      out: this.out,
      tolerance: this.opts.tolerance,
    }
  }

  /** Count the mismatches pushed since `from` and drop the ones over the storage cap. */
  private settle(from: number): void {
    for (let k = from; k < this.out.length; k++) {
      const m = this.out[k]!
      if (AUTO_CLASS_KINDS.has(m.kind)) this.autoCounts[m.kind] = (this.autoCounts[m.kind] ?? 0) + 1
      else this.failureTotal++
    }
    if (this.out.length > MAX_STORED_MISMATCHES) this.out = this.out.slice(0, MAX_STORED_MISMATCHES)
  }

  /** Failing mismatches found so far. */
  get failingSoFar(): number {
    return this.failureTotal
  }

  next(ra: TraceRecord | undefined, rb: TraceRecord | undefined): void {
    const before = this.out.length
    this.compareNext(ra, rb)
    this.settle(before)
  }

  private compareNext(ra: TraceRecord | undefined, rb: TraceRecord | undefined): void {
    const i = this.index++
    if (ra) {
      this.sumA.add(ra)
      this.lastA = ra
    }
    if (rb) {
      this.sumB.add(rb)
      this.lastB = rb
    }
    if (this.sequenceDivergence !== null || (!ra && !rb)) return
    const ctx = this.ctx(i, ra ?? rb)
    if (i === 0) {
      compareHeaders(ctx, ra, rb)
      return
    }
    if (!ra || !rb || ra.t !== rb.t || recordKind(ra) !== recordKind(rb)) {
      push(
        ctx,
        '$',
        ra ? `${ra.t}:${recordKind(ra) ?? ''}` : 'EOF',
        rb ? `${rb.t}:${recordKind(rb) ?? ''}` : 'EOF',
        'sequence',
      )
      this.sequenceDivergence = i
      return
    }
    if (ra.t === 'final') compareFinal(ctx, ra, rb, this.feeTies)
    else if (ra.t === 'feeds') compareFeedsRecord(ctx, ra, rb)
    else if (ra.t === 'header') push(ctx, '$.t', 'header', 'header', 'sequence')
    else compareEngineRecord(ctx, ra, rb, this.feeTies)
  }

  finish(): TraceDiffResult {
    const notes: string[] = []
    const fa = this.lastA
    const fb = this.lastB
    if (fa?.t !== 'final') notes.push('A has no final record')
    if (fb?.t !== 'final') notes.push('B has no final record')
    const failures = this.out.filter((m) => !AUTO_CLASS_KINDS.has(m.kind))
    if (this.failureTotal > failures.length)
      notes.push(
        `${this.failureTotal} failing mismatches; the first ${MAX_STORED_MISMATCHES} records of mismatches are kept`,
      )
    return {
      equal: this.failureTotal === 0 && fa?.t === 'final' && fb?.t === 'final',
      gating: this.opts.tolerance === undefined,
      sequenceDivergence: this.sequenceDivergence,
      mismatches: this.out,
      failures,
      failureTotal: this.failureTotal,
      autoClasses: { ...this.autoCounts },
      summaryA: this.sumA.s,
      summaryB: this.sumB.s,
      notes,
    }
  }
}

/** Diff two complete in-memory traces under the v2 rules (22 §3.4). */
export function diffTraces(
  a: readonly TraceRecord[],
  b: readonly TraceRecord[],
  opts: DiffOptions = {},
): TraceDiffResult {
  const d = new TraceDiffer(opts)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) d.next(a[i], b[i])
  return d.finish()
}
