import path from 'node:path'

import { getCurrentBtcUpDown15mMarket } from '../polymarket/btcUpDown15m.js'
import { createMarketWsClient, type PolymarketAuth } from '../polymarket/marketWs.js'
import { RotatingParquetEventRecorder } from '../io/parquet/eventWriter.js'
import type { RawMarketEventRow } from '../types/rawEvent.js'

process.on('unhandledRejection', (reason) => {
  console.error('[record-live] unhandledRejection', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[record-live] uncaughtException', err)
  process.exit(1)
})

const FIFTEEN_MIN_MS = 15 * 60 * 1000
const DEFAULT_STATS_INTERVAL_MS = 10_000

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  return n
}

function parseOptionalAuth(): PolymarketAuth | undefined {
  const apiKey = process.env.POLYMARKET_API_KEY
  const secret = process.env.POLYMARKET_API_SECRET
  const passphrase = process.env.POLYMARKET_API_PASSPHRASE
  if (!apiKey || !secret || !passphrase) return undefined
  return { apiKey, secret, passphrase }
}

function parseEventIndexFields(rawJson: string): {
  event_type: string
  market?: string
  asset_id?: string
  ts_exchange_ms?: bigint
} {
  try {
    const obj: unknown = JSON.parse(rawJson)
    if (!obj || typeof obj !== 'object') return { event_type: 'unknown' }

    const rec = obj as Record<string, unknown>
    const event_type = typeof rec.event_type === 'string' ? rec.event_type : 'unknown'
    const market = typeof rec.market === 'string' ? rec.market : undefined
    const asset_id = typeof rec.asset_id === 'string' ? rec.asset_id : undefined

    let ts_exchange_ms: bigint | undefined
    if (typeof rec.timestamp === 'string' && rec.timestamp.trim() !== '') {
      // Polymarket uses unix ms timestamps encoded as strings.
      ts_exchange_ms = BigInt(rec.timestamp)
    }

    const out: { event_type: string; market?: string; asset_id?: string; ts_exchange_ms?: bigint } =
      {
        event_type,
      }
    if (market) out.market = market
    if (asset_id) out.asset_id = asset_id
    if (ts_exchange_ms) out.ts_exchange_ms = ts_exchange_ms
    return out
  } catch {
    return { event_type: 'invalid_json' }
  }
}

function msUntilNextBoundary(nowMs: number, windowMs: number): number {
  const next = (Math.floor(nowMs / windowMs) + 1) * windowMs
  return Math.max(0, next - nowMs)
}

