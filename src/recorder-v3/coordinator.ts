import { MarketOrderBookEngine } from '../market/orderbook/MarketOrderBookEngine.js'
import { inspectMarketFrame, marketFrameMessages } from './marketFrame.js'
import { applyCapturedFeed, object, parseCapturedJson } from './replay/feedState.js'
import { parseRecorderMarket } from './markets.js'
import { OpeningReferenceTracker } from './replay/openingReference.js'
import type { OpeningReferenceSnapshot } from '../trading/feeds/externalFeeds.js'
import type {
  BootstrapPayload,
  CapturedEvent,
  CoverageGap,
  FeedStatus,
  MarketCoverage,
  RawFrame,
  RecordedMarket,
  RecorderFeed,
  RecorderSource,
} from './types.js'

export const RECORDER_FEEDS: readonly RecorderFeed[] = [
  'polymarket',
  'binance_agg_trade',
  'binance_book_ticker',
  'chainlink_spot',
  'chainlink_twap',
  'price_to_beat',
]

export function sourceFeeds(source: RecorderSource): RecorderFeed[] {
  if (source === 'binance') return ['binance_agg_trade', 'binance_book_ticker']
  if (source === 'chainlink') return ['chainlink_spot', 'chainlink_twap']
  if (source === 'polymarket' || source === 'price_to_beat') return [source]
  return []
}

type MarketState = {
  market: RecordedMarket
  books: MarketOrderBookEngine
  lastBookObservation: Map<string, { receivedAtMs: number; sequence: string }>
  started: boolean
  finished: boolean
  startedAtMs: number
  missingInitialBook: boolean
  receivedFeeds: Set<RecorderFeed>
  gaps: CoverageGap[]
  openGaps: Map<RecorderFeed, CoverageGap>
  priceToBeat: CapturedEvent | null
  openingReference: OpeningReferenceTracker | null
  rows: number
}

export type CoordinatorSink = {
  /** Enqueue persistence of frozen initial metadata before the following bootstrap append. */
  onStart?: (market: RecordedMarket) => void
  /** Called synchronously in ingest order. The sink owns bounded async persistence. */
  append: (slug: string, event: CapturedEvent) => void
  finalize: (slug: string, coverage: MarketCoverage) => void
}

export type CaptureFunction = (frame: RawFrame, eventType?: string) => CapturedEvent

/** Same-process ordered fanout; file I/O and HTTP work never run in this reducer. */
export class CaptureCoordinator {
  private readonly markets = new Map<string, MarketState>()
  private readonly latest = new Map<RecorderFeed, CapturedEvent>()
  private readonly unavailable = new Map<RecorderFeed, { since: number; reason: string }>()
  readonly counts: Partial<Record<RecorderSource, number>> = {}
  readonly lastReceived: Partial<Record<RecorderFeed, number>> = {}

