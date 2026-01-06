export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type BotUiOrderBookLevel = {
  price: number
  size: number
}

export type BotUiOrderBook = {
  bestBid?: number
  bestAsk?: number
  bids: BotUiOrderBookLevel[]
  asks: BotUiOrderBookLevel[]
  depthLevels?: number
  bidsDepthByLevel?: number[]
  asksDepthByLevel?: number[]
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
  // These are forwarded from the backend as raw snapshot objects.
  // We keep them permissive here so the UI doesn't break when backend evolves.
  feeds?: unknown
  indicators?: unknown
  portfolio?: unknown
  metrics?: unknown
}

export type WsSnapshotMsg = {
  type: 'snapshot'
  snapshot: BotUiSnapshot
  logsText?: { from: number; to: number; lines: string[] }
}

export type BotUiCommand =
  | { kind: 'cancel_order'; orderId?: string; clientOrderId?: string }
  | { kind: 'cancel_all' }

export type WsCommandMsg = {
  type: 'command'
  id: string
  command: BotUiCommand
}

export type WsCommandAckMsg = {
  type: 'command_ack'
  id: string
  ok: boolean
  error?: string
}

export type WsClientMsg = WsCommandMsg
export type WsServerMsg = WsSnapshotMsg | WsCommandAckMsg


