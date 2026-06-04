import Link from 'next/link'
import { ChevronLeft, Database, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionHeading } from '@/components/SectionHeading'
import { StatCard } from '@/components/StatCard'
import {
  getBacktestDatasetCoverage,
  type CoveragePeriod,
} from '@/lib/queries/backtestDatasets'

export const dynamic = 'force-dynamic'

function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function fmtDate(ms: number | null): string {
  if (ms === null) return 'n/a'
  const d = new Date(ms)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}, ${hh}:${min}`
}

function statusVariant(status: CoveragePeriod['status']): 'success' | 'warning' | 'muted' {
  if (status === 'complete') return 'success'
  if (status === 'overfull') return 'muted'
  return 'warning'
}

function CoverageTable({
  title,
  rows,
  limit,
}: {
  title: string
  rows: CoveragePeriod[]
  limit?: number
}) {
  const shown = typeof limit === 'number' ? rows.slice(-limit) : rows
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Markets</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>First</TableHead>
              <TableHead>Last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell className="text-right font-mono">{fmtInt(row.markets)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {fmtInt(row.expected)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.completenessPct.toFixed(2)}%
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {fmtDate(row.firstStartMs)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {fmtDate(row.lastStartMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default async function BacktestDatasetsPage() {
  const coverage = await getBacktestDatasetCoverage({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
  })
  const { summary, params } = coverage

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/backtests"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Backtests
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Backtest Datasets</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Eligible Telonex markets for backtest research, grouped by calendar period.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Backtest usable"
          value={fmtInt(summary.usableMarkets)}
          icon={Database}
          hint={`${params.symbol.toUpperCase()} ${params.timeframe} / ${params.converter} / ${params.readFrom}`}
        />
        <StatCard label="Raw Telonex" value={fmtInt(summary.rawMarkets)} hint="Matching slug set" />
        <StatCard
          label="Converted"
          value={fmtInt(summary.convertedMarkets)}
          hint="Conversion status done"
        />
        <StatCard
          label="Range"
          value={<span className="text-base">{fmtDate(summary.firstStartMs)}</span>}
          hint={`to ${fmtDate(summary.lastStartMs)}`}
        />
      </div>

      <section>
        <SectionHeading
          title="Months"
          subtitle="Main benchmark view. Counts use only markets that currently have a resolved outcome and selected converted dataset path."
          icon={Table2}
        />
        <CoverageTable title="Monthly Coverage" rows={coverage.byMonth} />
      </section>

      <section>
        <SectionHeading
          title="Weeks"
          subtitle="ISO week coverage, useful for spotting missing conversion windows."
          icon={Table2}
        />
        <CoverageTable title="Weekly Coverage" rows={coverage.byWeek} />
      </section>

      <section>
        <SectionHeading
          title="Days"
          subtitle={`Expected ${summary.expectedPerDay} markets per full day for 15m UP/DOWN markets.`}
          icon={Table2}
        />
        <CoverageTable title="Daily Coverage" rows={coverage.byDay} />
      </section>
    </div>
  )
}
