import type { AccountEvent, WsOrderUpdate } from '../../strategy/Strategy.js'

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
  /**
   * When to emit portfolio-impacting fills from user-channel trade messages.
   *
   * - MATCHED: fastest signal (recommended for low-latency reaction), but trades can later be RETRYING/FAILED.
   * - MINED/CONFIRMED: safer for portfolio correctness (default).
   *
   * NOTE: regardless of this setting, we dedupe by trade id so status updates won't double-count.
   */
  emitTradeFillsAtStatus?: 'MATCHED' | 'MINED' | 'CONFIRMED'
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

type UserTradeStatus = 'MATCHED' | 'MINED' | 'CONFIRMED' | 'RETRYING' | 'FAILED'
const USER_TRADE_STATUS_RANK: Record<UserTradeStatus, number> = {
  MATCHED: 1,
  MINED: 2,
  CONFIRMED: 3,
  RETRYING: 0,
  FAILED: 0,
}

function asTopLevelRecord(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null
  return obj as Record<string, unknown>
}

function unwrapUserWsPayload(rec: Record<string, unknown>): Record<string, unknown> {
  // Some ws infrastructures wrap messages in `{ data: {...} }` or `{ payload: {...} }`.
  // Polymarket's docs show flat objects, but we tolerate common envelopes.
  const data = rec.data
  if (data && typeof data === 'object') return data as Record<string, unknown>
  const payload = rec.payload
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>
  return rec
}

function asTsMsFromSecish(tsSec: unknown): number {
  if (typeof tsSec === 'string' && tsSec.trim() !== '') {
    const n = Number(tsSec)
    if (Number.isFinite(n)) {
      // Polymarket user-channel examples include:
      // - `timestamp` in milliseconds (e.g. "1766876555464")
      // - `match_time` / `last_update` in seconds (e.g. "1766876521")
      // Heuristic: treat large values as ms already.
      if (n >= 10_000_000_000) return Math.trunc(n)
      return Math.trunc(n * 1000)
    }
  }
  if (typeof tsSec === 'number' && Number.isFinite(tsSec)) {
    if (tsSec >= 10_000_000_000) return Math.trunc(tsSec)
    return Math.trunc(tsSec * 1000)
  }
  return Date.now()
}