  constructor(
    private readonly options: {
      capture: CaptureFunction
      sink: CoordinatorSink
      now?: () => number
      monotonic?: () => string
      /** Retain closed windows for retrospective sequence/watchdog gap reports. */
      finalizationGraceMs?: number
      /** Request fresh snapshots after invalid data made the local books unusable. */
      onInvalidMarketFrame?: () => void
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
  private mono(): string {
    return this.options.monotonic?.() ?? process.hrtime.bigint().toString()
  }

  register(market: RecordedMarket): void {
    if (this.markets.has(market.slug)) return
    this.markets.set(market.slug, {
      market,
      books: new MarketOrderBookEngine({
        market: market.conditionId,
        expectedAssetIds: market.tokenIds,
      }),
      lastBookObservation: new Map(),
      started: false,
      finished: false,
      startedAtMs: this.now(),
      missingInitialBook: true,
      receivedFeeds: new Set(),
      gaps: [],
      openGaps: new Map(),
      priceToBeat: null,
      openingReference: null,
      rows: 0,
    })
  }

  private local(
    source: RecorderSource,
    raw: unknown,
    nowMs: number,
    eventType: string,
  ): CapturedEvent {
    return this.options.capture(
      {
        source,
        connectionId: 'local',
        rawJson: JSON.stringify(raw),
        stamp: { receivedAtMs: nowMs, monotonicNs: this.mono() },
      },
      eventType,
    )
  }

  private write(state: MarketState, event: CapturedEvent): void {
    this.options.sink.append(state.market.slug, event)
    state.rows += 1
  }

  private gap(
    state: MarketState,
    feed: RecorderFeed,
    at: number,
    reason: string,
    certainty: CoverageGap['certainty'] = 'uncertain',
  ): void {
    const startMs = Math.max(state.market.startMs, at)
    if (startMs >= state.market.endMs) return
    const existing = state.openGaps.get(feed)
    if (existing) {
      existing.startMs = Math.min(existing.startMs, startMs)
      if (certainty === 'confirmed') existing.certainty = certainty
      return
    }
    const gap: CoverageGap = { feed, startMs, endMs: null, reason, certainty }
    state.gaps.push(gap)
    state.openGaps.set(feed, gap)
  }

  private restored(state: MarketState, feed: RecorderFeed, at: number): void {
    if (at >= state.market.startMs && at < state.market.endMs) state.receivedFeeds.add(feed)
    const gap = state.openGaps.get(feed)
    if (gap) {
      gap.endMs = Math.min(state.market.endMs, Math.max(at, gap.startMs))
      state.openGaps.delete(feed)
    }
  }

  private start(state: MarketState, at: number): void {
    state.started = true
    state.startedAtMs = at
    state.missingInitialBook = !state.books.isWarm()
    const snapshot = state.books.snapshot()
    const books: BootstrapPayload['books'] = Object.values(snapshot.byAssetId).flatMap((book) => {
      const observed = state.lastBookObservation.get(book.assetId)
      if (!observed || !state.books.isWarm()) return []
      return [
        {
          rawJson: JSON.stringify({
            event_type: 'book',
            market: state.market.conditionId,
            asset_id: book.assetId,
            timestamp: String(book.timestamp),
            hash: '',
            bids: book.bids.map((level) => ({
              price: String(level.price),
              size: String(level.size),
            })),
            asks: book.asks.map((level) => ({
              price: String(level.price),
              size: String(level.size),
            })),
          }),
          observedAtMs: observed.receivedAtMs,
          sequence: observed.sequence,
        },
      ]
    })
    const feeds = [...this.latest.values(), ...(state.priceToBeat ? [state.priceToBeat] : [])]
      .filter((event) => event.receivedAtMs <= at)
      .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1))
    for (const event of feeds) {
      const update = applyCapturedFeed({}, event, state.market)
      if (update) state.receivedFeeds.add(update.feed)
    }
    if (books.length === 2) state.receivedFeeds.add('polymarket')
    const payload: BootstrapPayload = { kind: 'initial_state', market: state.market, feeds, books }
    this.options.sink.onStart?.(state.market)
    const bootstrap = this.local('bootstrap', payload, at, 'initial_state')
    state.openingReference = new OpeningReferenceTracker(state.market)
    state.openingReference.accept(bootstrap)
    this.write(state, bootstrap)
    // Polling a newly opened strike naturally takes time: record its availability,
    // not a fictitious outage before the first successful price-to-beat response.
    for (const feed of RECORDER_FEEDS) {
      if (feed === 'price_to_beat') continue
      const outage = this.unavailable.get(feed)
      if (outage || !state.receivedFeeds.has(feed))
        this.gap(state, feed, state.market.startMs, outage?.reason ?? 'initial_state_unavailable')
    }
    if (at > state.market.startMs + 1000) {
      for (const feed of RECORDER_FEEDS)
        state.gaps.push({
          feed,
          startMs: state.market.startMs,
          endMs: at,
          reason: 'recording_started_late',
          certainty: 'confirmed',
        })
    }
  }

  advance(at = this.now()): void {
    for (const state of this.markets.values()) {
      if (!state.started && at >= state.market.endMs) {
        // A process pause can skip an entire pre-registered window. Finalize
        // explicit missing coverage without inventing a bootstrap or ticks.
        state.started = true
        state.startedAtMs = state.market.endMs
        state.missingInitialBook = true
        for (const feed of RECORDER_FEEDS)
          state.gaps.push({
            feed,
            startMs: state.market.startMs,
            endMs: state.market.endMs,
            reason: 'market_window_missed',
            certainty: 'confirmed',
          })
        this.options.sink.onStart?.(state.market)
        this.write(
          state,
          this.local('control', { kind: 'market_window_missed' }, at, 'market_window_missed'),
        )
      }
      if (
        !state.finished &&
        state.started &&
        at >= state.market.endMs + (this.options.finalizationGraceMs ?? 60_000)
      )
        this.finish(state, state.market.endMs)
      if (!state.started && at >= state.market.startMs && at < state.market.endMs)
        this.start(state, at)
    }
  }

