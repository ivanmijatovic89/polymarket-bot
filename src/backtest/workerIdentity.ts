import os from 'os'

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
