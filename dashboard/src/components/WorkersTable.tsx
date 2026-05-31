'use client'

import { useQuery } from '@tanstack/react-query'
import { Cpu } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Skeleton } from './ui/skeleton'
import type { WorkerStats } from '@/lib/queries/workers'

async function fetchWorkers(): Promise<{ workers: WorkerStats[] }> {
  const r = await fetch('/api/workers', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/workers')
  return r.json()
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
  const workers = data?.workers ?? []
  if (workers.length === 0) {
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
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Processed</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead>Last market</TableHead>
            <TableHead className="text-right">Heartbeat</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((w) => (
            <TableRow key={w.name}>
              <TableCell className="font-mono text-xs">{w.name}</TableCell>
              <TableCell>
                {w.alive ? (
                  <Badge variant="success">
                    <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                    alive
                  </Badge>
                ) : (
                  <Badge variant="muted">stale</Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {w.processedTotal.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {w.eventsTotal.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {w.lastMarket ?? '—'}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                {w.heartbeatAgeMs !== null ? `${Math.round(w.heartbeatAgeMs / 1000)}s ago` : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