  ingest(frame: RawFrame): CapturedEvent {
    // Sequence is allocated before parsing and before any writes. Boundary
    // markers are sequenced first so the current frame follows its bootstrap.
    this.advance(frame.stamp.receivedAtMs)
    const event = this.options.capture(frame)
    this.counts[event.source] = (this.counts[event.source] ?? 0) + 1
    const anyMarket = this.markets.values().next().value as MarketState | undefined
    const sharedUpdate =
      anyMarket && event.source !== 'price_to_beat'
        ? applyCapturedFeed({}, event, anyMarket.market)
        : null
    if (sharedUpdate) {
      this.latest.set(sharedUpdate.feed, event)
      this.lastReceived[sharedUpdate.feed] = event.receivedAtMs
      this.unavailable.delete(sharedUpdate.feed)
    }
    const marketFrame = event.source === 'polymarket' ? inspectMarketFrame(event.rawJson) : null
    const parsed = event.source === 'polymarket' ? parseCapturedJson(event) : null
    const rawMessages = Array.isArray(parsed) ? parsed : [parsed]
    const addressedMarkets = marketFrame?.addressedMarkets ?? new Set<string>()
    const malformedMarkets: string[] = []
    for (const state of this.markets.values()) {
      if (state.finished) continue
      if (frame.marketSlug && frame.marketSlug !== state.market.slug) continue
      // A post-boundary frame can end an existing outage, but is never data for
      // that older market and must not repair its missing observations.
      if (state.started && event.receivedAtMs >= state.market.endMs) {
        if (sharedUpdate) this.restored(state, sharedUpdate.feed, event.receivedAtMs)
        const lifecycle =
          event.source === 'polymarket' &&
          rawMessages.some((value) => {
            const message = object(value)
            const payload = object(message?.payload)
            const kind = message?.event_type ?? message?.type
            const condition = message?.market ?? message?.condition_id ?? payload?.market
            return (
              condition === state.market.conditionId &&
              (kind === 'market_resolved' || kind === 'new_market')
            )
          })
        if (
          lifecycle ||
          ((event.source === 'market_metadata' || event.source === 'price_to_beat') &&
            frame.marketSlug === state.market.slug)
        ) {
          // Replay ignores all post-end rows. Preserve lifecycle evidence during
          // grace so a crash cannot erase a resolution already observed here.
          this.write(state, event)
        }
        continue
      }
      const inWindow = state.started && event.receivedAtMs >= state.market.startMs
      const targetedMetadata =
        event.source === 'market_metadata' && frame.marketSlug === state.market.slug
      const addressed =
        event.source !== 'polymarket' ||
        marketFrame?.unscopedInvalid === true ||
        addressedMarkets.size === 0 ||
        addressedMarkets.has(state.market.conditionId)
      // Preserve raw evidence even if a future server schema cannot be decoded.
      if ((inWindow && addressed) || (!state.started && targetedMetadata)) this.write(state, event)
      if (
        targetedMetadata &&
        (frame.request === undefined ||
          (frame.request.httpStatus >= 200 && frame.request.httpStatus < 300))
      ) {
        const updated = parseRecorderMarket(parseCapturedJson(event), state.market.slug)
        const previous = state.market
        if (
          updated.conditionId !== previous.conditionId ||
          updated.startMs !== previous.startMs ||
          updated.endMs !== previous.endMs ||
          JSON.stringify(updated.tokenIds) !== JSON.stringify(previous.tokenIds) ||
          updated.outcomes.some(
            (outcome, index) => outcome.toLowerCase() !== previous.outcomes[index]?.toLowerCase(),
          )
        ) {
          throw new Error(`Observed market identity changed: ${previous.slug}`)
        }
        if (
          updated.twapEnabled !== previous.twapEnabled ||
          updated.twapLookbackSeconds !== previous.twapLookbackSeconds ||
          (previous.resolutionSource !== null &&
            updated.resolutionSource !== previous.resolutionSource)
        ) {
          throw new Error(`Observed reference-price configuration changed: ${previous.slug}`)
        }
        // Freeze initial rules at their actual observed state when the market
        // starts. Later metadata stays on the tape without changing its past.
        if (!state.started) state.market = { ...updated, rawJson: event.rawJson }
      }
      const validated = marketFrame ? marketFrameMessages(marketFrame, state.market) : null
      if (validated?.invalid) {
        malformedMarkets.push(state.market.slug)
        continue
      }
      const relevant = validated?.messages ?? []
      try {
        for (const message of relevant) {
          const assets =
            message.event_type === 'price_change'
              ? message.price_changes.map((change) => change.asset_id)
              : [message.asset_id]
          if (assets.some((asset) => !state.market.tokenIds.includes(asset)))
            throw new Error('Unexpected token')
          state.books.applyAny(message)
          for (const asset of assets)
            state.lastBookObservation.set(asset, {
              receivedAtMs: event.receivedAtMs,
              sequence: event.sequence,
            })
        }
      } catch {
        malformedMarkets.push(state.market.slug)
        continue
      }
      if (relevant.length && state.books.isWarm()) {
        this.lastReceived.polymarket = event.receivedAtMs
        this.unavailable.delete('polymarket')
      }
      const update =
        event.source === 'price_to_beat' ? applyCapturedFeed({}, event, state.market) : sharedUpdate
      if (update?.feed === 'price_to_beat') {
        state.priceToBeat = event
        this.lastReceived.price_to_beat = event.receivedAtMs
      }
      if (!inWindow || !addressed) continue
      if (event.source === 'chainlink' || event.source === 'price_to_beat')
        state.openingReference?.accept(event)
      if (update) this.restored(state, update.feed, event.receivedAtMs)
      if (relevant.length && state.books.isWarm())
        this.restored(state, 'polymarket', event.receivedAtMs)
    }
    for (const marketSlug of malformedMarkets)
      this.status({
        source: 'polymarket',
        connectionId: event.connectionId,
        kind: 'gap',
        stamp: frame.stamp,
        marketSlug,
        reason: 'invalid_market_payload',
        details: { certainty: 'confirmed' },
      })
    if (malformedMarkets.length) this.options.onInvalidMarketFrame?.()
    return event
  }

