import { DelayedError, type Job } from 'bullmq'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'
import { WORKER_LAUNCH_SHA, STALE_JOB_RELEASE_DELAY_MS, canRunJobCommit } from './commitGate.js'

/**
 * BullMQ processor for the market queue.
 *
 * Before replaying, the worker checks whether it already has the code the job
 * was built on. If the job needs newer code, the worker releases the job back
 * to the queue (no attempt consumed) and asks its supervisor to pull + restart,
 * rather than running with a stale strategy registry.
 */
export function makeMarketProcessor(machineId: string) {
  return async function marketProcessor(
    job: Job<MarketJobData>,
    token?: string,
  ): Promise<MarketJobResult> {
    const data = job.data

    if (!canRunJobCommit(data.commitSha)) {
      // The job was built on code newer than we loaded. Release it WITHOUT
      // consuming an attempt (moveToDelayed keeps it out of the "active" set so
      // it never counts as stalled when we exit), then ask the supervisor to
      // self-update. The run-worker.sh wrapper pulls the newer commit and
      // relaunches; afterwards this job's commit is in our history → it runs.
      await job.moveToDelayed(Date.now() + STALE_JOB_RELEASE_DELAY_MS, token)
      console.log(
        `[worker] deferring job ${job.id} and requesting update: ` +
          `loaded ${WORKER_LAUNCH_SHA.slice(0, 8)}, job needs ${data.commitSha.slice(0, 8)}`,
      )
      throw new DelayedError()
    }

    return runSingleMarket({
      idx: data.idx,
      filePath: data.filePath,
      ...(data.r2Fallback ? { r2Fallback: data.r2Fallback } : {}),
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
      commitSha: WORKER_LAUNCH_SHA,
    })
  }
}
