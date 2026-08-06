'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchMachineHealth } from '@/lib/runtimeClient'
import { cn } from '@/lib/utils'
import type { MachineHealth } from '@/lib/runtimeTypes'

type MachinesResponse = { machines: MachineHealth[] }

export function useMachineHealth() {
  return useQuery({
    queryKey: ['runtime-machines'],
    queryFn: () => fetchMachineHealth<MachinesResponse>(),
    refetchInterval: 10_000,
  })
}

/**
 * One chip per configured Global Runtime machine: green dot = daemon
 * reachable and ready, amber = replying but initializing, red = offline
 * (error on the tooltip). Missions on an offline machine stay browsable from
 * the DB; only commands need the daemon.
 */
export function MachineHealthStrip({ machines }: { machines: MachineHealth[] }) {
  if (machines.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {machines.map((machine) => (
        <span
          key={machine.machineId}
          title={
            machine.online
              ? machine.ready
                ? `${machine.machineId} — online`
                : `${machine.machineId} — initializing`
              : `${machine.machineId} — offline: ${machine.error ?? 'unreachable'}`
          }
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
        >
          <span
            aria-hidden
            className={cn(
              'h-2 w-2 rounded-full',
              machine.online
                ? machine.ready
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
                : 'bg-destructive',
            )}
          />
          <span className="font-medium">{machine.name}</span>
          {!machine.online && <span className="text-muted-foreground">offline</span>}
          {machine.online && !machine.ready && (
            <span className="text-muted-foreground">initializing</span>
          )}
        </span>
      ))}
    </div>
  )
}
