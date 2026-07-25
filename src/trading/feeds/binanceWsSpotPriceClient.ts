import { createWsConnection, type WsConnection } from '../../polymarket/ws/wsConnection.js'

export type AggTradeMessage = {
  e: 'aggTrade'
  E: number // event time
  s: string // symbol
  p: string // price
  q: string // quantity
  a: number // agg trade id
  f: number // first trade id
  l: number // last trade id
  T: number // trade time
  m: boolean // buyer is maker
  M: boolean // ignore
}

export type BinanceWsSpotPriceClientOptions = {
  /**
   * Binance spot trading pair symbol, lowercase, e.g. "btcusdt".
   *
   * Docs: stream name is `<symbol>@aggTrade` and "All symbols are lowercase".
   */
  symbol: string
  /**
   * Optional: override base endpoint (default: mainnet).
   * Docs: `wss://stream.binance.com:9443`.
   */
  baseUrl?: string
  onPrice: (u: { symbol: string; tsMs: number; value: number }) => void
  /**
   * Optional: full aggTrade message with local receive time. Used by the
   * recorder/verification tooling, and by the live trading path when
   * synthetic feed ticks are enabled (binanceWsSpotPrice.tickOnTrade).
   */
  onAggTrade?: (agg: AggTradeMessage, receivedAtMs: number) => void
  onStatus?: (s: {
    kind: 'connected' | 'reconnecting' | 'disconnected'
    attempt: number
    info?: string
  }) => void
}

export type BinanceWsSpotPriceClient = {
  start: () => void
  stop: () => void
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseAggTrade(msg: unknown): AggTradeMessage | null {
  if (!msg || typeof msg !== 'object') return null
  const o = msg as Partial<AggTradeMessage>
  if (o.e !== 'aggTrade') return null
  if (typeof o.s !== 'string' || o.s.length === 0) return null
  if (typeof o.p !== 'string' || o.p.length === 0) return null
  if (typeof o.T !== 'number' || !Number.isFinite(o.T)) return null
  return o as AggTradeMessage
}

export function createBinanceWsSpotPriceClient(
  opts: BinanceWsSpotPriceClientOptions,
): BinanceWsSpotPriceClient {
  const symbol = (opts.symbol ?? '').toLowerCase().trim()
  if (!symbol) {
    throw new Error('[binanceWsSpotPrice] missing symbol (e.g. "btcusdt")')
  }

  const base = (opts.baseUrl ?? 'wss://stream.binance.com:9443').replace(/\/+$/, '')
  const url = `${base}/ws/${symbol}@aggTrade`

  let running = false
  let conn: WsConnection | undefined

  let attempt = 0
  let backoffMs = 1_000
  let reconnectTimer: NodeJS.Timeout | undefined

  const clearTimers = (): void => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  const stopConn = (): void => {
    clearTimers()
    conn?.close()
    conn = undefined
  }

  const scheduleReconnect = (info?: string): void => {
    if (!running) return
    clearTimers()
    attempt += 1
    opts.onStatus?.({ kind: 'reconnecting', attempt, ...(info ? { info } : {}) })
    const delay = backoffMs
    reconnectTimer = setTimeout(() => {
      connect()
    }, delay)
    backoffMs = Math.min(10_000, Math.max(1_000, backoffMs * 2))
  }

  const connect = (): void => {
    if (!running) return
    stopConn()

    conn = createWsConnection({
      url,
      wsOptions: {
        perMessageDeflate: false,
        handshakeTimeout: 10_000,
        maxPayload: 10 * 1024 * 1024,
      },
      // Binance WS server sends ping frames; `ws` replies with pong automatically.
      heartbeat: { pingIntervalMs: 0 },
      onOpen: () => {
        backoffMs = 1_000
        opts.onStatus?.({ kind: 'connected', attempt, info: `${symbol}@aggTrade` })
      },
      onMessageText: (raw) => {
        if (!raw) return
        const parsed = safeJsonParse(raw)
        const agg = parseAggTrade(parsed)
        if (!agg) return
        const price = Number(agg.p)
        if (!Number.isFinite(price)) return
        opts.onAggTrade?.(agg, Date.now())
        // Use trade time as the price timestamp for "spot last price"
        opts.onPrice({ symbol: agg.s.toLowerCase(), tsMs: agg.T, value: price })
      },
      onError: (err) => {
        opts.onStatus?.({ kind: 'disconnected', attempt, info: `ws error: ${err.message}` })
      },
      onClose: (code, reason) => {
        opts.onStatus?.({
          kind: 'disconnected',
          attempt,
          info: `code=${code} reason=${reason.toString()}`,
        })
        stopConn()
        scheduleReconnect(`ws closed code=${code}`)
      },
    })
  }

  return {
    start: () => {
      if (running) return
      running = true
      attempt = 1
      backoffMs = 1_000
      connect()
    },
    stop: () => {
      running = false
      stopConn()
    },
  }
}
