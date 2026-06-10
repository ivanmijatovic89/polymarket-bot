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
