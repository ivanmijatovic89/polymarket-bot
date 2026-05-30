import os from 'os'
import type { Job } from 'bullmq'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'

/**
 * BullMQ processor for the market queue.
 *
 * Pulls the worker identity from the env/hostname so the producer never needs
 * to know who will pick up the job. The producer's commitSha is preserved on
 * the resulting execution metadata for traceability.
 */
export function makeMarketProcessor(workerName: string) {
  const workerHost = os.hostname()
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
      workerName,
      workerHost,
      commitSha: data.commitSha,
    })
  }
}
