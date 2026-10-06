/** Recorder v4's transport-neutral capture contract. No execution dependencies. */
export const RECORDER_SCHEMA_VERSION = 4 as const

export type RecorderTimeframe = '5m' | '15m'
export type RecorderSource =
  | 'polymarket'
  | 'binance'
  | 'chainlink'
  | 'price_to_beat'
  | 'market_metadata'
  | 'control'
  | 'bootstrap'

export type RecorderFeed =
  | 'polymarket'
  | 'binance_agg_trade'
  | 'binance_book_ticker'
  | 'chainlink_spot'
  | 'chainlink_twap'
  | 'price_to_beat'

/** Capture at callback entry, before parsing or asynchronous work. */
export type IngressStamp = { receivedAtMs: number; monotonicNs: string }

export type RawFrame = {
  source: RecorderSource
  connectionId: string
  rawJson: string
  stamp: IngressStamp
  marketSlug?: string
  /** Routing scope assigned by our subscription owner, never inferred from remote JSON. */
  marketSlugs?: readonly string[]
  /** Stable subscription group across reconnects; connectionId identifies each socket. */
  channelId?: string
  request?: { url: string; httpStatus: number; startedAtMs: number }
}

export type FeedStatus = {
  source: RecorderSource
  connectionId: string
  kind:
    | 'connecting'
    | 'connected'
    | 'subscribed'
    | 'disconnected'
    | 'gap'
    | 'error'
    | 'stale'
    | 'provider_mismatch'
    | 'stopped'
  stamp: IngressStamp
  reason?: string
  marketSlug?: string
  marketSlugs?: readonly string[]
  channelId?: string
  details?: Record<string, unknown>
}

export type FeedCallbacks = {
  onFrame: (frame: RawFrame) => void
  onStatus: (status: FeedStatus) => void
}

export type CapturedEvent = {
  schemaVersion: typeof RECORDER_SCHEMA_VERSION
  /** Stable recorder installation identity; sessionId changes on process restart. */
  captureId: string
  sessionId: string
  /** Decimal INT64. Reserved durably before accepting messages; never reused. */
  sequence: string
  eventId: string
  receivedAtMs: number
  monotonicNs: string
  source: RecorderSource
  connectionId: string
  eventType: string
  /** Null for envelopes with no single source timestamp, including batched frames. */
  sourceTimeMs: number | null
  rawJson: string
  /** Decoded typed payload; rawJson is materialized only when a diagnostic requests it. */
  decodedPayload?: unknown
  /** HTTP request metadata or local annotation; never contains authentication. */
  detailsJson: string | null
}

export type RecordedMarket = {
  slug: string
  symbol: 'btc'
  timeframe: RecorderTimeframe
  conditionId: string
  tokenIds: [string, string]
  outcomes: [string, string]
  startMs: number
  endMs: number
  twapEnabled: boolean
  twapLookbackSeconds: number | null
  resolutionSource: string | null
  /** Complete original discovery response for rules, fees, tick sizes, etc. */
  rawJson: string
}

export type CoverageGap = {
  feed: RecorderFeed
  startMs: number
  endMs: number | null
  reason: string
  certainty: 'confirmed' | 'uncertain'
}

export type MarketCoverage = {
  complete: boolean
  startedAtMs: number
  endedAtMs: number
  missingInitialBook: boolean
  gaps: CoverageGap[]
  warnings: string[]
}

/** Used by offline settlement; never supplied to an earlier strategy tick. */
export type ResolutionObservation = {
  schemaVersion: typeof RECORDER_SCHEMA_VERSION
  slug: string
  conditionId: string
  observedAtMs: number
  status: 'pending' | 'proposed' | 'disputed' | 'resolved' | 'unknown'
  winningOutcome: string | null
  winningTokenId: string | null
  payouts: Record<string, string> | null
  priceToBeat: string | null
  finalPrice: string | null
  source: string
  rawJson: string
}

/** A bootstrap restores observed state; it does not invent incoming market ticks. */
export type BootstrapPayload = {
  kind: 'initial_state'
  market: RecordedMarket
  /** Prior observed rows needed for current feed state, never a history warmup. */
  feeds: CapturedEvent[]
  /** Full book messages materialized from the pre-subscribed market's observed state. */
  books: Array<{ rawJson: string; observedAtMs: number; sequence: string }>
}
