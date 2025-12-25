import type { AccountEvent } from '../../strategy/Strategy.js'

import { createWsConnection, type WsConnection } from './wsConnection.js'
import type { PolymarketCredentials } from '../config.js'

export type UserWsAccountSourceOptions = {
  url?: string
  auth: PolymarketCredentials
  /**
   * Optional filter. Polymarket docs mention user channel can be filtered by market condition IDs.
   * If undefined, we subscribe to all user events.
   */
  markets?: string[]
  reconnect?: {
    baseDelayMs?: number
    maxDelayMs?: number
    jitterMs?: number
  }
}

export type UserWsAccountSource = {
  start: () => void
  stop: () => void
  onAccountEvent: (cb: (ev: AccountEvent) => void) => () => void
}

function jitter(delayMs: number, jitterMs: number): number {
  if (jitterMs <= 0) return delayMs
  const j = Math.floor(Math.random() * (jitterMs + 1))
  return Math.max(0, delayMs + j)
}

function parseUserChannelEvent(raw: string): AccountEvent[] {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return []
  }
  if (!obj || typeof obj !== 'object') return []
  const rec = obj as Record<string, unknown>
  const eventType = rec.event_type
  const tsSec = rec.timestamp
  const tsMs =
    typeof tsSec === 'string' && tsSec.trim() !== ''
      ? Math.trunc(Number(tsSec) * 1000)
      : typeof tsSec === 'number'
        ? Math.trunc(tsSec * 1000)
        : Date.now()

  if (eventType === 'trade') {
    const asset_id = typeof rec.asset_id === 'string' ? rec.asset_id : undefined
    const market = typeof rec.market === 'string' ? rec.market : undefined
    const sideRaw = rec.side
    const side = sideRaw === 'BUY' || sideRaw === 'SELL' ? sideRaw : undefined
    const price = typeof rec.price === 'string' ? Number(rec.price) : Number(rec.price)
    const size = typeof rec.size === 'string' ? Number(rec.size) : Number(rec.size)
    const id = typeof rec.id === 'string' ? rec.id : `trade:${tsMs}`
    const takerOrderId = typeof rec.taker_order_id === 'string' ? rec.taker_order_id : undefined

    if (!asset_id || !side || !Number.isFinite(price) || !Number.isFinite(size)) return []
    return [
      {
        kind: 'fill',
        fill: {
          id,
          tsMs,
          ...(market !== undefined ? { market } : {}),
          assetId: asset_id,
          side,
          price,
          size,
          ...(takerOrderId !== undefined ? { orderId: takerOrderId } : {}),
          liquidity: 'TAKER',
        },
      },
    ]
  }

  if (eventType === 'order') {
    // Order messages describe placement/update/cancel, but schema can vary.
    // For v1 we don’t attempt to perfectly map lifecycle without clientOrderId;
    // polling fallback will reconcile open orders.
    return []
  }

  return []
}

export function createUserWsAccountSource(opts: UserWsAccountSourceOptions): UserWsAccountSource {
  const url = opts.url ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/user'
  const baseDelayMs = opts.reconnect?.baseDelayMs ?? 1_000
  const maxDelayMs = opts.reconnect?.maxDelayMs ?? 10_000
  const jitterMs = opts.reconnect?.jitterMs ?? 250

  const listeners = new Set<(ev: AccountEvent) => void>()

  let running = false
  let conn: WsConnection | undefined
  let backoffMs = baseDelayMs
  let reconnectTimer: NodeJS.Timeout | undefined

  const emit = (ev: AccountEvent): void => {
    for (const cb of listeners) cb(ev)
  }

  const clearReconnect = (): void => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  const scheduleReconnect = (why: string): void => {
    if (!running) return
    clearReconnect()
    const delay = jitter(backoffMs, jitterMs)
    emit({
      kind: 'account_stream_status',
      tsMs: Date.now(),
      source: 'user_ws',
      status: 'disconnected',
      info: why,
    })
    reconnectTimer = setTimeout(() => connect(), delay)
    backoffMs = Math.min(maxDelayMs, Math.max(baseDelayMs, backoffMs * 2))
  }

  const connect = (): void => {
    if (!running) return
    conn?.close()
    conn = undefined

    conn = createWsConnection({
      url,
      wsOptions: { perMessageDeflate: false, handshakeTimeout: 10_000 },
      // Keep-alive only: user streams can be quiet; do NOT terminate due to inactivity.
      heartbeat: { pingIntervalMs: 10_000 },
      onOpen: () => {
        backoffMs = baseDelayMs
        emit({
          kind: 'account_stream_status',
          tsMs: Date.now(),
          source: 'user_ws',
          status: 'connected',
        })

        // Per docs: send auth fields on connection.
        conn?.send(
          JSON.stringify({
            apikey: opts.auth.apiKey,
            secret: opts.auth.secret,
            passphrase: opts.auth.passphrase,
            ...(opts.markets ? { markets: opts.markets } : {}),
          }),
        )
      },
      onMessageText: (raw) => {
        const events = parseUserChannelEvent(raw)
        for (const ev of events) emit(ev)
      },
      onClose: (code, reason) => {
        if (!running) return
        scheduleReconnect(`ws close code=${code} reason=${reason.toString()}`)
      },
      onError: (err) => {
        if (!running) return
        scheduleReconnect(`ws error: ${err.message}`)
      },
    })
  }

  return {
    start: () => {
      if (running) return
      running = true
      backoffMs = baseDelayMs
      clearReconnect()
      connect()
    },
    stop: () => {
      running = false
      clearReconnect()
      conn?.close()
      conn = undefined
    },
    onAccountEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}


