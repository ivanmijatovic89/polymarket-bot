import type { FeedStatus, IngressStamp } from '../types.js'
import { isValidPolyBoltPriceEnvelope } from '../replay/feedState.js'
import {
  createSocketTransport,
  ingressStamp,
  parseObject,
  type TransportOptions,
} from './transport.js'

export type PolyBoltCredentials = { apiKey: string; secret: string; passphrase: string }
export type PolyBoltFeedOptions = Omit<
  TransportOptions,
  'source' | 'url' | 'onMessage' | 'onOpen' | 'onTick'
> & {
  url?: string
  credentials: PolyBoltCredentials
  dataStaleMs?: number
  authTimeoutMs?: number
}

const CHANNELS = ['price.crypto', 'price.crypto.twap'] as const
const feedForChannel = (channel: string) =>
  channel === 'price.crypto.twap' ? 'chainlink_twap' : 'chainlink_spot'

export function createPolyBoltFeed(options: PolyBoltFeedOptions) {
  if (
    !options.credentials.apiKey ||
    !options.credentials.secret ||
    !options.credentials.passphrase
  ) {
    throw new Error('PolyBolt requires explicit CLOB API credentials')
  }
  const clock = options.clock ?? ingressStamp
  let authed = false
  let opened = 0n
  let openedAtMs = 0
  const sequence = new Map<string, number>()
  const lastChannelReceipt = new Map<string, number>()
  const activity = new Map<string, IngressStamp>()
  const report = (
    kind: FeedStatus['kind'],
    reason: string,
    stamp: IngressStamp,
    details: Record<string, unknown> = {},
  ) => {
    options.onStatus({
      source: 'chainlink',
      connectionId: transport.connectionId(),
      kind,
      stamp,
      reason,
      details,
    })
  }
  const transport = createSocketTransport({
    ...options,
    source: 'chainlink',
    url: options.url ?? 'wss://ws-live-v2.polymarket.com/ws',
    permanentCloseCodes: [4001, 4008],
    onOpen: (connection) => {
      const stamp = clock()
      opened = BigInt(stamp.monotonicNs)
      openedAtMs = stamp.receivedAtMs
      authed = false
      sequence.clear()
      lastChannelReceipt.clear()
      activity.clear()
      connection.send(JSON.stringify({ op: 'auth', auth: options.credentials }))
    },
    onMessage: (raw, stamp, connection) => {
      const message = parseObject(raw)
      if (!message) {
        report('gap', 'invalid_polybolt_json', stamp)
        return
      }
      if (message.op === 'authed') {
        if (authed) return
        authed = true
        connection.send(
          JSON.stringify({
            op: 'subscribe',
            subscriptions: [
              { channel: 'price.crypto', filter: { symbol: 'btcusd', provider: 'chainlink' } },
              { channel: 'price.crypto.twap', filter: { symbol: 'btcusd', window_seconds: 60 } },
            ],
          }),
        )
        return
      }
      if (message.op === 'error') {
        const code = typeof message.code === 'string' ? message.code : 'unknown'
        report('error', `polybolt_${code}`, stamp)
        if (['auth_invalid', 'bad_filter', 'auth_attempts', 'sub_limit'].includes(code)) {
          connection.halt(`polybolt_${code}_requires_configuration_fix`)
        } else connection.reconnect(`polybolt_${code}`)
        return
      }
      if (message.op === 'subscribed') {
        const filter =
          typeof message.filter === 'object' && message.filter !== null
            ? (message.filter as Record<string, unknown>)
            : null
        const provider = message.provider ?? message.source ?? filter?.provider
        if (provider !== undefined && provider !== 'chainlink') {
          report('provider_mismatch', 'polybolt_subscription_provider', stamp, {
            provider,
            channel: message.channel,
          })
        } else {
          report('subscribed', 'polybolt_subscription_accepted', stamp, {
            channel: message.channel,
          })
        }
        return
      }
      if (message.op === 'pong') return
      const channel = message.channel
      if (channel !== 'price.crypto' && channel !== 'price.crypto.twap') {
        report('gap', 'unexpected_polybolt_envelope', stamp)
        return
      }
      const feed = feedForChannel(channel)
      const currentSeq = message.seq
      const previous = sequence.get(channel)
      const startMs = lastChannelReceipt.get(channel) ?? stamp.receivedAtMs
      if (!Number.isSafeInteger(currentSeq) || (currentSeq as number) < 1) {
        report('gap', 'invalid_polybolt_sequence', stamp, { channel, feed })
      } else {
        if (currentSeq !== (previous ?? 0) + 1) {
          report('gap', 'polybolt_sequence', stamp, {
            channel,
            feed,
            previous: previous ?? null,
            current: currentSeq,
            startMs,
            endMs: stamp.receivedAtMs,
            certainty: (currentSeq as number) > (previous ?? 0) + 1 ? 'confirmed' : 'uncertain',
          })
        }
        sequence.set(channel, currentSeq as number)
        lastChannelReceipt.set(channel, stamp.receivedAtMs)
      }
      if (typeof message.dropped === 'number' && message.dropped > 0) {
        report('gap', 'polybolt_dropped', stamp, {
          channel,
          feed,
          dropped: message.dropped,
          startMs,
          endMs: stamp.receivedAtMs,
          certainty: 'confirmed',
        })
      }
      const payload = message.payload as Record<string, unknown> | null | undefined
      if (
        !payload ||
        payload.symbol !== 'btcusd' ||
        (channel === 'price.crypto.twap' && payload.window_seconds !== 60)
      ) {
        report('gap', 'polybolt_payload_mismatch', stamp, { channel, feed })
        return
      }
      if (payload.source !== 'chainlink') {
        report('provider_mismatch', 'polybolt_payload_provider', stamp, {
          channel,
          feed,
          provider: payload.source ?? null,
        })
        return
      }
      const points = message.snapshot === true ? payload.data : [payload]
      if (!Array.isArray(points) || points.length === 0) {
        report('gap', 'polybolt_empty_snapshot', stamp, { channel, feed })
        return
      }
      const valid = isValidPolyBoltPriceEnvelope(message)
      if (!valid) {
        report('gap', 'polybolt_invalid_price', stamp, { channel, feed })
        return
      }
      activity.set(channel, stamp)
    },
    onTick: (connection) => {
      const stamp = clock()
      const now = BigInt(stamp.monotonicNs)
      if (!authed) {
        if (now - opened > BigInt(options.authTimeoutMs ?? 10_000) * 1_000_000n) {
          connection.reconnect('polybolt_auth_timeout')
        }
        return
      }
      for (const channel of CHANNELS) {
        const last = activity.get(channel)
        if (
          now - (last ? BigInt(last.monotonicNs) : opened) >
          BigInt(options.dataStaleMs ?? 30_000) * 1_000_000n
        ) {
          report('stale', `polybolt_data_stale:${channel}`, stamp, {
            channel,
            feed: feedForChannel(channel),
            startMs: last?.receivedAtMs ?? openedAtMs,
            certainty: 'uncertain',
          })
          connection.reconnect(`polybolt_data_stale:${channel}`)
          return
        }
      }
    },
  })
  return { start: transport.start, stop: transport.stop }
}
