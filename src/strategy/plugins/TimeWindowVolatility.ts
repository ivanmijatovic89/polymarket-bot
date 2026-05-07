import type { MarketTick } from '../Strategy.js'
import type { Plugin } from './PluginSet.js'

type Sample = { tsMs: number; price: number }

class Deque<T> {
  private a: T[] = []
  private head = 0

  get length(): number {
    return this.a.length - this.head
  }

  at(i: number): T {
    return this.a[this.head + i]!
  }

  push(v: T): void {
    this.a.push(v)
  }

  pop(): T | undefined {
    return this.a.pop()
  }

  shift(): T | undefined {
    if (this.length <= 0) return undefined
    const v = this.a[this.head]
    this.head += 1
    // occasional compaction
    if (this.head > 1024 && this.head * 2 > this.a.length) {
      this.a = this.a.slice(this.head)
      this.head = 0
    }
    return v
  }

  peekFirst(): T | undefined {
    return this.length > 0 ? this.a[this.head] : undefined
  }

  peekLast(): T | undefined {
    return this.length > 0 ? this.a[this.a.length - 1] : undefined
  }

  clear(): void {
    this.a = []
    this.head = 0
  }
}

export type VolatilityWindowStats = {
  windowMs: number
  n: number
  startTsMs: number | null
  endTsMs: number | null
  coverageMs: number | null
  ready: boolean
  /**
   * If `ready` is false but we have previously produced a ready value, we keep the last computed metrics
   * and expose how stale they are. Null means either never ready yet, or no samples.
   */
  staleMs: number | null
  /**
   * Oldest sample price in this window.
   * Only populated when the window is ready, otherwise kept from the last computed ready value (if any).
   */
  startPrice: number | null
  /**
   * Newest sample price in this window.
   * Only populated when the window is ready, otherwise kept from the last computed ready value (if any).
   */
  endPrice: number | null
  /**
   * Net move over the window: endPrice - startPrice.
   * Only populated when the window is ready, otherwise kept from the last computed ready value (if any).
   */
  netChange: number | null
  low: number | null
  high: number | null
  stddev: number | null
  highLowRange: number | null
  avgAbsChange: number | null
}

export type VolatilitySnapshot = {
  asOfTsMs: number | null
  /**
   * assetId -> (windowLabel -> stats)
   */
  byAssetId: Record<string, Record<string, VolatilityWindowStats>>
}

class RollingTimeWindow {
  private readonly windowMs: number
  private readonly samples = new Deque<Sample>()

  // stddev
  private n = 0
  private sum = 0
  private sumSq = 0

  // avg abs change between adjacent samples
  private sumAbsDiff = 0

  // monotonic min/max queues
  private readonly minQ = new Deque<Sample>() // increasing price
  private readonly maxQ = new Deque<Sample>() // decreasing price

  private lastComputed: {
    atTsMs: number
    startPrice: number
    endPrice: number
    netChange: number
    low: number | null
    high: number | null
    stddev: number
    highLowRange: number | null
    avgAbsChange: number
  } | null = null

  constructor(windowMs: number) {
    this.windowMs = windowMs
  }

  reset(): void {
    this.samples.clear()
    this.minQ.clear()
    this.maxQ.clear()
    this.n = 0
    this.sum = 0
    this.sumSq = 0
    this.sumAbsDiff = 0
    this.lastComputed = null
  }

  update(tsMs: number, price: number): void {
    const cutoff = tsMs - this.windowMs

    // evict old samples (and maintain sumAbsDiff for removed adjacency)
    while (this.samples.length > 0 && this.samples.peekFirst()!.tsMs < cutoff) {
      if (this.samples.length >= 2) {
        const first = this.samples.at(0)
        const second = this.samples.at(1)
        this.sumAbsDiff -= Math.abs(second.price - first.price)
      }
      const old = this.samples.shift()!
      this.n -= 1
      this.sum -= old.price
      this.sumSq -= old.price * old.price
    }

    // evict from min/max queues
    while (this.minQ.length > 0 && this.minQ.peekFirst()!.tsMs < cutoff) this.minQ.shift()
    while (this.maxQ.length > 0 && this.maxQ.peekFirst()!.tsMs < cutoff) this.maxQ.shift()

    // add new sample (and add adjacency diff)
    const last = this.samples.peekLast()
    if (last) this.sumAbsDiff += Math.abs(price - last.price)

    const s: Sample = { tsMs, price }
    this.samples.push(s)

    this.n += 1
    this.sum += price
    this.sumSq += price * price

    while (this.minQ.length > 0 && this.minQ.peekLast()!.price >= price) this.minQ.pop()
    this.minQ.push(s)

    while (this.maxQ.length > 0 && this.maxQ.peekLast()!.price <= price) this.maxQ.pop()
    this.maxQ.push(s)
  }

