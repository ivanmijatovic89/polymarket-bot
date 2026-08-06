// Relative import (not `@/`) so plain-node test runners can load this module.
import machines from '../data/machines.json'

/**
 * Per-machine metadata, keyed by `machineId` (first 12 hex chars of the
 * hardware UUID — see `src/machines/identity.ts`). Edit
 * `src/data/machines.json` to add a box or fill in details; nothing here is
 * persisted to the DB. Display code uses `machineLabel` for the friendly
 * name and falls back to the raw id for unregistered machines.
 *
 * This is the dashboard's bundler view of the catalog (client components
 * cannot use fs). Runtime consumers (scripts, workers, Global Runtime) use
 * the fs-based loader in the repo root's `src/machines/catalog.ts` — keep
 * this type aligned with `MachineCatalogEntry` there. The JSON file stays
 * the single source of truth.
 *
 * Fields:
 * - `name`     — human-readable alias shown in the UI.
 * - `hardware` — `system_profiler` lines (free-form), reference only. Join
 *                with `\n` to render as a block.
 * - `runtimeUrl` — base URL of this machine's Global Runtime daemon on the
 *                  tailnet (raw 100.x IP, e.g. `http://100.107.149.100:3053`).
 *                  Present ⇒ the machine is a Mission Control target. The
 *                  bearer token is NEVER stored here — it lives in server-side
 *                  env only (`GLOBAL_RUNTIME_TOKEN`).
 * - `cores`, `geekbench6Multi`, `geekbench6Source`, `priceUsd`,
 *   `parallelThroughput` — optional benchmark/cost metadata consumed by the
 *   Workers Calculator page. `parallelThroughput` is a cores × single-core
 *   estimate (P/E-weighted for Apple chips); see WorkersCalculatorView.
 */
export type MachineInfo = {
  name: string
  hardware: string[]
  /** Global Runtime daemon base URL on the tailnet; absent ⇒ not a Mission Control target. */
  runtimeUrl?: string
  cores?: number | null
  /** Default `--market-concurrency` for backtest workers on this box (see scripts/run-worker.sh). */
  cores_for_backtest?: number | null
  geekbench6Multi?: number | null
  geekbench6Source?: 'verified' | 'estimated' | 'unknown'
  priceUsd?: number
  parallelThroughput?: number
}

const MACHINES = machines as Record<string, MachineInfo>

/** Full metadata for a machine id, or `undefined` when unregistered. */
export function getMachine(machineId: string): MachineInfo | undefined {
  return MACHINES[machineId]
}

/** Friendly name for a machine id, or the raw id when unknown. */
export function machineLabel(machineId: string): string {
  return MACHINES[machineId]?.name ?? machineId
}

/** True when a friendly name is registered for this id. */
export function hasMachineName(machineId: string): boolean {
  return machineId in MACHINES
}

/** Machines that run a Global Runtime daemon (have `runtimeUrl`), as [id, info] pairs. */
export function listRuntimeMachines(): Array<[string, MachineInfo]> {
  return Object.entries(MACHINES).filter(([, info]) => Boolean(info.runtimeUrl))
}
