import type {
  MarketEvent,
  MarketEventSource,
  MarketEventStatus,
} from '../ingest/marketEventSource.js'
import { createMarketWsClient, type MarketWsClient, type PolymarketAuth } from './marketWs.js'

export type LiveMarketEventSourceOptions = {
  url: string
  auth?: PolymarketAuth
  /**
   * Resolve the current subscription targets.
   * This is called on every (re)connect attempt, allowing callers to rotate markets.
   */
  resolveAssetsIds: () => Promise<{ assetsIds: string[]; label?: string }>
  reconnect?: {
    /** Base delay for reconnect attempts (default 1000ms). */
    baseDelayMs?: number
    /** Maximum backoff delay (default 10_000ms). */
    maxDelayMs?: number
    /** Random jitter added to reconnect delay (default 250ms). */
    jitterMs?: number
  }
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function getWaitMsFromError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  if (!('waitMs' in err)) return undefined
  const raw = (err as { waitMs?: unknown }).waitMs
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.trunc(n)
}

function jitter(delayMs: number, jitterMs: number): number {
  if (jitterMs <= 0) return delayMs
  const j = Math.floor(Math.random() * (jitterMs + 1))
  return Math.max(0, delayMs + j)
}

export function createLiveMarketEventSource(opts: LiveMarketEventSourceOptions): MarketEventSource {
  const baseDelayMs = opts.reconnect?.baseDelayMs ?? 1_000
  const maxDelayMs = opts.reconnect?.maxDelayMs ?? 10_000
  const jitterMs = opts.reconnect?.jitterMs ?? 250

  const eventListeners = new Set<(ev: MarketEvent) => void>()
  const statusListeners = new Set<(s: MarketEventStatus) => void>()

  let running = false
  let session = 0
  let connectInFlight: Promise<void> | undefined
  let reconnectTimer: NodeJS.Timeout | undefined

  let client: MarketWsClient | undefined
  let attempt = 0
  let backoffMs = baseDelayMs
  let lastLabel: string | undefined

  const emitEvent = (ev: MarketEvent): void => {
    for (const cb of eventListeners) cb(ev)
  }

  const emitStatus = (s: MarketEventStatus): void => {
    for (const cb of statusListeners) cb(s)
  }

  const clearReconnect = (): void => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  const scheduleReconnect = (delayMs: number, info?: string): void => {
    if (!running) return
    clearReconnect()
    const delay = jitter(delayMs, jitterMs)
    emitStatus({ kind: 'reconnecting', attempt, delayMs: delay, ...(info ? { info } : {}) })
    reconnectTimer = setTimeout(() => {
      connect()
    }, delay)
  }

  const connect = (): void => {
    if (!running) return
    if (connectInFlight) return

    connectInFlight = (async () => {
      const mySession = session
      attempt += 1

      let assetsIds: string[]
      let label: string | undefined
      try {
        const resolved = await opts.resolveAssetsIds()
        if (!running || mySession !== session) return
        assetsIds = resolved.assetsIds
        label = resolved.label
      } catch (err) {
        if (!running || mySession !== session) return
        const waitMs = getWaitMsFromError(err)
        const msg =
          waitMs !== undefined
            ? asErrorMessage(err)
            : `resolveAssetsIds failed: ${asErrorMessage(err)}`
        // If the resolver is telling us to wait (e.g. "no current market yet"), obey.
        scheduleReconnect(waitMs ?? backoffMs, msg)
        // Increase backoff only for generic errors (not for explicit waits).
        if (waitMs === undefined)
          backoffMs = Math.min(maxDelayMs, Math.max(baseDelayMs, backoffMs * 2))
        return
      }

      lastLabel = label

      // Tear down any previous client before creating a new one.
      client?.close()
      client = undefined

      if (!running || mySession !== session) return

      client = createMarketWsClient({
        url: opts.url,
        assetsIds,
        ...(opts.auth ? { auth: opts.auth } : {}),
        onOpen: () => {
          if (!running || mySession !== session) return
          // Reset backoff on successful open.
          backoffMs = baseDelayMs
          emitStatus({
            kind: 'connected',
            attempt,
            ...(lastLabel ? { info: lastLabel } : {}),
          })
        },
        onMessage: (raw) => {
          if (!running || mySession !== session) return
          emitEvent({ tsLocalMs: BigInt(Date.now()), raw })
        },
        onClose: (code, reason) => {
          if (mySession !== session) return
          const reasonStr = reason.toString()
          emitStatus({
            kind: 'disconnected',
            attempt,
            code,
            reason: reasonStr,
            ...(lastLabel ? { info: lastLabel } : {}),
          })

          client = undefined
          if (!running) return

          scheduleReconnect(backoffMs, `ws closed code=${code} reason=${reasonStr}`)
          // Avoid exponential backoff for normal closes (e.g. market rotations / clean disconnects).
          if (code !== 1000 && code !== 1001) {
            backoffMs = Math.min(maxDelayMs, Math.max(baseDelayMs, backoffMs * 2))
          }
        },
        onError: (err) => {
          if (!running || mySession !== session) return
          // `ws` typically triggers `close` after `error`, but we still surface this.
          emitStatus({
            kind: 'disconnected',
            attempt,
            ...(lastLabel
              ? { info: `${lastLabel} ws error: ${err.message}` }
              : { info: `ws error: ${err.message}` }),
          })
        },
      })
    })()
      .catch((err) => {
        if (!running) return
        scheduleReconnect(backoffMs, `connect failed: ${asErrorMessage(err)}`)
        backoffMs = Math.min(maxDelayMs, Math.max(baseDelayMs, backoffMs * 2))
      })
      .finally(() => {
        connectInFlight = undefined
      })
  }

  return {
    start: () => {
      if (running) return
      running = true
      session += 1
      backoffMs = baseDelayMs
      clearReconnect()
      connect()
    },
    stop: () => {
      running = false
      session += 1
      clearReconnect()
      client?.close()
      client = undefined
    },
    onEvent: (cb) => {
      eventListeners.add(cb)
      return () => {
        eventListeners.delete(cb)
      }
    },
    onStatus: (cb) => {
      statusListeners.add(cb)
      return () => {
        statusListeners.delete(cb)
      }
    },
  }
}
