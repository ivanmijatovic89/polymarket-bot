// Relative imports (not `@/`) so plain-node test runners can load this module.
import { listRuntimeRunSummaries } from '../queries/runtimeRuns'
import { createTtlCache } from './ttlCache'
import { getRuntimeMachines, runtimeAuthHeaders, type RuntimeMachine } from './runtimeMachines'

/**
 * Mission Control server caches (issue #213). Run history comes from the
 * shared MySQL (browsable while owning machines sleep); machine health is a
 * parallel `GET /health` sweep over every catalog machine with a
 * `runtimeUrl`. Both are TTL-cached so client polling doesn't multiply
 * upstream load.
 */

export const MISSION_CONTROL_RUNS_CACHE_MS = 2_000
export const MISSION_CONTROL_HEALTH_CACHE_MS = 5_000
const HEALTH_TIMEOUT_MS = 2_000

export type MachineHealth = {
  machineId: string
  name: string
  online: boolean
  /** Daemon replied but is still initializing (503 from /health). */
  ready: boolean
  error: string | null
}

export async function probeMachineHealth(
  machine: RuntimeMachine,
  fetchImpl: typeof fetch = fetch,
): Promise<MachineHealth> {
  const base = { machineId: machine.machineId, name: machine.name }
  try {
    const response = await fetchImpl(`${machine.runtimeUrl.replace(/\/$/u, '')}/health`, {
      cache: 'no-store',
      headers: runtimeAuthHeaders(),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (response.ok) return { ...base, online: true, ready: true, error: null }
    if (response.status === 503) {
      return { ...base, online: true, ready: false, error: 'initializing' }
    }
    return { ...base, online: false, ready: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      ...base,
      online: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function loadMachineHealth(
  machines: RuntimeMachine[] = getRuntimeMachines(),
  fetchImpl: typeof fetch = fetch,
): Promise<MachineHealth[]> {
  return Promise.all(machines.map((machine) => probeMachineHealth(machine, fetchImpl)))
}

const runsCache = createTtlCache<Awaited<ReturnType<typeof listRuntimeRunSummaries>>>(
  MISSION_CONTROL_RUNS_CACHE_MS,
)
const healthCache = createTtlCache<MachineHealth[]>(MISSION_CONTROL_HEALTH_CACHE_MS)

export function getCachedRuntimeRuns() {
  return runsCache.get(listRuntimeRunSummaries)
}

export function getCachedMachineHealth() {
  return healthCache.get(() => loadMachineHealth())
}
