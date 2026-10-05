import { MarketEngine } from '../../market/MarketEngine.js'
import { inspectMarketFrame, marketFrameMessages } from '../marketFrame.js'
import { includesMarket } from '../marketScope.js'
import { buildSyntheticFeedTick } from '../../market/syntheticTick.js'
import type { MarketTick } from '../../strategy/Strategy.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { BootstrapPayload, CapturedEvent, MarketCoverage, RecordedMarket } from '../types.js'
import { OpeningReferenceTracker } from './openingReference.js'
import {
  applyCapturedFeed,
  object,
  parseCapturedJson,
  requestedCapturedFeeds,
  selectCapturedFeeds,
  validateCapturedFeedRequest,
} from './feedState.js'

export function capturedMarketGapReasons(
  market: RecordedMarket,
  coverage: MarketCoverage,
  config: ExternalFeedsRequestConfig,
): string[] {
  const required = requestedCapturedFeeds(config)
  const reasons = coverage.gaps
    .filter(
      (gap) =>
        required.has(gap.feed) &&
        gap.startMs < market.endMs &&
        ((gap.endMs ?? market.endMs) > market.startMs ||
          (gap.endMs === gap.startMs && gap.startMs >= market.startMs)),
    )
    .map((gap) => `${gap.feed}: ${gap.reason}`)
  if (coverage.missingInitialBook) reasons.push('polymarket: missing initial book')
  if (!coverage.complete && coverage.gaps.length === 0 && reasons.length === 0)
    reasons.push('recording coverage is incomplete')
  return [...new Set(reasons)]
}

/**
 * Same receive-order dispatcher for an observed capture and its offline replay.
 * It serializes envelopes, never source timestamps, and binds feed state to each
 * emitted tick. Bootstrap restores state without creating strategy history.
 */
export class CapturedMarketDispatcher {
  private readonly engine: MarketEngine
  private readonly openingReference: OpeningReferenceTracker
  private state: ExternalFeedsSnapshot = {}
  private sequence = -1n
  private captureId: string | undefined
  private bootstrapSession: string | undefined
  private tail: Promise<void> = Promise.resolve()
  private readonly tickFeeds = new WeakMap<MarketTick, ExternalFeedsSnapshot>()

  constructor(
    private readonly args: {
      market: RecordedMarket
      filePath: string
      config: ExternalFeedsRequestConfig
      onTick: (tick: MarketTick) => void | Promise<void>
    },
  ) {
    validateCapturedFeedRequest(args.config, args.market)
    this.openingReference = new OpeningReferenceTracker(args.market)
    this.engine = new MarketEngine({
      expectedAssetIds: args.market.tokenIds,
      onTick: (tick) => this.dispatchTick(tick),
    })
  }

  snapshotForTick = (tick?: MarketTick): ExternalFeedsSnapshot =>
    tick ? (this.tickFeeds.get(tick) ?? {}) : {}

  /** A defensive copy for diagnostics; strategies use the bound tick snapshot. */
  snapshot(): ExternalFeedsSnapshot {
    return structuredClone(this.state)
  }

  accept(event: CapturedEvent): Promise<void> {
    const next = this.tail.then(() => this.apply(event))
    // Stop the stream on an error; continuing would silently omit an observation.
    this.tail = next
    return next
  }

  private async dispatchTick(tick: MarketTick): Promise<void> {
    this.tickFeeds.set(
      tick,
      structuredClone(selectCapturedFeeds(this.state, this.args.config, this.args.market)),
    )
    await this.args.onTick(tick)
  }

