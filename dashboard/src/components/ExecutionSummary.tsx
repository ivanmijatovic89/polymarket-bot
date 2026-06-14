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
 * Execution/timing breakdown for a single run: wall-clock vs CPU time plus a
 * per-machine table of how much work each box did. Pure presentation — the
 * aggregate is computed in `buildExecutionSummary` from already-loaded market
 * rows (no extra DB cost). Renders nothing when no timing was recorded.
 */
export function ExecutionSummary({ summary }: { summary: ExecutionSummaryData | null }) {
  if (!summary || summary.marketsWithTiming === 0) return null

  const { wallClockMs, cpuTimeMs, marketsWithTiming, eventsTotal, perMachine, spansExtension } =
    summary
  const cpuSeconds = cpuTimeMs / 1000
  const eventsPerSec = cpuSeconds > 0 ? eventsTotal / cpuSeconds : null

  return (
    <section>
      <SectionHeading
        title="Execution"
        subtitle="Wall-clock vs CPU time, and how much each machine processed."
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
        <StatCard label="CPU time" value={formatDuration(cpuTimeMs)} icon={Cpu} tone="muted" />
        <StatCard label="Markets timed" value={formatNumber(marketsWithTiming)} />
        <StatCard
          label="Events"
          value={formatNumber(eventsTotal)}
          hint={eventsPerSec !== null ? `${formatNumber(Math.round(eventsPerSec))}/s` : undefined}
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Machine</TableHead>
              <TableHead className="text-right">Markets</TableHead>
              <TableHead className="text-right">CPU time</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perMachine.map((m) => (
              <TableRow key={m.machineId}>
                <TableCell className="text-xs">
                  <MachineName machineId={m.machineId} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(m.markets)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {formatDuration(m.cpuTimeMs)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {formatNumber(m.eventsProcessed)}
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
