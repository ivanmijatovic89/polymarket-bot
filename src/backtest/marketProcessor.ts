import type { Job } from 'bullmq'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'

/**
 * BullMQ processor for the market queue.
 *
 * The producer never needs to know which worker will pick up the job —
 * the worker identity is bound at processor construction time and the
 * producer's commitSha is preserved on the execution metadata for
 * traceability.
 */
export function makeMarketProcessor(machineId: string) {
  return async function marketProcessor(job: Job<MarketJobData>): Promise<MarketJobResult> {
    const data = job.data
    return runSingleMarket({
      idx: data.idx,
      filePath: data.filePath,
      slug: data.slug,
      marketMeta: data.marketMeta,
      marketResolution: data.marketResolution,
      strategyId: data.strategyId,
      strategyParams: data.strategyParams,
      inputMode: data.inputMode,
      order: data.order,
      timeDriven: data.timeDriven,
      latency: data.latency,
      strategyWindow: data.strategyWindow,
      machineId,
      commitSha: data.commitSha,
    })
  }
}
