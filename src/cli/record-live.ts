import path from 'node:path'

import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { RotatingParquetEventRecorder } from '../parquet/io/eventWriter.js'
import type { RawMarketEventRow } from '../types/rawEvent.js'
import {
  createWindowBoundaryScheduler,
  formatMsAsMmSs,
  msUntilNextBoundary,
} from '../utils/windowBoundary.js'
import { FIFTEEN_MIN_MS } from '../utils/timeWindows.js'
import { requireUpDown15mSymbolFromEnv } from '../polymarket/symbols.js'
import { resolveCurrentUpDown15mAssets } from '../polymarket/resolveUpDown15mAssets.js'
import { createRawEventIndexer } from '../parquet/indexer/rawEventIndexer.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import { fetchGammaMarketBySlugAndMapApiResponseToMarketTable } from '../polymarket/gamma.js'
import { marketExistsBySlug, insertMarket, updateMarketBySlug } from '../db/index.js'

installProcessCrashHandlers({ prefix: 'record-live' })

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
  if (filePathFinal.endsWith('.parquet'))
    return filePathFinal.replace(/\.parquet$/, '-terminated.parquet')
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

function tryParseUpDown15mSlugEpochMs(args: { slug: string; symbol: string }): number | null {
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
  const cfg = loadPolymarketConfigFromEnv()
  const wsUrl = cfg.ws.marketUrl

  const symbol = requireUpDown15mSymbolFromEnv({
    primaryEnv: 'RECORD_SYMBOL',
    requiredName: 'RECORD_SYMBOL',
    script: 'record-live',
  })

  const baseDir = path.resolve(process.env.RECORD_BASE_DIR ?? 'data/events', symbol)
  const auth = cfg.creds

  const statsIntervalMs = parseEnvInt('RECORD_STATS_INTERVAL_MS', DEFAULT_STATS_INTERVAL_MS)
  const maxInFlightAppends = parseEnvInt('RECORD_MAX_INFLIGHT_APPENDS', 10_000)
  const skipIfOlderMs = parseEnvInt('RECORD_SKIP_IF_OLDER_MS', DEFAULT_SKIP_IF_OLDER_MS)

  // TEST MODE: Use 15 seconds instead of 15 minutes for faster testing
  // TODO: Remove this before production
  const TEST_MODE = process.env.RECORD_TEST_MODE === 'true'
  const windowMs = TEST_MODE ? 30_000 : FIFTEEN_MIN_MS // 15 seconds in test mode, 15 minutes otherwise

  console.log(`[record-live] symbol=${symbol}`)
  console.log(`[record-live] wsUrl=${wsUrl}`)
  console.log(`[record-live] baseDir=${baseDir}`)
  console.log(`[record-live] maxInFlightAppends=${maxInFlightAppends}`)
  if (TEST_MODE) {
    console.log(`[record-live] ⚠️  TEST MODE ENABLED: Using ${windowMs / 1000}s window instead of 15 minutes`)
  }

  const recorder = new RotatingParquetEventRecorder({
    baseDir,
    windowMs,
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
  const handler = createRawEventIndexer()

  // Track scheduled resolution update callbacks: slug -> scheduledTimeMs
  const scheduledResolutionUpdates = new Map<string, number>()

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
    const snap = handler.snapshot()
    // If we're intentionally waiting for the next window and nothing has been written yet,
    // keep the console clean (avoid repeating "all zeros" stats lines).
    if (
      isWaitingForNextWindow &&
      inFlightAppends === 0 &&
      totalAppends === 0 &&
      appendErrors === 0 &&
      snap.total === 0
    ) {
      return
    }

    const msLeft = msUntilNextBoundary(Date.now(), windowMs)
    const secLeft = Math.max(0, Math.ceil(msLeft / 1000))
    const minLeft = Math.floor(secLeft / 60)
    const secRemainder = secLeft % 60
    const candleLeft = `${String(minLeft).padStart(2, '0')}:${String(secRemainder).padStart(2, '0')}`

    // Format scheduled resolution updates
    const now = Date.now()
    const updateResolvedParts: string[] = []
    for (const [slug, scheduledTimeMs] of scheduledResolutionUpdates.entries()) {
      const remainingMs = scheduledTimeMs - now
      if (remainingMs > 0) {
        const remainingSec = Math.ceil(remainingMs / 1000)
        const remainingMin = Math.floor(remainingSec / 60)
        const remainingSecRemainder = remainingSec % 60
        updateResolvedParts.push(`${slug}:${remainingMin}m${remainingSecRemainder}sec`)
      }
    }
    const updateResolvedStr = updateResolvedParts.length > 0 ? ` updateResolved=${updateResolvedParts.join('|')}` : ''

    console.log(
      `[record-live] stats in_flight_appends=${inFlightAppends} total_appends=${totalAppends} append_errors=${appendErrors} candle_left=${candleLeft} disconnects=${disconnects} expected_closes=${expectedCloses} dropped_no_market=${snap.droppedNoMarket} dropped_bad_json=${snap.droppedBadJson} dropped_unknown_type=${snap.droppedUnknownType}${updateResolvedStr}`,
    )
  }, statsIntervalMs)

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label: string }> => {
    const resolved = await resolveCurrentUpDown15mAssets({ symbol, date: new Date() })
    currentSlug = resolved.slug

    // If the market already started, don't join mid-candle on *initial startup*.
    // This prevents overwriting the current slug's single parquet file on restarts.
    //
    // IMPORTANT: once we've connected at least once (`everConnected=true`), we MUST allow
    // mid-window reconnects, otherwise a single disconnect after ~10s would cause us to
    // stop recording until the next 15m boundary (producing "short files" ending with
    // a synthetic `disconnect` marker).
    const windowStartMsFromSlug = tryParseUpDown15mSlugEpochMs({ slug: resolved.slug, symbol })
    if (windowStartMsFromSlug !== null) {
      // In test mode, Gamma API still returns 15-minute markets, so we need to use FIFTEEN_MIN_MS
      // for window boundary checks instead of the test windowMs (15 seconds)
      const gammaWindowMs = TEST_MODE ? FIFTEEN_MIN_MS : windowMs

      // After a 15m boundary, Gamma may briefly still return the previous market.
      // If so, retry quickly rather than skipping a whole 15m window.
      // In test mode, skip this check since Gamma markets are always 15 minutes
      if (!TEST_MODE) {
        const expectedWindowStartMs = floorToWindowStart(Date.now(), windowMs)
        if (windowStartMsFromSlug < expectedWindowStartMs) {
          currentSlug = undefined
          isWaitingForNextWindow = true
          throw new SkipWindowError(
            `[record-live] gamma still returning previous market slug=${resolved.slug}; waiting for current window market`,
            500,
          )
        }
      }

      // In test mode, skip the age check since we want to join any available market
      if (!TEST_MODE) {
        const ageMs = Date.now() - windowStartMsFromSlug
        if (!everConnected && ageMs > skipIfOlderMs) {
          currentSlug = undefined
          isWaitingForNextWindow = true
          const waitMs = msUntilNextBoundary(Date.now(), windowMs) + 250
          throw new SkipWindowError(
            `[record-live] market already started ageMs=${ageMs} > skipIfOlderMs=${skipIfOlderMs}; waiting for next window`,
            waitMs,
          )
        }
      }
    }

    console.log('[record-live] chosen market from Gamma:', {
      slug: resolved.slug,
      question: resolved.market.question,
    })
    console.log('[record-live] token ids:', resolved.tokenMap)

    // Reset per-market stats when the selected Gamma market changes.
    const nextStatsKey = currentSlug
    if (nextStatsKey && nextStatsKey !== statsMarketKey) {
      statsMarketKey = nextStatsKey
      totalAppends = 0
    }

    // Remember the current subscription targets for logging and markers.
    currentAssetsIds = resolved.assetsIds
    seenMarketIds.clear()

    return { assetsIds: resolved.assetsIds, label: resolved.label }
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

    const decision = handler.handle({ tsLocalMs, raw })

    // We rotate/write per market. If a message doesn't carry `market` (e.g. acks),
    // we ignore it to avoid polluting `market=unknown` files.
    if (!decision.ok) return
    const idx = decision.idx

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
    const msToBoundary = msUntilNextBoundary(Date.now(), windowMs)
    const isNearBoundary = msToBoundary <= 2_000
    const slugStartMs = currentSlug
      ? tryParseUpDown15mSlugEpochMs({ slug: currentSlug, symbol })
      : null
    const isNearWindowEnd =
      slugStartMs !== null ? Date.now() - slugStartMs >= windowMs - 2_000 : false

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


  /**
   * Insert market into database when parquet file is finalized.
   */
  async function insertMarketOnFileFinalized(args: { filePath: string; fileKey: string }): Promise<void> {
    console.log(`[record-live] 🔵 onFileFinalized callback STARTED for fileKey: ${args.fileKey}, filePath: ${args.filePath}`)

    const slug = args.fileKey
    if (!slug) {
      console.warn(`[record-live] ⚠️  Cannot insert market: fileKey is empty`)
      return
    }

    try {
      // Check if market already exists
      console.log(`[record-live] 🔍 Checking if market exists: ${slug}`)
      const exists = await marketExistsBySlug(slug)
      if (exists) {
        console.log(`[record-live] ⏭️  Market already exists in database, skipping insert: ${slug}`)
        // Still schedule update in case it wasn't scheduled before
        if (!scheduledResolutionUpdates.has(slug)) {
          console.log(`[record-live] 📅 Scheduling resolution update for existing market: ${slug}`)
          scheduleResolutionUpdate(slug, args.filePath)
        } else {
          console.log(`[record-live] ✅ Resolution update already scheduled for: ${slug}`)
        }
        return
      }

      // Fetch and map market data from Gamma API
      console.log(`[record-live] 🌐 Fetching market data from Gamma API for slug: ${slug}`)
      const marketData = await fetchGammaMarketBySlugAndMapApiResponseToMarketTable({
        slug,
        filePath: args.filePath,
        symbol,
      })

      if (!marketData) {
        console.warn(`[record-live] ⚠️  Failed to fetch or map market for slug: ${slug}`)
        return
      }

      // Insert into database
      console.log(`[record-live] 💾 Inserting market into database: ${slug}`)
      await insertMarket(marketData)
      console.log(`[record-live] ✅ Successfully inserted market into database: ${slug}`)

      // Schedule resolution update callback for 15 minutes later
      console.log(`[record-live] 📅 Scheduling resolution update for: ${slug}`)
      scheduleResolutionUpdate(slug, args.filePath)
      console.log(`[record-live] 🟢 onFileFinalized callback COMPLETED for: ${slug}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      // Don't throw - this shouldn't block rotation
      console.error(`[record-live] ❌ Failed to insert market "${slug}" into database: ${msg}`)
      if (stack) {
        console.error(`[record-live] Stack trace:`, stack)
      }
    }
  }

  /**
   * Update market in database with latest data from Gamma API.
   * Used to refresh resolved outcome after market closes.
   */
  async function updateMarketFromGamma(slug: string, filePath: string): Promise<void> {
    console.log(`[record-live] 🔄 Resolution update callback STARTED for: ${slug}`)
    try {
      // Fetch latest market data from Gamma API
      console.log(`[record-live] 🌐 Fetching latest market data from Gamma API for update: ${slug}`)
      const marketData = await fetchGammaMarketBySlugAndMapApiResponseToMarketTable({
        slug,
        filePath,
        symbol,
      })

      if (!marketData) {
        console.warn(`[record-live] ⚠️  Failed to fetch market data for update: ${slug}`)
        scheduledResolutionUpdates.delete(slug)
        return
      }

      // Update only fields that might have changed after resolution
      console.log(`[record-live] 💾 Updating market in database: ${slug}`)
      await updateMarketBySlug(slug, {
        resolvedOutcome: marketData.resolvedOutcome,
        outcomePrices: marketData.outcomePrices,
        umaResolutionStatus: marketData.umaResolutionStatus,
        active: marketData.active,
        closed: marketData.closed,
        volume: marketData.volume,
        rawJson: marketData.rawJson,
      })

      scheduledResolutionUpdates.delete(slug)
      const resolved = marketData.resolvedOutcome ?? 'pending'
      console.log(`[record-live] ✅ Resolution update COMPLETED: ${slug} (resolved: ${resolved})`)
    } catch (err) {
      scheduledResolutionUpdates.delete(slug)
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      console.error(`[record-live] ❌ Resolution update FAILED for "${slug}": ${msg}`)
      if (stack) {
        console.error(`[record-live] Stack trace:`, stack)
      }
    }
  }

  /**
   * Schedule a delayed callback to update market resolution status.
   * Called 15 minutes after file finalization to check if market is resolved.
   */
  function scheduleResolutionUpdate(slug: string, filePath: string): void {
    // Check if already scheduled
    if (scheduledResolutionUpdates.has(slug)) {
      console.log(`[record-live] ⚠️  Resolution update already scheduled for ${slug}, skipping duplicate`)
      return
    }

    const delayMs = 15 * 60 * 1000 // 15 minutes
    const scheduledTimeMs = Date.now() + delayMs
    scheduledResolutionUpdates.set(slug, scheduledTimeMs)

    const timeoutId = setTimeout(() => {
      console.log(`[record-live] ⏰ Resolution update timeout triggered for: ${slug}`)
      void updateMarketFromGamma(slug, filePath).catch((err) => {
        scheduledResolutionUpdates.delete(slug)
        console.error(`[record-live] Scheduled resolution update failed for ${slug}:`, err)
      })
    }, delayMs)

    // Store timeout ID for potential cleanup (if needed in future)
    const delayMin = Math.floor(delayMs / 60_000)
    const delaySec = Math.floor((delayMs % 60_000) / 1000)
    console.log(`[record-live] 📅 Scheduled resolution update for ${slug} in ${delayMin}m${delaySec}s (timeoutId: ${timeoutId})`)
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

      // Stop inbound first, then flush queue, then close writers (writes footer + renames tmp).
      source.stop()

      const drained = await waitForInFlightAppends(10_000)
      if (!drained) {
        console.warn(
          `[record-live] in-flight appends did not drain before rotation (inFlightAppends=${inFlightAppends}); proceeding to close`,
        )
      }

      await recorder.closeAll({
        onFileFinalized: insertMarketOnFileFinalized,
      })
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
    windowMs,
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
        onFileFinalized: insertMarketOnFileFinalized,
      })
      process.exit(0)
    })().catch((err) => {
      console.error('[record-live] shutdown failed', err)
      process.exit(1)
    })
  }

  installSignalHandlers({ onSignal: shutdown })

  source.start()
  boundaryScheduler.start()
}

main().catch((err) => {
  console.error('[record-live] fatal error', err)
  process.exit(1)
})
