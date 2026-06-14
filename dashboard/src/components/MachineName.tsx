import { getMachine, hasMachineName, machineLabel } from '@/lib/machineNames'

/**
 * Renders a machine id as its friendly name with the raw id as a small
 * subtext underneath. When no alias is registered, only the raw id is shown
 * (no redundant second line). Hovering shows the machine's `hardware` lines
 * as a native tooltip. Used everywhere the dashboard surfaces a `machineId`.
 */
export function MachineName({ machineId }: { machineId: string }) {
  const hardware = getMachine(machineId)?.hardware ?? []
  const tooltip = hardware.length > 0 ? hardware.join('\n') : undefined

  if (!hasMachineName(machineId)) {
    return (
      <span className="font-mono" title={tooltip}>
        {machineId}
      </span>
    )
  }
  return (
    <span className="flex flex-col leading-tight" title={tooltip}>
      <span className="font-sans">{machineLabel(machineId)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{machineId}</span>
    </span>
  )
}
