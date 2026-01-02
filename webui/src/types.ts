export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogRecord = {
  tsMs: number
  level: LogLevel
  msg: string
  fields?: Record<string, unknown>
  data?: unknown
  err?: { name?: string; message?: string; stack?: string }
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
  strategy?: {
    id: string
    name: string
    params: Record<string, unknown>
    indicators: string[]
    externalFeeds: {
      requested?: Record<string, unknown>
      enabled?: {
        rtdsCryptoPrices?: boolean
        binanceWsSpotPrice?: boolean
        polymarketPriceToBeat?: boolean
      }
    }
  }
}

export type WsSnapshotMsg = {
  type: 'snapshot'
  snapshot: BotUiSnapshot
  logsText?: { from: number; to: number; lines: string[] }
  logsJson?: { from: number; to: number; records: LogRecord[] }
}


