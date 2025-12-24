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

export type MarketOrderBookWarning =
  | {
      kind: 'delta_before_book'
      market: string
      assetId: string
      eventType: 'price_change' | 'tick_size_change' | 'last_trade_price'
      timestamp?: number
    }
  | {
      kind: 'non_monotonic_book_timestamp'
      market: string
      assetId: string
      prevTimestamp: number
      nextTimestamp: number
    }