function parseUserChannelEvent(
  raw: string,
  state: {
    // Track trade status progression so we can (a) dedupe duplicates and (b) only emit fills once.
    // Map tradeId -> highest rank seen so far.
    tradeRankById: Map<string, number>
    maxTradeIds: number
    // Prevent emitting the same trade fill multiple times across status updates.
    emittedTradeIds: Set<string>
    // Best-effort: our user "owner" id (uuid-like) observed on order/taker messages,
    // used to filter maker_orders to only our fills.
    myOwnerId?: string
    emitAt: UserTradeStatus
  },
): AccountEvent[] {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return []
  }
  const top = asTopLevelRecord(obj)
  if (!top) return []
  const rec = unwrapUserWsPayload(top)
  const eventType = rec.event_type
  const tsMs = asTsMsFromSecish(rec.timestamp ?? rec.matchtime ?? rec.match_time ?? rec.last_update)

  if (eventType === 'trade') {
    const statusRaw = typeof rec.status === 'string' ? rec.status : undefined
    const status = (statusRaw === 'MATCHED' ||
      statusRaw === 'MINED' ||
      statusRaw === 'CONFIRMED' ||
      statusRaw === 'RETRYING' ||
      statusRaw === 'FAILED'
      ? statusRaw
      : undefined) as UserTradeStatus | undefined

    const asset_id = typeof rec.asset_id === 'string' ? rec.asset_id : undefined
    const market = typeof rec.market === 'string' ? rec.market : undefined
    const sideRaw = rec.side
    const side = sideRaw === 'BUY' || sideRaw === 'SELL' ? sideRaw : undefined
    const price = typeof rec.price === 'string' ? Number(rec.price) : Number(rec.price)
    const size = typeof rec.size === 'string' ? Number(rec.size) : Number(rec.size)
    const id = typeof rec.id === 'string' ? rec.id : undefined
    const takerOrderId = typeof rec.taker_order_id === 'string' ? rec.taker_order_id : undefined
    const traderSideRaw = typeof rec.trader_side === 'string' ? rec.trader_side : undefined
    const traderSide = traderSideRaw === 'TAKER' || traderSideRaw === 'MAKER' ? traderSideRaw : undefined
    const feeRateBps = Number(rec.fee_rate_bps)

    // Without a stable trade id, we cannot safely dedupe status updates. Drop it.
    if (!id) return []

    // Best-effort: if we are the taker on this message, `owner` is our user-id. Capture it for future maker fills.
    if (traderSide === 'TAKER' && typeof rec.owner === 'string') state.myOwnerId = rec.owner

    // Track status progress even if we don't emit a fill for this status.
    const rank = status ? USER_TRADE_STATUS_RANK[status] : 0
    const prevRank = state.tradeRankById.get(id) ?? -1
    if (rank <= prevRank) return []
    state.tradeRankById.set(id, rank)
    if (state.tradeRankById.size > state.maxTradeIds) {
      // Best-effort bounding: drop oldest insertion order.
      const firstKey = state.tradeRankById.keys().next().value as string | undefined
      if (firstKey) state.tradeRankById.delete(firstKey)
    }

    // Always emit status progression as an existing ws_order_update event so strategies can
    // react to MATCHED/MINED/CONFIRMED independently from fill emission policy.
    //
    // IMPORTANT: this event does NOT impact positions/PnL (Portfolio only moves on `fill`),
    // so there is no double counting.
    const out: AccountEvent[] = []
    if (status && takerOrderId) {
      const wsOrder: WsOrderUpdate = {
        orderId: takerOrderId,
        ...(market !== undefined ? { market } : {}),
        ...(asset_id !== undefined ? { assetId: asset_id } : {}),
        ...(side !== undefined ? { side } : {}),
        ...(Number.isFinite(price) ? { price } : {}),
        // Mark as "filled" for Portfolio's wsOpenOrdersByOrderId bookkeeping (prevents growth),
        // while still preserving status string for strategies.
        ...(Number.isFinite(size) ? { originalSize: size, sizeMatched: size } : {}),
        status,
        event: 'UPDATE',
      }
      out.push({ kind: 'ws_order_update', tsMs, order: wsOrder })
    }

    // Emit policy: allow earlier signal (MATCHED) if configured.
    // Once we emit the *fill* for a trade id, never emit it again for later statuses (prevents double-counting).
    const emitRank = USER_TRADE_STATUS_RANK[state.emitAt]
    if (!status) return out
    if (USER_TRADE_STATUS_RANK[status] < emitRank) return out
    if (state.emittedTradeIds.has(id)) return out
    state.emittedTradeIds.add(id)

    // If we are a MAKER in this trade, emit fills only for our maker_orders entries.
    // IMPORTANT: even taker messages include maker_orders (other people's orders); do NOT emit those as our fills.
    if (traderSide === 'MAKER') {
      // Without knowing our owner id, we cannot safely filter maker_orders to "our" fills.
      if (!state.myOwnerId) return []
      const makerOrdersRaw = rec.maker_orders
      const makerOrders = Array.isArray(makerOrdersRaw) ? makerOrdersRaw : []
      const makerFills: AccountEvent[] = []
      for (const mo of makerOrders) {
        if (!mo || typeof mo !== 'object') continue
        const mor = mo as Record<string, unknown>
        const moOwner = typeof mor.owner === 'string' ? mor.owner : undefined
        if (moOwner !== state.myOwnerId) continue
        const moOrderId = typeof mor.order_id === 'string' ? mor.order_id : undefined
        const moMatched =
          typeof mor.matched_amount === 'string' ? Number(mor.matched_amount) : Number(mor.matched_amount)
        const moPrice = typeof mor.price === 'string' ? Number(mor.price) : Number(mor.price)
        const moAssetId = typeof mor.asset_id === 'string' ? mor.asset_id : undefined
        const moSideRaw = mor.side
        const moSide = moSideRaw === 'BUY' || moSideRaw === 'SELL' ? moSideRaw : undefined
        const moFeeRateBps = Number(mor.fee_rate_bps)
        if (!moOrderId || !moAssetId || !moSide) continue
        if (!Number.isFinite(moMatched) || moMatched <= 0) continue
        if (!Number.isFinite(moPrice) || moPrice <= 0) continue
        makerFills.push({
          kind: 'fill',
          fill: {
            id: `${id}:${moOrderId}`,
            tsMs,
            ...(market !== undefined ? { market } : {}),
            assetId: moAssetId,
            side: moSide,
            price: moPrice,
            size: moMatched,
            ...(Number.isFinite(moFeeRateBps) ? { feeRateBps: moFeeRateBps } : {}),
            orderId: moOrderId,
            liquidity: 'MAKER',
          },
        })
      }
      if (makerFills.length > 0) return [...out, ...makerFills]
      return out
    }

    // TAKER trade: single fill, use top-level fields.
    if (!asset_id || !side || !Number.isFinite(price) || !Number.isFinite(size)) return out
    return [
      ...out,
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
          ...(Number.isFinite(feeRateBps) ? { feeRateBps } : {}),
          ...(takerOrderId !== undefined ? { orderId: takerOrderId } : {}),
          liquidity: 'TAKER',
        },
      },
    ]
  }

  if (eventType === 'order') {
    // Polymarket docs: order messages with `type`: PLACEMENT | UPDATE | CANCELLATION
    const typeRaw = typeof rec.type === 'string' ? rec.type : undefined
    const type = typeRaw === 'PLACEMENT' || typeRaw === 'UPDATE' || typeRaw === 'CANCELLATION' ? typeRaw : undefined
    const orderId = typeof rec.id === 'string' ? rec.id : undefined
    if (!orderId) return []

    // Capture our owner id early from order messages.
    if (typeof rec.owner === 'string') state.myOwnerId = rec.owner

    const sideRaw = rec.side
    const side = sideRaw === 'BUY' || sideRaw === 'SELL' ? sideRaw : undefined
    const price = Number(rec.price)
    const originalSize = Number(rec.original_size)
    const sizeMatched = Number(rec.size_matched)
    const market = typeof rec.market === 'string' ? rec.market : undefined
    const assetId = typeof rec.asset_id === 'string' ? rec.asset_id : undefined
    const owner = typeof rec.owner === 'string' ? rec.owner : undefined
    const status = typeof rec.status === 'string' ? rec.status : undefined
    const orderType = typeof rec.order_type === 'string' ? rec.order_type : undefined
    const outcome = typeof rec.outcome === 'string' ? rec.outcome : undefined
    const expirationSec = Number(rec.expiration)
    const createdAtSec = Number(rec.created_at)

    const wsOrder: WsOrderUpdate = {
      orderId,
      ...(owner ? { owner } : {}),
      ...(market ? { market } : {}),
      ...(assetId ? { assetId } : {}),
      ...(side ? { side } : {}),
      ...(Number.isFinite(price) ? { price } : {}),
      ...(Number.isFinite(originalSize) ? { originalSize } : {}),
      ...(Number.isFinite(sizeMatched) ? { sizeMatched } : {}),
      ...(status ? { status } : {}),
      ...(orderType ? { orderType } : {}),
      ...(outcome ? { outcome } : {}),
      ...(Number.isFinite(expirationSec) ? { expirationSec } : {}),
      ...(Number.isFinite(createdAtSec) ? { createdAtSec } : {}),
      event: type ?? 'UPDATE',
    }

    // Always emit a detailed order update so Portfolio can track all account orders.
    const out: AccountEvent[] = [{ kind: 'ws_order_update', tsMs, order: wsOrder }]

    if (type === 'CANCELLATION') {
      out.push({ kind: 'order_done', tsMs, orderId, reason: 'canceled' })
      return out
    }

    // If we have sizes, infer filled when matched size >= original.
    if (
      Number.isFinite(originalSize) &&
      Number.isFinite(sizeMatched) &&
      originalSize > 0 &&
      sizeMatched >= originalSize
    ) {
      out.push({ kind: 'order_done', tsMs, orderId, reason: 'filled' })
      return out
    }

    // Otherwise treat as open/update. We can't map clientOrderId from ws payload reliably, so
    // Portfolio must reconcile by orderId.
    out.push({ kind: 'order_open', tsMs, orderId })
    return out
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

  // Trade status dedupe across reconnects (best-effort). Keeps memory bounded.
  const tradeRankById = new Map<string, number>()
  const maxTradeIds = 50_000
  const emittedTradeIds = new Set<string>()
  const parseState: {
    tradeRankById: Map<string, number>
    maxTradeIds: number
    emittedTradeIds: Set<string>
    myOwnerId?: string
    emitAt: UserTradeStatus
  } = {
    tradeRankById,
    maxTradeIds,
    emittedTradeIds,
    // In Polymarket user-channel payloads, `owner` is the API key id (uuid). We have it.
    myOwnerId: opts.auth.apiKey,
    emitAt: (opts.emitTradeFillsAtStatus ?? 'MINED') as UserTradeStatus,
  }

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

        // Per Polymarket docs: wss-subscriptions-clob format requires:
        // { type: "USER", auth: { apiKey, secret, passphrase }, markets?: [...] }
        const authMsg = {
          type: 'USER',
          auth: {
            apiKey: opts.auth.apiKey,
            secret: opts.auth.secret,
            passphrase: opts.auth.passphrase,
          },
          ...(opts.markets ? { markets: opts.markets } : {}),
        }
        console.log('[ws-user][⚙️] Sending auth message:', {
          type: 'USER',
          apiKey: opts.auth.apiKey.substring(0, 8) + '...',
          hasSecret: !!opts.auth.secret,
          hasPassphrase: !!opts.auth.passphrase,
          markets: opts.markets,
        })
        console.log('[ws-user][⚙️] Full auth message (without secrets):', JSON.stringify({ ...authMsg, auth: { ...authMsg.auth, secret: '***', passphrase: '***' } }))
        conn?.send(JSON.stringify(authMsg))
      },
      onMessageText: (raw) => {
        console.log('[ws-user][⚡️] Received raw message:', raw)
        const events = parseUserChannelEvent(raw, parseState)
        if (events.length === 0) {
          console.log('[ws-user] Message did not parse into any events (might be error/subscription response)')
        } else {
          console.log('[ws-user] Parsed into', events.length, 'event(s)')
        }
        for (const ev of events) emit(ev)
      },
      onClose: (code, reason) => {
        if (!running) return
        const reasonStr = reason.toString()
        console.log('[ws-user][🔴] Connection closed:', {
          code,
          reason: reasonStr,
          code1006: code === 1006 ? 'ABNORMAL_CLOSURE' : undefined,
        })
        scheduleReconnect(`ws close code=${code} reason=${reasonStr}`)
      },
      onError: (err) => {
        if (!running) return
        console.log('[ws-user][🔴] Connection error:', err.message)
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
