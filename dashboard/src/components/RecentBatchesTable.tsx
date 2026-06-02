'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, History, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn, formatPnl, shortTime } from '@/lib/utils'
import type { HistoricalBatch } from '@/lib/queries/batches'

async function fetchHistory(): Promise<{ batches: HistoricalBatch[] }> {
  const r = await fetch('/api/batches/history?limit=20', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/history')
  return r.json()
}

export function RecentBatchesTable() {
  const { data } = useQuery({
    queryKey: ['batches', 'history'],
    queryFn: fetchHistory,
    refetchInterval: 10000,
  })
  const batches = data?.batches ?? []
  if (batches.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <History className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">No completed batches yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">Past runs will appear here.</p>
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
            <TableHead>Comment</TableHead>
            <TableHead className="text-right">PnL</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b, i) => {
            const pnlNum = typeof b.pnlTotal === 'number' ? b.pnlTotal : null
            const wr = typeof b.winRatePct === 'number' ? `${b.winRatePct.toFixed(2)}%` : '—'
            const uid = b.batchUid ?? ''
            const pnlTone =
              pnlNum === null
                ? ''
                : pnlNum >= 0
                  ? 'text-[color:var(--success)]'
                  : 'text-destructive'
            const Trend = pnlNum === null ? null : pnlNum >= 0 ? TrendingUp : TrendingDown
            return (
              <TableRow key={`${uid}-${i}`}>
                <TableCell>
                  {uid ? (
                    <Link
                      href={`/batches/${encodeURIComponent(uid)}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {uid}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{b.strategy}</TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[240px]">
                  {b.comment ?? '—'}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums font-medium', pnlTone)}>
                  <span className="inline-flex items-center justify-end gap-1">
                    {Trend && <Trend className="h-3.5 w-3.5" />}
                    {formatPnl(pnlNum)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{wr}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {shortTime(b.createdAt)}
                </TableCell>
                <TableCell>
                  {uid && (
                    <Link
                      href={`/batches/${encodeURIComponent(uid)}`}
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
