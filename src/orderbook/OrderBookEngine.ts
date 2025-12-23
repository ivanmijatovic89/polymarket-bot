/**
 * Polymarket Market-channel order book reconstruction.
 *
 * Key rules from Polymarket docs:
 * - `book` is a full snapshot (source-of-truth) and must replace local state.
 * - `price_change` is a delta: it updates a single price level to a NEW aggregate size.
 * - `last_trade_price` does NOT mutate the book (subsequent `book` and/or `price_change` will).
 *
 * Implementation notes:
 * - We use `number` internally for price/size for now. TODO: migrate to integer ticks (e.g. price in 1e6)
 *   to avoid floating point issues when keying by decimal prices.
 * - We maintain Map insertion order such that:
 *   - bids iterate in DESC price order
 *   - asks iterate in ASC price order
 *   This makes snapshot output deterministic without sorting each time.
 */

export type Side = 'BUY' | 'SELL'

export interface OrderLevel {
  price: number
  size: number
}

export type SideBook = Map<number, OrderLevel> // key = price (number)

export interface OrderBookSnapshot {
  market: string
  assetId: string
  timestamp: number
  bestBid: number | null
  bestAsk: number | null
  mid: number | null
  spread: number | null
  bids: OrderLevel[] // ALL levels, sorted DESC by price
  asks: OrderLevel[] // ALL levels, sorted ASC by price
}

export interface BookMessage {
  event_type: 'book'
  asset_id: string
  market: string
  bids: { price: string; size: string }[]
  asks: { price: string; size: string }[]
  timestamp: string
  hash: string
}

export interface PriceChange {
  asset_id: string
  price: string
  size: string // NEW aggregate size at that level
  side: Side
  hash: string
  best_bid: string
  best_ask: string
}

export interface PriceChangeMessage {
  event_type: 'price_change'
  market: string
  price_changes: PriceChange[]
  timestamp: string
}

/**
 * Tick size change messages are inconsistent across Polymarket docs/examples.
 * The current official event structure example does NOT include `side`.
 *
 * We keep `side` optional for tolerance (some historical captures may include it).
 */
export interface TickSizeChangeMessage {
  event_type: 'tick_size_change'
  asset_id: string
  market: string
  old_tick_size: string
  new_tick_size: string
  side?: Side
  timestamp: string
}

export interface LastTradePriceMessage {
  event_type: 'last_trade_price'
  asset_id: string
  market: string
  price: string
  side: Side
  size: string
  fee_rate_bps: string
  timestamp: string
}

export type AnyMarketMessage =
  | BookMessage
  | PriceChangeMessage
  | TickSizeChangeMessage
  | LastTradePriceMessage

export interface OrderBookState {
  market: string
  assetId: string
  bids: SideBook
  asks: SideBook
  tickSizeBuy: number | null
  tickSizeSell: number | null
  lastUpdateTs: number
  lastBookHash?: string
}

export type RecentTrade = {
  price: number
  size: number
  side: Side
  timestamp: number
}

function parseNum(label: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`[orderbook] invalid ${label}: ${JSON.stringify(raw)}`)
  }
  return n
}

function parseTsMs(raw: string): number {
  // Polymarket uses unix ms encoded as strings.
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`[orderbook] invalid timestamp: ${JSON.stringify(raw)}`)
  return Math.trunc(n)
}

function toSortedLevelsFromBookSide(
  side: 'bids' | 'asks',
  levels: { price: string; size: string }[],
): OrderLevel[] {
  const out: OrderLevel[] = []
  for (const lvl of levels) {
    const price = parseNum(`${side}.price`, lvl.price)
    const size = parseNum(`${side}.size`, lvl.size)
    if (size <= 0) continue
    out.push({ price, size })
  }
  if (side === 'bids') out.sort((a, b) => b.price - a.price)
  else out.sort((a, b) => a.price - b.price)
  return out
}

function rebuildMapSorted(levels: OrderLevel[]): SideBook {
  const m: SideBook = new Map()
  for (const lvl of levels) m.set(lvl.price, lvl)
  return m
}

function bestFromSortedMap(map: SideBook): number | null {
  for (const p of map.keys()) return p
  return null
}

function getMid(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid === null || bestAsk === null) return null
  return (bestBid + bestAsk) / 2
}

function getSpread(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid === null || bestAsk === null) return null
  return bestAsk - bestBid
}

export class OrderBookEngine {
  private state: OrderBookState
  private readonly recentTrades: RecentTrade[] = []
  private readonly maxRecentTrades: number

  constructor(params: { market: string; assetId: string; maxRecentTrades?: number }) {
    this.state = {
      market: params.market,
      assetId: params.assetId,
      bids: new Map(),
      asks: new Map(),
      tickSizeBuy: null,
      tickSizeSell: null,
      lastUpdateTs: 0,
    }
    this.maxRecentTrades = Math.max(0, params.maxRecentTrades ?? 200)
  }

