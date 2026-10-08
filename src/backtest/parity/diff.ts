import type { TraceRecord } from './trace.js'

/**
 * Parity trace comparison (native/TRACE.md rules):
 * - records are compared in order, line by line;
 * - numbers within `tolerance` (default 1e-6) — prices, sizes, USDC, PnL;
 *   integers (seq, ts, counts) are therefore effectively exact;
 * - strings / booleans / null / key sets exact;
 * - `reason` of order_rejected / cancel_failed / split_failed / merge_failed is
 *   loose (both sides must carry a non-empty reason; text may differ);
 * - in the `final` record, top-level keys other than `stats` are compared only
 *   when both sides carry them (each engine may report extra diagnostics).
 */

export const DEFAULT_TOLERANCE = 1e-6

const LOOSE_REASON_KINDS = new Set([
  'order_rejected',
  'cancel_failed',
  'split_failed',
  'merge_failed',
])

export type FieldMismatch = { path: string; a: unknown; b: unknown }

export type TraceDivergence = {
  /** 0-based record index (= line number - 1 when the file has no blank lines). */
  index: number
  a: TraceRecord | undefined
  b: TraceRecord | undefined
  mismatches: FieldMismatch[]
}

export type TraceSummary = {
  records: number
  ticks: number
  intents: Record<string, number>
  accountIntents: number
  events: Record<string, number>
  fills: { taker: number; maker: number }
  orderDone: Record<string, number>
  final: TraceRecord | undefined
}

export type TraceDiffResult = {
  equal: boolean
  divergences: TraceDivergence[]
  summaryA: TraceSummary
  summaryB: TraceSummary
  notes: string[]
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function compareValues(
  a: unknown,
  b: unknown,
  path: string,
  tol: number,
  out: FieldMismatch[],
  looseReason: boolean,
): void {
  if (looseReason && path.endsWith('.reason')) {
    const ok = (v: unknown) => typeof v === 'string' && v.length > 0
    if (!ok(a) || !ok(b)) out.push({ path, a, b })
    return
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return
    if (a === b || Math.abs(a - b) <= tol) return
    out.push({ path, a, b })
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, a: a.length, b: b.length })
      return
    }
    for (let i = 0; i < a.length; i++)
      compareValues(a[i], b[i], `${path}[${i}]`, tol, out, looseReason)
    return
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of [...keys].sort()) {
      if (!(k in a) || !(k in b)) {
        out.push({ path: `${path}.${k}`, a: a[k], b: b[k] })
        continue
      }
      compareValues(a[k], b[k], `${path}.${k}`, tol, out, looseReason)
    }
    return
  }
  if (a !== b) out.push({ path, a, b })
}

export function compareRecords(a: TraceRecord, b: TraceRecord, tol: number): FieldMismatch[] {
  const out: FieldMismatch[] = []
  if (a.t === 'final' && b.t === 'final') {
    compareValues(a.stats, b.stats, '$.stats', tol, out, false)
    for (const k of Object.keys(a)) {
      if (k === 't' || k === 'stats' || !(k in b)) continue
      compareValues(a[k], b[k], `$.${k}`, tol, out, false)
    }
    return out
  }
  const loose =
    a.t === 'event' &&
    b.t === 'event' &&
    LOOSE_REASON_KINDS.has(String(a.kind)) &&
    a.kind === b.kind
  compareValues(a, b, '$', tol, out, loose)
  return out
}

export function summarizeTrace(records: readonly TraceRecord[]): TraceSummary {
  const s: TraceSummary = {
    records: records.length,
    ticks: 0,
    intents: {},
    accountIntents: 0,
    events: {},
    fills: { taker: 0, maker: 0 },
    orderDone: {},
    final: undefined,
  }
  for (const r of records) {
    if (r.t === 'tick') s.ticks++
    else if (r.t === 'intent') {
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
  return s
}

export function diffTraces(
  a: readonly TraceRecord[],
  b: readonly TraceRecord[],
  opts: { tolerance?: number; maxDivergences?: number } = {},
): TraceDiffResult {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE
  const max = Math.max(1, opts.maxDivergences ?? 1)
  const divergences: TraceDivergence[] = []
  const notes: string[] = []
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len && divergences.length < max; i++) {
    const ra = a[i]
    const rb = b[i]
    if (!ra || !rb) {
      divergences.push({
        index: i,
        a: ra,
        b: rb,
        mismatches: [{ path: '$', a: ra ? 'record' : 'EOF', b: rb ? 'record' : 'EOF' }],
      })
      continue
    }
    const mismatches = compareRecords(ra, rb, tol)
    if (mismatches.length > 0) divergences.push({ index: i, a: ra, b: rb, mismatches })
  }
  const fa = a.at(-1)
  const fb = b.at(-1)
  if (fa?.t === 'final' && fb?.t === 'final') {
    for (const k of Object.keys(fa))
      if (k !== 't' && k !== 'stats' && !(k in fb)) notes.push(`final.${k} only in A`)
    for (const k of Object.keys(fb))
      if (k !== 't' && k !== 'stats' && !(k in fa)) notes.push(`final.${k} only in B`)
  } else {
    if (fa?.t !== 'final') notes.push('A has no final record')
    if (fb?.t !== 'final') notes.push('B has no final record')
  }
  return {
    equal: divergences.length === 0 && fa?.t === 'final' && fb?.t === 'final',
    divergences,
    summaryA: summarizeTrace(a),
    summaryB: summarizeTrace(b),
    notes,
  }
}
