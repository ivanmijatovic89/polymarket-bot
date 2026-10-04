import { hostname } from 'node:os'
import path from 'node:path'
import { readdir, stat, statfs } from 'node:fs/promises'
import { CaptureCoordinator, RECORDER_FEEDS, sourceFeeds } from './coordinator.js'
import type { RecorderConfig } from './config.js'
import { discoverBtcMarkets } from './markets.js'
import { createStatusPublisher } from './monitoring.js'
import { ResolutionTracker } from './resolution.js'
import { openCaptureSequence } from './sequence.js'
import { createBinanceFeed } from './feeds/binance.js'
import { createPolyBoltFeed } from './feeds/polybolt.js'
import { createPolymarketFeed } from './feeds/polymarket.js'
import { createPriceToBeatFeed } from './feeds/priceToBeat.js'
import { ingressStamp } from './feeds/transport.js'
import { ArchiveService, readArchiveReceipt } from './storage/archive.js'
import { R2BlobStore, type BlobStore, type R2BlobStoreOptions } from './storage/blobStore.js'
import { DurableMarketStore, type ReadyMarket } from './storage/marketStore.js'
import { applyCapturedFeed } from './replay/feedState.js'
import { ensureDirectory } from './storage/files.js'
import type { RecorderStatus } from './statusTypes.js'
import type {
  CapturedEvent,
  FeedCallbacks,
  IngressStamp,
  RawFrame,
  RecordedMarket,
  RecorderFeed,
} from './types.js'

export type DiskUsage = { bytes: number; freeBytes: number; pendingMarkets?: number }

export async function scanRecorderDisk(directory: string): Promise<DiskUsage> {
  let bytes = 0
  let pendingMarkets = 0
  const visit = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (
      entries.some((entry) => entry.name === 'manifest.json') &&
      !entries.some((entry) => entry.name === 'archived.json')
    )
      pendingMarkets++
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) {
        try {
          bytes += (await stat(file)).size
        } catch (error) {
          // A verified upload can remove a file while the directory is being scanned.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
  }
  await visit(directory)
  const filesystem = await statfs(directory)
  return { bytes, freeBytes: filesystem.bavail * filesystem.bsize, pendingMarkets }
}

export function recorderError(error: unknown, config: RecorderConfig): string {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of [
    config.credentials.apiKey,
    config.credentials.secret,
    config.credentials.passphrase,
    config.r2?.accessKeyId,
    config.r2?.secretAccessKey,
    config.redisUrl,
  ]) {
    if (secret) text = text.split(secret).join('[redacted]')
  }
  return text.slice(0, 1000)
}

/** Detect sleep/backlog and wall-clock changes before routing another event by its window. */
export class CaptureClockMonitor {
  private prior: IngressStamp
  lagMs = 0
  constructor(initial: IngressStamp) {
    this.prior = initial
  }
  observe(
    stamp: IngressStamp,
  ): { startMs: number; endMs: number; reason: string; fatal: boolean } | null {
    const prior = this.prior
    this.prior = stamp
    const monotonicDelta = Number(BigInt(stamp.monotonicNs) - BigInt(prior.monotonicNs)) / 1_000_000
    const wallDelta = stamp.receivedAtMs - prior.receivedAtMs
    this.lagMs = Math.max(0, monotonicDelta - 100)
    if (monotonicDelta < 0 || Math.abs(wallDelta - monotonicDelta) > 250) {
      return {
        startMs: Math.min(prior.receivedAtMs, stamp.receivedAtMs),
        endMs: Math.max(prior.receivedAtMs, stamp.receivedAtMs),
        reason: 'capture_clock_changed',
        fatal: true,
      }
    }
    return monotonicDelta > 2_000
      ? {
          startMs: prior.receivedAtMs,
          endMs: stamp.receivedAtMs,
          reason: 'capture_event_loop_gap',
          fatal: false,
        }
      : null
  }
}

type DaemonDependencies = {
  discover: typeof discoverBtcMarkets
  binance: typeof createBinanceFeed
  polybolt: typeof createPolyBoltFeed
  polymarket: typeof createPolymarketFeed
  priceToBeat: typeof createPriceToBeatFeed
  disk: typeof scanRecorderDisk
  stamp: typeof ingressStamp
  blobStore: (options: R2BlobStoreOptions) => BlobStore & { close(): void }
}

