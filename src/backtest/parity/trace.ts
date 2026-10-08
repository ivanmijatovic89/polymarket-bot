import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  OrderReference,
  PlaceBatchIntent,
} from '../../strategy/Strategy.js'
import { computePolymarketTakerFee } from '../../trading/fees.js'
import type { RunSingleMarketInput, RunSingleMarketOutput } from '../runSingleMarket.js'

/**
 * Canonical parity trace (native/TRACE.md) — TypeScript writer.
 *
 * One JSON object per line in engine processing order. Assets are outcome
 * indexes (0 = UP, 1 = DOWN), never token ids; exchange order ids and fill ids
 * are omitted. Diagnostic only: the observer copies data and never touches
 * engine state, so a traced replay is behaviorally identical to an untraced one.
 */

export type TraceRecord = Record<string, unknown> & { t: 'tick' | 'intent' | 'event' | 'final' }

/** Account event kinds written to the trace (TRACE.md). Others (ws_order_update, …) are dropped. */
export const TRACED_EVENT_KINDS = new Set<AccountEvent['kind']>([
  'order_submitted',
  'order_accepted',
  'order_rejected',
  'order_open',
  'order_done',
  'fill',
  'cancel_failed',
  'positions_split',
  'split_failed',
  'positions_merged',
  'merge_failed',
])

/** Round float noise away well below the 1e-6 diff tolerance; -0 → 0. */
export function num(x: number): number {
  if (!Number.isFinite(x)) return x
  const r = Math.round(x * 1e9) / 1e9
  return r === 0 ? 0 : r
}

