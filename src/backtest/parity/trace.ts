import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type {
  AccountEvent,
  Fill,
  Intent,
  MarketTick,
  OrderReference,
  PlaceBatchIntent,
  PortfolioSnapshot,
  PositionsSplit,
} from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import { isSyntheticFeedTick } from '../../market/syntheticTick.js'
import { computePolymarketTakerFee } from '../../trading/fees.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import { feedClockMs } from '../feeds/wireBacktestExternalFeeds.js'
import type { RunSingleMarketInput, RunSingleMarketOutput } from '../runSingleMarket.js'

/**
 * Canonical parity trace `pmb-parity-trace/2` — TypeScript writer
 * (native/spec/22-trace-ledger-journal.md §3).
 *
 * One JSON object per line. The first line is `header`, the last is `final`.
 * Assets are outcome indexes (0 = UP, 1 = DOWN), never token ids; exchange
 * order ids and fill ids are omitted, client ids are resolved through the
 * accepted/open map (22 §3.3). Diagnostic only: the observer copies data and
 * never touches engine state, so a traced replay is behaviorally identical to
 * an untraced one (60 OR-4: no engine change).
 */

export const TRACE_FORMAT = 'pmb-parity-trace'
export const TRACE_VERSION = 2

export type TraceLevel = 'decisions' | 'feeds'

export type TraceRecord = Record<string, unknown> & {
  t: 'header' | 'tick' | 'feeds' | 'intent' | 'event' | 'final'
}

/** Account event kinds written to the trace (22 §3.2). Others are dropped. */
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
  'ws_order_update',
])

/**
 * TS `ws_order_update` statuses that map to a `SettlementStatus` and are traced
 * as `settlement_update` (22 §3.2). `CANCELED` after a FOK kill has no Rust
 * counterpart and is not traced (13 §5.4).
 */
export const SETTLEMENT_STATUSES = new Set(['MATCHED', 'MINED', 'CONFIRMED', 'RETRYING', 'FAILED'])

/** Round float noise to 1e-9 (22 §3.3: "TS rounds to 1e-9"); -0 → 0. */
export function num(x: number): number {
  if (!Number.isFinite(x)) return x
  const r = Math.round(x * 1e9) / 1e9
  return r === 0 ? 0 : r
}

/**
 * Deep copy for the trace: drops `undefined`, stringifies bigints, maps -0 to
 * 0, optionally rounds numbers to 1e-9, and (when `assets` is given) writes
 * token ids as outcome indexes — object keys become "0"/"1", string values
 * become 0/1 (22 §3.3).
 */
function normalizeDeep(
  value: unknown,
  round: boolean,
  assets?: { UP: string; DOWN: string },
): unknown {
  if (typeof value === 'number') return round ? num(value) : value === 0 ? 0 : value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'string' && assets && value !== '') {
    if (value === assets.UP) return 0
    if (value === assets.DOWN) return 1
    return value
  }
  if (Array.isArray(value)) return value.map((v) => normalizeDeep(v, round, assets))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      const key = assets && k === assets.UP ? '0' : assets && k === assets.DOWN ? '1' : k
      out[key] = normalizeDeep(v, round, assets)
    }
    return out
  }
  return value
}

type Observer = NonNullable<RunSingleMarketInput['observer']>

export type TraceHeaderFields = {
  /** Engine version string. TS writes a constant so traces stay byte-identical across trees (60 OR-17). */
  engineVersion: string
  profile: 'ts-compat' | 'realistic'
  slug: string
  candidateKey: string
  level: TraceLevel
}

/** The TS engine version string in the header (60 OR-17 needs it tree-independent). */
// D-PENDING: 22 §3.2 does not define engineVersion for the TS writer; chose the constant "ts" because a commit sha would break the byte-identical TS self-parity of 60 OR-17 (the commit goes into the manifest instead).
export const TS_ENGINE_VERSION = 'ts'

/** Unrounded money values of the `final` record (22 §3.2), recomputed with TS's float expression order. */
export type UnroundedStats = {
  pnl: number
  cost: number
  feesPaid: number
  splitCost: number
  upShares: number
  downShares: number
}

type ResolutionView = {
  tokenMap: Record<string, string>
  outcome: 'UP' | 'DOWN' | null
} | null

export class ParityTraceRecorder {
  readonly records: TraceRecord[] = []
  private ticks = 0
  private seq = -1
  private readonly cidByOrderId = new Map<string, string>()
  private readonly tokens: { UP: string; DOWN: string }
  private readonly fills: Fill[] = []
  private readonly seenFillIds = new Set<string>()
  private readonly splits: PositionsSplit[] = []
  private lastPortfolio: PortfolioSnapshot | undefined