  stats(): VolatilityWindowStats {
    if (this.n <= 0) {
      return {
        windowMs: this.windowMs,
        n: 0,
        startTsMs: null,
        endTsMs: null,
        coverageMs: null,
        ready: false,
        staleMs: null,
        startPrice: null,
        endPrice: null,
        netChange: null,
        low: null,
        high: null,
        stddev: null,
        highLowRange: null,
        avgAbsChange: null,
      }
    }

    const startTsMs = this.samples.peekFirst()!.tsMs
    const endTsMs = this.samples.peekLast()!.tsMs
    const coverageMs = Math.max(0, endTsMs - startTsMs)
    const ready = coverageMs >= this.windowMs * 0.93 && this.n >= 6

    if (!ready) {
      const staleMs =
        this.lastComputed && endTsMs >= this.lastComputed.atTsMs
          ? endTsMs - this.lastComputed.atTsMs
          : null
      return {
        windowMs: this.windowMs,
        n: this.n,
        startTsMs,
        endTsMs,
        coverageMs,
        ready,
        staleMs,
        startPrice: this.lastComputed ? this.lastComputed.startPrice : null,
        endPrice: this.lastComputed ? this.lastComputed.endPrice : null,
        netChange: this.lastComputed ? this.lastComputed.netChange : null,
        low: this.lastComputed ? this.lastComputed.low : null,
        high: this.lastComputed ? this.lastComputed.high : null,
        stddev: this.lastComputed ? this.lastComputed.stddev : null,
        highLowRange: this.lastComputed ? this.lastComputed.highLowRange : null,
        avgAbsChange: this.lastComputed ? this.lastComputed.avgAbsChange : null,
      }
    }

    const startPrice = this.samples.peekFirst()!.price
    const endPrice = this.samples.peekLast()!.price
    const netChange = endPrice - startPrice

    const mean = this.sum / this.n
    const variance = Math.max(0, this.sumSq / this.n - mean * mean)
    const stddev = Math.sqrt(variance)

    const low = this.minQ.peekFirst()?.price ?? null
    const high = this.maxQ.peekFirst()?.price ?? null
    const highLowRange = low != null && high != null ? high - low : null

    const avgAbsChange = this.n >= 2 ? this.sumAbsDiff / (this.n - 1) : 0

    this.lastComputed = {
      atTsMs: endTsMs,
      startPrice,
      endPrice,
      netChange,
      low,
      high,
      stddev,
      highLowRange,
      avgAbsChange,
    }

    return {
      windowMs: this.windowMs,
      n: this.n,
      startTsMs,
      endTsMs,
      coverageMs,
      ready,
      staleMs: 0,
      startPrice,
      endPrice,
      netChange,
      low,
      high,
      stddev,
      highLowRange,
      avgAbsChange,
    }
  }
}

export type TimeWindowVolatilityConfig = {
  /**
   * Label -> window length in ms.
   * Example: { '1s': 1000, '2s': 2000 }
   */
  windows: Record<string, number>
  /**
   * Which orderbook-derived price to track.
   *
   * - `bid`: uses `book.bestBid`
   * - `ask`: uses `book.bestAsk`
   * - `mid`: uses `book.mid`
   *
   * Default: `mid`
   */
  trackPrice?: 'bid' | 'ask' | 'mid'
}

/**
 * Time-based volatility plugin using a chosen price (bid/ask/mid) per asset.
 *
 * Updates every tick and exposes precomputed stats via snapshot().
 */
export class TimeWindowVolatility implements Plugin {
  readonly id = 'timeWindowVolatility'

  private readonly windows: Record<string, number>
  private readonly trackPrice: 'bid' | 'ask' | 'mid'
  private readonly byAssetId = new Map<string, Record<string, RollingTimeWindow>>()
  private asOfTsMs: number | null = null

  constructor(cfg: TimeWindowVolatilityConfig) {
    this.windows = cfg.windows
    this.trackPrice = cfg.trackPrice ?? 'mid'
  }

  reset(): void {
    for (const perAsset of this.byAssetId.values()) {
      for (const w of Object.values(perAsset)) w.reset()
    }
    this.byAssetId.clear()
    this.asOfTsMs = null
  }

  onMarketTick(tick: MarketTick): void {
    const tsMs = tick.snapshot.timestamp
    this.asOfTsMs = tsMs

    for (const [assetId, book] of Object.entries(tick.snapshot.byAssetId)) {
      const price =
        this.trackPrice === 'bid'
          ? book.bestBid
          : this.trackPrice === 'ask'
            ? book.bestAsk
            : book.mid
      if (price == null) continue

      let ws = this.byAssetId.get(assetId)
      if (!ws) {
        ws = {}
        for (const [label, ms] of Object.entries(this.windows)) {
          ws[label] = new RollingTimeWindow(ms)
        }
        this.byAssetId.set(assetId, ws)
      }

      for (const w of Object.values(ws)) w.update(tsMs, price)
    }
  }

  snapshot(): VolatilitySnapshot {
    const out: VolatilitySnapshot = { asOfTsMs: this.asOfTsMs, byAssetId: {} }
    for (const [assetId, ws] of this.byAssetId) {
      const byWindow: Record<string, VolatilityWindowStats> = {}
      for (const [label, w] of Object.entries(ws)) byWindow[label] = w.stats()
      out.byAssetId[assetId] = byWindow
    }
    return out
  }
}
