import os from 'os'
import { execSync } from 'node:child_process'
import { getRedisConnection } from './queue.js'

/**
 * The default value for `--worker-name` when the CLI flag is omitted.
 * `${os.hostname()}-${pid}` is just a fallback — pass `--worker-name <foo>`
 * (or set `WORKER_NAME=foo` for children) to override without touching
 * the OS hostname. Children inherit the supervisor's name and append
 * `#<childId>` for uniqueness.
 */
export function defaultWorkerName(): string {
  return `${os.hostname()}-${process.pid}`
}

/**
 * Best-effort `git rev-parse HEAD`. Returns `'unknown'` if git isn't
 * available or the workdir isn't a repo. Shared by the producer
 * (`backtest.ts`), supervisor (`backtestWorker.ts`), and worker children
 * (`backtestWorkerChild.ts`) — keep one definition so the dashboard's
 * `worker:*:commitSha` field stays consistent.
 */
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
 * Writes a 60s-TTL heartbeat key + commitSha hash field for `workerName`
 * every 5 seconds. The dashboard's `listWorkers` query reads these keys —
 * the schema MUST stay aligned with `dashboard/src/lib/queries/workers.ts`.
 *
 * Returns a disposer that clears the timer and best-effort deletes the
 * heartbeat key on shutdown.
 */
export async function startHeartbeat(workerName: string): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const interval = 5000
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${workerName}:heartbeat`, String(Date.now()), 'EX', 60)
      await conn.hset(`backtest:worker:${workerName}`, 'commitSha', getCurrentGitSha())
    } catch {
      /* best-effort */
    }
  }
  await write()
  const timer = setInterval(write, interval)
  return async () => {
    clearInterval(timer)
    try {
      await conn.del(`backtest:worker:${workerName}:heartbeat`)
    } catch {
      /* best-effort */
    }
  }
}
