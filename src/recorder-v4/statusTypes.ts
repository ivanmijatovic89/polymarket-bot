import type { RecorderFeed, RecorderTimeframe } from './types.js'
import type { OpeningReferenceSnapshot } from '../trading/feeds/externalFeeds.js'

export const RECORDER_STATUS_SET = 'recorder:v4:instances'
export const RECORDER_STATUS_PREFIX = 'recorder:v4:status:'
export const RECORDER_OFFLINE_AFTER_MS = 30_000

/** Monitoring DTO; never contains credentials, raw messages, or wallet information. */
export type RecorderStatus = {
  schemaVersion: 4
  recorderId: string
  captureId: string
  sessionId: string
  host: string
  pid: number
  startedAtMs: number
  updatedAtMs: number
  state: 'starting' | 'recording' | 'degraded' | 'stopping' | 'stopped' | 'error'
  reason: string | null
  feeds: Array<{
    feed: RecorderFeed
    state: string
    lastReceivedAtMs: number | null
    messages: number
    reconnects: number
  }>
  markets: Array<{
    slug: string
    timeframe: string
    active: boolean
    rows: number
    gaps: number
    booksReady: boolean
    openingReference?: OpeningReferenceSnapshot
  }>
  spool: {
    bytes: number
    maxBytes: number
    freeBytes: number
    minFreeBytes: number
    pendingWrites: number
  }
  archive: {
    enabled: boolean
    pendingMarkets: number
    uploadedMarkets: number
    lastSuccessAtMs: number | null
    lastError: string | null
  }
  resolution: { pending: number; lastError: string | null }
  metrics: { rssBytes: number; eventLoopLagMs: number; cpuPercent: number }
  recentMarkets: Array<{
    slug: string
    timeframe: RecorderTimeframe
    startMs: number
    endMs: number
    rows: number
    gaps: number
    complete: boolean
    manifestKey: string | null
    resolution: string
  }>
}
