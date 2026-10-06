import type { MarketResolution } from '../../backtest/stats/marketResolution.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { MarketManifest } from '../storage/manifest.js'
import { readOpeningReferenceEvents } from '../storage/parquet.js'
import type { RecorderTimeframe } from '../types.js'
import { capturedMarketGapReasons } from './dispatcher.js'
import { validateCapturedFeedRequest } from './feedState.js'
import { inspectOpeningReference, type OpeningReferenceInspection } from './openingReference.js'

export type RecorderV4SelectionSource =
  | { kind: 'r2'; bucket: string; prefix: string }
  | { kind: 'local'; roots: string[] }
  | { kind: 'explicit'; inputs: string[] }

export type RecorderV4SelectionSummary = {
  candidates: number
  eligible: number
  selected: number
  excluded: number
  exclusions: Record<string, number>
}

export type RecorderV4SelectionMetadata = {
  version: 1
  source: RecorderV4SelectionSource
  requiredFeeds: ExternalFeedsRequestConfig
  allowGaps: boolean
  filters: { symbol: 'btc'; timeframe?: RecorderTimeframe; fromMs?: number; toMs?: number }
  summary: RecorderV4SelectionSummary
}

export type CaptureEligibilityOptions = {
  allowGaps?: boolean
  /** Omit only when resolution admission is handled separately by the caller. */
  resolution?: MarketResolution | null
  /** Narrow Parquet inspection, never a final snapshot supplied to a strategy. */
  reference?: OpeningReferenceInspection
  referenceEvidence?: PtbAdmissionEvidence
}

/** Small immutable admission evidence; no final feed values are exposed to strategy ticks. */
export type PtbAdmissionEvidence = { websiteObserved: boolean; openingReasons: string[] }

export function referenceAdmissionEvidence(
  reference: OpeningReferenceInspection,
): PtbAdmissionEvidence {
  return { websiteObserved: !!reference.state?.website, openingReasons: reference.reasons }
}

/** Shared selection/execution policy. No historical timestamp-gap tolerance applies to captures. */
export function captureEligibilityReasons(
  manifest: MarketManifest,
  requiredFeeds: ExternalFeedsRequestConfig,
  options: CaptureEligibilityOptions = {},
): string[] {
  const reasons: string[] = []
  try {
    validateCapturedFeedRequest(requiredFeeds, manifest.market)
  } catch (error) {
    reasons.push(`unsupported_feed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Number.isFinite(manifest.finalizedAtMs) || manifest.finalizedAtMs < manifest.createdAtMs)
    reasons.push('not_finalized: recording has no valid finalization marker')
  if (manifest.events.rows === 0) reasons.push('empty_capture: no recorded events')
  if (options.resolution !== undefined && !options.resolution?.outcome)
    reasons.push('unresolved_outcome: official resolution is unavailable')
  if (!options.allowGaps) {
    reasons.push(...capturedMarketGapReasons(manifest.market, manifest.coverage, requiredFeeds))
    // startedAtMs is bootstrap callback receipt time, normally a few milliseconds
    // after the boundary. The producer records actual late-start/tail loss as
    // feed-scoped gaps; requiring an exact boundary callback rejects valid tapes.
    if (requiredFeeds.polymarketPriceToBeat?.enabled) {
      const source = requiredFeeds.polymarketPriceToBeat.source ?? 'website'
      const evidence =
        options.referenceEvidence ??
        (options.reference ? referenceAdmissionEvidence(options.reference) : undefined)
      if (!evidence) reasons.push('ptb_unverified: reference observations not inspected')
      else if (source === 'chainlink-opening-twap') reasons.push(...evidence.openingReasons)
      else if (!evidence.websiteObserved)
        reasons.push('price_to_beat: website opening observation missing')
    }
  }
  return [...new Set(reasons)]
}

/** The caller verifies the event file checksum before inspecting its contents. */
export async function inspectCaptureEligibility(
  manifest: MarketManifest,
  requiredFeeds: ExternalFeedsRequestConfig,
  options: CaptureEligibilityOptions & { filePath: string },
): Promise<string[]> {
  const reference =
    requiredFeeds.polymarketPriceToBeat?.enabled && !options.allowGaps
      ? await inspectOpeningReference(manifest.market, readOpeningReferenceEvents(options.filePath))
      : undefined
  return captureEligibilityReasons(manifest, requiredFeeds, {
    ...options,
    ...(reference ? { reference } : {}),
  })
}
