import os from 'os'

/**
 * Returns the hostname that should appear in the dashboard and in
 * `MarketStats.execution.workerHost`. Prefers `BACKTEST_WORKER_HOST` from
 * the environment so users can override what their machine reports
 * without touching the OS hostname.
 *
 * Falls back to Node's `os.hostname()` (e.g. macOS mDNS `.local` name).
 */
export function getWorkerHost(): string {
  const override = process.env.BACKTEST_WORKER_HOST?.trim()
  if (override) return override
  return os.hostname()
}

/**
 * The default value for `--worker-name` when the CLI flag is omitted.
 * Uses the resolved worker host (env override or os.hostname) and the
 * current pid so multiple workers on one machine don't collide.
 */
export function defaultWorkerName(): string {
  return `${getWorkerHost()}-${process.pid}`
}
