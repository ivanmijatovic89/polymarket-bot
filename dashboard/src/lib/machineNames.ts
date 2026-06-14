/**
 * Human-readable aliases for hardware machine ids.
 *
 * `machineId` is the first 12 hex chars of the hardware UUID (see
 * `src/backtest/workerIdentity.ts`). It is stable per box but unreadable, so
 * the dashboard maps it to a friendly label at display time only. Nothing is
 * persisted — add a box here when it first shows up. Unknown ids fall back to
 * the raw id via `machineLabel`.
 */
const MACHINE_NAMES: Record<string, string> = {
  '8e367b2f7eb8': 'Laranist-macbook-m5',
  '8955f8d87c59': 'NotHumbleAtAll-macbook-m1',
  '5a69e8aa2068': 'Laranist-macbook-m1',
  a279f9dd3843: 'NotHumbleAtAll-PC',
}

/** Friendly name for a machine id, or the raw id when unknown. */
export function machineLabel(machineId: string): string {
  return MACHINE_NAMES[machineId] ?? machineId
}

/** True when a friendly name is registered for this id. */
export function hasMachineName(machineId: string): boolean {
  return machineId in MACHINE_NAMES
}