  private async apply(event: CapturedEvent): Promise<void> {
    if (event.schemaVersion !== 3) throw new Error('Unsupported recorder event schema')
    if (!/^\d+$/.test(event.sequence)) throw new Error('Invalid recorder sequence')
    const sequence = BigInt(event.sequence)
    if (sequence <= this.sequence)
      throw new Error('Recorder events are not in strictly increasing receive order')
    if (this.captureId !== undefined && event.captureId !== this.captureId)
      throw new Error('Cannot combine independent capture clocks')
    this.captureId = event.captureId
    this.sequence = sequence
    const source = {
      kind: 'parquet' as const,
      filePath: this.args.filePath,
      ingestSeq: sequence,
      tsLocalMs: event.receivedAtMs,
    }
    const market = this.args.market

    if (event.source === 'bootstrap') {
      const bootstrap = parseCapturedJson(event) as BootstrapPayload | null
      const identity = [
        'slug',
        'symbol',
        'timeframe',
        'conditionId',
        'tokenIds',
        'outcomes',
        'startMs',
        'endMs',
        'twapEnabled',
        'twapLookbackSeconds',
        'resolutionSource',
      ] as const
      if (
        !bootstrap ||
        bootstrap.kind !== 'initial_state' ||
        !object(bootstrap.market) ||
        identity.some(
          (key) => JSON.stringify(bootstrap.market[key]) !== JSON.stringify(market[key]),
        ) ||
        !Array.isArray(bootstrap.feeds) ||
        !Array.isArray(bootstrap.books)
      )
        throw new Error('Invalid market bootstrap')
      if (this.bootstrapSession === event.sessionId)
        throw new Error('Duplicate bootstrap in one capture session')
      this.bootstrapSession = event.sessionId
      this.engine.reset()
      this.state = {}
      this.openingReference.accept(event)
      for (const feed of bootstrap.feeds) {
        if (feed.receivedAtMs > event.receivedAtMs || BigInt(feed.sequence) > sequence)
          throw new Error('Bootstrap contains future feed state')
        const update = applyCapturedFeed(this.state, feed, market)
        if (update) this.state = update.snapshot
      }
      const reference = this.openingReference.snapshot()
      if (reference) this.state = { ...this.state, openingReference: reference }
      for (const book of bootstrap.books) {
        if (book.observedAtMs > event.receivedAtMs || BigInt(book.sequence) > sequence)
          throw new Error('Bootstrap contains future order book state')
        await this.applyMarketFrame(book.rawJson, source, true)
      }
      return
    }

    // Half-open market windows: boundary events belong to the next market.
    if (event.receivedAtMs < market.startMs || event.receivedAtMs >= market.endMs) return
    if (event.source === 'chainlink' || event.source === 'price_to_beat') {
      this.openingReference.accept(event)
      const reference = this.openingReference.snapshot()
      if (reference) this.state = { ...this.state, openingReference: reference }
    }
    if (event.source === 'control') {
      const status = object(parseCapturedJson(event))
      if (
        status?.source === 'polymarket' &&
        includesMarket(status, market.slug) &&
        ['disconnected', 'gap', 'stale', 'provider_mismatch', 'error'].includes(String(status.kind))
      ) {
        this.engine.reset()
      }
      return
    }
    if (event.source === 'polymarket') {
      await this.applyMarketFrame(event.rawJson, source, false)
      return
    }
    const update = applyCapturedFeed(this.state, event, market)
    if (!update) return
    this.state = update.snapshot
    const synthetic = update.synthetic
    const enabled =
      synthetic?.eventType === 'binance_agg_trade'
        ? this.args.config.binanceWsSpotPrice?.tickOnUpdate
        : this.args.config.rtdsCryptoPrices?.tickOnUpdate
    const snapshot = this.engine.snapshot()
    if (
      !synthetic ||
      !enabled ||
      !Number.isFinite(snapshot.timestamp) ||
      snapshot.timestamp <= 0 ||
      Object.keys(snapshot.byAssetId).length === 0
    )
      return
    await this.dispatchTick(
      buildSyntheticFeedTick({
        ...synthetic,
        visibilityMs: event.receivedAtMs,
        baseSnapshot: snapshot,
        source,
      }),
    )
  }

  private async applyMarketFrame(
    rawJson: string,
    source: Parameters<MarketEngine['handleRaw']>[0]['source'],
    bootstrap: boolean,
  ): Promise<void> {
    // A shared websocket frame may contain messages for several active markets.
    const { messages, invalid } = marketFrameMessages(inspectMarketFrame(rawJson), this.args.market)
    if (invalid) {
      if (bootstrap) throw new Error('Invalid initial order book state')
      this.engine.reset()
      return
    }
    if (messages.length > 0)
      await this.engine.handleRaw({ rawJson: JSON.stringify(messages), source, bootstrap })
  }
}

export async function replayCapturedEvents(
  args: ConstructorParameters<typeof CapturedMarketDispatcher>[0] & {
    events: AsyncIterable<CapturedEvent> | Iterable<CapturedEvent>
    onDispatcher?: (dispatcher: CapturedMarketDispatcher) => void
    shouldStop?: () => boolean
  },
): Promise<void> {
  const dispatcher = new CapturedMarketDispatcher(args)
  args.onDispatcher?.(dispatcher)
  for await (const event of args.events) {
    if (args.shouldStop?.()) break
    await dispatcher.accept(event)
  }
}
