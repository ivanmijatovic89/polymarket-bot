import path from 'node:path'

import { getCurrentUpDown15mMarket, type UpDown15mSymbol } from '../polymarket/upDown15m.js'
import type { PolymarketAuth } from '../polymarket/marketWs.js'
import { parseOptionalAuth } from '../polymarket/auth.js'
import { parseEventIndexFields } from '../polymarket/marketEventIndex.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { RotatingParquetEventRecorder } from '../io/parquet/eventWriter.js'
import type { RawMarketEventRow } from '../types/rawEvent.js'
import { createWindowBoundaryScheduler, formatMsAsMmSs, msUntilNextBoundary } from '../utils/windowBoundary.js'
import { FIFTEEN_MIN_MS } from '../utils/timeWindows.js'

process.on('unhandledRejection', (reason) => {
  console.error('[record-live] unhandledRejection', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[record-live] uncaughtException', err)
  process.exit(1)
})

const DEFAULT_STATS_INTERVAL_MS = 10_000
const DEFAULT_SKIP_IF_OLDER_MS = 10_000

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  return n
}

function floorToWindowStart(tsMs: number, windowMs: number): number {
  return Math.floor(tsMs / windowMs) * windowMs
}

function asTerminatedParquetPath(filePathFinal: string): string {
  // Mark incomplete files created by manual termination (Ctrl+C / SIGTERM).
  if (filePathFinal.endsWith('-terminated.parquet')) return filePathFinal
  if (filePathFinal.endsWith('.parquet')) return filePathFinal.replace(/\.parquet$/, '-terminated.parquet')
  return `${filePathFinal}-terminated`
}

class SkipWindowError extends Error {
  readonly waitMs: number
  constructor(message: string, waitMs: number) {
    super(message)
    this.name = 'SkipWindowError'
    this.waitMs = waitMs
  }
}

