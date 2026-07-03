'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Inbox } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ProgressBar } from './ProgressBar'
import type { ActiveBatchSummary } from '@/lib/queries/batches'

async function fetchActive(): Promise<{ batches: ActiveBatchSummary[] }> {
  const r = await fetch('/api/batches/active', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/active')
  return r.json()
}

export function ActiveBatchesTable() {
  const { data } = useQuery({
    queryKey: ['batches', 'active'],
    queryFn: fetchActive,
    refetchInterval: 3000,
  })
  const batches = data?.batches ?? []
  if (batches.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">No active batches</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Submit a new run with <code className="font-mono text-foreground">npm run backtest</code>
        </p>
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead className="min-w-[220px]">Progress</TableHead>
            <TableHead className="text-right">Done</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead>State</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow key={b.submissionUid}>
              <TableCell>
                <Link
                  href={`/batches/${encodeURIComponent(b.batchUid)}`}
                  className="font-mono text-xs hover:underline"
                >
                  {b.batchUid}
                </Link>
              </TableCell>
              <TableCell className="text-sm">{b.strategy}</TableCell>
              <TableCell>
                <ProgressBar
                  total={b.totalMarkets}
                  completed={b.completedChildren}
                  active={b.activeChildren}
                  failed={b.failedChildren}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">{b.completedChildren}</TableCell>
              <TableCell className="text-right tabular-nums text-[color:var(--warning)]">
                {b.activeChildren > 0 ? (
                  b.activeChildren
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {b.waitingChildren}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {b.failedChildren > 0 ? (
                  <span className="text-destructive font-medium">{b.failedChildren}</span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                  {b.parentState ?? '?'}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/batches/${encodeURIComponent(b.batchUid)}`}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
