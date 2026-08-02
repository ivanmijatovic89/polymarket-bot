'use client'

import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Cpu } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Skeleton } from './ui/skeleton'
import { MachineName } from './MachineName'
import { cn } from '@/lib/utils'
import {
  fetchWorkers,
  LIVE_DASHBOARD_REFETCH_MS,
  workersQueryKey,
} from '@/lib/client/liveDashboardQueries'
import type { MachineGroup, WorkerProcess, WorkerRole } from '@/lib/queries/workers'

function RoleBadge({ role }: { role: WorkerRole }) {
  switch (role.kind) {
    case 'supervisor':
      return <Badge variant="secondary">supervisor</Badge>
    case 'aggregator':
      return <Badge variant="warning">aggregator</Badge>
    case 'worker':
      return <Badge variant="outline">worker #{role.childId}</Badge>
    case 'sequential':
      return <Badge variant="outline">sequential</Badge>
    default:
      return <Badge variant="muted">unknown</Badge>
  }
}

function formatHeartbeat(ageMs: number | null): string {
  return ageMs !== null ? `${Math.round(ageMs / 1000)}s ago` : '—'
}

function sharedLabel(values: Array<string | null>, fallback = 'unknown'): string {
  const known = [...new Set(values.filter((value): value is string => Boolean(value)))]
  if (known.length === 0) return fallback
  return known.length === 1 ? known[0] : 'mixed'
}

function machineHeartbeatAge(machine: MachineGroup): number | null {
  const ages = machine.processes
    .map((process) => process.heartbeatAgeMs)
    .filter((age): age is number => age !== null)
  return ages.length > 0 ? Math.max(...ages) : null
}

function ProcessRow({ process }: { process: WorkerProcess }) {
  const shaLabel = process.commitSha ? process.commitSha.slice(0, 8) : 'unknown'
  const branchLabel = process.branchName ?? 'unknown'
  return (
    <TableRow className="bg-muted/10 hover:bg-muted/20">
      <TableCell className="pl-10">
        <RoleBadge role={process.role} />
      </TableCell>
      <TableCell>
        {process.alive ? (
          <Badge variant="success">
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            alive
          </Badge>
        ) : (
          <Badge variant="muted">stale</Badge>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {process.processedTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {process.eventsTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="outline" className="max-w-36 font-mono">
          <span className="truncate">{branchLabel}</span>
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Badge
          variant={process.mainCommitMatch ? 'success' : 'warning'}
          className="font-mono"
        >
          {shaLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
        {formatHeartbeat(process.heartbeatAgeMs)}
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

function MachineRow({
  machine,
  expanded,
  onToggle,
}: {
  machine: MachineGroup
  expanded: boolean
  onToggle: () => void
}) {
  const processCount = machine.processes.length
  const branchLabel = sharedLabel(machine.processes.map((process) => process.branchName))
  const commitLabel = sharedLabel(
    machine.processes.map((process) => process.commitSha?.slice(0, 8) ?? null),
  )
  const commitsMatch = machine.processes.every((process) => process.mainCommitMatch)
  const allAlive = processCount > 0 && machine.totals.aliveCount === processCount
  const someAlive = machine.totals.aliveCount > 0

  return (
    <TableRow className="bg-muted/35 hover:bg-muted/50">
      <TableCell className="font-semibold">
        <span className="inline-flex items-center gap-2">
          <MachineName machineId={machine.machineId} />
          {machine.supervisorQueues?.includes('aggregate') ? (
            <Badge variant="warning">aggregator</Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={allAlive ? 'success' : someAlive ? 'warning' : 'muted'}>
          {machine.totals.aliveCount} / {processCount} alive
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {machine.totals.processedTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold text-muted-foreground">
        {machine.totals.eventsTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="outline" className="max-w-36 font-mono">
          <span className="truncate">{branchLabel}</span>
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Badge variant={commitsMatch ? 'success' : 'warning'} className="font-mono">
          {commitLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
        {formatHeartbeat(machineHeartbeatAge(machine))}
      </TableCell>
      <TableCell className="w-10 text-right">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} worker details for ${machine.machineId}`}
          title={`${expanded ? 'Hide' : 'Show'} per-worker details`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onToggle}
        >
          <ChevronRight
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
          />
        </button>
      </TableCell>
    </TableRow>
  )
}

export function WorkersTable() {
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(() => new Set())
  const { data, isLoading } = useQuery({
    queryKey: workersQueryKey,
    queryFn: fetchWorkers,
    refetchInterval: LIVE_DASHBOARD_REFETCH_MS,
  })

  function toggleMachine(machineId: string) {
    setExpandedMachines((current) => {
      const next = new Set(current)
      if (next.has(machineId)) next.delete(machineId)
      else next.add(machineId)
      return next
    })
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>
    )
  }
  const machines = data?.machines ?? []
  if (machines.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <Cpu className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">No workers reported in</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Start one with <code className="font-mono text-foreground">npm run backtest:worker</code>
        </p>
      </Card>
    )
  }

  const allExpanded = machines.every((machine) => expandedMachines.has(machine.machineId))

  function toggleAllMachines() {
    setExpandedMachines(
      allExpanded ? new Set() : new Set(machines.map((machine) => machine.machineId)),
    )
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Machine</TableHead>
            <TableHead>Workers</TableHead>
            <TableHead className="text-right">Processed</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">Branch</TableHead>
            <TableHead className="text-right">Commit</TableHead>
            <TableHead className="text-right">Heartbeat</TableHead>
            <TableHead className="w-10 text-right">
              <button
                type="button"
                aria-expanded={allExpanded}
                aria-label={allExpanded ? 'Collapse all worker details' : 'Expand all worker details'}
                title={allExpanded ? 'Collapse all worker details' : 'Expand all worker details'}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={toggleAllMachines}
              >
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', allExpanded && 'rotate-90')}
                />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {machines.map((machine) => {
            const expanded = expandedMachines.has(machine.machineId)
            return (
              <Fragment key={machine.machineId}>
                <MachineRow
                  machine={machine}
                  expanded={expanded}
                  onToggle={() => toggleMachine(machine.machineId)}
                />
                {expanded
                  ? machine.processes.map((process) => (
                      <ProcessRow key={process.processKey} process={process} />
                    ))
                  : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
