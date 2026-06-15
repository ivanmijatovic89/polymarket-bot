import machines from '@/data/machines.json'

/**
 * Per-machine metadata, keyed by `machineId` (first 12 hex chars of the
 * hardware UUID — see `src/backtest/workerIdentity.ts`). Edit
 * `src/data/machines.json` to add a box or fill in details; nothing here is
 * persisted to the DB. Display code uses `machineLabel` for the friendly
 * name and falls back to the raw id for unregistered machines.
 *
 * Fields:
 * - `name`     — human-readable alias shown in the UI.
 * - `hardware` — `system_profiler` lines (free-form), reference only. Join
 *                with `\n` to render as a block.
 * - `cores`, `geekbench6Multi`, `geekbench6Source`, `priceUsd`,
 *   `parallelThroughput` — optional benchmark/cost metadata consumed by the
 *   Workers Calculator page. `parallelThroughput` is a cores × single-core
 *   estimate (P/E-weighted for Apple chips); see WorkersCalculatorView.
 */
export type MachineInfo = {
  name: string
  hardware: string[]
  cores?: number | null
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
