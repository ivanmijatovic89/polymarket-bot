import type { MarketStats } from './stats/marketStats.js'
import type { MarketResolution } from './stats/marketResolution.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { StrategyArtifactMeta, StrategyArtifactRef } from '../strategy/artifacts/types.js'
import type {
  RunSingleMarketInputMode,
  RunSingleMarketLatency,
  RunSingleMarketOutput,
} from './runSingleMarket.js'

/**
 * Payload pushed into the market queue by the producer.
 * Workers consume this and pass it (minus the producer-provided commitSha)
 * to runSingleMarket along with their own worker identity.
 */
export type MarketJobData = {
  /** Internal per-submission identity (auto-UUID). Keys the flow's job ids. */
  submissionUid: string
  /** Human-facing group label persisted on the run row (display only here). */
  batchUid: string
  idx: number
  filePath: string
  /** `--read-from local-or-download-from-r2-to-local`: r2:// URL to fetch to `filePath` if it's missing. */
  r2Fallback?: string
  slug: string | null
  marketMeta: GammaMarketMeta | undefined
  marketResolution: MarketResolution | null
  strategyId: string
  strategyParams: Record<string, unknown>
  /**
   * External strategy artifact ref (issue #211). When present the worker
   * hash-verifies + loads the artifact (machine-local cache, one download per
   * machine) instead of consulting its strategy registry. Optional:
   * pre-existing registry jobs replay unchanged.
   */
  strategyArtifact?: StrategyArtifactRef
  inputMode: RunSingleMarketInputMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  latency: RunSingleMarketLatency
  strategyWindow: { startMs: number; endMs: number } | null
  /** Producer-resolved Gamma metadata for priceToBeat-requesting strategies. Optional: pre-existing jobs replay unchanged. */
  gammaPriceToBeat?: { priceToBeat: number | null; syncedAtMs: number | null } | null
  /** Producer's git SHA at enqueue time. Worker validates against its own. */
  commitSha: string
}

export type MarketJobResult = RunSingleMarketOutput

export const AGGREGATE_JOB_PROTOCOL_VERSION = 5

/**
 * Payload for the FlowProducer parent job that runs after all children settle.
 */
export type AggregateJobData = {
  /** Internal per-submission identity (auto-UUID). Keys the flow's job ids. */
  submissionUid: string
  /** Human-facing group label persisted on the run row. */
  batchUid: string
  protocolVersion: number
  /** Producer's git SHA at enqueue time. The aggregate worker self-updates if it loaded older code. */
  commitSha: string
  totalMarkets: number
  expectedMarkets: Array<{ idx: number; slug: string | null }>
  initialCapital: number
  insertMeta: {
    baselineId: string | null
    cmd: string
    comment: string | null
    protocol: string | null
    model: string | null
    strategy: string
    params: Record<string, unknown>
    symbol: string | null
    timeframe: string | null
    inputMode: string | null
    converter: string | null
    readFrom: string | null
    slugs: string[] | null
    limit: number | null
    random: boolean
    latest: boolean
    /** External artifact provenance (issue #211). Null for registry strategies. */
    strategyArtifactSha256: string | null
    strategyArtifactMeta: StrategyArtifactMeta | null
  }
  /**
   * Set when this aggregate is the completion of an extension batch. Drives
   * the UPDATE-vs-INSERT branch in `aggregateProcessor`: when present, results
   * are merged into the parent run instead of inserting a new row. Absent for
   * fresh runs.
   */
  extension?: {
    parentRunId: number
  }
}

export type AggregateJobResult = {
  submissionUid: string
  batchUid: string
  totalSucceeded: number
  totalFailed: number
  totalSkipped: number
  marketsPersisted: number
}

export type FailedMarketRecord = {
  jobId?: string
  idx: number | null
  slug: string | null
  reason: string
}

/**
 * Helper to build the jobId for a market job. Used both at enqueue time
 * and when computing failed-children diagnostics. Keyed by submissionUid —
 * always fresh per submission, so job ids never collide with BullMQ's
 * jobId dedup cache even when the batch label is reused.
 */
export function marketJobId(submissionUid: string, idx: number): string {
  return `${submissionUid}-m-${idx}`
}

/**
 * Helper to build the jobId for the aggregate parent job.
 */
export function aggregateJobId(submissionUid: string): string {
  return `${submissionUid}-agg`
}

/** Re-export so downstream files can import via jobTypes. */
export type { MarketStats }
