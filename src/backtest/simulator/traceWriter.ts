import { writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { AccountEvent, PortfolioSnapshot, MarketTick } from '../../strategy/Strategy.js'
import type { RunSingleMarketInput } from '../runSingleMarket.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import { computePolymarketTakerFee } from '../../trading/fees.js'
import { feedClockMs } from '../feeds/wireBacktestExternalFeeds.js'
import {
  emptyDisplayState,
  type TraceChunk,
  type TraceFrame,
  type DisplayBook,
  type DisplayState,
  type ChunkIndex,
  type ChartPoint,
  type ActionIndex,
} from './contracts.js'

export function writeJsonAtomic(file: string, data: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(data))
  renameSync(`${file}.tmp`, file)
}

/** Copy immediately: portfolio snapshots and plugin values can change after the callback. */
function copy<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
  ) as T
}
function book(b: OrderBookSnapshot | undefined): DisplayBook | null {
  return b
    ? {
        timestamp: b.timestamp,
        bid: b.bestBid,
        ask: b.bestAsk,
        bids: b.bids.slice(0, 10).map((l) => [l.price, l.size]),
        asks: b.asks.slice(0, 10).map((l) => [l.price, l.size]),
      }
    : null
}

export class TraceWriter {
  readonly chunks: ChunkIndex[] = []
  readonly actions: ActionIndex[] = []
  readonly chart: ChartPoint[] = []
  ticks = 0
  private seq = 0
  private clock = 0
  private frame: TraceFrame | undefined
  private state: DisplayState = emptyDisplayState()
  private context: unknown = null
  private contextKey = 'null'
  private chunk: TraceChunk = { version: 1, frames: [], states: [this.state], contexts: [null] }
  private stateId = 0
  private contextId = 0
  private bytes = 0
  private readonly fills = new Set<string>()
  private readonly splits = new Set<string>()
  private readonly pendingCancels = new Set<string>()
  // Keep each time bucket's first, last and quote extrema in original tick order.
  private chartBucket = -1
  private chartCandidates: ChartPoint[] = []

  constructor(
    private readonly directory: string,
    private readonly tokens: { UP: string; DOWN: string },
    private readonly progress: (ticks: number) => void = () => {},
    private readonly chunkSize = 2000,
  ) {}

  private outcome(asset: string): string {
    return asset === this.tokens.UP ? 'UP' : asset === this.tokens.DOWN ? 'DOWN' : asset
  }

