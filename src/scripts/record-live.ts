import path from 'node:path'

import { createMarketWsClient, type PolymarketAuth } from '../polymarket/marketWs.js'
import { RotatingParquetEventRecorder } from '../io/parquet/eventWriter.js'
import type { RawMarketEventRow } from '../types/rawEvent.js'

const FIFTEEN_MIN_MS = 15 * 60 * 1000

function parseEnvList(name: string): string[] {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
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

    const out: { event_type: string; market?: string; asset_id?: string; ts_exchange_ms?: bigint } = {
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

  const assetsIds = parseEnvList('POLYMARKET_ASSET_IDS')
  if (assetsIds.length === 0) {
    throw new Error('Missing POLYMARKET_ASSET_IDS (comma-separated token ids)')
  }

  const baseDir = path.resolve(process.env.RECORD_BASE_DIR ?? 'data/events')
  const auth = parseOptionalAuth()

  console.log(`[record-live] wsUrl=${wsUrl}`)
  console.log(`[record-live] assetsIds=${assetsIds.length}`)
  console.log(`[record-live] baseDir=${baseDir}`)

  const recorder = new RotatingParquetEventRecorder({
    baseDir,
    windowMs: FIFTEEN_MIN_MS,
  })

  let ingestSeq = 0n
  let shouldStop = false

  let currentClient: { close: () => void } | undefined

  const connect = (): void => {
    if (shouldStop) return

    console.log('[record-live] connecting...')

    currentClient = createMarketWsClient({
      url: wsUrl,
      assetsIds,
      ...(auth ? { auth } : {}),
      onOpen: () => {
        console.log('[record-live] connected + subscribed')
      },
      onMessage: (raw) => {
        void (async () => {
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
            ...(idx.asset_id ? { asset_id: idx.asset_id } : {}),
            raw_json: raw,
          }

          await recorder.append(row)
        })().catch((err) => {
          console.error('[record-live] append failed', err)
        })
      },
      onClose: (code, reason) => {
        console.log(`[record-live] ws closed code=${code} reason=${reason.toString()}`)
        currentClient = undefined

        if (shouldStop) return
        // quick reconnect loop (we also reconnect on every 15m boundary)
        setTimeout(connect, 1_000)
      },
      onError: (err) => {
        console.error('[record-live] ws error', err)
      },
    })
  }

  const rotateAndReconnect = (): void => {
    void (async () => {
      console.log('[record-live] 15m boundary: closing parquet writers + reconnecting ws')
      await recorder.closeAll()
      currentClient?.close()
      currentClient = undefined
    })().catch((err) => {
      console.error('[record-live] rotate failed', err)
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

  process.on('SIGINT', () => {
    console.log('[record-live] SIGINT received, shutting down...')
    shouldStop = true
    currentClient?.close()
    void recorder.closeAll().finally(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    console.log('[record-live] SIGTERM received, shutting down...')
    shouldStop = true
    currentClient?.close()
    void recorder.closeAll().finally(() => process.exit(0))
  })

  connect()
  scheduleNextBoundary()
}

main().catch((err) => {
  console.error('[record-live] fatal error', err)
  process.exit(1)
})