  status(status: FeedStatus): void {
    // A delayed watchdog report must mark retained windows before advance can
    // finalize them, even when the event loop stalled longer than the grace.
    for (const state of this.markets.values()) {
      if (
        !state.started &&
        status.stamp.receivedAtMs >= state.market.startMs &&
        status.stamp.receivedAtMs < state.market.endMs
      )
        this.start(state, status.stamp.receivedAtMs)
    }
    const event = this.options.capture(
      {
        source: 'control',
        connectionId: status.connectionId,
        rawJson: JSON.stringify(status),
        stamp: status.stamp,
      },
      status.kind,
    )
    const losing = ['disconnected', 'gap', 'stale', 'provider_mismatch', 'error'].includes(
      status.kind,
    )
    const eligibleFeeds = sourceFeeds(status.source)
    const feedHint = status.details?.feed
    const feeds =
      typeof feedHint === 'string' && eligibleFeeds.includes(feedHint as RecorderFeed)
        ? [feedHint as RecorderFeed]
        : eligibleFeeds
    const startMs =
      typeof status.details?.startMs === 'number' && Number.isFinite(status.details.startMs)
        ? Math.min(status.details.startMs, status.stamp.receivedAtMs)
        : status.stamp.receivedAtMs
    const endMs =
      typeof status.details?.endMs === 'number' && Number.isFinite(status.details.endMs)
        ? Math.max(startMs, Math.min(status.details.endMs, status.stamp.receivedAtMs))
        : null
    const certainty = status.details?.certainty === 'confirmed' ? 'confirmed' : 'uncertain'
    if (losing && endMs === null && !status.marketSlug) {
      for (const feed of feeds)
        this.unavailable.set(feed, { since: startMs, reason: status.reason ?? status.kind })
    }
    for (const state of this.markets.values()) {
      if (state.finished || (status.marketSlug && status.marketSlug !== state.market.slug)) continue
      if (losing && status.source === 'polymarket') {
        state.books = new MarketOrderBookEngine({
          market: state.market.conditionId,
          expectedAssetIds: state.market.tokenIds,
        })
        state.lastBookObservation.clear()
      }
      if (!state.started) continue
      const intersects =
        startMs < state.market.endMs && (endMs === null || endMs >= state.market.startMs)
      const inWindow =
        status.stamp.receivedAtMs >= state.market.startMs &&
        status.stamp.receivedAtMs < state.market.endMs
      if (inWindow || (losing && intersects)) this.write(state, event)
      if (losing && intersects)
        for (const feed of feeds) {
          if (endMs !== null) {
            // Historical loss does not invalidate the successfully received frame
            // that revealed it, or close an unrelated ongoing outage.
            state.gaps.push({
              feed,
              startMs: Math.max(state.market.startMs, startMs),
              endMs: Math.min(state.market.endMs, endMs),
              reason: status.reason ?? status.kind,
              certainty,
            })
          } else this.gap(state, feed, startMs, status.reason ?? status.kind, certainty)
        }
    }
    // The caller may report a single event-loop stall for several sources.
    // Finalizing here would let the first status hide later sources' gaps.
    // Normal ingest/advance performs finalization after the status batch.
  }