  readonly observer: NonNullable<RunSingleMarketInput['observer']> = {
    onCapital: (capital) => {
      const previous = this.state.capital
      if (!capital) return
      if (
        previous?.startingCapital === capital.startingCapital &&
        previous.cash === capital.cash &&
        previous.reservedCash === capital.reservedCash &&
        previous.availableCash === capital.availableCash
      )
        return
      this.state = { ...this.state, capital: { ...capital } }
      this.stateId = this.chunk.states.push(this.state) - 1
    },
    onTickStart: (tick: MarketTick) => {
      if (this.ticks >= 2_000_000)
        throw new Error('Simulator limit: two million strategy ticks per market.')
      this.clock = Math.max(this.clock, feedClockMs(tick))
      this.frame = {
        tick: this.ticks++,
        seq: this.seq++,
        time: this.clock,
        exchangeTime: tick.snapshot.timestamp,
        receiveTime: tick.source.kind === 'parquet' ? (tick.source.tsLocalMs ?? null) : null,
        ingestSeq: tick.source.kind === 'parquet' ? String(tick.source.ingestSeq) : null,
        kind: tick.msg.event_type,
        up: book(tick.snapshot.byAssetId[this.tokens.UP]),
        down: book(tick.snapshot.byAssetId[this.tokens.DOWN]),
        state: this.stateId,
        context: this.contextId,
        actions: [],
      }
    },
    onContext: (ctx) => {
      // Only the feed snapshot seen by this callback; never refresh or query a plugin here.
      const value = ctx?.plugins?.externalFeeds ?? null
      const key = JSON.stringify(value)
      if (key === this.contextKey) return
      if (key.length > 200_000) throw new Error('External feed snapshot exceeds simulator limit.')
      this.contextKey = key
      this.context = JSON.parse(key) as unknown
      this.contextId = this.chunk.contexts.push(this.context) - 1
    },
    onDecision: (origin, intents) => {
      for (const intent of intents ?? []) {
        const raw = copy(intent) as unknown as Record<string, unknown>
        if (intent.kind.startsWith('cancel_')) {
          for (const order of this.state.orders) {
            const references = intent.kind === 'cancel_batch' ? intent.orders : []
            if (
              intent.kind === 'cancel_all' ||
              (intent.kind === 'cancel_market' &&
                (intent.market !== undefined || intent.assetId !== undefined) &&
                (intent.market === undefined || intent.market === order.market) &&
                (intent.assetId === undefined || intent.assetId === order.assetId)) ||
              raw.clientOrderId === order.id ||
              (order.orderId !== null && raw.orderId === order.orderId) ||
              references.some(
                (r) =>
                  r.clientOrderId === order.id ||
                  (order.orderId !== null && r.orderId === order.orderId),
              )
            ) {
              this.pendingCancels.add(order.id)
            }
          }
          this.state = {
            ...this.state,
            orders: this.state.orders.map((o) => ({
              ...o,
              cancelRequested: this.pendingCancels.has(o.id),
            })),
          }
          this.stateId = this.chunk.states.push(this.state) - 1
        }
        const label =
          intent.kind === 'place_limit'
            ? `${origin}: request ${intent.side} ${this.outcome(intent.assetId)} ${intent.size.toFixed(2)} @ ${(intent.price * 100).toFixed(1)}¢ · ${intent.orderType}${intent.postOnly ? ' post-only' : ''}`
            : `${origin}: ${intent.kind}`
        this.action(`intent:${intent.kind}`, label, raw)
      }
    },
    onAccountEvent: (event, portfolio) => {
      this.updateState(event, portfolio)
      let label: string = event.kind
      let marker: Pick<ActionIndex, 'price' | 'side' | 'outcome'> = {}
      if (event.kind === 'fill') {
        const f = event.fill
        label = `${f.side} ${this.outcome(f.assetId)} ${f.size.toFixed(2)} @ ${(f.price * 100).toFixed(1)}¢ (${f.liquidity ?? 'unknown'})`
        marker = { price: f.price, side: f.side, outcome: this.outcome(f.assetId) }
      } else if ('reason' in event) label += `: ${event.reason}`
      const cid =
        event.kind === 'fill'
          ? event.fill.clientOrderId
          : 'clientOrderId' in event
            ? event.clientOrderId
            : undefined
      const orderMeta = cid ? portfolio.ordersByClientId[cid]?.meta : undefined
      this.action(
        event.kind,
        label,
        copy({ ...event, ...(orderMeta ? { orderMeta } : {}) }),
        marker,
      )
    },
    onTickEnd: () => {
      const f = this.frame
      if (!f) return
      f.state = this.stateId
      f.context = this.contextId
      this.chunk.frames.push(f)
      this.sampleChart({
        tick: f.tick,
        time: f.time,
        upBid: f.up?.bid ?? null,
        upAsk: f.up?.ask ?? null,
        downBid: f.down?.bid ?? null,
        downAsk: f.down?.ask ?? null,
      })
      this.frame = undefined
      if (this.chunk.frames.length >= this.chunkSize) this.flush()
    },
  }

  private action(
    kind: string,
    label: string,
    detail: unknown,
    marker: Pick<ActionIndex, 'price' | 'side' | 'outcome'> = {},
  ): void {
    const frame = this.frame
    if (!frame) throw new Error('Account observation outside a simulator tick')
    if (this.actions.length >= 100_000)
      throw new Error('Simulator limit: 100,000 actions per market.')
    const seq = this.seq++
    frame.actions.push({ seq, kind, label, state: this.stateId, context: this.contextId, detail })
    this.actions.push({ tick: frame.tick, seq, time: frame.time, kind, label, ...marker })
  }

