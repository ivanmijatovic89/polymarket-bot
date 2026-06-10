import { DelayedError, type Job } from 'bullmq'
import { runSingleMarket } from './runSingleMarket.js'
import type { MarketJobData, MarketJobResult } from './jobTypes.js'
import { getCurrentGitSha, isAncestorOrEqual } from './workerIdentity.js'

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
 * Commits already proven to be at-or-before our loaded code (runnable). One
 * `git merge-base` per distinct commit; every job in a batch shares a commit,
 * so this is effectively one check per batch.
 */
const runnableCommits = new Set<string>()

/**
 * Can this worker run a job built on `jobCommitSha` with the code it loaded?
 * Yes when the job's commit is the same as, or an ancestor of, our loaded
 * commit (we already have that code, or newer). No when the job needs code
 * newer than we loaded — that's the signal to self-update.
 */
function canRunJobCommit(jobCommitSha: string): boolean {
  if (!jobCommitSha || jobCommitSha === WORKER_LAUNCH_SHA) return true
  if (WORKER_LAUNCH_SHA === 'unknown') return true // no git → can't verify, best effort
  if (runnableCommits.has(jobCommitSha)) return true
  if (isAncestorOrEqual(jobCommitSha, WORKER_LAUNCH_SHA)) {
    runnableCommits.add(jobCommitSha)
    return true
  }
  return false
}

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
      process.send?.({ type: 'update-requested', jobCommitSha: data.commitSha })
      throw new DelayedError()
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