  private finish(state: MarketState, at: number, reason?: string): void {
    if (state.finished) return
    state.finished = true
    for (const gap of state.openGaps.values()) gap.endMs = Math.min(at, state.market.endMs)
    for (const feed of RECORDER_FEEDS) {
      if (!state.receivedFeeds.has(feed) && !state.gaps.some((gap) => gap.feed === feed)) {
        state.gaps.push({
          feed,
          startMs: state.market.startMs,
          endMs: at,
          reason: 'no_observations',
          certainty: 'confirmed',
        })
      }
    }
    if (reason && at < state.market.endMs) {
      for (const feed of RECORDER_FEEDS)
        state.gaps.push({
          feed,
          startMs: at,
          endMs: state.market.endMs,
          reason,
          certainty: 'confirmed',
        })
    }
    this.write(
      state,
      this.local(
        'control',
        { kind: 'window_end', at, reason: reason ?? 'boundary' },
        this.now(),
        'window_end',
      ),
    )
    const coverage: MarketCoverage = {
      complete: !state.missingInitialBook && state.gaps.length === 0,
      startedAtMs: state.startedAtMs,
      endedAtMs: at,
      missingInitialBook: state.missingInitialBook,
      gaps: state.gaps,
      warnings: reason ? [reason] : [],
    }
    this.options.sink.finalize(state.market.slug, coverage)
  }

  shutdown(reason: string, at = this.now()): void {
    this.advance(at)
    for (const state of this.markets.values())
      if (state.started && !state.finished) {
        if (at >= state.market.endMs) {
          // Shutdown shortens retrospective validation; mark its unverified tail.
          for (const feed of RECORDER_FEEDS) {
            const verifiedThrough = this.lastReceived[feed]
            if (verifiedThrough === undefined || verifiedThrough < state.market.endMs) {
              this.gap(
                state,
                feed,
                verifiedThrough ?? state.market.startMs,
                'shutdown_before_tail_verification',
              )
            }
          }
          this.finish(state, state.market.endMs, reason)
        } else this.finish(state, at, reason)
      }
  }

  prune(): void {
    for (const [slug, state] of this.markets) if (state.finished) this.markets.delete(slug)
  }

  snapshot(): Array<{
    slug: string
    timeframe: string
    active: boolean
    rows: number
    gaps: number
    booksReady: boolean
    openingReference?: OpeningReferenceSnapshot
  }> {
    return [...this.markets.values()]
      .filter((state) => !state.finished)
      .map((state) => {
        const openingReference = state.openingReference?.snapshot()
        return {
          slug: state.market.slug,
          timeframe: state.market.timeframe,
          active: state.started && this.now() < state.market.endMs,
          rows: state.rows,
          gaps: state.gaps.length,
          booksReady: state.books.isWarm(),
          ...(openingReference ? { openingReference } : {}),
        }
      })
  }
}
