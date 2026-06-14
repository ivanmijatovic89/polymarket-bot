import { hasMachineName, machineLabel } from '@/lib/machineNames'

/**
 * Renders a machine id as its friendly name with the raw id as a small
 * subtext underneath. When no alias is registered, only the raw id is shown
 * (no redundant second line). Used everywhere the dashboard surfaces a
 * `machineId` — Leaderboard, Workers, and the per-market exec columns.
 */
export function MachineName({ machineId }: { machineId: string }) {
  const named = hasMachineName(machineId)
  if (!named) {
    return <span className="font-mono">{machineId}</span>
  }
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-sans">{machineLabel(machineId)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{machineId}</span>
    </span>
  )
}
