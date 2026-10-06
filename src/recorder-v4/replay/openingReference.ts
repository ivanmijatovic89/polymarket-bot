import type { OpeningReferenceSnapshot } from '../../trading/feeds/externalFeeds.js'
import type { BootstrapPayload, CapturedEvent, RecordedMarket } from '../types.js'
import {
  applyCapturedFeed,
  isValidPolyBoltPriceEnvelope,
  object,
  parseCapturedJson,
} from './feedState.js'

/** Exact decimal identity; spelling differences must not invent a correction. */
function decimalIdentity(value: string): string {
  const [whole = '', fraction = ''] = value.split('.')
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`
}

function compared(state: OpeningReferenceSnapshot): OpeningReferenceSnapshot {
  const comparison = state.conflict
    ? 'conflicting-twap'
    : !state.observation
      ? 'unavailable'
      : !state.website
        ? 'waiting-for-website'
        : state.observation.openPrice === state.website.openPrice
          ? 'match'
          : 'mismatch'
  // The HTTP API supplies a JSON number. Comparison is at that precision;
  // fullAccuracyValue remains the unrounded Chainlink decimal string.
  return { ...state, comparison }
}

/** Same boundary/receipt rules for live capture diagnostics and archived replay. */
export class OpeningReferenceTracker {
  private state: OpeningReferenceSnapshot | undefined
  private bootstrapSession: string | undefined
  private sessionConflicts = 0
  observations = 0
  corrections = 0
  conflicts = 0

  constructor(private readonly market: RecordedMarket) {}

  snapshot(): OpeningReferenceSnapshot | undefined {
    if (!this.state && !this.sessionConflicts) return undefined
    return {
      ...(this.state ? structuredClone(this.state) : { comparison: 'unavailable' as const }),
      conflictCount: this.sessionConflicts,
    }
  }

  report(): OpeningReferenceInspection {
    const state = this.snapshot()
    const reasons: string[] = []
    if (!this.market.twapEnabled || this.market.twapLookbackSeconds !== 60)
      reasons.push('chainlink_opening_twap: unsupported market reference configuration')
    else if (!state?.observation)
      reasons.push('chainlink_opening_twap: exact opening observation missing')
    if (this.conflicts)
      reasons.push('chainlink_opening_twap: conflicting boundary observations in a frame')
    return {
      ...(state ? { state } : {}),
      observations: this.observations,
      corrections: this.corrections,
      conflicts: this.conflicts,
      reasons,
    }
  }

  accept(event: CapturedEvent): void {
    const market = this.market
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
        !Array.isArray(bootstrap.feeds)
      )
        throw new Error('Invalid opening-reference bootstrap')
      if (this.bootstrapSession === event.sessionId)
        throw new Error('Duplicate opening-reference bootstrap in one session')
      this.bootstrapSession = event.sessionId
      // A real process restart loses volatile state. Replay may restore only
      // observations actually present in its new bootstrap, never prior knowledge.
      this.state = undefined
      this.sessionConflicts = 0
      for (const feed of bootstrap.feeds) {
        if (
          feed.captureId !== event.captureId ||
          !/^\d+$/.test(feed.sequence) ||
          BigInt(feed.sequence) > BigInt(event.sequence) ||
          !Number.isFinite(feed.receivedAtMs) ||
          feed.receivedAtMs > event.receivedAtMs
        )
          throw new Error('Opening-reference bootstrap contains invalid or future feed state')
        this.observe(feed)
      }
      return
    }
    this.observe(event)
  }

  private observe(event: CapturedEvent): void {
    const market = this.market
    if (event.receivedAtMs < market.startMs || event.receivedAtMs >= market.endMs) return
    if (event.source === 'price_to_beat') {
      const price = applyCapturedFeed({}, event, market)?.snapshot.polymarketPriceToBeat
      if (price)
        this.state = compared({
          ...this.state,
          website: {
            openPrice: price.openPrice,
            receivedAtMs: price.receivedAtMs,
            eventId: event.eventId,
          },
          comparison: 'unavailable',
        })
      return
    }
    if (event.source !== 'chainlink' || !market.twapEnabled || market.twapLookbackSeconds !== 60)
      return
    const raw = object(parseCapturedJson(event))
    if (raw?.channel !== 'price.crypto.twap' || !isValidPolyBoltPriceEnvelope(raw, 60)) return
    const payload = object(raw.payload)!
    const points = (raw.snapshot === true ? payload.data : [payload]) as Record<string, unknown>[]
    const boundary = points.filter((point) => point.timestamp === market.startMs)
    if (!boundary.length) return
    const fullAccuracyValue = boundary[0]!.full_accuracy_value as string
    const conflict = boundary.find(
      (point) =>
        decimalIdentity(point.full_accuracy_value as string) !== decimalIdentity(fullAccuracyValue),
    )
    if (conflict) {
      this.conflicts++
      this.sessionConflicts++
      this.state = compared({
        ...this.state,
        conflict: {
          fullAccuracyValue: conflict.full_accuracy_value as string,
          receivedAtMs: event.receivedAtMs,
          eventId: event.eventId,
        },
        comparison: 'conflicting-twap',
      })
      return
    }
    const previous = this.state?.observation
    const changed =
      previous && decimalIdentity(previous.fullAccuracyValue) !== decimalIdentity(fullAccuracyValue)
    if (changed) this.corrections++
    this.observations++
    // Duplicate confirmations keep the original availability receipt. A later
    // correction or recovery becomes visible at its own newly observed receipt.
    const observation =
      previous && !changed && !this.state?.conflict
        ? previous
        : {
            source: 'chainlink-opening-twap' as const,
            symbol: 'BTC' as const,
            sourceTimestampMs: market.startMs,
            windowSeconds: 60 as const,
            openPrice: Number(fullAccuracyValue),
            fullAccuracyValue,
            receivedAtMs: event.receivedAtMs,
            eventId: event.eventId,
            sessionId: event.sessionId,
            connectionId: event.connectionId,
          }
    this.state = compared({
      observation,
      ...(this.state?.website ? { website: this.state.website } : {}),
      comparison: 'waiting-for-website',
    })
  }
}

export type OpeningReferenceInspection = {
  state?: OpeningReferenceSnapshot
  observations: number
  corrections: number
  conflicts: number
  reasons: string[]
}

/** Admission evidence only. Never inject this final state into earlier strategy ticks. */
export async function inspectOpeningReference(
  market: RecordedMarket,
  events: AsyncIterable<CapturedEvent> | Iterable<CapturedEvent>,
): Promise<OpeningReferenceInspection> {
  const tracker = new OpeningReferenceTracker(market)
  for await (const event of events) tracker.accept(event)
  return tracker.report()
}
