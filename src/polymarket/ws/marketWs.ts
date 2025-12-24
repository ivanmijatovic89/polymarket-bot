import { createWsConnection } from './wsConnection.js'

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
  const conn = createWsConnection({
    url: opts.url,
    wsOptions: {
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      maxPayload: 100 * 1024 * 1024,
    },
    heartbeat: {
      pingIntervalMs: HEARTBEAT_INTERVAL_MS,
      deadAfterMs: HEARTBEAT_DEAD_AFTER_MS,
      // If we're receiving messages frequently, rely on that as "alive" signal too.
      treatMessagesAsActivity: true,
    },
    onOpen: () => {
      const msg: MarketWsSubscribeMessage = {
        type: 'market',
        assets_ids: opts.assetsIds,
        ...(opts.auth ? { auth: opts.auth } : {}),
      }
      conn.send(JSON.stringify(msg))
      opts.onOpen?.()
    },
    onMessageText: (raw) => {
      opts.onMessage(raw)
    },
    onError: (err) => {
      opts.onError?.(err)
    },
    onClose: (code, reason) => {
      opts.onClose?.(code, reason)
    },
  })

  return {
    close: () => {
      conn.close()
    },
  }
}


