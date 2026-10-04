import {
  createSocketTransport,
  ingressStamp,
  parseObject,
  type TransportOptions,
} from './transport.js'
import type { IngressStamp } from '../types.js'
import { isValidBinancePriceEnvelope } from '../replay/feedState.js'

export type BinanceFeedOptions = Omit<
  TransportOptions,
  'source' | 'url' | 'onMessage' | 'onOpen' | 'onTick'
> & {
  url?: string
  dataStaleMs?: number
}

export function createBinanceFeed(options: BinanceFeedOptions) {
  const clock = options.clock ?? ingressStamp
  const received = new Map<string, IngressStamp>()
  let lastAggId: bigint | null = null
  let lastAggReceivedAtMs: number | null = null
  let opened: IngressStamp = { receivedAtMs: 0, monotonicNs: '0' }
  const transport = createSocketTransport({
    ...options,
    source: 'binance',
    url:
      options.url ??
      'wss://stream.binance.com:443/stream?streams=btcusdt@aggTrade/btcusdt@bookTicker',
    onOpen: () => {
      opened = clock()
      received.clear()
      lastAggId = null
      lastAggReceivedAtMs = null
    },
    onMessage: (raw, stamp, connection) => {
      const message = parseObject(raw)
      if (!message || message.transport) return
      const data = message.data as Record<string, unknown> | undefined
      if (message.e === 'serverShutdown' || data?.e === 'serverShutdown') {
        connection.reconnect('binance_server_shutdown')
        return
      }
      if (
        !data ||
        (message.stream !== 'btcusdt@aggTrade' && message.stream !== 'btcusdt@bookTicker')
      ) {
        options.onStatus({
          source: 'binance',
          connectionId: connection.connectionId(),
          kind: 'gap',
          stamp,
          reason: 'unexpected_binance_envelope',
        })
        return
      }
      const stream = message.stream
      if (data.s !== 'BTCUSDT') {
        connection.reconnect('binance_symbol_mismatch')
        return
      }
      if (!isValidBinancePriceEnvelope(message)) {
        options.onStatus({
          source: 'binance',
          connectionId: connection.connectionId(),
          kind: 'gap',
          stamp,
          reason: 'invalid_binance_price',
          details: {
            feed: stream === 'btcusdt@aggTrade' ? 'binance_agg_trade' : 'binance_book_ticker',
            certainty: 'confirmed',
          },
        })
        return
      }
      received.set(stream, stamp)
      if (stream === 'btcusdt@aggTrade') {
        const id =
          typeof data.a === 'number' && Number.isSafeInteger(data.a) ? BigInt(data.a) : null
        if (id === null) connection.reconnect('invalid_binance_aggregate_id')
        else {
          if (lastAggId !== null && id !== lastAggId + 1n) {
            options.onStatus({
              source: 'binance',
              connectionId: connection.connectionId(),
              kind: 'gap',
              stamp,
              reason: 'binance_aggregate_sequence',
              details: {
                feed: 'binance_agg_trade',
                previous: lastAggId.toString(),
                current: id.toString(),
                startMs: lastAggReceivedAtMs ?? stamp.receivedAtMs,
                endMs: stamp.receivedAtMs,
                certainty: id > lastAggId + 1n ? 'confirmed' : 'uncertain',
              },
            })
          }
          lastAggId = id
          lastAggReceivedAtMs = stamp.receivedAtMs
        }
      }
    },
    onTick: (connection) => {
      const stamp = clock()
      const now = BigInt(stamp.monotonicNs)
      for (const stream of ['btcusdt@aggTrade', 'btcusdt@bookTicker']) {
        const last = received.get(stream) ?? opened
        if (now - BigInt(last.monotonicNs) > BigInt(options.dataStaleMs ?? 30_000) * 1_000_000n) {
          options.onStatus({
            source: 'binance',
            connectionId: connection.connectionId(),
            kind: 'stale',
            stamp,
            reason: `binance_data_stale:${stream}`,
            details: {
              feed: stream === 'btcusdt@aggTrade' ? 'binance_agg_trade' : 'binance_book_ticker',
              startMs: last.receivedAtMs,
              certainty: 'uncertain',
            },
          })
          connection.reconnect(`binance_data_stale:${stream}`)
          return
        }
      }
    },
  })
  return { start: transport.start, stop: transport.stop }
}
