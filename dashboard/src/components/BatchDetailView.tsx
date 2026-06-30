'use client'

import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  Hash,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ProgressBar } from './ProgressBar'
import { SectionHeading } from './SectionHeading'
import { StatCard } from './StatCard'
import { MachineName } from './MachineName'
import { ExecutionSummary } from './ExecutionSummary'
import { cn, formatNumber, formatPnl } from '@/lib/utils'
import type { ExecutionSummary as ExecutionSummaryData } from '@/lib/queries/batches'

type ActiveResponse = {
  batchUid: string
  active: true
  parentState: string
  strategy: string
  comment: string | null
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  failedChildrenValues: Record<string, unknown>
}

type CompletedResponse = {
  batchUid: string
  active: false
  batch: {
    strategy: string
    comment: string | null
    pnlTotal: number
    winRatePct: number
    tradesTotal: number
    marketsTotal: number
    marketsPlayed: number
    marketStats: Array<{
      slug: string | null
      finalOutcome: string | number | null
      pnl: number
      tradeCount: number
      execution?: {
        machineId: string
        workerChildId?: number | null
        durationMs: number
        eventsProcessed: number
      }
    }> | null
    executionSummary: ExecutionSummaryData | null
    failedMarkets: Array<{ idx: number | null; slug: string | null; reason: string }> | null
  }
}

type BatchResponse = ActiveResponse | CompletedResponse | { error: string }

async function fetchBatch(uid: string): Promise<BatchResponse> {
  const r = await fetch(`/api/batches/${encodeURIComponent(uid)}`, { cache: 'no-store' })
  if (r.status === 404) return { error: 'batch not found' }
  if (!r.ok) throw new Error(`failed to fetch /api/batches/${uid}`)
  return r.json()
}

export function BatchDetailView({ batchUid }: { batchUid: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['batches', batchUid],
    queryFn: () => fetchBatch(batchUid),
    refetchInterval: (q) => {
      const d = q.state.data as BatchResponse | undefined
      return d && 'active' in d && d.active ? 3000 : false
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  if (!data || 'error' in data) {
    return (
      <Card className="px-6 py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">Batch not found</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono">{batchUid}</span> isn&apos;t in the queue or the database.
        </p>
      </Card>
    )
  }
  return data.active ? <ActiveDetail data={data} /> : <CompletedDetail data={data} />
}

function ActiveDetail({ data }: { data: ActiveResponse }) {
  const failedEntries = Object.entries(data.failedChildrenValues ?? {})
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="warning">
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              {data.parentState}
            </Badge>
            <CardTitle className="text-base">{data.strategy}</CardTitle>
            {data.comment && (
              <span className="text-xs text-muted-foreground truncate">— {data.comment}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ProgressBar
            total={data.totalMarkets}
            completed={data.completedChildren}
            active={data.activeChildren}
            failed={data.failedChildren}
          />
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MetricMini label="Completed" value={data.completedChildren} tone="success" />
            <MetricMini label="Active" value={data.activeChildren} tone="warning" />
            <MetricMini label="Waiting" value={data.waitingChildren} tone="muted" />
            <MetricMini
              label="Failed"
              value={data.failedChildren}
              tone={data.failedChildren > 0 ? 'destructive' : 'muted'}
            />
            <MetricMini label="Total" value={data.totalMarkets} />
          </div>
        </CardContent>
      </Card>

      {failedEntries.length > 0 && (
        <section>
          <SectionHeading
            title="Failed children"
            subtitle={`${data.failedChildren} failed${
              data.failedChildren > failedEntries.length
                ? `, showing first ${failedEntries.length}`
                : ''
            }`}
            icon={AlertTriangle}
          />
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedEntries.map(([jobId, reason]) => (
                  <TableRow key={jobId}>
                    <TableCell className="font-mono text-xs">{jobId}</TableCell>
                    <TableCell className="text-destructive text-xs">
                      {String(reason).slice(0, 200)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  )
}

function MetricMini({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted'
}) {
  const toneStyles = {
    default: 'text-foreground',
    success: 'text-[color:var(--success)]',
    warning: 'text-[color:var(--warning)]',
    destructive: 'text-destructive',
    muted: 'text-muted-foreground',
  } as const
  return (
    <div className="rounded-lg border bg-background px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', toneStyles[tone])}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function CompletedDetail({ data }: { data: CompletedResponse }) {
  const { batch } = data
  const pnlNum = typeof batch.pnlTotal === 'number' ? batch.pnlTotal : null
  const pnlTone = pnlNum === null ? 'default' : pnlNum >= 0 ? 'success' : 'destructive'
  const wr = typeof batch.winRatePct === 'number' ? `${batch.winRatePct.toFixed(2)}%` : '—'
  const trades = typeof batch.tradesTotal === 'number' ? formatNumber(batch.tradesTotal) : '—'
  const totalMarkets = typeof batch.marketsTotal === 'number' ? String(batch.marketsTotal) : '—'
  const played = typeof batch.marketsPlayed === 'number' ? String(batch.marketsPlayed) : '—'

  const marketStats = batch.marketStats ?? []
  const failed = batch.failedMarkets ?? []

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3" />
              completed
            </Badge>
            <CardTitle className="text-base">{batch.strategy}</CardTitle>
            {batch.comment && (
              <span className="text-xs text-muted-foreground truncate">— {batch.comment}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="PnL total"
              value={
                <span className="inline-flex items-center gap-1">
                  {pnlNum !== null && pnlNum >= 0 && <TrendingUp className="h-5 w-5" />}
                  {pnlNum !== null && pnlNum < 0 && <TrendingDown className="h-5 w-5" />}
                  {formatPnl(pnlNum)}
                </span>
              }
              tone={pnlTone}
              icon={Trophy}
            />
            <StatCard label="Win rate" value={wr} icon={CheckCircle2} tone="success" />
            <StatCard
              label="Markets played"
              value={`${played}`}
              hint={`of ${totalMarkets}`}
              icon={Hash}
            />
            <StatCard label="Total trades" value={trades} icon={FileText} tone="muted" />
          </div>
        </CardContent>
      </Card>

      <ExecutionSummary summary={batch.executionSummary} />

      <section>
        <SectionHeading
          title="Per-market"
          subtitle={`${marketStats.length} markets. Rows highlighted red ran > 10s.`}
          icon={Cpu}
        />
        <Card className="overflow-hidden">
          <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketStats.map((m, i) => {
                  const exec = m.execution
                  const slow = exec && exec.durationMs > 10_000
                  const pnlClass =
                    m.pnl > 0 ? 'text-[color:var(--success)]' : m.pnl < 0 ? 'text-destructive' : ''
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground tabular-nums text-xs">
                        {i}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.slug ?? '—'}</TableCell>
                      <TableCell className="text-xs">{String(m.finalOutcome ?? '—')}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', pnlClass)}>
                        {formatPnl(m.pnl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.tradeCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {exec ? <MachineName machineId={exec.machineId} /> : '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums text-xs',
                          slow ? 'text-destructive font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {exec ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            {slow && <Clock className="h-3 w-3" />}
                            {exec.durationMs} ms
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {exec ? exec.eventsProcessed.toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </section>

      {failed.length > 0 && (
        <section>
          <SectionHeading
            title="Failed markets"
            subtitle={`${failed.length} markets exhausted retries`}
            icon={AlertTriangle}
          />
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failed.slice(0, 100).map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {f.idx ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.slug ?? '—'}</TableCell>
                    <TableCell className="text-destructive text-xs">
                      {f.reason.slice(0, 200)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  )
}