async function main(): Promise<void> {
  const wsUrl =
    process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market'

  const baseDir = path.resolve(process.env.RECORD_BASE_DIR ?? 'data/events')
  const auth = parseOptionalAuth()

  const statsIntervalMs = parseEnvInt('RECORD_STATS_INTERVAL_MS', DEFAULT_STATS_INTERVAL_MS)
  const maxInFlightAppends = parseEnvInt('RECORD_MAX_INFLIGHT_APPENDS', 10_000)

  console.log(`[record-live] wsUrl=${wsUrl}`)
  console.log(`[record-live] baseDir=${baseDir}`)
  console.log(`[record-live] maxInFlightAppends=${maxInFlightAppends}`)

  const recorder = new RotatingParquetEventRecorder({
    baseDir,
    windowMs: FIFTEEN_MIN_MS,
  })

  let ingestSeq = 0n
  let shouldStop = false
  let isRotating = false

  let currentClient: { close: () => void } | undefined
  let currentAssetsIds: string[] = []
  let currentSlug: string | undefined

  let inFlightAppends = 0
  let totalAppends = 0
  let appendErrors = 0

  const waitForInFlightAppends = async (timeoutMs: number): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (inFlightAppends === 0) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return inFlightAppends === 0
  }

  let statsInterval: NodeJS.Timeout | undefined
  statsInterval = setInterval(() => {
    const msLeft = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    const secLeft = Math.max(0, Math.ceil(msLeft / 1000))
    const minLeft = Math.floor(secLeft / 60)
    const secRemainder = secLeft % 60
    const candleLeft = `${String(minLeft).padStart(2, '0')}:${String(secRemainder).padStart(2, '0')}`
    console.log(
      `[record-live] stats in_flight_appends=${inFlightAppends} total_appends=${totalAppends} append_errors=${appendErrors} candle_left=${candleLeft}`,
    )
  }, statsIntervalMs)

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label: string }> => {
    const m = await getCurrentBtcUpDown15mMarket(new Date())
    if (!m) throw new Error('No current BTC 15m Up/Down market found on Gamma')

    currentSlug = m.slug
    const assetsIds = m.clobTokenIds.slice(0, 2)
    const map = Object.fromEntries(m.outcomes.slice(0, 2).map((o, i) => [o, assetsIds[i]]))
    console.log('[record-live] chosen market from Gamma:', { slug: m.slug, question: m.question })
    console.log('[record-live] token ids:', map)

    return { assetsIds, label: `gamma:${m.slug}` }
  }

  let connectInFlight: Promise<void> | undefined
  let reconnectTimer: NodeJS.Timeout | undefined
  let everConnected = false
  let connectAttempt = 0

  const scheduleReconnect = (delayMs: number): void => {
    if (shouldStop) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connect()
    }, delayMs)
    console.log(`[record-live] scheduled reconnect in ${delayMs}ms`)
  }

  const connect = (): void => {
    if (shouldStop) return
    if (connectInFlight) return

    connectInFlight = (async () => {
      connectAttempt += 1
      const { assetsIds, label } = await resolveAssetsIds()
      currentAssetsIds = assetsIds

      console.log(
        `[record-live] connecting... attempt=${connectAttempt} assets=${assetsIds.length} source=${label}`,
      )

      // Ensure we don't have a stale client lying around.
      currentClient?.close()
      currentClient = undefined

      currentClient = createMarketWsClient({
        url: wsUrl,
        assetsIds,
        ...(auth ? { auth } : {}),
        onOpen: () => {
          const msg = everConnected ? 'reconnected + subscribed' : 'connected + subscribed'
          everConnected = true
          console.log(`[record-live] ${msg}`)
        },
        onMessage: (raw) => {
          if (shouldStop || isRotating) return

          const tsLocalMs = BigInt(Date.now())
          const idx = parseEventIndexFields(raw)

          // We rotate/write per market. If a message doesn't carry `market` (e.g. acks),
          // we ignore it to avoid polluting `market=unknown` files.
          if (!idx.market) return
          if (idx.event_type === 'unknown' || idx.event_type === 'invalid_json') return

          ingestSeq += 1n

          const row: RawMarketEventRow = {
            ingest_seq: ingestSeq,
            ts_local_ms: tsLocalMs,
            ...(idx.ts_exchange_ms ? { ts_exchange_ms: idx.ts_exchange_ms } : {}),
            event_type: idx.event_type,
            market: idx.market,
            ...(currentSlug ? { market_slug: currentSlug } : {}),
            ...(idx.asset_id ? { asset_id: idx.asset_id } : {}),
            raw_json: raw,
          }

          // No queue: write immediately. If disk can't keep up, we disconnect to avoid
          // unbounded memory growth from piling up promises/buffers.
          if (inFlightAppends >= maxInFlightAppends) {
            if (currentClient) {
              console.warn(
                `[record-live] writer lag detected (inFlightAppends=${inFlightAppends} >= ${maxInFlightAppends}); disconnecting`,
              )
              currentClient.close()
              currentClient = undefined
            }
            return
          }

          inFlightAppends += 1
          totalAppends += 1
          void recorder
            .append(row)
            .catch((err) => {
              appendErrors += 1
              console.error('[record-live] append failed', err)
            })
            .finally(() => {
              inFlightAppends -= 1
            })
        },
        onClose: (code, reason) => {
          console.log(`[record-live] disconnected code=${code} reason=${reason.toString()}`)
          currentClient = undefined

          if (shouldStop || isRotating) return
          // quick reconnect loop (we also reconnect on every 15m boundary)
          scheduleReconnect(1_000)
        },
        onError: (err) => {
          console.error('[record-live] ws error', err)
        },
      })
    })()
      .catch((err) => {
        console.error('[record-live] connect failed', err)
        if (!shouldStop) scheduleReconnect(2_000)
      })
      .finally(() => {
        connectInFlight = undefined
      })
  }

  const rotateAndReconnect = (): void => {
    void (async () => {
      if (shouldStop) return
      if (isRotating) return
      isRotating = true

      console.log('[record-live] 15m boundary: closing parquet writers + reconnecting ws')
      if (currentSlug) console.log(`[record-live] last gamma slug=${currentSlug}`)
      if (currentAssetsIds.length)
        console.log(`[record-live] last assets=${currentAssetsIds.length}`)

      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined

      // Stop inbound first, then flush queue, then close writers (writes footer + renames tmp).
      currentClient?.close()
      currentClient = undefined

      const drained = await waitForInFlightAppends(10_000)
      if (!drained) {
        console.warn(
          `[record-live] in-flight appends did not drain before rotation (inFlightAppends=${inFlightAppends}); proceeding to close`,
        )
      }

      await recorder.closeAll()
      // Reconnect will re-resolve the current market slug/token ids.
      isRotating = false
      scheduleReconnect(500)
    })().catch((err) => {
      console.error('[record-live] rotate failed', err)
      isRotating = false
      if (!shouldStop) scheduleReconnect(2_000)
    })
  }

  const scheduleNextBoundary = (): void => {
    const delay = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    setTimeout(() => {
      if (shouldStop) return
      rotateAndReconnect()
      scheduleNextBoundary()
    }, delay)
  }

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[record-live] ${signal} received, shutting down...`)
    shouldStop = true
    isRotating = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    if (statsInterval) clearInterval(statsInterval)
    statsInterval = undefined

    currentClient?.close()
    currentClient = undefined

    void (async () => {
      const drained = await waitForInFlightAppends(10_000)
      if (!drained) {
        console.warn(
          `[record-live] in-flight appends did not drain before shutdown (inFlightAppends=${inFlightAppends}); proceeding to close`,
        )
      }

      await recorder.closeAll()
      process.exit(0)
    })().catch((err) => {
      console.error('[record-live] shutdown failed', err)
      process.exit(1)
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  connect()
  scheduleNextBoundary()
}

main().catch((err) => {
  console.error('[record-live] fatal error', err)
  process.exit(1)
})
