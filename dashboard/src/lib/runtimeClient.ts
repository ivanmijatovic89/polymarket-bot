// Browser-side client for Mission Control (issue #213).
//
// Reads (run list, run detail, machine health) hit DB-backed dashboard
// routes, so history from every machine stays visible even when a daemon is
// offline. Commands and live-file reads go through machine- or run-addressed
// proxies that forward to the owning Global Runtime daemon over the tailnet
// (bearer token attached server-side — the browser never sees it).

async function missionControlFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/mission-control${path}`, { ...init, cache: 'no-store' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

/** DB-backed list of runs across all machines. */
export function fetchRuntimeRuns<T = unknown>(): Promise<T> {
  return missionControlFetch<T>('/runs')
}

/** DB-backed run detail (browsable while the owning machine is offline). */
export function fetchRuntimeRunDetail<T = unknown>(runId: number | string): Promise<T> {
  return missionControlFetch<T>(`/runs/${runId}`)
}

/** Health of every configured Global Runtime machine. */
export function fetchMachineHealth<T = unknown>(): Promise<T> {
  return missionControlFetch<T>('/machines')
}

/** Command addressed to a SPECIFIC machine's daemon (e.g. POST /runs to create). */
export function machineFetch<T = unknown>(
  machineId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return missionControlFetch<T>(`/machine/${machineId}${path}`, init)
}

/**
 * Command or live-file read for an EXISTING run, forwarded to its owning
 * machine's daemon (path is relative to `/runs/<id>`, e.g. `/start`, `/files`).
 */
export function runFetch<T = unknown>(
  runId: number | string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return missionControlFetch<T>(`/run/${runId}${path}`, init)
}
