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
  /**
   * Optional: raw chainlink tick with BOTH clocks and the unparsed value.
   * Used by the recorder/verification tooling (`telonex:crypto-prices:record-rtds`);
   * the live trading path leaves it unset. Fired for the same allow-listed
   * messages as `onChainlinkUpdate`, immediately before it.
   *
   * - `payloadTimestampMs` — `payload.timestamp`, the chainlink round time
   *   (what `onChainlinkUpdate` reports as `tsMs`).
   * - `serverTimestampMs` — the top-level message `timestamp`, when Polymarket
   *   broadcast the tick (observed ~1s after the round time).
   * - `rawValue` — `payload.value` exactly as parsed from JSON (string or
   *   number), before `Number(...)` coercion.
   */
  onChainlinkRaw?: (m: {
    symbol: string
    payloadTimestampMs: number
    serverTimestampMs: number | null
    rawValue: unknown
    receivedAtMs: number
  }) => void
  /**
   * Force a reconnect when no DATA message (crypto_prices topics — PONGs do
   * not count) arrives for this long: the socket can go silent, or keep
   * answering pings with a stalled subscription, without a close event.
   * Default 30_000; 0 disables.
   */
  idleReconnectMs?: number
  onStatus?: (s: {
    kind: 'connected' | 'reconnecting' | 'disconnected'
    attempt: number
    info?: string
  }) => void
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

function parseUpdatePayload(
  p: unknown,
): { symbol: string; timestamp: number; value: number } | null {
  if (!p || typeof p !== 'object') return null
  const obj = p as { symbol?: unknown; timestamp?: unknown; value?: unknown }
  if (typeof obj.symbol !== 'string' || obj.symbol.length === 0) return null
  const ts = asFiniteNumber(obj.timestamp)
  const v = asFiniteNumber(obj.value)
  if (ts === null || v === null) return null
  return { symbol: obj.symbol, timestamp: ts, value: v }
}

export function createRtdsCryptoPricesClient(
  opts: RtdsCryptoPricesClientOptions,
): RtdsCryptoPricesClient {
  const url = opts.url ?? 'wss://ws-live-data.polymarket.com'

  // Idle watchdog. The RTDS socket has been observed going silent WITHOUT a
  // close event (2026-07-21 recorder incident; 2026-07-25 trading-bot capture:
  // frozen 28 min, no error) — chainlink rounds arrive ~1/s, so prolonged
  // silence means a stale connection, not a quiet market. When no DATA
  // message (crypto_prices topics; PONGs and acks do NOT count) arrives for
  // this long, force a reconnect through the normal path. 0 disables.
  const idleReconnectMs = opts.idleReconnectMs ?? 30_000
  let lastMessageAtMs = 0
  let idleTimer: NodeJS.Timeout | undefined

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
    if (idleTimer) clearInterval(idleTimer)
    idleTimer = undefined
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
    // Per-connect identity: each invocation's callbacks close over THEIR
    // socket, so a late event from a replaced socket can be ignored.
    let thisConn: WsConnection | undefined
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
        if (idleReconnectMs > 0) {
          lastMessageAtMs = Date.now()
          idleTimer = setInterval(() => {
            if (!running) return
            const idleMs = Date.now() - lastMessageAtMs
            if (idleMs > idleReconnectMs) {
              // terminate(), not close(): a graceful close handshake on a
              // stale socket only completes after ws's ~30s close timeout, by
              // which time the reconnect has already built a healthy
              // replacement — whose lifecycle the late 'close' event would
              // then wrongly tear down. terminate() emits 'close' immediately
              // on THIS socket, flowing through the normal onClose path once.
              const stale = conn
              conn = undefined
              clearTimers()
              stale?.terminate()
              scheduleReconnect(`idle watchdog (${Math.round(idleMs / 1000)}s without data)`)
            }
          }, 5_000)
          idleTimer.unref?.()
        }
      },
      onMessageText: (raw) => {
        if (!raw) return
        if (raw === 'PONG') return
        const parsed = safeJsonParse(raw)
        if (!parsed || typeof parsed !== 'object') return

        const msg = parsed as RtdsMessage
        if (typeof msg.topic !== 'string' || typeof msg.type !== 'string') return

        // Liveness keys on DATA topics only (any symbol): a server that keeps
        // answering PING or sending acks while the crypto_prices subscription
        // is stalled must still trip the watchdog — the exact "frozen, no
        // error, no close" incident class this exists for. Rounds arrive
        // ~1/s, so 30s without data is never a quiet market.
        if (msg.topic === 'crypto_prices' || msg.topic === 'crypto_prices_chainlink') {
          lastMessageAtMs = Date.now()
        }

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
          opts.onChainlinkRaw?.({
            symbol: p.symbol,
            payloadTimestampMs: p.timestamp,
            serverTimestampMs: asFiniteNumber(msg.timestamp),
            rawValue: (msg.payload as { value?: unknown }).value,
            receivedAtMs: Date.now(),
          })
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
        // Identity guard: a late 'close' from an already-replaced socket
        // (e.g. one the idle watchdog terminated) must not tear down the
        // CURRENT connection's lifecycle.
        if (conn !== thisConn) return
        const reasonStr = reason.toString()
        opts.onStatus?.({ kind: 'disconnected', attempt, info: `code=${code} reason=${reasonStr}` })
        stopConn()
        scheduleReconnect(`ws closed code=${code}`)
      },
    })
    thisConn = conn
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
