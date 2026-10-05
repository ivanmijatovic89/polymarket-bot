import type { RecordedMarket, RecorderTimeframe } from '../types.js'
import { createSocketTransport, ingressStamp, type TransportOptions } from './transport.js'

export type PolymarketFeedOptions = Omit<TransportOptions, 'source' | 'url' | 'onOpen'> & {
  url?: string
  markets?: readonly RecordedMarket[]
  dataStaleMs?: number
}

/** One duration's public connection survives market boundaries. */
function createPolymarketConnection(options: PolymarketFeedOptions) {
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
    connectionId: transport.connectionId,
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

/** Independent sockets limit per-connection traffic; callbacks retain one global receipt order. */
export function createPolymarketFeed(options: PolymarketFeedOptions) {
  let running = false
  const groups = new Map<
    RecorderTimeframe,
    { markets: readonly RecordedMarket[]; feed: ReturnType<typeof createPolymarketConnection> }
  >()
  const setMarkets = (markets: readonly RecordedMarket[]) => {
    for (const timeframe of ['5m', '15m'] as const) {
      const selected = markets.filter((market) => market.timeframe === timeframe)
      const existing = groups.get(timeframe)
      if (!selected.length) {
        if (existing) {
          existing.feed.stop()
          groups.delete(timeframe)
        }
        continue
      }
      if (existing) {
        existing.markets = selected
        existing.feed.setMarkets(selected)
        continue
      }
      // Freeze scope on each callback so later discovery cannot change recorded evidence.
      const scope = () => ({
        channelId: `polymarket:${timeframe}`,
        marketSlugs: (groups.get(timeframe)?.markets ?? selected).map((market) => market.slug),
      })
      const feed = createPolymarketConnection({
        ...options,
        markets: selected,
        onFrame: (frame) => options.onFrame({ ...frame, ...scope() }),
        onStatus: (status) => options.onStatus({ ...status, ...scope() }),
      })
      groups.set(timeframe, { markets: selected, feed })
      if (running) feed.start()
    }
  }
  setMarkets(options.markets ?? [])
  return {
    start() {
      if (running) return
      running = true
      for (const { feed } of groups.values()) feed.start()
    },
    stop() {
      running = false
      for (const { feed } of groups.values()) feed.stop()
    },
    reconnect(reason: string, connectionId?: string) {
      for (const { feed } of groups.values())
        if (connectionId === undefined || feed.connectionId() === connectionId)
          feed.reconnect(reason)
    },
    setMarkets,
  }
}
