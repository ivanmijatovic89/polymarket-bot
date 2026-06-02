import { Trophy } from 'lucide-react'
import { Card } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Badge } from './ui/badge'
import { shortTime } from '@/lib/utils'
import type { LeaderboardRow } from '@/lib/queries/leaderboard'

export type LeaderboardTableProps = {
  rows: LeaderboardRow[]
  /** Optional empty-state copy override. */
  emptyHint?: string
}

function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`
  return `${(seconds / 3600).toFixed(2)}h`
}

function formatRate(eventsPerSec: number | null): string {
  if (eventsPerSec === null) return '—'
  if (eventsPerSec >= 1000) return `${(eventsPerSec / 1000).toFixed(1)}k/s`
  return `${eventsPerSec.toFixed(0)}/s`
}

/**
 * Pure presentational table — no fetching, no client-only hooks. Pass it
 * rows from any source (server component, TanStack Query, mock data) and
 * it renders. Safe to embed on multiple pages.
 */
export function LeaderboardTable({ rows, emptyHint }: LeaderboardTableProps) {
  if (rows.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <Trophy className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">No machine activity yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {emptyHint ?? 'Run a backtest — rows aggregate by machine_id automatically.'}
        </p>
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead className="text-right">Markets</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">CPU time</TableHead>
            <TableHead className="text-right">Throughput</TableHead>
            <TableHead className="text-right">Commits</TableHead>
            <TableHead className="text-right">Last active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.machineId}>
              <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
              <TableCell className="font-mono text-xs">{r.machineId}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.marketsDone.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.eventsTotal.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {formatCpuTime(r.cpuSeconds)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {formatRate(r.eventsPerSec)}
              </TableCell>
              <TableCell className="text-right">
                {r.commitVersions > 1 ? (
                  <Badge variant="warning">{r.commitVersions}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.commitVersions}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {r.lastActiveMs !== null ? shortTime(new Date(r.lastActiveMs)) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