export type RecorderRunOptions = {
  signal?: AbortSignal
  log?: (message: string) => void
  dependencies?: Partial<DaemonDependencies>
  discoveryIntervalMs?: number
  maintenanceIntervalMs?: number
  statusIntervalMs?: number
}

/** Runs until a requested stop or a capture-integrity failure; never initializes trading. */
export async function runRecorder(
  config: RecorderConfig,
  options: RecorderRunOptions = {},
): Promise<RecorderStatus> {
  const deps: DaemonDependencies = {
    discover: discoverBtcMarkets,
    binance: createBinanceFeed,
    polybolt: createPolyBoltFeed,
    polymarket: createPolymarketFeed,
    priceToBeat: createPriceToBeatFeed,
    disk: scanRecorderDisk,
    stamp: ingressStamp,
    blobStore: (options) => new R2BlobStore(options),
    ...options.dependencies,
  }
  const log = options.log ?? console.log
  await ensureDirectory(config.spoolDir)
  const initialDisk = await deps.disk(config.spoolDir)
  const sequence = await openCaptureSequence(config.spoolDir)
  const store = new DurableMarketStore({
    spoolDir: config.spoolDir,
    prefix: config.archivePrefix,
    maxPendingBytes: config.maxPendingBytes,
  })
  const publisher = createStatusPublisher(
    config.spoolDir,
    config.statusEnabled ? config.redisUrl : null,
  )
  const blobStore = config.r2 ? deps.blobStore(config.r2) : null
  const archive = blobStore
    ? new ArchiveService({ spoolDir: config.spoolDir, blobStore })
    : undefined
  const resolution = new ResolutionTracker({
    spoolDir: config.spoolDir,
    ...(archive ? { archive } : {}),
    onObservation: (observation) => {
      const record = recent.get(observation.slug)
      if (record)
        record.resolution =
          observation.status === 'resolved'
            ? `resolved ${observation.winningOutcome ?? ''}`
            : observation.status
    },
  })
  const startedAtMs = deps.stamp().receivedAtMs
  const clock = new CaptureClockMonitor(deps.stamp())
  const registered = new Map<string, RecordedMarket>()
  const pendingMetadata = new Map<string, CapturedEvent[]>()
  const priceFeeds = new Map<string, ReturnType<typeof createPriceToBeatFeed>>()
  const recent = new Map<
    string,
    { ready: ReadyMarket; manifestKey: string | null; resolution: string }
  >()
  const writes = new Set<Promise<void>>()
  const initialMetadataWrites = new Map<string, Promise<void>>()
  const finalizers = new Set<Promise<void>>()
  const phases = new Map<RecorderFeed, string>()
  const messages = new Map<RecorderFeed, number>()
  const reconnects = new Map<RecorderFeed, number>()
  const connected = new Set<RecorderFeed>()
  let pendingBytes = 0
  let disk = initialDisk
  let diskVerified = true
  let state: RecorderStatus['state'] = 'starting'
  let reason: string | null = null
  let stopped = false
  let fatal = false
  let accepting = true
  let maintenance: Promise<void> | null = null
  let discovery: Promise<void> | null = null
  let publishing: Promise<void> | null = null
  let uploadedMarkets = 0
  let lastSuccessAtMs: number | null = null
  let archiveError: string | null = null
  let discoveryError: string | null = null
  let lastDiscoveryAtMs: number | null = null
  let cpu = process.cpuUsage()
  let cpuAt = process.hrtime.bigint()
  let cpuPercent = 0
  let eventLoopLagMs = 0
  let timerMonotonic = process.hrtime.bigint()
  let resolveStop!: () => void
  const stop = new Promise<void>((resolve) => {
    resolveStop = resolve
  })
  const requestStop = (message: string, failed = false) => {
    if (failed && !fatal) {
      fatal = true
      reason = recorderError(message, config)
      state = 'error'
    }
    if (stopped) return
    stopped = true
    reason ??= recorderError(message, config)
    state = failed ? 'error' : 'stopping'
    startupAbort.abort()
    blobStore?.close()
    resolveStop()
  }
  const fail = (error: unknown) => requestStop(recorderError(error, config), true)
  const remember = (ready: ReadyMarket) => {
    recent.set(ready.manifest.market.slug, { ready, manifestKey: null, resolution: 'pending' })
    while (recent.size > 30) recent.delete(recent.keys().next().value!)
  }
  const append = (slug: string, event: CapturedEvent) => {
    const bytes = Buffer.byteLength(event.rawJson) + 512
    if (pendingBytes + bytes > config.maxPendingBytes && !stopped)
      throw new Error('Recorder append backlog exceeded its memory allowance')
    pendingBytes += bytes
    let promise: Promise<void>
    const metadataWrite = initialMetadataWrites.get(slug)
    promise = (
      metadataWrite
        ? metadataWrite.then(() => store.append(slug, event))
        : store.append(slug, event)
    )
      .catch(fail)
      .finally(() => {
        writes.delete(promise)
        pendingBytes -= bytes
      })
    writes.add(promise)
  }
  const coordinator = new CaptureCoordinator({
    capture: sequence.capture,
    now: () => deps.stamp().receivedAtMs,
    monotonic: () => deps.stamp().monotonicNs,
    onInvalidMarketFrame: () => polymarket.reconnect('invalid_market_payload'),
    sink: {
      onStart: (market) => {
        registered.set(market.slug, market)
        const write = store.freezeInitialMarket(market)
        initialMetadataWrites.set(market.slug, write)
        let tracked: Promise<void>
        tracked = write.catch(fail).finally(() => {
          initialMetadataWrites.delete(market.slug)
          writes.delete(tracked)
        })
        writes.add(tracked)
      },
      append,
      finalize: (slug, coverage) => {
        let promise: Promise<void>
        const operation = (initialMetadataWrites.get(slug) ?? Promise.resolve()).then(() =>
          !diskVerified || disk.freeBytes <= config.minFreeBytes
            ? store.seal(slug, coverage)
            : store.finalize(slug, coverage).then(remember),
        )
        promise = operation.catch(fail).finally(() => finalizers.delete(promise))
        finalizers.add(promise)
      },
    },
  })
  const checkClock = (stamp: IngressStamp): boolean => {
    const issue = clock.observe(stamp)
    if (issue) {
      for (const source of ['polymarket', 'binance', 'chainlink', 'price_to_beat'] as const)
        coordinator.status({
          source,
          connectionId: 'recorder-clock',
          kind: 'gap',
          stamp,
          reason: issue.reason,
          details: { startMs: issue.startMs, endMs: issue.endMs, certainty: 'uncertain' },
        })
      if (issue.fatal) requestStop(issue.reason, true)
      else polymarket.reconnect(issue.reason)
    }
    return !stopped
  }
  const callbacks: FeedCallbacks = {
    onFrame: (frame) => {
      if (!accepting || stopped) return
      try {
        if (!checkClock(frame.stamp)) return
        const event = coordinator.ingest(frame)
        const market = frame.marketSlug
          ? registered.get(frame.marketSlug)
          : registered.values().next().value
        const feed =
          event.source === 'polymarket'
            ? 'polymarket'
            : market
              ? applyCapturedFeed({}, event, market)?.feed
              : undefined
        if (feed) {
          messages.set(feed, (messages.get(feed) ?? 0) + 1)
          phases.set(feed, 'receiving')
        }
      } catch (error) {
        fail(error)
      }
    },
    onStatus: (status) => {
      if (!accepting || stopped) return
      try {
        if (!checkClock(status.stamp)) return
        coordinator.status(status)
        const hinted = status.details?.feed
        for (const feed of sourceFeeds(status.source).filter(
          (feed) => !hinted || feed === hinted,
        )) {
          if (status.kind === 'connecting' && connected.has(feed))
            reconnects.set(feed, (reconnects.get(feed) ?? 0) + 1)
          if (status.kind === 'connected') connected.add(feed)
          phases.set(feed, status.kind)
        }
        if (status.details?.permanent === true)
          requestStop(status.reason ?? 'Permanent feed failure', true)
      } catch (error) {
        fail(error)
      }
    },
  }
  const binance = deps.binance(callbacks)
  const chainlink = deps.polybolt({ ...callbacks, credentials: config.credentials })
  const polymarket = deps.polymarket(callbacks)
  const startupAbort = new AbortController()
  const timers: NodeJS.Timeout[] = []
  const onAbort = () => requestStop('shutdown_requested')
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()

  const refresh = async () => {
    let refreshError: string | null = null
    const discovered = await deps.discover({
      nowMs: deps.stamp().receivedAtMs,
      timeframes: config.timeframes,
      signal: startupAbort.signal,
      onResponse: (response) => {
        if (stopped) return
        const stamp = deps.stamp()
        const frame: RawFrame = {
          source: 'market_metadata',
          connectionId: 'gamma-discovery',
          rawJson: response.rawJson,
          stamp,
          marketSlug: response.slug,
          request: {
            url: response.url,
            httpStatus: response.status,
            startedAtMs: stamp.receivedAtMs,
          },
        }
        if (registered.has(response.slug)) callbacks.onFrame(frame)
        else {
          if (!checkClock(stamp)) return
          pendingMetadata.set(response.slug, [sequence.capture(frame)])
        }
      },
      onError: (slug, error) => {
        if (stopped) return
        const message = recorderError(error, config)
        refreshError = message
        log(`[recorder] discovery ${slug}: ${message}`)
        if (
          /Unsupported TWAP|Unsupported reference-price provider|Missing explicit reference|Reference-price configuration/.test(
            message,
          )
        )
          fail(message)
      },
    })
    for (const market of discovered) {
      if (stopped) break
      if (!registered.has(market.slug)) {
        await store.openMarket(market)
        for (const event of pendingMetadata.get(market.slug) ?? []) append(market.slug, event)
        pendingMetadata.delete(market.slug)
        coordinator.register(market)
        registered.set(market.slug, market)
        const priceFeed = deps.priceToBeat({ ...callbacks, market })
        priceFeeds.set(market.slug, priceFeed)
        priceFeed.start()
      }
    }
    pendingMetadata.clear()
    polymarket.setMarkets([...registered.values()])
    discoveryError = refreshError
    lastDiscoveryAtMs = deps.stamp().receivedAtMs
  }
  const drainArchive = async () => {
    if (!archive || stopped) return { uploaded: 0, attemptedDirectories: [] as string[] }
    const result = await archive.runOnce({ signal: startupAbort.signal })
    uploadedMarkets += result.uploaded.length
    lastSuccessAtMs = result.uploaded.at(-1)?.verifiedAtMs ?? lastSuccessAtMs
    archiveError = result.failures.length
      ? recorderError(result.failures[0]!.message, config)
      : null
    return { uploaded: result.uploaded.length, attemptedDirectories: result.attemptedDirectories }
  }
  const maintain = async () => {
    if (stopped) return
    await resolution.runOnce({ signal: startupAbort.signal })
    await drainArchive()
    for (const record of recent.values()) {
      const receipt = await readArchiveReceipt(record.ready.directory)
      record.manifestKey = receipt?.manifestKey ?? record.manifestKey
    }
  }
  const report = (): RecorderStatus => {
    const now = deps.stamp().receivedAtMs
    const missing = config.timeframes.filter(
      (timeframe) =>
        ![...registered.values()].some(
          (market) => market.timeframe === timeframe && market.startMs <= now && now < market.endMs,
        ),
    )
    const discoveryReason = missing.length
      ? `Missing current ${missing.join(' + ')} market; last discovery ${lastDiscoveryAtMs === null ? 'not completed' : `${Math.max(0, now - lastDiscoveryAtMs)}ms ago`}${discoveryError ? `: ${discoveryError}` : ''}`
      : discoveryError
        ? `Market discovery: ${discoveryError}`
        : null
    return {
      schemaVersion: 3,
      recorderId: config.recorderId,
      captureId: sequence.captureId,
      sessionId: sequence.sessionId,
      host: hostname(),
      pid: process.pid,
      startedAtMs,
      updatedAtMs: now,
      state:
        state === 'recording' &&
        (archiveError ||
          discoveryReason ||
          RECORDER_FEEDS.some(
            (feed) =>
              coordinator.lastReceived[feed] === undefined ||
              ['gap', 'error', 'stale', 'disconnected', 'provider_mismatch'].includes(
                phases.get(feed) ?? '',
              ),
          ))
          ? 'degraded'
          : state,
      reason: reason ?? (state === 'recording' ? discoveryReason : null),
      feeds: RECORDER_FEEDS.map((feed) => ({
        feed,
        state: phases.get(feed) ?? 'waiting',
        lastReceivedAtMs: coordinator.lastReceived[feed] ?? null,
        messages: messages.get(feed) ?? 0,
        reconnects: reconnects.get(feed) ?? 0,
      })),
      markets: coordinator.snapshot(),
      spool: {
        ...disk,
        maxBytes: config.maxSpoolBytes,
        minFreeBytes: config.minFreeBytes,
        pendingWrites: writes.size,
      },
      archive: {
        enabled: !!archive,
        pendingMarkets:
          disk.pendingMarkets ??
          [...recent.values()].filter((record) => !record.manifestKey).length,
        uploadedMarkets,
        lastSuccessAtMs,
        lastError: archiveError,
      },
      resolution: {
        pending: resolution.pending,
        lastError: resolution.lastError ? recorderError(resolution.lastError, config) : null,
      },
      metrics: { rssBytes: process.memoryUsage().rss, eventLoopLagMs, cpuPercent },
      recentMarkets: [...recent.values()]
        .reverse()
        .map(({ ready, manifestKey, resolution: outcome }) => ({
          slug: ready.manifest.market.slug,
          timeframe: ready.manifest.market.timeframe,
          startMs: ready.manifest.market.startMs,
          endMs: ready.manifest.market.endMs,
          rows: ready.manifest.events.rows,
          gaps: ready.manifest.coverage.gaps.length,
          complete: ready.manifest.coverage.complete,
          manifestKey,
          resolution: outcome,
        })),
    }
  }
  const checkDisk = async () => {
    try {
      disk = await deps.disk(config.spoolDir)
      diskVerified = true
    } catch (error) {
      diskVerified = false
      fail(`Recorder cannot verify disk allowance: ${recorderError(error, config)}`)
      return false
    }
    if (disk.bytes + pendingBytes >= config.maxSpoolBytes || disk.freeBytes <= config.minFreeBytes)
      requestStop('Recorder disk allowance exhausted; unuploaded data was retained', true)
    return !stopped
  }
  const publish = async () => {
    await checkDisk()
    const currentCpu = process.cpuUsage()
    const currentNs = process.hrtime.bigint()
    cpuPercent =
      (((currentCpu.user - cpu.user + currentCpu.system - cpu.system) * 1000) /
        Number(currentNs - cpuAt)) *
      100
    cpu = currentCpu
    cpuAt = currentNs
    await publisher.publish(report())
  }
  try {
    startup: {
      timers.push(
        setInterval(() => {
          if (state !== 'starting' || stopped || publishing) return
          publishing = publisher
            .publish(report())
            .catch((error) => log(`[recorder] startup status: ${recorderError(error, config)}`))
            .finally(() => {
              publishing = null
            })
        }, options.statusIntervalMs ?? 5_000),
      )
      await publisher
        .publish(report())
        .catch((error) => log(`[recorder] initial status: ${recorderError(error, config)}`))
      // Already-finalized packages can free a full spool without opening a journal or
      // starting compression. A restart must be able to recover after an R2 outage.
      // Visit every pending package before declaring a full spool unrecoverable:
      // an early failed batch must not hide later packages that can free space.
      const attemptedDirectories = new Set<string>()
      let madeProgress: boolean
      do {
        const drained = await drainArchive().catch((error) => {
          archiveError = recorderError(error, config)
          return { uploaded: 0, attemptedDirectories: [] as string[] }
        })
        madeProgress =
          drained.uploaded > 0 ||
          drained.attemptedDirectories.some((directory) => !attemptedDirectories.has(directory))
        for (const directory of drained.attemptedDirectories) attemptedDirectories.add(directory)
        disk = await deps.disk(config.spoolDir)
      } while (
        !stopped &&
        madeProgress &&
        (disk.bytes >= config.maxSpoolBytes || disk.freeBytes <= config.minFreeBytes)
      )
      await checkDisk()
      if (stopped) break startup
      const recovered = await store.recover()
      recovered.ready.forEach(remember)
      await checkDisk()
      if (stopped) break startup
      for (const market of recovered.active) {
        coordinator.register(market)
        registered.set(market.slug, market)
        const priceFeed = deps.priceToBeat({ ...callbacks, market })
        priceFeeds.set(market.slug, priceFeed)
        if (!stopped) priceFeed.start()
      }
      if (!stopped) await refresh()
      if (!stopped) {
        binance.start()
        if (!stopped) chainlink.start()
        if (!stopped) polymarket.start()
        if (!stopped) state = 'recording'
        log(
          `[recorder] ${config.recorderId} capturing BTC ${config.timeframes.join(' + ')}; upload=${config.upload}`,
        )
        timers.push(
          setInterval(() => {
            try {
              const stamp = deps.stamp()
              const timerNow = process.hrtime.bigint()
              eventLoopLagMs = Math.max(0, Number(timerNow - timerMonotonic) / 1_000_000 - 100)
              timerMonotonic = timerNow
              if (!checkClock(stamp)) return
              coordinator.advance(stamp.receivedAtMs)
              coordinator.prune()
              let subscriptionsChanged = false
              for (const [slug, market] of registered) {
                if (stamp.receivedAtMs >= market.endMs) {
                  priceFeeds.get(slug)?.stop()
                  priceFeeds.delete(slug)
                }
                if (stamp.receivedAtMs >= market.endMs + 60_000) {
                  registered.delete(slug)
                  subscriptionsChanged = true
                }
              }
              if (subscriptionsChanged) polymarket.setMarkets([...registered.values()])
            } catch (error) {
              fail(error)
            }
          }, 100),
        )
        timers.push(
          setInterval(() => {
            if (discovery || stopped) return
            discovery = refresh()
              .catch(fail)
              .finally(() => {
                discovery = null
              })
          }, options.discoveryIntervalMs ?? 15_000),
        )
        timers.push(
          setInterval(() => {
            if (maintenance || stopped) return
            maintenance = maintain()
              .catch((error) => {
                archiveError = recorderError(error, config)
              })
              .finally(() => {
                maintenance = null
              })
          }, options.maintenanceIntervalMs ?? 5_000),
        )
        timers.push(
          setInterval(() => {
            if (publishing || stopped) return
            publishing = publish()
              .catch((error) => {
                log(`[recorder] monitoring: ${recorderError(error, config)}`)
              })
              .finally(() => {
                publishing = null
              })
          }, options.statusIntervalMs ?? 5_000),
        )
        if (config.durationMs !== null)
          timers.push(setTimeout(() => requestStop('duration_complete'), config.durationMs))
        await publish().catch((error) =>
          log(`[recorder] monitoring: ${recorderError(error, config)}`),
        )
        await stop
      }
    }
  } catch (error) {
    fail(error)
  } finally {
    timers.forEach(clearTimeout)
    startupAbort.abort()
    blobStore?.close()
    accepting = false
    binance.stop()
    chainlink.stop()
    polymarket.stop()
    for (const feed of priceFeeds.values()) feed.stop()
    await Promise.allSettled([discovery, maintenance, publishing])
    try {
      coordinator.shutdown(reason ?? 'shutdown_requested')
      await Promise.all([...writes, ...finalizers])
      await store.close()
    } catch (error) {
      fatal = true
      reason = recorderError(error, config)
    }
    state = fatal ? 'error' : 'stopped'
    try {
      await publish()
    } catch (error) {
      log(`[recorder] final status: ${recorderError(error, config)}`)
    }
    publisher.close()
    blobStore?.close()
    await sequence.close()
    options.signal?.removeEventListener('abort', onAbort)
  }
  const final = report()
  log(`[recorder] ${final.state}: ${final.reason ?? 'finished'}`)
  return final
}
