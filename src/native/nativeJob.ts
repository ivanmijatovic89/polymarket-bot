/**
 * Producer-side assembly of a native `MarketJobData` (21 §4) from the TS
 * job the producer already builds (selection, resolution, token map, slug
 * window, Gamma price-to-beat) plus the native additions. Used by the parity
 * harness now (60 HR-2) and by the producer from M3a.
 */
import type { MarketJobData } from '../backtest/jobTypes.js'
import type { ReadFrom } from '../db/telonexMarkets.js'
import { windowFromSlug } from '../polymarket/upDownSlugWindow.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { CandidateSpec, MarketRules, ModelConfig } from './contract/generated.js'
import {
  JOB_SCHEMA_VERSION,
  type NativeInputRef,
  type NativeMarketJobData,
} from './buildEngineJob.js'
import { resolvePriceToBeatAvailability } from './feeds.js'

/** The empty rules record every job carries before the snapshot table exists (21 §7.2). */
export function emptyRulesRecord(): MarketRules {
  return { snapshotParserVersion: null, captured: {}, disagreements: 0 }
}

/** What the producer adds to a TS job for the native engine (21 §4). */
export interface NativeJobExtras {
  /** The binary's strategy id (21 §5.1, D20). */
  strategyId: string
  modelConfig: ModelConfig
  /** `describe.requiredFeeds` of the job's params (20 §5.1). */
  requiredFeeds: ExternalFeedsRequestConfig | null
  /** `telonex_markets.market_id` (15 I-18); null when unknown. */
  conditionId: string | null
  input: NativeInputRef
  readFrom: ReadFrom
  /** Producer wall clock for `feedAvailability` (21 §5.3). */
  asOfMs: number
  /** Captured rules (21 §7); default the empty form. */
  rules?: MarketRules
  /** Group candidates (21 §8); absent for a single candidate. */
  candidates?: CandidateSpec[]
}

/**
 * The native `MarketJobData` of a TS job: the TS fields stay as built (the
 * legacy `latency` and `startingCapital` are asserted against the
 * ModelConfig by `buildEngineJob`, 21 §4), the strategy id becomes the
 * binary's, and `feedAvailability` is resolved at `asOfMs` (14 §6.2).
 */
export function toNativeMarketJob(job: MarketJobData, x: NativeJobExtras): NativeMarketJobData {
  const window = job.slug === null ? null : windowFromSlug(job.slug)
  const requested = x.requiredFeeds?.polymarketPriceToBeat?.enabled === true
  const feedAvailability =
    job.slug === null || window === null
      ? { priceToBeat: null }
      : resolvePriceToBeatAvailability({
          requested,
          slug: job.slug,
          window,
          gamma: job.gammaPriceToBeat,
          asOfMs: x.asOfMs,
        })
  return {
    ...job,
    strategyId: x.strategyId,
    jobSchemaVersion: JOB_SCHEMA_VERSION,
    modelConfig: x.modelConfig,
    rules: x.rules ?? emptyRulesRecord(),
    ...(x.candidates === undefined ? {} : { candidates: x.candidates }),
    conditionId: x.conditionId,
    input: x.input,
    readFrom: x.readFrom,
    feedAvailability,
    asOfMs: x.asOfMs,
    ownActivity: null,
    ledger: false,
    requiredFeeds: x.requiredFeeds,
  }
}
