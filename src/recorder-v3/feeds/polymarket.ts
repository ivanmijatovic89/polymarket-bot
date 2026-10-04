import type { RecordedMarket } from '../types.js'
import { createSocketTransport, ingressStamp, type TransportOptions } from './transport.js'

export type PolymarketFeedOptions = Omit<TransportOptions, 'source' | 'url' | 'onOpen'> & {
  url?: string
  markets?: readonly RecordedMarket[]
  dataStaleMs?: number
}

/** One public market connection survives both 5m and 15m boundaries. */
export function createPolymarketFeed(options: PolymarketFeedOptions) {
  const clock = options.clock ?? ingressStamp
  let markets = options.markets ?? []
  let desired = new Set((options.markets ?? []).flatMap((market) => market.tokenIds))
  let subscribed = new Set<string>()
  let initialized = false
  let openedAtMs = 0
  const lastMarketData = new Map<string, number>()

  const update = () => {
    const additions = [...desired].filter((id) => !subscribed.has(id))
    const removals = [...subscribed].filter((id) => !desired.has(id))
    if (additions.length > 0) {
      const sent = transport.send(
        JSON.stringify({
          ...(initialized ? { operation: 'subscribe' } : { type: 'market' }),
          assets_ids: additions,
          initial_dump: true,
          custom_feature_enabled: true,
        }),
      )
      if (sent) {
        for (const id of additions) subscribed.add(id)
        initialized = true
      }
    }
    if (removals.length > 0) {
      if (transport.send(JSON.stringify({ operation: 'unsubscribe', assets_ids: removals }))) {
        for (const id of removals) subscribed.delete(id)
      }
    }
  }
  const transport = createSocketTransport({
    ...options,
    source: 'polymarket',
    url: options.url ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    pingText: 'PING',
    pingIntervalMs: options.pingIntervalMs ?? 10_000,
    onOpen: () => {
      openedAtMs = clock().receivedAtMs
      lastMarketData.clear()
      subscribed = new Set()
      initialized = false
      update()
    },
    onMessage: (raw, received, connection) => {
      try {
        const parsed: unknown = JSON.parse(raw)
        for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
          if (!value || typeof value !== 'object') continue
          const message = value as Record<string, unknown>
          if (
            typeof message.market === 'string' &&
            typeof message.event_type === 'string' &&
            markets.some((market) => market.conditionId === message.market)
          ) {
            lastMarketData.set(message.market, received.receivedAtMs)
          }
        }
      } catch {
        /* Text PONG frames are captured but are not market data. */
      }
      options.onMessage?.(raw, received, connection)
    },
    onTick: (connection) => {
      const received = clock()
      for (const market of markets) {
        if (received.receivedAtMs < market.startMs || received.receivedAtMs >= market.endMs)
          continue
        const last = Math.max(market.startMs, lastMarketData.get(market.conditionId) ?? openedAtMs)
        if (received.receivedAtMs - last > (options.dataStaleMs ?? 30_000)) {
          options.onStatus({
            source: 'polymarket',
            connectionId: connection.connectionId(),
            kind: 'stale',
            stamp: received,
            marketSlug: market.slug,
            reason: 'polymarket_market_data_stale',
            details: { feed: 'polymarket', startMs: last, certainty: 'uncertain' },
          })
          connection.reconnect('polymarket_subscription_stale')
          return
        }
      }
      options.onTick?.(connection)
    },
  })
  return {
    start: transport.start,
    stop: transport.stop,
    reconnect: transport.reconnect,
    setMarkets(updated: readonly RecordedMarket[]) {
      markets = updated
      for (const conditionId of lastMarketData.keys())
        if (!markets.some((market) => market.conditionId === conditionId))
          lastMarketData.delete(conditionId)
      desired = new Set(markets.flatMap((market) => market.tokenIds))
      update()
    },
  }
}
