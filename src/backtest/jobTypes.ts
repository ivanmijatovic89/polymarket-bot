import type { MarketStats } from './stats/marketStats.js'
import type { MarketResolution } from './stats/marketResolution.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
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
  batchUid: string
  idx: number
  filePath: string
  slug: string | null
  marketMeta: GammaMarketMeta | undefined
  marketResolution: MarketResolution | null
  strategyId: string
  strategyParams: Record<string, unknown>
  inputMode: RunSingleMarketInputMode
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  latency: RunSingleMarketLatency
  strategyWindow: { startMs: number; endMs: number } | null
  /** Producer's git SHA at enqueue time. Worker validates against its own. */
  commitSha: string
}

export type MarketJobResult = RunSingleMarketOutput

/**
 * Payload for the FlowProducer parent job that runs after all children settle.
 */
export type AggregateJobData = {
  batchUid: string
  totalMarkets: number
  initialCapital: number
  insertMeta: {
    baselineId: string | null
    cmd: string
    comment: string | null
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
 * and when computing failed-children diagnostics.
 */
export function marketJobId(batchUid: string, idx: number): string {
  return `${batchUid}-m-${idx}`
}

/**
 * Helper to build the jobId for the aggregate parent job.
 */
export function aggregateJobId(batchUid: string): string {
  return `${batchUid}-agg`
}

/** Re-export so downstream files can import via jobTypes. */
export type { MarketStats }
