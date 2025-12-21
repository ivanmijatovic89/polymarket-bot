import path from 'node:path'

import { getCurrentBtcUpDown15mMarket } from '../polymarket/btcUpDown15m.js'
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

  const envAssetsIds = parseEnvList('POLYMARKET_ASSET_IDS')

  const baseDir = path.resolve(process.env.RECORD_BASE_DIR ?? 'data/events')
  const auth = parseOptionalAuth()

  console.log(`[record-live] wsUrl=${wsUrl}`)
  console.log(`[record-live] baseDir=${baseDir}`)

  const recorder = new RotatingParquetEventRecorder({
    baseDir,
    windowMs: FIFTEEN_MIN_MS,
  })

  let ingestSeq = 0n
  let shouldStop = false

  let currentClient: { close: () => void } | undefined
  let currentAssetsIds: string[] = []
  let currentSlug: string | undefined

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label: string }> => {
    if (envAssetsIds.length > 0) {
      return { assetsIds: envAssetsIds, label: `env(${envAssetsIds.length})` }
    }

    const m = await getCurrentBtcUpDown15mMarket(new Date())
    if (!m) throw new Error('No current BTC 15m Up/Down market found on Gamma')

    currentSlug = m.slug
    const assetsIds = m.clobTokenIds.slice(0, 2)
    const map = Object.fromEntries(m.outcomes.slice(0, 2).map((o, i) => [o, assetsIds[i]]))
    console.log('[record-live] chosen market from Gamma:', { slug: m.slug, question: m.question })
    console.log('[record-live] token ids:', map)

    return { assetsIds, label: `gamma:${m.slug}` }
  }

  const connect = (): void => {
    if (shouldStop) return

    void (async () => {
      const { assetsIds, label } = await resolveAssetsIds()
      currentAssetsIds = assetsIds

      console.log(`[record-live] connecting... assets=${assetsIds.length} source=${label}`)

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
              ...(currentSlug ? { market_slug: currentSlug } : {}),
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
    })().catch((err) => {
      console.error('[record-live] connect failed', err)
      if (!shouldStop) setTimeout(connect, 2_000)
    })
  }

  const rotateAndReconnect = (): void => {
    void (async () => {
      console.log('[record-live] 15m boundary: closing parquet writers + reconnecting ws')
      if (currentSlug) console.log(`[record-live] last gamma slug=${currentSlug}`)
      if (currentAssetsIds.length)
        console.log(`[record-live] last assets=${currentAssetsIds.length}`)
      await recorder.closeAll()
      currentClient?.close()
      currentClient = undefined
      // Reconnect will re-resolve the current market slug/token ids.
      setTimeout(connect, 500)
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
