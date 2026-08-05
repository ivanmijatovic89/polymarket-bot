import os from 'os'
import nodeMachineId from 'node-machine-id'

const { machineIdSync } = nodeMachineId

let cachedMachineId: string | null = null

/**
 * Immutable per-machine identifier derived from the hardware UUID via
 * `node-machine-id`. The first 12 hex chars are enough to be globally
 * unique in practice and fit comfortably in tables/logs.
 *
 * This is the ONLY machine identity in the system (backtest workers,
 * dashboard machine catalog keys, and — per issue #213 — Global Runtime
 * ownership). There is no CLI flag, env override, or hostname dependency —
 * two invocations on the same box always produce the same id, and two
 * different boxes can never collide.
 *
 * Canonical home. `src/backtest/workerIdentity.ts` re-exports it for
 * existing importers; new code should import from here — this module pulls
 * in no Redis/queue dependencies.
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
