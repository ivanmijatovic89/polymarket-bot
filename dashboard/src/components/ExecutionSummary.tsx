import { Clock, Cpu } from 'lucide-react'
import { Card } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { SectionHeading } from './SectionHeading'
import { StatCard } from './StatCard'
import { MachineName } from './MachineName'
import { formatNumber } from '@/lib/utils'
import type { ExecutionSummary as ExecutionSummaryData } from '@/lib/queries/batches'

/** `1.4s` / `2.3m` / `1.05h` from a millisecond duration. */
function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  if (s < 3600) return `${(s / 60).toFixed(1)}m`
  return `${(s / 3600).toFixed(2)}h`
}

/**
 * Execution/timing breakdown for a single run: wall-clock speed plus a
 * per-machine table of how many events each box processed. Pure presentation
 * — the aggregate is computed in `buildExecutionSummary` from already-loaded
 * market rows (no extra DB cost). Renders nothing when no timing was recorded.
 */
export function ExecutionSummary({ summary }: { summary: ExecutionSummaryData | null }) {
  if (!summary || summary.marketsWithTiming === 0) return null

  const { wallClockMs, marketsWithTiming, eventsTotal, perMachine, spansExtension } = summary
  const wallClockSeconds = wallClockMs / 1000
  const wallClockEventsPerSec = wallClockSeconds > 0 ? eventsTotal / wallClockSeconds : null

  return (
    <section>
      <SectionHeading
        title="Execution"
        subtitle="Wall-clock speed and how many events each machine processed."
        icon={Cpu}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Wall-clock"
          value={formatDuration(wallClockMs)}
          icon={Clock}
          hint={spansExtension ? 'includes idle gaps (extended run)' : undefined}
          tone={spansExtension ? 'warning' : 'default'}
        />
        <StatCard
          label="Throughput"
          value={
            wallClockEventsPerSec !== null
              ? `${formatNumber(Math.round(wallClockEventsPerSec))}/s`
              : '—'
          }
          icon={Cpu}
          hint="wall-clock"
        />
        <StatCard label="Events" value={formatNumber(eventsTotal)} />
        <StatCard label="Markets timed" value={formatNumber(marketsWithTiming)} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Machine</TableHead>
              <TableHead className="text-right">Workers</TableHead>
              <TableHead className="text-right">Markets</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Wall rate</TableHead>
              <TableHead className="text-right">Per worker</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perMachine.map((m) => (
              <TableRow key={m.machineId}>
                <TableCell className="text-xs">
                  <MachineName machineId={m.machineId} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {m.workers ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(m.markets)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {formatNumber(m.eventsProcessed)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {wallClockSeconds > 0
                    ? `${formatNumber(Math.round(m.eventsProcessed / wallClockSeconds))}/s`
                    : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {wallClockSeconds > 0 && m.workers !== null && m.workers > 0
                    ? `${formatNumber(Math.round(m.eventsProcessed / wallClockSeconds / m.workers))}/s`
                    : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.sharePct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}
