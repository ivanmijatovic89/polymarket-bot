import nodeMachineId from 'node-machine-id'

const { machineIdSync } = nodeMachineId

let cached: string | null | undefined

/**
 * The dashboard HOST's machine id — same derivation as the engine's
 * `src/machines/identity.ts` (first 12 hex chars of the hardware UUID).
 * Used to pin the example card's workspace to the machine whose filesystem
 * actually holds `examplesRoot`. Null when the id cannot be derived.
 */
export function getLocalMachineId(): string | null {
  if (cached !== undefined) return cached
  try {
    cached = machineIdSync().slice(0, 12)
  } catch {
    cached = null
  }
  return cached
}
