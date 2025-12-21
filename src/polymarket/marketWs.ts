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
  let isAlive = true

  ws.on('open', () => {
    const msg: MarketWsSubscribeMessage = {
      type: 'market',
      assets_ids: opts.assetsIds,
      ...(opts.auth ? { auth: opts.auth } : {}),
    }
    ws.send(JSON.stringify(msg))
    opts.onOpen?.()

    // Heartbeat: ping/pong.
    isAlive = true
    heartbeatInterval = setInterval(() => {
      if (!isAlive) {
        ws.terminate()
        return
      }
      isAlive = false
      ws.ping()
    }, 30_000)
  })

  ws.on('pong', () => {
    isAlive = true
  })

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return
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

