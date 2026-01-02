import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../../market/orderbook/index.js'

/**
 * Minimal state needed for a read-only bot monitoring UI (web or otherwise).
 *
 * Intentionally mirrors the existing blessed TUI state shape, but without any TUI dependency.
 */
export type BotUiSourceState = {
  symbol: string
  slug?: string
  candleLeftMs: number
  wsAttempt: number
  wsEventsTotal: number
  market?: MarketOrderBooksSnapshot
  upAssetId?: string
  downAssetId?: string
}

export type BotUiOrderBookLevel = {
  price: number
  size: number
}

export type BotUiOrderBook = {
  bestBid?: number
  bestAsk?: number
  bids: BotUiOrderBookLevel[]
  asks: BotUiOrderBookLevel[]
}

export type BotUiSnapshot = {
  nowMs: number
  title: string
  status: {
    symbol: string
    slug?: string
    candleLeftMs: number
    wsAttempt: number
    wsEventsTotal: number
    upAssetId?: string
    downAssetId?: string
  }
  books: {
    up?: BotUiOrderBook
    down?: BotUiOrderBook
  }
}

export function toBotUiOrderBook(book: OrderBookSnapshot | undefined, levels: number): BotUiOrderBook | undefined {
  if (!book) return undefined
  const n = Math.max(1, Math.floor(levels))
  const bids = (book.bids ?? []).slice(0, n).map((x) => ({ price: x.price, size: x.size }))
  const asks = (book.asks ?? []).slice(0, n).map((x) => ({ price: x.price, size: x.size }))
  return {
    ...(typeof book.bestBid === 'number' ? { bestBid: book.bestBid } : {}),
    ...(typeof book.bestAsk === 'number' ? { bestAsk: book.bestAsk } : {}),
    bids,
    asks,
  }
}


