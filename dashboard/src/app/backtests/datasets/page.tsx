import Link from 'next/link'
import { ChevronLeft, Database, Table2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionHeading } from '@/components/SectionHeading'
import { StatCard } from '@/components/StatCard'
import {
  getBacktestDatasetCoverage,
  type BacktestDatasetParams,
  type CoveragePeriod,
} from '@/lib/queries/backtestDatasets'

export const dynamic = 'force-dynamic'

const SYMBOLS = ['btc', 'eth', 'sol', 'xrp'] as const
const TIMEFRAMES = ['15m', '5m'] as const
const CONVERTERS = ['delta-typed', 'paired'] as const

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

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

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseParams(searchParams: { [key: string]: string | string[] | undefined }): BacktestDatasetParams {
  const symbol = firstValue(searchParams.symbol)
  const timeframe = firstValue(searchParams.timeframe)
  const converter = firstValue(searchParams.converter)

  return {
    symbol: SYMBOLS.includes(symbol as (typeof SYMBOLS)[number]) ? symbol! : 'btc',
    timeframe: TIMEFRAMES.includes(timeframe as (typeof TIMEFRAMES)[number]) ? timeframe! : '15m',
    converter: CONVERTERS.includes(converter as (typeof CONVERTERS)[number])
      ? (converter as BacktestDatasetParams['converter'])
      : 'delta-typed',
  }
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`
}

function DatasetControls({ params }: { params: BacktestDatasetParams }) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" method="get">
      <label className="space-y-1 text-xs text-muted-foreground">
        <span>Symbol</span>
        <select
          name="symbol"
          defaultValue={params.symbol}
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
        >
          {SYMBOLS.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        <span>Timeframe</span>
        <select
          name="timeframe"
          defaultValue={params.timeframe}
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
        >
          {TIMEFRAMES.map((timeframe) => (
            <option key={timeframe} value={timeframe}>
              {timeframe}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        <span>Conversion</span>
        <select
          name="converter"
          defaultValue={params.converter}
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
        >
          {CONVERTERS.map((converter) => (
            <option key={converter} value={converter}>
              {converter}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Apply
      </button>
    </form>
  )
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
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Telonex Markets</TableHead>
              <TableHead className="text-right">Local Ready</TableHead>
              <TableHead className="text-right">Local %</TableHead>
              <TableHead className="text-right">R2 Ready</TableHead>
              <TableHead className="text-right">R2 %</TableHead>
              <TableHead>First</TableHead>
              <TableHead>Last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {fmtInt(row.expected)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {fmtInt(row.telonexMarkets)}
                </TableCell>
                <TableCell className="text-right font-mono">{fmtInt(row.localReady)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {pct(row.localReadyPct)}
                </TableCell>
                <TableCell className="text-right font-mono">{fmtInt(row.r2Ready)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {pct(row.r2ReadyPct)}
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

export default async function BacktestDatasetsPage(props: { searchParams: PageSearchParams }) {
  const params = parseParams(await props.searchParams)
  const coverage = await getBacktestDatasetCoverage(params)
  const { summary } = coverage

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
          Telonex market availability against the selected conversion, grouped by calendar period.
        </p>
      </div>

      <DatasetControls params={params} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Telonex markets"
          value={fmtInt(summary.rawMarkets)}
          icon={Database}
          hint={`${params.symbol.toUpperCase()} ${params.timeframe}`}
        />
        <StatCard
          label="Local ready"
          value={fmtInt(summary.localReady)}
          hint={`${params.converter} done with local path`}
        />
        <StatCard
          label="R2 ready"
          value={fmtInt(summary.r2Ready)}
          hint={`${params.converter} done with R2 URL`}
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
          subtitle="Main benchmark view. Local and R2 readiness only check selected conversion output availability."
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
