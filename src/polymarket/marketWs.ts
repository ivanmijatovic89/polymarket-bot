import WebSocket, { type RawData } from 'ws'

export type PolymarketAuth = {
  apiKey: string
  secret: string
  passphrase: string
}

export type MarketWsSubscribeMessage = {
  type: 'market'
  assets_ids: string[]
  auth?: PolymarketAuth
}

export type MarketWsClientOptions = {
  url: string
  assetsIds: string[]
  auth?: PolymarketAuth
  onMessage: (raw: string) => void
  onOpen?: () => void
  onClose?: (code: number, reason: Buffer) => void
  onError?: (err: Error) => void
}

export type MarketWsClient = {
  close: () => void
}

// Keep pings frequent to keep NAT/proxies warm.
const HEARTBEAT_INTERVAL_MS = 2_000
// Be lenient: markets can go quiet; rely on pong to prove liveness.
const HEARTBEAT_DEAD_AFTER_MS = 90_000

/**
 * Minimal ws client for Polymarket market channel.
 *
 * Docs (Context7 Polymarket):
 * - Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/{wss-channel}
 * - Subscribe payload: { type: 'market', assets_ids: [...] }
 */
export function createMarketWsClient(opts: MarketWsClientOptions): MarketWsClient {
  const ws = new WebSocket(opts.url, {
    perMessageDeflate: false,
    handshakeTimeout: 10_000,
    maxPayload: 100 * 1024 * 1024,
  })

  let heartbeatInterval: NodeJS.Timeout | undefined
  let lastSeenAtMs = Date.now()

  ws.on('open', () => {
    const msg: MarketWsSubscribeMessage = {
      type: 'market',
      assets_ids: opts.assetsIds,
      ...(opts.auth ? { auth: opts.auth } : {}),
    }
    ws.send(JSON.stringify(msg))
    opts.onOpen?.()

    // Heartbeat: ping/pong.
    lastSeenAtMs = Date.now()
    heartbeatInterval = setInterval(() => {
      const now = Date.now()
      // If we're receiving messages frequently, rely on that as "alive" signal too.
      if (now - lastSeenAtMs > HEARTBEAT_DEAD_AFTER_MS) {
        ws.terminate()
        return
      }
      ws.ping()
    }, HEARTBEAT_INTERVAL_MS)
  })

  ws.on('pong', () => {
    lastSeenAtMs = Date.now()
  })

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return
    lastSeenAtMs = Date.now()
    opts.onMessage(data.toString())
  })

  ws.on('error', (err: Error) => {
    opts.onError?.(err)
  })

  ws.on('close', (code: number, reason: Buffer) => {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    opts.onClose?.(code, reason)
  })

  return {
    close: () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      ws.close()
    },
  }
}
