import { listRuntimeMachines, type MachineInfo } from '@/lib/machineNames'

/**
 * Server-side view of Global Runtime machines (issue #213). `runtimeUrl`
 * comes from the machines.json catalog; the bearer token comes from the
 * dashboard host's env ONLY — it must never reach a client bundle, so this
 * module is imported exclusively from route handlers / server code.
 */

export type RuntimeMachine = {
  machineId: string
  name: string
  runtimeUrl: string
}

export function getRuntimeMachines(): RuntimeMachine[] {
  return listRuntimeMachines().map(([machineId, info]: [string, MachineInfo]) => ({
    machineId,
    name: info.name,
    // listRuntimeMachines only returns entries with a runtimeUrl.
    runtimeUrl: info.runtimeUrl as string,
  }))
}

/** Machine by 12-hex id, or undefined when unknown / not a Global Runtime target. */
export function getRuntimeMachine(machineId: string): RuntimeMachine | undefined {
  return getRuntimeMachines().find((machine) => machine.machineId === machineId)
}

/** Authorization headers for daemon requests; empty when no token is configured. */
export function runtimeAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env.GLOBAL_RUNTIME_TOKEN?.trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}
