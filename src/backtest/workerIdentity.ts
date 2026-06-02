import os from 'os'
import { execSync } from 'node:child_process'
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
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
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
      await conn.hset(`backtest:worker:${processKey}`, 'commitSha', getCurrentGitSha())
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
