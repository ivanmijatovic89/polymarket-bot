import type { Worker } from 'bullmq'
import { getCurrentGitSha, isAncestorOrEqual } from './workerIdentity.js'

/**
 * The commit this worker process LOADED its code at.
 *
 * Children inherit it from the supervisor via `WORKER_LAUNCH_SHA`. The
 * supervisor itself has no such env at module-load time, so it falls back to a
 * live `git rev-parse` — which, at process start, IS the launch commit. Either
 * way this reflects the strategy/stats code actually in memory, not the files
 * on disk (which change the moment you commit, while the process keeps running
 * its old code).
 */
export const WORKER_LAUNCH_SHA = process.env.WORKER_LAUNCH_SHA?.trim() || getCurrentGitSha()

/**
 * Exit code that tells the run-worker.sh wrapper to `git pull` and relaunch.
 * Any other exit code stops the wrapper loop. Chosen to not collide with
 * Node's conventional codes (0, 1) or our pre-flight failures (2).
 */
export const SELF_UPDATE_EXIT_CODE = 75

/** How long a deferred job waits before becoming eligible again (ms). */
export const STALE_JOB_RELEASE_DELAY_MS = 15_000

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
export function canRunJobCommit(jobCommitSha: string): boolean {
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
 * Stop a worker from fetching ANY MORE jobs, called the moment we decide to
 * self-update (exit for a `git pull` + relaunch).
 *
 * Why this matters: a concurrency-1 worker keeps its fetch loop alive right up
 * until the process exits. When a stale-code job is deferred and we schedule the
 * self-update exit, the worker would otherwise immediately grab the NEXT
 * runnable job, start it, and then get killed mid-flight — leaving that job
 * stuck in "active" with a held lock until `lockDuration` (10 min) elapses and
 * the stalled-checker reclaims it. On a busy multi-batch fleet the grabbed job
 * usually belongs to an unrelated batch, whose parent then hangs in
 * WAITING-CHILDREN. Pausing here closes that window entirely.
 *
 * Uses `pause()` (not `close()`): pause is safe to call from inside a processor,
 * whereas `close()` awaits the current job and would deadlock. It is
 * fire-and-forget on purpose — awaiting it from the active job's own catch block
 * can wait on that very job.
 *
 * The rejection MUST be swallowed: pause() awaits `whenCurrentJobsFinished()` on
 * the blocking connection, and callers commonly close/exit the worker moments
 * later (e.g. drainAndExit -> w.close()), which rejects that pending promise
 * with "Connection is closed". These processes install no unhandledRejection
 * handler, so a bare `void w.pause()` would let that rejection crash the process
 * with exit code 1 instead of the self-update code 75 — defeating the very
 * self-update this helper exists to enable.
 */
export function haltWorkerForSelfUpdate(w: Pick<Worker, 'pause'>): void {
  void w.pause().catch(() => {})
}