function tryParseUpDown15mSlugEpochMs(args: {
  slug: string
  symbol: UpDown15mSymbol
}): number | null {
  // Expected: <symbol>-updown-15m-<epochSeconds>
  // Note: RegExp(string) needs a single escaped `\\d` to mean digit.
  // `\\\\d` would match the literal string "\d" and would break the skip-if-older logic.
  const m = new RegExp(`^${args.symbol}-updown-15m-(\\d+)$`).exec(args.slug)
  if (!m) return null
  const seconds = Number(m[1])
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

async function main(): Promise<void> {
  const wsUrl =
    process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market'

  const rawSymbol = process.env.RECORD_SYMBOL
  if (!rawSymbol) {
    throw new Error('[record-live] RECORD_SYMBOL is required (BTC|ETH|SOL|XRP)')
  }
  const symbol = rawSymbol.trim().toLowerCase() as UpDown15mSymbol
  if (symbol !== 'btc' && symbol !== 'eth' && symbol !== 'sol' && symbol !== 'xrp') {
    throw new Error(`[record-live] invalid RECORD_SYMBOL=${rawSymbol} (expected BTC|ETH|SOL|XRP)`)
  }

  const baseDir = path.resolve(process.env.RECORD_BASE_DIR ?? 'data/events', symbol)
  const auth = parseOptionalAuth()

  const statsIntervalMs = parseEnvInt('RECORD_STATS_INTERVAL_MS', DEFAULT_STATS_INTERVAL_MS)
  const maxInFlightAppends = parseEnvInt('RECORD_MAX_INFLIGHT_APPENDS', 10_000)
  const skipIfOlderMs = parseEnvInt('RECORD_SKIP_IF_OLDER_MS', DEFAULT_SKIP_IF_OLDER_MS)

  console.log(`[record-live] symbol=${symbol}`)
  console.log(`[record-live] wsUrl=${wsUrl}`)
  console.log(`[record-live] baseDir=${baseDir}`)
  console.log(`[record-live] maxInFlightAppends=${maxInFlightAppends}`)

  const recorder = new RotatingParquetEventRecorder({
    baseDir,
    windowMs: FIFTEEN_MIN_MS,
  })

  // Per-market ingestion sequence (resets automatically for each new market id).
  const ingestSeqByMarket = new Map<string, bigint>()
  // Market ids observed on the current WS connection (used for synthetic disconnect markers).
  const seenMarketIds = new Set<string>()
  let shouldStop = false
  let isRotating = false

  let currentAssetsIds: string[] = []
  let currentSlug: string | undefined

  let everConnected = false
  let isWaitingForNextWindow = false

  let inFlightAppends = 0
  let totalAppends = 0
  let appendErrors = 0
  let disconnects = 0
  let expectedCloses = 0
  let droppedNoMarket = 0
  let droppedBadJson = 0
  let droppedUnknownType = 0

  const classifyClose = (
    code: number,
    reasonStr: string,
  ): { kind: 'expected' | 'unexpected'; tag: string } => {
    const r = reasonStr.toLowerCase()

    // Codes are per RFC6455 / ws conventions:
    // - 1000: Normal closure
    // - 1001: Going away
    // - 1005/1006: No status code / Abnormal closure (should be treated as unexpected)
    if (code === 1000 || code === 1001) {
      // Some providers send empty reasons on normal close.
      // When this happens around a 15m market boundary/end, we do NOT want to count it as a disconnect.
      return { kind: 'expected', tag: 'normal_close' }
    }

    // Heuristics for "market ended / subscription no longer valid" closes.
    if (
      r.includes('market') ||
      r.includes('closed') ||
      r.includes('inactive') ||
      r.includes('not active') ||
      r.includes('no longer') ||
      r.includes('expired') ||
      r.includes('asset') ||
      r.includes('token') ||
      r.includes('unsubscribe')
    ) {
      // If a server closes with a specific error code + reason, prefer to treat it as expected.
      // (We still reconnect immediately, but we won't write synthetic `disconnect` markers.)
      if (code >= 1000 && code < 4000) {
        return { kind: 'expected', tag: 'market_end_or_subscription' }
      }
    }

    return { kind: 'unexpected', tag: 'disconnect' }
  }

  // Stats scoping: `totalAppends` should track the current market (slug) only.
  // We treat the Gamma slug as the market key because it rotates every 15m.
  let statsMarketKey: string | undefined

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
    // If we're intentionally waiting for the next window and nothing has been written yet,
    // keep the console clean (avoid repeating "all zeros" stats lines).
    if (
      isWaitingForNextWindow &&
      inFlightAppends === 0 &&
      totalAppends === 0 &&
      appendErrors === 0
    ) {
      return
    }

    const msLeft = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    const secLeft = Math.max(0, Math.ceil(msLeft / 1000))
    const minLeft = Math.floor(secLeft / 60)
    const secRemainder = secLeft % 60
    const candleLeft = `${String(minLeft).padStart(2, '0')}:${String(secRemainder).padStart(2, '0')}`

    console.log(
      `[record-live] stats in_flight_appends=${inFlightAppends} total_appends=${totalAppends} append_errors=${appendErrors} candle_left=${candleLeft} disconnects=${disconnects} expected_closes=${expectedCloses} dropped_no_market=${droppedNoMarket} dropped_bad_json=${droppedBadJson} dropped_unknown_type=${droppedUnknownType}`,
    )
  }, statsIntervalMs)

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label: string }> => {
    const m = await getCurrentUpDown15mMarket(symbol, new Date())
    if (!m)
      throw new Error(
        `[record-live] No current ${symbol.toUpperCase()} 15m Up/Down market found on Gamma`,
      )

    const nextSlug = m.slug
    currentSlug = m.slug

    // If the market already started, don't join mid-candle on *initial startup*.
    // This prevents overwriting the current slug's single parquet file on restarts.
    //
    // IMPORTANT: once we've connected at least once (`everConnected=true`), we MUST allow
    // mid-window reconnects, otherwise a single disconnect after ~10s would cause us to
    // stop recording until the next 15m boundary (producing "short files" ending with
    // a synthetic `disconnect` marker).
    const windowStartMsFromSlug = tryParseUpDown15mSlugEpochMs({ slug: m.slug, symbol })
    if (windowStartMsFromSlug !== null) {
      // After a 15m boundary, Gamma may briefly still return the previous market.
      // If so, retry quickly rather than skipping a whole 15m window.
      const expectedWindowStartMs = floorToWindowStart(Date.now(), FIFTEEN_MIN_MS)
      if (windowStartMsFromSlug < expectedWindowStartMs) {
        currentSlug = undefined
        isWaitingForNextWindow = true
        throw new SkipWindowError(
          `[record-live] gamma still returning previous market slug=${m.slug}; waiting for current window market`,
          500,
        )
      }

      const ageMs = Date.now() - windowStartMsFromSlug
      if (!everConnected && ageMs > skipIfOlderMs) {
        currentSlug = undefined
        isWaitingForNextWindow = true
        const waitMs = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS) + 250
        throw new SkipWindowError(
          `[record-live] market already started ageMs=${ageMs} > skipIfOlderMs=${skipIfOlderMs}; waiting for next window`,
          waitMs,
        )
      }
    }

    const assetsIds = m.clobTokenIds.slice(0, 2)
    const map = Object.fromEntries(m.outcomes.slice(0, 2).map((o, i) => [o, assetsIds[i]]))
    console.log('[record-live] chosen market from Gamma:', { slug: m.slug, question: m.question })
    console.log('[record-live] token ids:', map)

    // Reset per-market stats when the selected Gamma market changes.
    const nextStatsKey = currentSlug
    if (nextStatsKey && nextStatsKey !== statsMarketKey) {
      statsMarketKey = nextStatsKey
      totalAppends = 0
    }

    // Remember the current subscription targets for logging and markers.
    currentAssetsIds = assetsIds
    seenMarketIds.clear()

    return { assetsIds, label: `gamma:${nextSlug}` }
  }

  let manualReconnectTimer: NodeJS.Timeout | undefined

  const source = createLiveMarketEventSource({
    url: wsUrl,
    ...(auth ? { auth } : {}),
    resolveAssetsIds,
  })

  const requestReconnect = (delayMs: number, why: string): void => {
    if (shouldStop) return
    if (manualReconnectTimer) clearTimeout(manualReconnectTimer)
    manualReconnectTimer = setTimeout(() => {
      if (shouldStop) return
      source.start()
    }, delayMs)
    console.log(`[record-live] scheduled reconnect in ${formatMsAsMmSs(delayMs)} (${why})`)
  }

  source.onEvent(({ tsLocalMs, raw }) => {
    if (shouldStop || isRotating) return

    const idx = parseEventIndexFields(raw)

    // We rotate/write per market. If a message doesn't carry `market` (e.g. acks),
    // we ignore it to avoid polluting `market=unknown` files.
    if (!idx.market) {
      droppedNoMarket += 1
      return
    }
    if (idx.event_type === 'invalid_json') {
      droppedBadJson += 1
      return
    }
    if (idx.event_type === 'unknown') {
      droppedUnknownType += 1
      return
    }

    const marketId = idx.market
    seenMarketIds.add(marketId)
    const nextSeq = (ingestSeqByMarket.get(marketId) ?? 0n) + 1n
    ingestSeqByMarket.set(marketId, nextSeq)

    const row: RawMarketEventRow = {
      ingest_seq: nextSeq,
      ts_local_ms: tsLocalMs,
      ...(idx.ts_exchange_ms ? { ts_exchange_ms: idx.ts_exchange_ms } : {}),
      event_type: idx.event_type,
      raw_json: raw,
    }

    const fileKey = currentSlug ?? `market-${marketId}`

    // No queue: write immediately. If disk can't keep up, we disconnect to avoid
    // unbounded memory growth from piling up promises/buffers.
    if (inFlightAppends >= maxInFlightAppends) {
      console.warn(
        `[record-live] writer lag detected (inFlightAppends=${inFlightAppends} >= ${maxInFlightAppends}); disconnecting`,
      )
      source.stop()
      requestReconnect(1_000, 'writer_lag')
      return
    }

    inFlightAppends += 1
    totalAppends += 1
    void recorder
      .append({ marketId, fileKey, row })
      .catch((err) => {
        appendErrors += 1
        console.error('[record-live] append failed', err)
      })
      .finally(() => {
        inFlightAppends -= 1
      })
  })

  source.onStatus((s) => {
    if (shouldStop || isRotating) return

    if (s.kind === 'connected') {
      const msg = everConnected ? 'reconnected + subscribed' : 'connected + subscribed'
      everConnected = true
      isWaitingForNextWindow = false
      console.log(`[record-live] ${msg}`)
      return
    }

    if (s.kind === 'reconnecting') {
      // Keep console readable: show delays in mm:ss format.
      const extra = s.info ? ` (${s.info})` : ''
      console.log(`[record-live] scheduled reconnect in ${formatMsAsMmSs(s.delayMs)}${extra}`)
      return
    }

    if (s.kind !== 'disconnected') return
    if (typeof s.code !== 'number') return
    const code = s.code
    const reasonStr = s.reason ?? ''

    const msg = `[record-live] disconnected code=${code} reason=${reasonStr}`
    console.error(`\x1b[31m${msg}\x1b[0m`)

    let closeKind = classifyClose(code, reasonStr)

    // Special case: Polymarket may close the WS right as the 15m market ends.
    // That should not count as an "unexpected disconnect".
    const msToBoundary = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    const isNearBoundary = msToBoundary <= 2_000
    const slugStartMs = currentSlug ? tryParseUpDown15mSlugEpochMs({ slug: currentSlug, symbol }) : null
    const isNearWindowEnd = slugStartMs !== null ? Date.now() - slugStartMs >= FIFTEEN_MIN_MS - 2_000 : false

    if (closeKind.kind === 'unexpected' && (isNearBoundary || isNearWindowEnd)) {
      closeKind = { kind: 'expected', tag: 'window_end' }
    }

    if (closeKind.kind === 'expected') {
      expectedCloses += 1
      return
    }

    disconnects += 1

    // Persist a synthetic disconnect marker so backtests can detect data gaps.
    // Note: the parquet writer may open on this marker even if the initial `book`
    // snapshot was never received.
    const ts = BigInt(Date.now())
    const markets = [...seenMarketIds]
    for (const marketId of markets) {
      const nextSeq = (ingestSeqByMarket.get(marketId) ?? 0n) + 1n
      ingestSeqByMarket.set(marketId, nextSeq)

      const fileKey = currentSlug ?? `market-${marketId}`
      const row: RawMarketEventRow = {
        ingest_seq: nextSeq,
        ts_local_ms: ts,
        ts_exchange_ms: ts,
        event_type: closeKind.tag,
        raw_json: JSON.stringify({
          event_type: closeKind.tag,
          market: marketId,
          timestamp: ts.toString(),
          ws_close_code: code,
          ws_close_reason: reasonStr,
        }),
      }

      inFlightAppends += 1
      totalAppends += 1
      void recorder
        .append({ marketId, fileKey, row })
        .catch((err) => {
          appendErrors += 1
          console.error('[record-live] disconnect append failed', err)
        })
        .finally(() => {
          inFlightAppends -= 1
        })
    }
  })

  const rotateAndReconnect = (): void => {
    void (async () => {
      if (shouldStop) return
      if (isRotating) return
      isRotating = true

      console.log('[record-live] 15m boundary: closing parquet writers + reconnecting ws')
      if (currentSlug) console.log(`[record-live] last gamma slug=${currentSlug}`)
      if (currentAssetsIds.length)
        console.log(`[record-live] last assets=${currentAssetsIds.length}`)

      // Stop inbound first, then flush queue, then close writers (writes footer + renames tmp).
      source.stop()

      const drained = await waitForInFlightAppends(10_000)
      if (!drained) {
        console.warn(
          `[record-live] in-flight appends did not drain before rotation (inFlightAppends=${inFlightAppends}); proceeding to close`,
        )
      }

      await recorder.closeAll()
      // Reconnect will re-resolve the current market slug/token ids.
      isRotating = false
      requestReconnect(500, 'window_boundary')
    })().catch((err) => {
      console.error('[record-live] rotate failed', err)
      isRotating = false
      requestReconnect(2_000, 'rotate_failed')
    })
  }

  const boundaryScheduler = createWindowBoundaryScheduler({
    windowMs: FIFTEEN_MIN_MS,
    onBoundary: () => {
      if (shouldStop) return
      rotateAndReconnect()
    },
  })

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[record-live] ${signal} received, shutting down...`)
    shouldStop = true
    isRotating = true
    boundaryScheduler.stop()
    if (manualReconnectTimer) clearTimeout(manualReconnectTimer)
    manualReconnectTimer = undefined
    if (statsInterval) clearInterval(statsInterval)
    statsInterval = undefined

    source.stop()

    void (async () => {
      const drained = await waitForInFlightAppends(10_000)
      if (!drained) {
        console.warn(
          `[record-live] in-flight appends did not drain before shutdown (inFlightAppends=${inFlightAppends}); proceeding to close`,
        )
      }

      await recorder.closeAll({
        finalPathTransform: ({ filePathFinal }) => asTerminatedParquetPath(filePathFinal),
      })
      process.exit(0)
    })().catch((err) => {
      console.error('[record-live] shutdown failed', err)
      process.exit(1)
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  source.start()
  boundaryScheduler.start()
}

main().catch((err) => {
  console.error('[record-live] fatal error', err)
  process.exit(1)
})
