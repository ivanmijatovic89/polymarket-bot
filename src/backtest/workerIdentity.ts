import os from 'os'
import { execFileSync } from 'node:child_process'
import nodeMachineId from 'node-machine-id'

const { machineIdSync } = nodeMachineId
import { getRedisConnection } from './queue.js'

let cachedMachineId: string | null = null

/**
 * Immutable per-machine identifier derived from the hardware UUID via
 * `node-machine-id`. The first 12 hex chars are enough to be globally
 * unique in practice and fit comfortably in tables/logs.
 *
 * This is the ONLY worker identity in the system. There is no CLI flag,
 * env override, or hostname dependency — two invocations on the same box
 * always produce the same id, and two different boxes can never collide.
 */
export function getMachineId(): string {
  if (cachedMachineId !== null) return cachedMachineId
  try {
    cachedMachineId = machineIdSync().slice(0, 12)
  } catch {
    cachedMachineId = 'unk-' + os.hostname().slice(0, 8)
  }
  return cachedMachineId
}

/**
 * Per-process Redis key suffix used by `startHeartbeat` and the worker
 * stats hash. The dashboard's live Workers panel groups rows by the
 * `machineId` prefix; the `#<childId>` suffix lets it show one row per
 * forked child. **Never persisted to MySQL** — only used in Redis keys.
 */
export function getRedisProcessKey(childId: number | 'supervisor' | 'aggregator' | 'seq'): string {
  return `${getMachineId()}#${childId}`
}

export function getCurrentGitSha(): string {
  return getGitRefSha('HEAD')
}

export function getGitRefSha(ref: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export function getMainGitSha(): string {
  const originMain = getGitRefSha('origin/main')
  if (originMain !== 'unknown') return originMain
  return getGitRefSha('main')
}

/** True when the working tree has uncommitted changes to tracked files. */
export function isWorkingTreeDirty(): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return out.length > 0
  } catch {
    return false
  }
}

/**
 * True when `maybeAncestor` is the same as, or an ancestor of, `descendant` —
 * i.e. `descendant`'s history already CONTAINS `maybeAncestor`'s code.
 *
 * Used to answer "does this worker already have the code a job was built on?".
 * Because strategies are only ever ADDED (never removed), a worker whose loaded
 * commit is at-or-after the job's commit has every strategy that job needs, so
 * it can run the job — even if the job came from an older batch still in the
 * queue. Purely local (`git merge-base`), no network. Returns false when either
 * commit is unknown to this checkout (e.g. a newer commit not yet pulled), which
 * the caller treats as "I'm behind — update".
 */
export function isAncestorOrEqual(maybeAncestor: string, descendant: string): boolean {
  if (maybeAncestor === 'unknown' || descendant === 'unknown') return false
  if (maybeAncestor === descendant) return true
  try {
    // Exit 0 → is an ancestor; exit 1 → not; other → unknown commit / error.
    execFileSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Writes a 60s-TTL heartbeat key + commitSha hash field for `processKey`
 * every 5 seconds. The dashboard's `listWorkers` query reads these keys —
 * the schema MUST stay aligned with `dashboard/src/lib/queries/workers.ts`.
 *
 * `loadedSha` is the commit this process actually LOADED its code at (the
 * supervisor's `WORKER_LAUNCH_SHA`). Report that — not a live `git rev-parse`,
 * which drifts once the repo advances on disk under a still-running worker and
 * would make the dashboard show a stale worker as "current". Falls back to the
 * live HEAD only when no loaded SHA is provided (e.g. non-worker callers).
 */
export async function startHeartbeat(
  processKey: string,
  loadedSha?: string,
): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const interval = 5000
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${processKey}:heartbeat`, String(Date.now()), 'EX', 60)
      const commitSha = loadedSha?.trim() || getCurrentGitSha()
      const mainCommitSha = getMainGitSha()
      await conn.hset(
        `backtest:worker:${processKey}`,
        'commitSha',
        commitSha,
        'mainCommitSha',
        mainCommitSha,
        'mainCommitMatch',
        commitSha !== 'unknown' && mainCommitSha !== 'unknown' && commitSha === mainCommitSha
          ? '1'
          : '0',
      )
    } catch {
      /* best-effort */
    }
  }
  await write()
  const timer = setInterval(write, interval)
  return async () => {
    clearInterval(timer)
    try {
      await conn.del(`backtest:worker:${processKey}:heartbeat`)
    } catch {
      /* best-effort */
    }
  }
}
