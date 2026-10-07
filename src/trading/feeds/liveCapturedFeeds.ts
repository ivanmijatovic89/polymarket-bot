import { randomUUID } from 'node:crypto'
import { CaptureCoordinator } from '../../recorder-v4/coordinator.js'
import { discoverBtcMarkets } from '../../recorder-v4/markets.js'
import { createBinanceFeed } from '../../recorder-v4/feeds/binance.js'
import { createPolyBoltFeed, type PolyBoltCredentials } from '../../recorder-v4/feeds/polybolt.js'
import { createPolymarketFeed } from '../../recorder-v4/feeds/polymarket.js'
import { createPriceToBeatFeed } from '../../recorder-v4/feeds/priceToBeat.js'
import { ingressStamp } from '../../recorder-v4/feeds/transport.js'
import { CapturedMarketDispatcher } from '../../recorder-v4/replay/dispatcher.js'
import { validateCapturedFeedRequest } from '../../recorder-v4/replay/feedState.js'
import type {
  CapturedEvent,
  FeedCallbacks,
  FeedStatus,
  IngressStamp,
  RawFrame,
  RecordedMarket,
  RecorderTimeframe,
} from '../../recorder-v4/types.js'
import type { MarketTick } from '../../strategy/Strategy.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsSnapshot } from './externalFeeds.js'

export function resolveLiveFeedMode(
  raw: string | undefined,
  config: ExternalFeedsRequestConfig,
): 'legacy' | 'recorder-v4' {
  const value = raw?.trim().toLowerCase()
  if (value && value !== 'legacy' && value !== 'recorder-v4')
    throw new Error('TRADING_FEED_MODE must be legacy or recorder-v4')
  const needsV4 = !!(
    config.binanceBookTicker ||
    config.chainlinkTwap ||
    config.polymarketPriceToBeat?.source === 'chainlink-opening-twap'
  )
  if (value === 'legacy' && needsV4)
    throw new Error('The requested bookTicker/TWAP/opening reference requires recorder-v4 feeds')
  return value === 'recorder-v4' || needsV4 ? 'recorder-v4' : 'legacy'
}

export function resolveLiveTimeframe(
  raw: string | undefined,
  mode: 'legacy' | 'recorder-v4',
  symbol: string,
): RecorderTimeframe {
  const timeframe = raw?.trim().toLowerCase() || '15m'
  if (timeframe !== '5m' && timeframe !== '15m')
    throw new Error('TRADING_TIMEFRAME must be 5m or 15m')
  if (mode === 'legacy' && timeframe !== '15m')
    throw new Error('TRADING_TIMEFRAME=5m requires TRADING_FEED_MODE=recorder-v4')
  if (mode === 'recorder-v4' && symbol !== 'btc')
    throw new Error('The V4 live feed runtime currently supports BTC only')
  return timeframe
}

type StreamOptions = {
  config: ExternalFeedsRequestConfig
  onMarket: (market: RecordedMarket) => void | Promise<void>
  onTick: (tick: MarketTick) => void | Promise<void>
  onFatal: (error: Error) => void
  onStatus?: (status: FeedStatus) => void
  onInvalidMarketFrame?: (connectionId: string) => void
  /** Test/audit tap for the exact envelopes handed to the shared dispatcher. */
  onObservation?: (market: RecordedMarket, event: CapturedEvent) => void
  clock?: () => IngressStamp
  maxPendingBytes?: number
}

/**
 * In-memory counterpart of the recorder: the same synchronous coordinator and
 * receive-order dispatcher, with no file, R2, wallet or execution dependencies.
 * Waiting strategy/order I/O cannot mutate already-bound feed snapshots.
 */
export class LiveCapturedMarketStream implements FeedCallbacks {
  private readonly coordinator: CaptureCoordinator
  private readonly dispatchers = new Map<string, CapturedMarketDispatcher>()
  private readonly markets = new Map<string, RecordedMarket>()
  private readonly tickSnapshots = new WeakMap<MarketTick, ExternalFeedsSnapshot>()
  private readonly captureId = randomUUID()
  private readonly sessionId = randomUUID()
  private sequence = 0n
  private tail: Promise<void> = Promise.resolve()
  private pendingBytes = 0
  private failed = false
  private closed = false
  private currentSlug: string | undefined
  private readonly clock: () => IngressStamp
  private readonly maxPendingBytes: number

