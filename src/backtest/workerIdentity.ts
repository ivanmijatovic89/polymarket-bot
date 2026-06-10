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

/**
 * SHA of the upstream tracking branch (`@{u}`) — i.e. the newest commit this
 * checkout could reach via `git pull`. Falls back to origin/main when the
 * current branch has no upstream configured.
 */
export function getUpstreamSha(): string {
  const upstream = getGitRefSha('@{u}')
  if (upstream !== 'unknown') return upstream
  return getMainGitSha()
}

/** Best-effort `git fetch` to refresh remote refs before reading the upstream SHA. */
export function gitFetch(): void {
  try {
    execFileSync('git', ['fetch', '--quiet'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    /* offline / no remote — best effort */
  }
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
 * Decides what a worker should do with a market job, given the commit the
 * worker LOADED its code at (`workerLaunchSha`) versus the commit the job was
 * built on (`jobCommitSha`):
 *
 *  - `run`    — same commit (or parity can't be verified) → process normally.
 *  - `update` — worker is behind its own upstream → pulling can reach the job's
 *               commit, so release the job and self-update.
 *  - `fail`   — worker is already at its upstream tip but the job wants a
 *               different commit → pulling won't help (loop guard).
 *
 * `workerLaunchSha` is intentionally the code the process STARTED with, not a
 * live `git rev-parse` — on the producer's own machine the files change under
 * the running worker, so only the launch SHA reflects the loaded registry.
 */
export type JobCommitAction = 'run' | 'update' | 'fail'

export function classifyJobCommit(args: {
  workerLaunchSha: string
  jobCommitSha: string
  upstreamSha: string
}): { action: JobCommitAction; reason: string } {
  const { workerLaunchSha, jobCommitSha, upstreamSha } = args
  if (jobCommitSha === 'unknown' || workerLaunchSha === 'unknown') {
    return { action: 'run', reason: 'commit parity unverifiable (no git) — running' }
  }
  if (jobCommitSha === workerLaunchSha) {
    return { action: 'run', reason: 'worker on job commit' }
  }
  if (workerLaunchSha !== upstreamSha) {
    return {
      action: 'update',
      reason:
        `worker on ${workerLaunchSha.slice(0, 8)} but job wants ${jobCommitSha.slice(0, 8)}; ` +
        `upstream is ${upstreamSha.slice(0, 8)} — pulling`,
    }
  }
  return {
    action: 'fail',
    reason:
      `worker already at upstream tip ${workerLaunchSha.slice(0, 8)} but job wants ` +
      `${jobCommitSha.slice(0, 8)} (unpushed or diverged producer commit)`,
  }
}

/**
 * Writes a 60s-TTL heartbeat key + commitSha hash field for `processKey`
 * every 5 seconds. The dashboard's `listWorkers` query reads these keys —
 * the schema MUST stay aligned with `dashboard/src/lib/queries/workers.ts`.
 */
export async function startHeartbeat(processKey: string): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const interval = 5000
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${processKey}:heartbeat`, String(Date.now()), 'EX', 60)
      const commitSha = getCurrentGitSha()
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
