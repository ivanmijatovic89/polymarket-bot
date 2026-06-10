import { DelayedError, type Job } from 'bullmq'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'
import { classifyJobCommit, getCurrentGitSha, getUpstreamSha, gitFetch } from './workerIdentity.js'

/**
 * The commit this worker LOADED its code at. Captured once at module load
 * (the supervisor stamps it into the child env via WORKER_LAUNCH_SHA) so it
 * keeps reflecting the in-memory strategy registry even after the files on
 * disk change underneath a long-running worker.
 */
const WORKER_LAUNCH_SHA = process.env.WORKER_LAUNCH_SHA?.trim() || getCurrentGitSha()

/** How long a deferred job waits before becoming eligible again (ms). */
const STALE_JOB_RELEASE_DELAY_MS = 15_000

/**
 * BullMQ processor for the market queue.
 *
 * Before replaying, the worker checks the job's commit SHA against the code it
 * loaded. If the job was built on newer code, the worker releases the job back
 * to the queue (no attempt consumed) and asks its supervisor to pull + restart,
 * rather than running with a stale strategy registry and failing the market.
 */
export function makeMarketProcessor(machineId: string) {
  return async function marketProcessor(
    job: Job<MarketJobData>,
    token?: string,
  ): Promise<MarketJobResult> {
    const data = job.data

    if (data.commitSha && data.commitSha !== WORKER_LAUNCH_SHA) {
      gitFetch()
      const { action, reason } = classifyJobCommit({
        workerLaunchSha: WORKER_LAUNCH_SHA,
        jobCommitSha: data.commitSha,
        upstreamSha: getUpstreamSha(),
      })

      if (action === 'update') {
        // Release WITHOUT consuming an attempt, then ask the supervisor to
        // self-update. moveToDelayed keeps the job out of the "active" set so
        // it never counts as stalled when we exit (maxStalledCount guard).
        await job.moveToDelayed(Date.now() + STALE_JOB_RELEASE_DELAY_MS, token)
        console.log(`[worker] deferring job ${job.id} and requesting update: ${reason}`)
        process.send?.({ type: 'update-requested', jobCommitSha: data.commitSha })
        throw new DelayedError()
      }

      if (action === 'fail') {
        throw new Error(`[worker] cannot satisfy job ${job.id}: ${reason}`)
      }
      // action === 'run' → fall through (parity unverifiable; best effort)
    }

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
      commitSha: WORKER_LAUNCH_SHA,
    })
  }
}