  constructor(private readonly options: StreamOptions) {
    this.clock = options.clock ?? ingressStamp
    this.maxPendingBytes = options.maxPendingBytes ?? 16 * 1024 ** 2
    if (!Number.isSafeInteger(this.maxPendingBytes) || this.maxPendingBytes < 1)
      throw new Error('Live feed maxPendingBytes must be a positive integer')
    this.coordinator = new CaptureCoordinator({
      capture: (frame, eventType = 'message') => {
        const sequence = String(++this.sequence)
        return {
          schemaVersion: 4,
          captureId: this.captureId,
          sessionId: this.sessionId,
          sequence,
          eventId: `${this.captureId}:${sequence}`,
          receivedAtMs: frame.stamp.receivedAtMs,
          monotonicNs: frame.stamp.monotonicNs,
          source: frame.source,
          connectionId: frame.connectionId,
          eventType,
          sourceTimeMs: null,
          rawJson: frame.rawJson,
          detailsJson: frame.request ? JSON.stringify(frame.request) : null,
        }
      },
      now: () => this.clock().receivedAtMs,
      monotonic: () => this.clock().monotonicNs,
      finalizationGraceMs: 0,
      onInvalidMarketFrame: (id) => options.onInvalidMarketFrame?.(id),
      sink: {
        onStart: (market) => {
          this.markets.set(market.slug, market)
          this.dispatcher(market)
        },
        append: (slug, event) => {
          const market = this.markets.get(slug)
          if (!market) throw new Error(`Missing live market metadata: ${slug}`)
          options.onObservation?.(market, event)
          // Future-market metadata is audited but cannot create a strategy dispatcher
          // before the coordinator freezes the bootstrap market configuration.
          const dispatcher = this.dispatchers.get(slug)
          if (!dispatcher) return
          this.enqueue(Buffer.byteLength(event.rawJson) + 512, () => dispatcher.accept(event))
        },
        finalize: (slug) => {
          this.enqueue(0, () => {
            this.dispatchers.delete(slug)
            this.markets.delete(slug)
          })
        },
      },
    })
  }

  private dispatcher(market: RecordedMarket): CapturedMarketDispatcher {
    const existing = this.dispatchers.get(market.slug)
    if (existing) return existing
    const dispatcher = new CapturedMarketDispatcher({
      market,
      filePath: '',
      sourceKind: 'live',
      config: this.options.config,
      onTick: async (tick) => {
        if (this.failed) return
        this.tickSnapshots.set(tick, dispatcher.snapshotForTick(tick))
        // Change market context only after the preceding tick finished. An
        // asynchronous order response cannot rotate context beneath that tick.
        if (this.currentSlug !== market.slug) {
          await this.options.onMarket(market)
          this.currentSlug = market.slug
        }
        await this.options.onTick(tick)
      },
    })
    this.dispatchers.set(market.slug, dispatcher)
    return dispatcher
  }

  private fail(error: unknown): void {
    if (this.failed) return
    this.failed = true
    this.options.onFatal(error instanceof Error ? error : new Error(String(error)))
  }

  private enqueue(bytes: number, run: () => void | Promise<void>): void {
    if (this.failed) return
    if (this.pendingBytes + bytes > this.maxPendingBytes) {
      this.fail(
        new Error('Live V4 feed queue exceeded its byte limit; stopped without dropping silently'),
      )
      return
    }
    this.pendingBytes += bytes
    this.tail = this.tail
      .then(async () => {
        if (!this.failed) await run()
      })
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.pendingBytes -= bytes
      })
  }

  private receive(run: () => void): void {
    if (this.closed || this.failed) return
    try {
      run()
    } catch (error) {
      this.fail(error)
    }
  }

  register(market: RecordedMarket): void {
    if (this.closed || this.failed) return
    validateCapturedFeedRequest(this.options.config, market)
    if (!this.markets.has(market.slug)) this.markets.set(market.slug, market)
    this.coordinator.register(market)
  }

  onFrame = (frame: RawFrame): void => {
    this.receive(() => {
      this.coordinator.ingest(frame)
      this.coordinator.prune()
    })
  }

  onStatus = (status: FeedStatus): void => {
    this.receive(() => {
      this.coordinator.status(status)
      this.options.onStatus?.(status)
    })
  }

  advance(): void {
    this.receive(() => {
      this.coordinator.advance()
      this.coordinator.prune()
    })
  }

  snapshotForTick = (tick?: MarketTick): ExternalFeedsSnapshot =>
    tick ? (this.tickSnapshots.get(tick) ?? {}) : {}

  async flush(): Promise<void> {
    await this.tail
  }

  async stop(): Promise<void> {
    this.closed = true
    await this.flush()
  }
}

export type LiveCapturedFeedsOptions = StreamOptions & {
  timeframe: RecorderTimeframe
  credentials?: PolyBoltCredentials
  marketWsUrl?: string
  discoveryMs?: number
}