  constructor(
    private readonly header: TraceHeaderFields,
    private readonly resolution: ResolutionView,
  ) {
    this.tokens = {
      UP: resolution?.tokenMap['UP'] ?? '',
      DOWN: resolution?.tokenMap['DOWN'] ?? '',
    }
    this.records.push({
      t: 'header',
      format: TRACE_FORMAT,
      version: TRACE_VERSION,
      engine: 'ts',
      engineVersion: header.engineVersion,
      profile: header.profile,
      slug: header.slug,
      candidateKey: header.candidateKey,
      level: header.level,
    })
  }

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
        if (!this.seenFillIds.has(f.id)) {
          this.seenFillIds.add(f.id)
          this.fills.push(f)
        }
        // The fee TS charges for this fill: Portfolio applies exactly this
        // function to TAKER fills (src/trading/Portfolio.ts:894-899). 22 §3.2:
        // `fee` is the charged fee carried by the fill.
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
        this.splits.push(ev.split)
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
      case 'ws_order_update': {
        // 22 §3.2: traced as settlement_update only when the status maps to a SettlementStatus.
        const status = ev.order.status
        if (status === undefined || !SETTLEMENT_STATUSES.has(status)) return
        return this.push({
          t: 'event',
          seq: this.seq,
          kind: 'settlement_update',
          ts: ev.tsMs,
          cid: this.cidByOrderId.get(ev.order.orderId) ?? null,
          status,
          sizeMatched: ev.order.sizeMatched === undefined ? null : num(ev.order.sizeMatched),
        })
      }
    }
  }

  /**
   * `feeds` record (22 §3.2, level `feeds` only): the feed values and plugin
   * snapshots the strategy sees at this tick. Feed values are external `f64`
   * and are written unrounded (exact comparison, 14 V-3).
   */
  private feeds(ctx: StrategyContext | undefined): void {
    const plugins = (ctx?.plugins ?? {}) as Record<string, unknown>
    const ext = plugins['externalFeeds'] as ExternalFeedsSnapshot | undefined
    const point = (p: { tsMs: number; value: number; receivedAtMs: number } | undefined) =>
      p ? { tsMs: p.tsMs, value: p.value, receivedAtMs: p.receivedAtMs } : null
    const ptb = ext?.polymarketPriceToBeat
    const others: Record<string, unknown> = {}
    // D-PENDING: 22 §3.2 says `plugins` holds every requested plugin; chose to omit `externalFeeds` because its content is the binance/chainlink/priceToBeat fields of this record and feeds are not a plugin in Rust (14 P-4).
    // D-PENDING: 22 §3.3 writes assets as outcome indexes; chose to apply that inside plugin snapshots too (token-id keys -> "0"/"1", token-id values -> 0/1), floats unrounded.
    for (const id of Object.keys(plugins).sort()) {
      if (id === 'externalFeeds') continue
      const snap = plugins[id]
      if (snap !== undefined) others[id] = normalizeDeep(snap, false, this.tokens)
    }
    this.push({
      t: 'feeds',
      seq: this.seq,
      binance: point(ext?.binanceWsSpotPrice),
      chainlink: point(ext?.rtdsPolymarketCryptoPrices?.chainlink),
      priceToBeat: ptb ? { value: ptb.openPrice, receivedAtMs: ptb.receivedAtMs } : null,
      plugins: others,
    })
  }

  readonly observer: Observer = {
    onTickStart: (tick: MarketTick) => {
      this.seq = this.ticks++
      // D-PENDING: 22 §3.2 leaves `xts`/`vts` loosely defined; chose xts = exchange ts of a real tick (absent on synthetic ticks, which have none) and vts = the feed clock at which feed visibility is evaluated (TS feedClockMs, 14 F-7; 12 §4.1).
      const synthetic = isSyntheticFeedTick(tick.msg)
      this.push({
        t: 'tick',
        seq: this.seq,
        ts: tick.snapshot.timestamp,
        cause: tick.msg.event_type,
        ...(synthetic ? {} : { xts: tick.snapshot.timestamp }),
        vts: feedClockMs(tick),
      })
    },
    onTickEnd: () => {},
    onContext: (ctx) => {
      if (this.header.level === 'feeds') this.feeds(ctx)
    },
    onDecision: (origin, intents) => {
      for (const i of intents ?? []) this.intent(origin === 'market' ? 'tick' : 'account', i)
    },
    onAccountEvent: (ev, portfolio) => {
      this.lastPortfolio = portfolio
      this.event(ev)
    },
  }

  /**
   * Unrounded `final` money values (22 §3.2). Recomputed from the delivered
   * account events with the float expression order of
   * `computeMarketStats` (src/backtest/stats/marketStats.ts:100-170), raw
   * floats; the caller verifies that rounding them reproduces the TS stats.
   */
  unrounded(): UnroundedStats {
    const up = this.tokens.UP
    const down = this.tokens.DOWN
    const positions = this.lastPortfolio?.positionsByAssetId ?? {}
    const upPosition = positions[up]
    const downPosition = positions[down]
    const upShares = upPosition?.qty ?? 0
    const downShares = downPosition?.qty ?? 0
    const mergableShares = Math.min(upShares, downShares)
    let feesPaid = 0
    for (const f of this.fills) {
      if (f.liquidity === 'TAKER' && typeof f.feeRateBps === 'number')
        feesPaid += computePolymarketTakerFee({
          feeRateBps: f.feeRateBps,
          price: f.price,
          size: f.size,
        })
    }
    const mergeValue = mergableShares * 1.0
    const remainingUp = upShares - mergableShares
    const remainingDown = downShares - mergableShares
    const redeemValue =
      this.resolution?.outcome === 'UP'
        ? remainingUp * 1.0 + remainingDown * 0.0
        : remainingUp * 0.0 + remainingDown * 1.0
    const splitCost = this.splits.reduce(
      (sum, s) => sum + (Number.isFinite(s.splitCost) ? s.splitCost : 0),
      0,
    )
    const remainingCostBasis =
      (typeof upPosition?.costBasis === 'number' ? upPosition.costBasis : 0) +
      (typeof downPosition?.costBasis === 'number' ? downPosition.costBasis : 0)
    const realizedPnl = this.lastPortfolio?.realizedPnlTotal ?? 0
    const pnl = realizedPnl + mergeValue + redeemValue - remainingCostBasis - splitCost
    return {
      pnl,
      cost: remainingCostBasis,
      feesPaid,
      splitCost,
      upShares,
      downShares,
    }
  }

  /** Last line: the per-market result (execution metadata and V4 capture stripped, 22 §3.2). */
  finish(output: RunSingleMarketOutput): void {
    let stats: unknown = null
    let unrounded: UnroundedStats | null = null
    if (output.marketStats) {
      const { execution: _execution, recorderV4Capture: _capture, ...rest } = output.marketStats
      void _execution
      void _capture
      stats = normalizeDeep(rest, true)
      const raw = this.unrounded()
      assertUnroundedMatchesStats(raw, output.marketStats, output.slug ?? '?')
      unrounded = {
        pnl: num(raw.pnl),
        cost: num(raw.cost),
        feesPaid: num(raw.feesPaid),
        splitCost: num(raw.splitCost),
        upShares: num(raw.upShares),
        downShares: num(raw.downShares),
      }
    }
    this.push({
      t: 'final',
      stats,
      skipReason: output.skipReason ?? null,
      eventsProcessed: output.eventsProcessed,
      eventsByType: output.eventsByType,
      unrounded,
    })
  }

  get tickCount(): number {
    return this.ticks
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Fail loud (R14) when the recomputed unrounded values do not round to the
 * TS stats: the trace would otherwise carry values TS never used.
 */
export function assertUnroundedMatchesStats(
  u: UnroundedStats,
  stats: {
    pnl: number
    cost: number
    feesPaid: number
    splitCost: number
    upShares: number
    downShares: number
  },
  slug: string,
): void {
  const pairs: Array<[keyof UnroundedStats, number]> = [
    ['pnl', stats.pnl],
    ['cost', stats.cost],
    ['feesPaid', stats.feesPaid],
    ['splitCost', stats.splitCost],
    ['upShares', stats.upShares],
    ['downShares', stats.downShares],
  ]
  for (const [k, v] of pairs) {
    if (round2(u[k]) !== v && !(round2(u[k]) === 0 && v === 0))
      throw new Error(
        `[parity-trace] ${slug}: unrounded ${k}=${u[k]} does not round to the TS stat ${v}; the trace writer's event harvest disagrees with runSingleMarket`,
      )
  }
}

/** Serialize records as JSONL (one record per line, trailing newline). */
export function serializeTrace(records: readonly TraceRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

/** Write records as JSONL; `.gz` suffix → gzip level 6 (22 §3.6). Atomic (tmp → rename, 22 §3.1). */
export function writeTrace(file: string, records: readonly TraceRecord[]): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const body = serializeTrace(records)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, file.endsWith('.gz') ? gzipSync(body, { level: 6 }) : body)
  renameSync(tmp, file)
}

/** Read a JSONL trace (plain or `.gz`). Throws with the line number on malformed input. */
export function readTrace(file: string): TraceRecord[] {
  const raw = readFileSync(file)
  const text = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
  return parseTrace(text, file)
}

/** Parse JSONL trace text. Throws with the line number on malformed input. */
export function parseTrace(text: string, label = '<trace>'): TraceRecord[] {
  const out: TraceRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    try {
      out.push(JSON.parse(line) as TraceRecord)
    } catch (err) {
      throw new Error(`${label}:${i + 1}: invalid JSON (${(err as Error).message})`)
    }
  }
  return out
}

/** Decompressed trace bytes (for byte-identity checks, 60 OR-9). */
export function readTraceText(file: string): string {
  const raw = readFileSync(file)
  return (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
}