  getState(): Readonly<OrderBookState> {
    return this.state
  }

  getRecentTrades(): readonly RecentTrade[] {
    return this.recentTrades
  }

  snapshot(): OrderBookSnapshot {
    const bestBid = bestFromSortedMap(this.state.bids)
    const bestAsk = bestFromSortedMap(this.state.asks)
    return {
      market: this.state.market,
      assetId: this.state.assetId,
      timestamp: this.state.lastUpdateTs,
      bestBid,
      bestAsk,
      mid: getMid(bestBid, bestAsk),
      spread: getSpread(bestBid, bestAsk),
      bids: [...this.state.bids.values()],
      asks: [...this.state.asks.values()],
    }
  }

  applyBook(msg: BookMessage): void {
    this.assertMarketAsset({ market: msg.market, asset_id: msg.asset_id, event_type: msg.event_type })
    const bids = toSortedLevelsFromBookSide('bids', msg.bids)
    const asks = toSortedLevelsFromBookSide('asks', msg.asks)
    this.state.bids = rebuildMapSorted(bids)
    this.state.asks = rebuildMapSorted(asks)
    this.state.lastUpdateTs = parseTsMs(msg.timestamp)
    this.state.lastBookHash = msg.hash
  }

  applyPriceChange(msg: PriceChangeMessage): void {
    this.assertMarket({ market: msg.market, event_type: msg.event_type })
    this.state.lastUpdateTs = parseTsMs(msg.timestamp)

    // Apply deltas. If new levels are introduced, we rebuild the affected side map
    // to preserve deterministic iteration order (bids DESC, asks ASC).
    let insertedBid = false
    let insertedAsk = false

    for (const ch of msg.price_changes) {
      if (ch.asset_id !== this.state.assetId) continue

      const price = parseNum('price_change.price', ch.price)
      const size = parseNum('price_change.size', ch.size)

      const sideBook = ch.side === 'BUY' ? this.state.bids : this.state.asks
      const had = sideBook.has(price)

      if (size <= 0) {
        sideBook.delete(price)
        continue
      }

      sideBook.set(price, { price, size })
      if (!had) {
        if (ch.side === 'BUY') insertedBid = true
        else insertedAsk = true
      }
    }

    if (insertedBid) this.state.bids = this.resortSide(this.state.bids, 'bids')
    if (insertedAsk) this.state.asks = this.resortSide(this.state.asks, 'asks')
  }

  applyTickSizeChange(msg: TickSizeChangeMessage): void {
    this.assertMarketAsset({ market: msg.market, asset_id: msg.asset_id, event_type: msg.event_type })
    this.state.lastUpdateTs = parseTsMs(msg.timestamp)
    const newTick = parseNum('tick_size_change.new_tick_size', msg.new_tick_size)

    // Docs example doesn't include side; when missing, apply to both for now.
    if (msg.side === 'BUY') this.state.tickSizeBuy = newTick
    else if (msg.side === 'SELL') this.state.tickSizeSell = newTick
    else {
      this.state.tickSizeBuy = newTick
      this.state.tickSizeSell = newTick
    }
  }

  applyLastTradePrice(msg: LastTradePriceMessage): void {
    this.assertMarketAsset({ market: msg.market, asset_id: msg.asset_id, event_type: msg.event_type })
    this.state.lastUpdateTs = parseTsMs(msg.timestamp)

    // DO NOT mutate the order book here. Book impact comes via `book` and/or `price_change`.
    if (this.maxRecentTrades <= 0) return
    const trade: RecentTrade = {
      price: parseNum('last_trade_price.price', msg.price),
      size: parseNum('last_trade_price.size', msg.size),
      side: msg.side,
      timestamp: parseTsMs(msg.timestamp),
    }
    this.recentTrades.push(trade)
    if (this.recentTrades.length > this.maxRecentTrades) {
      this.recentTrades.splice(0, this.recentTrades.length - this.maxRecentTrades)
    }
  }

  applyAny(msg: AnyMarketMessage): void {
    switch (msg.event_type) {
      case 'book':
        this.applyBook(msg)
        return
      case 'price_change':
        this.applyPriceChange(msg)
        return
      case 'tick_size_change':
        this.applyTickSizeChange(msg)
        return
      case 'last_trade_price':
        this.applyLastTradePrice(msg)
        return
      default: {
        const _exhaustive: never = msg
        throw new Error(`[orderbook] unknown event_type ${(msg as { event_type?: unknown }).event_type}`)
      }
    }
  }