function normalizeDeep(value: unknown): unknown {
  if (typeof value === 'number') return num(value)
  if (typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(normalizeDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = normalizeDeep(v)
    return out
  }
  return value
}

type Observer = NonNullable<RunSingleMarketInput['observer']>

export class ParityTraceRecorder {
  readonly records: TraceRecord[] = []
  private ticks = 0
  private seq = -1
  private readonly cidByOrderId = new Map<string, string>()

  constructor(private readonly tokens: { UP: string; DOWN: string }) {}

  private asset(id: string | undefined): number | string | null {
    if (id === undefined) return null
    return id === this.tokens.UP ? 0 : id === this.tokens.DOWN ? 1 : id
  }

  private cid(ref: OrderReference): string | null {
    if (ref.clientOrderId) return ref.clientOrderId
    return ref.orderId ? (this.cidByOrderId.get(ref.orderId) ?? null) : null
  }

  private push(rec: TraceRecord): void {
    this.records.push(rec)
  }

  private order(o: PlaceBatchIntent['orders'][number]): Record<string, unknown> {
    return {
      cid: o.clientOrderId,
      asset: this.asset(o.assetId),
      side: o.side,
      price: num(o.price),
      size: num(o.size),
      orderType: o.orderType,
      postOnly: o.postOnly === true,
      expireAtMs: o.expireAtMs ?? null,
    }
  }

  private intent(src: 'tick' | 'account', i: Intent): void {
    const base = { t: 'intent' as const, seq: this.seq, src, kind: i.kind }
    switch (i.kind) {
      case 'place_limit':
        return this.push({ ...base, ...this.order(i) })
      case 'place_batch':
        return this.push({ ...base, orders: i.orders.map((o) => this.order(o)) })
      case 'cancel_order':
        return this.push({ ...base, cid: this.cid(i) })
      case 'cancel_batch':
        return this.push({ ...base, cids: i.orders.map((r) => this.cid(r)) })
      case 'cancel_market':
        return this.push({
          ...base,
          asset: this.asset(i.assetId),
          ...(i.market !== undefined ? { market: i.market } : {}),
        })
      case 'cancel_all':
        return this.push(base)
      case 'split_positions':
      case 'merge_positions':
        return this.push({ ...base, size: num(i.size) })
    }
  }

  private event(ev: AccountEvent): void {
    if (!TRACED_EVENT_KINDS.has(ev.kind)) return
    const base = { t: 'event' as const, seq: this.seq, kind: ev.kind }
    switch (ev.kind) {
      case 'order_submitted':
        return this.push({ ...base, ts: ev.tsMs, ...this.order(ev.order) })
      case 'order_accepted':
        if (ev.orderId) this.cidByOrderId.set(ev.orderId, ev.clientOrderId)
        return this.push({ ...base, ts: ev.tsMs, cid: ev.clientOrderId })
      case 'order_rejected':
        return this.push({ ...base, ts: ev.tsMs, cid: ev.clientOrderId, reason: ev.reason })
      case 'order_open':
        if (ev.orderId && ev.clientOrderId) this.cidByOrderId.set(ev.orderId, ev.clientOrderId)
        return this.push({ ...base, ts: ev.tsMs, cid: this.cid(ev) })
      case 'order_done':
        return this.push({
          ...base,
          ts: ev.tsMs,
          cid: this.cid(ev),
          reason: ev.reason,
          filledSize: ev.filledSize === undefined ? null : num(ev.filledSize),
        })
      case 'fill': {
        const f = ev.fill
        const fee =
          f.liquidity === 'TAKER' && f.feeRateBps !== undefined
            ? computePolymarketTakerFee({ feeRateBps: f.feeRateBps, price: f.price, size: f.size })
            : 0
        return this.push({
          ...base,
          ts: f.tsMs,
          cid: f.clientOrderId ?? (f.orderId ? (this.cidByOrderId.get(f.orderId) ?? null) : null),
          asset: this.asset(f.assetId),
          side: f.side,
          price: num(f.price),
          size: num(f.size),
          fee: num(fee),
          liquidity: f.liquidity ?? null,
        })
      }
      case 'cancel_failed':
        return this.push({
          ...base,
          ts: ev.tsMs,
          op: ev.operation,
          cid: this.cid(ev),
          asset: this.asset(ev.assetId),
          reason: ev.reason,
        })
      case 'positions_split':
        return this.push({
          ...base,
          ts: ev.split.tsMs,
          size: num(ev.split.size),
          cost: num(ev.split.splitCost),
        })
      case 'positions_merged':
        return this.push({ ...base, ts: ev.tsMs, size: num(ev.size) })
      case 'split_failed':
      case 'merge_failed':
        return this.push({
          ...base,
          ts: ev.tsMs,
          size: num(ev.requestedSize),
          reason: ev.reason,
        })
    }
  }

  readonly observer: Observer = {
    onTickStart: (tick: MarketTick) => {
      this.seq = this.ticks++
      this.push({
        t: 'tick',
        seq: this.seq,
        ts: tick.snapshot.timestamp,
        cause: tick.msg.event_type,
      })
    },
    onTickEnd: () => {},
    onDecision: (origin, intents) => {
      for (const i of intents ?? []) this.intent(origin === 'market' ? 'tick' : 'account', i)
    },
    onAccountEvent: (ev) => this.event(ev),
  }

  /** Last line: the per-market result (non-deterministic execution metadata stripped). */
  finish(output: RunSingleMarketOutput): void {
    let stats: unknown = null
    if (output.marketStats) {
      const { execution: _execution, recorderV4Capture: _capture, ...rest } = output.marketStats
      void _execution
      void _capture
      stats = normalizeDeep(rest)
    }
    this.push({
      t: 'final',
      stats,
      skipReason: output.skipReason ?? null,
      eventsProcessed: output.eventsProcessed,
      eventsByType: output.eventsByType,
    })
  }

  get tickCount(): number {
    return this.ticks
  }
}

/** Write records as JSONL; `.gz` suffix → gzip. Atomic (tmp → rename). */
export function writeTrace(file: string, records: readonly TraceRecord[]): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, file.endsWith('.gz') ? gzipSync(body, { level: 6 }) : body)
  renameSync(tmp, file)
}

/** Read a JSONL trace (plain or `.gz`). Throws with the line number on malformed input. */
export function readTrace(file: string): TraceRecord[] {
  const raw = readFileSync(file)
  const text = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
  const out: TraceRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    try {
      out.push(JSON.parse(line) as TraceRecord)
    } catch (err) {
      throw new Error(`${file}:${i + 1}: invalid JSON (${(err as Error).message})`)
    }
  }
  return out
}