export type LiveCapturedFeedDependencies = {
  discover: typeof discoverBtcMarkets
  polymarket: typeof createPolymarketFeed
  binance: typeof createBinanceFeed
  chainlink: typeof createPolyBoltFeed
  priceToBeat: typeof createPriceToBeatFeed
}

/** Shared recorder transports; independently stoppable and read-only upstream. */
export function createLiveCapturedFeeds(
  options: LiveCapturedFeedsOptions,
  dependencies: Partial<LiveCapturedFeedDependencies> = {},
) {
  const deps: LiveCapturedFeedDependencies = {
    discover: discoverBtcMarkets,
    polymarket: createPolymarketFeed,
    binance: createBinanceFeed,
    chainlink: createPolyBoltFeed,
    priceToBeat: createPriceToBeatFeed,
    ...dependencies,
  }
  const needsChainlink = !!(
    options.config.rtdsCryptoPrices ||
    options.config.chainlinkTwap ||
    options.config.polymarketPriceToBeat?.source === 'chainlink-opening-twap'
  )
  if (needsChainlink && !options.credentials)
    throw new Error('V4 Chainlink live feeds require CLOB API credentials for PolyBolt')
  const clock = options.clock ?? ingressStamp
  let running = false
  let stopped = false
  let discoveryTimer: NodeJS.Timeout | undefined
  let advanceTimer: NodeJS.Timeout | undefined
  let discoveryAbort: AbortController | undefined
  const active = new Map<string, RecordedMarket>()
  const prices = new Map<string, ReturnType<typeof createPriceToBeatFeed>>()
  const stream = new LiveCapturedMarketStream({
    ...options,
    onInvalidMarketFrame: (id) => polymarket.reconnect('invalid_market_payload', id),
    onFatal: (error) => {
      void stop()
      options.onFatal(error)
    },
  })
  const callbacks = { onFrame: stream.onFrame, onStatus: stream.onStatus, clock }
  const polymarket = deps.polymarket({
    ...callbacks,
    ...(options.marketWsUrl ? { url: options.marketWsUrl } : {}),
  })
  const binance =
    options.config.binanceWsSpotPrice || options.config.binanceBookTicker
      ? deps.binance(callbacks)
      : null
  const chainlink = needsChainlink
    ? deps.chainlink({ ...callbacks, credentials: options.credentials! })
    : null

  const discover = async () => {
    discoveryAbort = new AbortController()
    try {
      const markets = await deps.discover({
        nowMs: clock().receivedAtMs,
        timeframes: [options.timeframe],
        signal: discoveryAbort.signal,
        onError: (slug) => {
          if (running)
            options.onStatus?.({
              source: 'market_metadata',
              connectionId: 'gamma',
              kind: 'error',
              stamp: clock(),
              marketSlug: slug,
              reason: 'market_discovery_failed',
            })
        },
      })
      if (!running) return
      for (const market of markets) {
        if (!running) return
        // A bounded Gamma request may finish across a market boundary.
        if (market.endMs <= clock().receivedAtMs) continue
        stream.register(market)
        active.set(market.slug, market)
        stream.onFrame({
          source: 'market_metadata',
          connectionId: 'gamma',
          rawJson: market.rawJson,
          stamp: clock(),
          marketSlug: market.slug,
        })
        if (!running) return
        if (options.config.polymarketPriceToBeat?.enabled && !prices.has(market.slug)) {
          const price = deps.priceToBeat({ ...callbacks, market })
          prices.set(market.slug, price)
          price.start()
        }
      }
      for (const [slug, market] of active) {
        if (market.endMs > clock().receivedAtMs) continue
        active.delete(slug)
        prices.get(slug)?.stop()
        prices.delete(slug)
      }
      polymarket.setMarkets([...active.values()])
      stream.advance()
    } catch (error) {
      if (running) {
        void stop()
        options.onFatal(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      discoveryAbort = undefined
      if (running) discoveryTimer = setTimeout(() => void discover(), options.discoveryMs ?? 15_000)
    }
  }
  const stop = async () => {
    if (stopped) {
      await stream.flush()
      return
    }
    stopped = true
    running = false
    if (discoveryTimer) clearTimeout(discoveryTimer)
    if (advanceTimer) clearInterval(advanceTimer)
    discoveryAbort?.abort()
    polymarket.stop()
    binance?.stop()
    chainlink?.stop()
    for (const feed of prices.values()) feed.stop()
    prices.clear()
    await stream.stop()
  }
  return {
    snapshotForTick: stream.snapshotForTick,
    start() {
      if (stopped) throw new Error('Stopped V4 feed runtime cannot restart; create a new instance')
      if (running) return
      running = true
      polymarket.start()
      binance?.start()
      chainlink?.start()
      advanceTimer = setInterval(() => stream.advance(), 250)
      void discover()
    },
    stop,
  }
}