  private resortSide(map: SideBook, side: 'bids' | 'asks'): SideBook {
    const arr = [...map.values()]
    if (side === 'bids') arr.sort((a, b) => b.price - a.price)
    else arr.sort((a, b) => a.price - b.price)
    return rebuildMapSorted(arr)
  }

  private assertMarket(args: { market: string; event_type: string }): void {
    if (args.market !== this.state.market) {
      throw new Error(
        `[orderbook] market mismatch on ${args.event_type}: expected=${this.state.market} got=${args.market}`,
      )
    }
  }

  private assertMarketAsset(args: { market: string; asset_id: string; event_type: string }): void {
    this.assertMarket({ market: args.market, event_type: args.event_type })
    if (args.asset_id !== this.state.assetId) {
      throw new Error(
        `[orderbook] asset_id mismatch on ${args.event_type}: expected=${this.state.assetId} got=${args.asset_id}`,
      )
    }
  }
}

export type MarketOrderBooksSnapshot = {
  market: string
  /**
   * Timestamp of the last applied message (unix ms).
   * Each individual asset book also has its own timestamp in its snapshot.
   */
  timestamp: number
  /**
   * One order book snapshot per asset_id (CLOB token id).
   * This is what strategies want for token-to-token arbitrage.
   */
  byAssetId: Record<string, OrderBookSnapshot>
}

function groupPriceChangesByAsset(changes: PriceChange[]): Map<string, PriceChange[]> {
  const out = new Map<string, PriceChange[]>()
  for (const ch of changes) {
    const arr = out.get(ch.asset_id) ?? []
    arr.push(ch)
    out.set(ch.asset_id, arr)
  }
  return out
}

/**
 * Market-level orderbook engine: maintains order books for ALL asset_ids under the same `market`.
 *
 * Rationale:
 * - Polymarket condition markets have multiple tokens (usually YES/NO).
 * - Many strategies (e.g. arbitrage) need the latest state of both books on each tick.
 */
export class MarketOrderBookEngine {
  private market: string | undefined
  private lastUpdateTs = 0
  private readonly enginesByAssetId = new Map<string, OrderBookEngine>()

  constructor(params?: { market?: string }) {
    this.market = params?.market
  }

  snapshot(): MarketOrderBooksSnapshot {
    const market = this.market ?? '(unknown)'
    return {
      market,
      timestamp: this.lastUpdateTs,
      byAssetId: Object.fromEntries(
        [...this.enginesByAssetId.entries()].map(([assetId, eng]) => [assetId, eng.snapshot()]),
      ),
    }
  }

  applyAny(msg: AnyMarketMessage): void {
    const msgMarket = 'market' in msg && typeof msg.market === 'string' ? msg.market : undefined
    if (msgMarket) this.assertOrSetMarket(msgMarket, msg.event_type)

    const ts = Number((msg as { timestamp?: unknown }).timestamp)
    if (Number.isFinite(ts)) this.lastUpdateTs = Math.trunc(ts)

    switch (msg.event_type) {
      case 'book': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const eng = this.getOrCreate(msg.market, msg.asset_id)
        eng.applyBook(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        return
      }
      case 'price_change': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const byAsset = groupPriceChangesByAsset(msg.price_changes)
        for (const [assetId, changes] of byAsset.entries()) {
          const eng = this.getOrCreate(msg.market, assetId)
          eng.applyPriceChange({
            event_type: 'price_change',
            market: msg.market,
            price_changes: changes,
            timestamp: msg.timestamp,
          })
        }
        this.lastUpdateTs = parseTsMs(msg.timestamp)
        return
      }
      case 'tick_size_change': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const eng = this.getOrCreate(msg.market, msg.asset_id)
        eng.applyTickSizeChange(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        return
      }
      case 'last_trade_price': {
        this.assertOrSetMarket(msg.market, msg.event_type)
        const eng = this.getOrCreate(msg.market, msg.asset_id)
        eng.applyLastTradePrice(msg)
        this.lastUpdateTs = eng.getState().lastUpdateTs
        return
      }
      default: {
        const _exhaustive: never = msg
        throw new Error(
          `[orderbook] MarketOrderBookEngine unknown event_type ${(msg as { event_type?: unknown }).event_type}`,
        )
      }
    }
  }

  private getOrCreate(market: string, assetId: string): OrderBookEngine {
    const existing = this.enginesByAssetId.get(assetId)
    if (existing) return existing
    const eng = new OrderBookEngine({ market, assetId })
    this.enginesByAssetId.set(assetId, eng)
    return eng
  }

  private assertOrSetMarket(market: string, eventType: string): void {
    if (!this.market) {
      this.market = market
      return
    }
    if (this.market !== market) {
      throw new Error(
        `[orderbook] market mismatch on ${eventType}: expected=${this.market} got=${market}`,
      )
    }
  }
}

