import { randomUUID } from 'node:crypto'
import WebSocket, { type RawData } from 'ws'
import type { FeedCallbacks, FeedStatus, IngressStamp, RecorderSource } from '../types.js'

export const ingressStamp = (): IngressStamp => ({
  receivedAtMs: Date.now(),
  monotonicNs: process.hrtime.bigint().toString(),
})

export type SocketTransport = {
  start(): void
  stop(): void
  send(raw: string): boolean
  reconnect(reason: string): void
  halt(reason: string): void
  connectionId(): string
}

export type TransportOptions = FeedCallbacks & {
  source: RecorderSource
  url: string
  onOpen?: (transport: SocketTransport) => void
  /** Runs after the raw frame was synchronously captured. */
  onMessage?: (raw: string, stamp: IngressStamp, transport: SocketTransport) => void
  onTick?: (transport: SocketTransport) => void
  onClose?: () => void
  clock?: () => IngressStamp
  socketFactory?: (url: string) => WebSocket
  idleMs?: number
  tickMs?: number
  pingText?: string
  pingIntervalMs?: number
  reconnectBaseMs?: number
  random?: () => number
  permanentCloseCodes?: number[]
}

function rawText(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return raw.toString('utf8')
}

/** A single reconnect owner, with no outbound authentication logging. */
export function createSocketTransport(options: TransportOptions): SocketTransport {
  const stamp = options.clock ?? ingressStamp
  const random = options.random ?? Math.random
  let socket: WebSocket | undefined
  let running = false
  let id = ''
  let attempts = 0
  let timer: NodeJS.Timeout | undefined
  let tick: NodeJS.Timeout | undefined
  let lastActivityNs = 0n
  let lastActivityMs = 0
  let openedNs = 0n
  let lastPingNs = 0n
  let retryAfterMs = 0

  const status = (kind: FeedStatus['kind'], reason?: string, details?: Record<string, unknown>) => {
    options.onStatus({
      source: options.source,
      connectionId: id,
      kind,
      stamp: stamp(),
      ...(reason === undefined ? {} : { reason }),
      ...(details === undefined ? {} : { details }),
    })
  }
  const clearTimers = () => {
    if (timer) clearTimeout(timer)
    if (tick) clearInterval(tick)
    timer = undefined
    tick = undefined
  }

  const connect = () => {
    if (!running) return
    id = randomUUID()
    status('connecting')
    const currentId = id
    retryAfterMs = 0
    openedNs = 0n
    const current = options.socketFactory
      ? options.socketFactory(options.url)
      : new WebSocket(options.url, {
          handshakeTimeout: 10_000,
          perMessageDeflate: false,
          maxPayload: 16 * 1024 * 1024,
          followRedirects: false,
        })
    socket = current
    const isCurrent = () => running && socket === current
    current.on('open', () => {
      if (!isCurrent()) return
      const opened = stamp()
      lastActivityMs = opened.receivedAtMs
      openedNs = lastActivityNs = lastPingNs = BigInt(opened.monotonicNs)
      status('connected')
      options.onOpen?.(transport)
      tick = setInterval(() => {
        if (!isCurrent()) return
        const now = BigInt(stamp().monotonicNs)
        if (now - lastActivityNs > BigInt(options.idleMs ?? 45_000) * 1_000_000n) {
          status('stale', 'transport_idle_timeout', {
            startMs: lastActivityMs,
            certainty: 'uncertain',
          })
          current.terminate()
          return
        }
        if (
          options.pingText &&
          now - lastPingNs >= BigInt(options.pingIntervalMs ?? 10_000) * 1_000_000n
        ) {
          transport.send(options.pingText)
          lastPingNs = now
        }
        options.onTick?.(transport)
      }, options.tickMs ?? 1_000)
    })
    current.on('message', (data, binary) => {
      const received = stamp()
      if (!isCurrent()) return
      lastActivityNs = BigInt(received.monotonicNs)
      lastActivityMs = received.receivedAtMs
      // All current feeds use text. Unexpected binary data is preserved losslessly.
      const raw = binary
        ? JSON.stringify({
            transport: 'binary',
            base64: Buffer.from(rawTextBytes(data)).toString('base64'),
          })
        : rawText(data)
      options.onFrame({
        source: options.source,
        connectionId: currentId,
        rawJson: raw,
        stamp: received,
      })
      if (binary) status('gap', 'unexpected_binary_frame')
      else options.onMessage?.(raw, received, transport)
    })
    // ws automatically echoes protocol pings. Capture control frames without treating them as prices.
    for (const type of ['ping', 'pong'] as const) {
      current.on(type, (data: Buffer) => {
        const received = stamp()
        if (!isCurrent()) return
        lastActivityNs = BigInt(received.monotonicNs)
        lastActivityMs = received.receivedAtMs
        options.onFrame({
          source: options.source,
          connectionId: currentId,
          rawJson: JSON.stringify({ transport: type, base64: data.toString('base64') }),
          stamp: received,
        })
      })
    }
    current.on('error', () => {
      if (isCurrent()) status('error', 'websocket_transport_error')
    })
    current.on('unexpected-response', (request, response) => {
      if (!isCurrent()) return
      const header = response.headers['retry-after']
      const value = Array.isArray(header) ? header[0] : header
      if (value) {
        const seconds = Number(value)
        retryAfterMs = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1_000)
          : Math.max(0, Date.parse(value) - stamp().receivedAtMs) || 0
      }
      status('error', 'websocket_handshake_rejected', { httpStatus: response.statusCode })
      response.resume()
      request.destroy()
      current.terminate()
    })
    current.on('close', (code) => {
      if (socket !== current) return
      if (tick) clearInterval(tick)
      tick = undefined
      socket = undefined
      options.onClose?.()
      if (!running) return
      // Even a normal remote close interrupts observation; do not suppress boundary gaps.
      status('disconnected', 'websocket_closed', {
        code,
        ...(openedNs > 0n ? { startMs: lastActivityMs } : {}),
        certainty: 'uncertain',
      })
      if (options.permanentCloseCodes?.includes(code)) {
        running = false
        status('error', 'websocket_requires_configuration_fix', { code, permanent: true })
        return
      }
      const now = BigInt(stamp().monotonicNs)
      if (openedNs > 0n && now - openedNs > 60_000_000_000n) attempts = 0
      const cap = Math.min(
        30_000,
        (options.reconnectBaseMs ?? 1_000) * 2 ** Math.min(attempts++, 10),
      )
      const jitter = code === 4003 ? random() * 10_000 : random() * cap
      const delay = Math.max(1, Math.ceil(retryAfterMs + jitter))
      timer = setTimeout(connect, delay)
    })
  }

  const transport: SocketTransport = {
    start() {
      if (running) return
      running = true
      attempts = 0
      connect()
    },
    stop() {
      if (!running && !socket) return
      running = false
      clearTimers()
      status('stopped', 'requested_stop')
      socket?.terminate()
    },
    send(raw) {
      if (!running || socket?.readyState !== WebSocket.OPEN) return false
      socket.send(raw)
      return true
    },
    reconnect(reason) {
      if (!running) return
      status('gap', reason)
      socket?.terminate()
    },
    halt(reason) {
      if (!running) return
      status('error', reason, { permanent: true })
      running = false
      clearTimers()
      socket?.terminate()
    },
    connectionId: () => id,
  }
  return transport
}

function rawTextBytes(raw: RawData): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw)
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return raw
}

export function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
