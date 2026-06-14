'use client'

import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cpu } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Skeleton } from './ui/skeleton'
import { MachineName } from './MachineName'
import type { MachineGroup, WorkerProcess, WorkerRole } from '@/lib/queries/workers'

async function fetchWorkers(): Promise<{ machines: MachineGroup[] }> {
  const r = await fetch('/api/workers', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/workers')
  return r.json()
}

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

function ProcessRow({ p }: { p: WorkerProcess }) {
  const shaLabel = p.commitSha ? p.commitSha.slice(0, 8) : 'unknown'
  return (
    <TableRow>
      <TableCell className="pl-8">
        <RoleBadge role={p.role} />
      </TableCell>
      <TableCell>
        {p.alive ? (
          <Badge variant="success">
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            alive
          </Badge>
        ) : (
          <Badge variant="muted">stale</Badge>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {p.processedTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {p.eventsTotal.toLocaleString()}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {p.lastMarket ?? '—'}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant={p.mainCommitMatch ? 'success' : 'warning'} className="font-mono">
          {shaLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
        {p.heartbeatAgeMs !== null ? `${Math.round(p.heartbeatAgeMs / 1000)}s ago` : '—'}
      </TableCell>
    </TableRow>
  )
}

function MachineHeaderRow({ machine }: { machine: MachineGroup }) {
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={2} className="text-xs font-semibold">
        <span className="inline-flex items-baseline">
          <MachineName machineId={machine.machineId} />
          <span className="ml-3 font-sans text-xs font-normal text-muted-foreground">
            {machine.totals.aliveCount} alive
          </span>
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {machine.totals.processedTotal.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold text-muted-foreground">
        {machine.totals.eventsTotal.toLocaleString()}
      </TableCell>
      <TableCell colSpan={3} />
    </TableRow>
  )
}

export function WorkersTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: fetchWorkers,
    refetchInterval: 3000,
  })

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
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Processed</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead>Last market</TableHead>
            <TableHead className="text-right">Commit</TableHead>
            <TableHead className="text-right">Heartbeat</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {machines.map((m) => (
            <Fragment key={m.machineId}>
              <MachineHeaderRow machine={m} />
              {m.processes.map((p) => (
                <ProcessRow key={p.processKey} p={p} />
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
