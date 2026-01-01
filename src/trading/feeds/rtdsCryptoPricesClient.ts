import { createWsConnection, type WsConnection } from '../../polymarket/ws/wsConnection.js'

type RtdsMessage = {
  topic: string
  type: string
  timestamp: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
}

export type RtdsCryptoPricesClientOptions = {
  url?: string
  binanceSymbols: string[]
  chainlinkSymbols: string[]
  onBinanceUpdate: (u: { symbol: string; tsMs: number; value: number }) => void
  onChainlinkUpdate: (u: { symbol: string; tsMs: number; value: number }) => void
  onStatus?: (s: { kind: 'connected' | 'reconnecting' | 'disconnected'; attempt: number; info?: string }) => void
}

export type RtdsCryptoPricesClient = {
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

function asFiniteNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && x.length > 0) {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseUpdatePayload(p: unknown): { symbol: string; timestamp: number; value: number } | null {
  if (!p || typeof p !== 'object') return null
  const obj = p as { symbol?: unknown; timestamp?: unknown; value?: unknown }
  if (typeof obj.symbol !== 'string' || obj.symbol.length === 0) return null
  const ts = asFiniteNumber(obj.timestamp)
  const v = asFiniteNumber(obj.value)
  if (ts === null || v === null) return null
  return { symbol: obj.symbol, timestamp: ts, value: v }
}

export function createRtdsCryptoPricesClient(opts: RtdsCryptoPricesClientOptions): RtdsCryptoPricesClient {
  const url = opts.url ?? 'wss://ws-live-data.polymarket.com'

  const allowedBinance = new Set(opts.binanceSymbols.map((s) => s.toLowerCase()))
  const allowedChainlink = new Set(opts.chainlinkSymbols.map((s) => s.toLowerCase()))

  let running = false
  let conn: WsConnection | undefined

  let attempt = 0
  let backoffMs = 1_000
  let reconnectTimer: NodeJS.Timeout | undefined
  let pingTimer: NodeJS.Timeout | undefined

  const clearTimers = (): void => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = undefined
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

  const subscribe = (): void => {
    if (!conn) return

    // Subscribe broadly and filter locally.
    // This avoids any quirks with server-side filter formats while still allowing
    // strategies to request only the symbols they care about.
    const subs: Array<{ topic: string; type: string; filters?: string }> = [
      { topic: 'crypto_prices', type: 'update' },
      { topic: 'crypto_prices_chainlink', type: '*', filters: '' },
    ]

    conn.send(
      JSON.stringify({
        action: 'subscribe',
        subscriptions: subs,
      }),
    )
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
        // Some Cloudflare-hosted WS endpoints expect an Origin header.
        origin: 'https://polymarket.com',
      },
      // RTDS docs recommend sending text "PING" every ~5s; keep ws-level ping off here.
      heartbeat: { pingIntervalMs: 0 },
      onOpen: () => {
        backoffMs = 1_000
        opts.onStatus?.({ kind: 'connected', attempt })
        subscribe()
        pingTimer = setInterval(() => {
          try {
            conn?.send('PING')
          } catch {
            // ignore
          }
        }, 5_000)
      },
      onMessageText: (raw) => {
        if (!raw) return
        if (raw === 'PONG') return
        const parsed = safeJsonParse(raw)
        if (!parsed || typeof parsed !== 'object') return

        const msg = parsed as RtdsMessage
        if (typeof msg.topic !== 'string' || typeof msg.type !== 'string') return

        if (msg.topic === 'crypto_prices' && msg.type === 'update') {
          const p = parseUpdatePayload(msg.payload)
          if (!p) return
          // Require explicit allow-list: empty list means "accept none"
          if (!allowedBinance.has(p.symbol.toLowerCase())) return
          opts.onBinanceUpdate({
            symbol: p.symbol,
            tsMs: p.timestamp,
            value: p.value,
          })
          return
        }

        if (msg.topic === 'crypto_prices_chainlink' && msg.type === 'update') {
          const p = parseUpdatePayload(msg.payload)
          if (!p) return
          // Require explicit allow-list: empty list means "accept none"
          if (!allowedChainlink.has(p.symbol.toLowerCase())) return
          opts.onChainlinkUpdate({
            symbol: p.symbol,
            tsMs: p.timestamp,
            value: p.value,
          })
        }
      },
      onError: (err) => {
        opts.onStatus?.({ kind: 'disconnected', attempt, info: `ws error: ${err.message}` })
      },
      onClose: (code, reason) => {
        const reasonStr = reason.toString()
        opts.onStatus?.({ kind: 'disconnected', attempt, info: `code=${code} reason=${reasonStr}` })
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


