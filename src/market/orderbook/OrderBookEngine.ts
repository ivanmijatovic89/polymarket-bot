import type {
  AnyMarketMessage,
  BookMessage,
  LastTradePriceMessage,
  OrderBookSnapshot,
  OrderBookState,
  PriceChangeMessage,
  RecentTrade,
  SideBook,
  TickSizeChangeMessage,
} from './types.js'
import {
  bestFromSortedMap,
  cumulativeDepthByLevel,
  DEFAULT_DEPTH_LEVELS,
  getMid,
  getSpread,
  parseNum,
  parseTsMs,
  rebuildMapSorted,
  toSortedLevelsFromBookSide,
} from './utils.js'

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
    const bids = [...this.state.bids.values()]
    const asks = [...this.state.asks.values()]
    return {
      market: this.state.market,
      assetId: this.state.assetId,
      timestamp: this.state.lastUpdateTs,
      bestBid,
      bestAsk,
      mid: getMid(bestBid, bestAsk),
      spread: getSpread(bestBid, bestAsk),
      bids,
      asks,
      depthLevels: DEFAULT_DEPTH_LEVELS,
      bidsDepthByLevel: cumulativeDepthByLevel(bids),
      asksDepthByLevel: cumulativeDepthByLevel(asks),
    }
  }

  applyBook(msg: BookMessage): void {
    this.assertMarketAsset({
      market: msg.market,
      asset_id: msg.asset_id,
      event_type: msg.event_type,
    })
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
    this.assertMarketAsset({
      market: msg.market,
      asset_id: msg.asset_id,
      event_type: msg.event_type,
    })
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
    this.assertMarketAsset({
      market: msg.market,
      asset_id: msg.asset_id,
      event_type: msg.event_type,
    })
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
        void _exhaustive
        throw new Error(
          `[orderbook] unknown event_type ${(msg as { event_type?: unknown }).event_type}`,
        )
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