  private updateState(event: AccountEvent, portfolio: PortfolioSnapshot): void {
    let { cashDelta, fees, fills } = this.state
    if (event.kind === 'fill' && !this.fills.has(event.fill.id)) {
      const f = event.fill
      this.fills.add(f.id)
      const fee =
        f.liquidity === 'TAKER' && f.feeRateBps !== undefined
          ? computePolymarketTakerFee({ feeRateBps: f.feeRateBps, price: f.price, size: f.size })
          : 0
      cashDelta += (f.side === 'BUY' ? -1 : 1) * f.price * f.size - fee
      fees += fee
      fills++
    }
    if (event.kind === 'positions_split' && !this.splits.has(event.split.id)) {
      this.splits.add(event.split.id)
      cashDelta -= event.split.splitCost
    }
    if (event.kind === 'positions_merged') {
      // Count only the quantity the authoritative portfolio actually removed.
      const before = event.assetIdA === this.tokens.UP ? this.state.up.qty : this.state.down.qty
      const after = portfolio.positionsByAssetId[event.assetIdA]?.qty ?? 0
      cashDelta += Math.max(0, before - after)
    }
    if (event.kind === 'cancel_failed') {
      if (event.clientOrderId) this.pendingCancels.delete(event.clientOrderId)
      else this.pendingCancels.clear()
    }
    const position = (asset: string) => {
      const p = portfolio.positionsByAssetId[asset]
      return { qty: p?.qty ?? 0, cost: p?.costBasis ?? 0, average: p?.avgEntryPrice ?? null }
    }
    const open = Object.values(portfolio.openOrdersByClientId)
    for (const id of this.pendingCancels)
      if (!open.some((o) => o.clientOrderId === id)) this.pendingCancels.delete(id)
    this.state = {
      capital: portfolio.capital ? { ...portfolio.capital } : null,
      up: position(this.tokens.UP),
      down: position(this.tokens.DOWN),
      cashDelta,
      fees,
      fills,
      realized: portfolio.realizedPnlTotal ?? 0,
      orders: open.map((o) => ({
        id: o.clientOrderId,
        orderId: o.orderId ?? null,
        assetId: o.assetId,
        market: o.market ?? portfolio.marketByAssetId[o.assetId] ?? null,
        outcome: this.outcome(o.assetId),
        side: o.side,
        price: o.price,
        size: o.size,
        remaining: o.remaining,
        filled: o.filled,
        state: o.state,
        type: o.orderType,
        postOnly: o.postOnly ?? false,
        cancelRequested: this.pendingCancels.has(o.clientOrderId),
        meta: o.meta ? copy(o.meta) : null,
      })),
    }
    this.stateId = this.chunk.states.push(this.state) - 1
  }

  private sampleChart(point: ChartPoint): void {
    const bucket = Math.floor(point.time / 1000)
    if (bucket !== this.chartBucket) {
      this.flushChart()
      this.chartBucket = bucket
    }
    this.chartCandidates.push(point)
    // A frozen/backward source clock must not make the overview buffer grow without bound.
    if (this.chartCandidates.length > 32) this.chartCandidates = this.chartExtrema()
  }

  private chartExtrema(): ChartPoint[] {
    const points = this.chartCandidates
    if (!points.length) return []
    const selected = new Set<ChartPoint>([points[0]!, points[points.length - 1]!])
    for (const key of ['upBid', 'upAsk', 'downBid', 'downAsk'] as const) {
      let min: ChartPoint | undefined, max: ChartPoint | undefined
      for (const p of points) {
        if (p[key] === null) continue
        if (!min || p[key]! < min[key]!) min = p
        if (!max || p[key]! > max[key]!) max = p
      }
      if (min) selected.add(min)
      if (max) selected.add(max)
    }
    return [...selected].sort((a, b) => a.tick - b.tick)
  }

  private flushChart(): void {
    this.chart.push(...this.chartExtrema())
    this.chartCandidates = []
  }

  private flush(): void {
    const frames = this.chunk.frames
    if (!frames.length) return
    const id = this.chunks.length
    const data = gzipSync(JSON.stringify(this.chunk), { level: 1 })
    this.bytes += data.length
    if (this.bytes > 512 * 1024 * 1024)
      throw new Error('Simulator trace exceeds 512 MB per-market limit.')
    writeFileSync(path.join(this.directory, `${id}.json.gz`), data)
    this.chunks.push({
      id,
      firstTick: frames[0]!.tick,
      lastTick: frames.at(-1)!.tick,
      startTime: frames[0]!.time,
      endTime: frames.at(-1)!.time,
      bytes: data.length,
    })
    this.chunk = { version: 1, frames: [], states: [this.state], contexts: [this.context] }
    this.stateId = 0
    this.contextId = 0
    this.progress(this.ticks)
  }

  finish(): void {
    this.flush()
    this.flushChart()
  }
}
