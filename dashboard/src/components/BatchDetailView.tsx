'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Hash, Layers } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ProgressBar } from './ProgressBar'
import { SectionHeading } from './SectionHeading'
import { BacktestSummaryTable } from './BacktestSummaryTable'
import { cn, shortTime } from '@/lib/utils'

type ActiveSubmission = {
  batchUid: string
  submissionUid: string
  parentState: string
  strategy: string
  totalMarkets: number
  waitingChildren: number
  activeChildren: number
  completedChildren: number
  failedChildren: number
  failedChildrenValues: Record<string, unknown>
  comment: string | null
}

type BatchRun = {
  id: number
  batchUid: string
  submissionUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  symbol: string | null
  limit: number | null
  inputMarketsTotal: number | null
  comment: string | null
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  failuresCount: number
  pnlTotal: number
  winRatePct: number
  pnlAvgWin: number
  pnlAvgLose: number
  evPerMarketPlayed: number
  evPerMarketTotal: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  qualitySystem: number | null
  qualityTrade: number | null
  totalFeesPaid: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  createdAt: string
}

type BatchResponse =
  | {
      batchUid: string
      runs: BatchRun[]
      active: ActiveSubmission[]
    }
  | { error: string }

async function fetchBatch(uid: string): Promise<BatchResponse> {
  const r = await fetch(`/api/batches/${encodeURIComponent(uid)}`, { cache: 'no-store' })
  if (r.status === 404) return { error: 'batch not found' }
  if (!r.ok) throw new Error(`failed to fetch /api/batches/${uid}`)
  return r.json()
}

/**
 * Batch group view. A batch label groups N runs (e.g. every cell of one
 * param sweep) plus any submissions still in the queue. Per-run detail
 * lives at /backtests/[id].
 */
export function BatchDetailView({ batchUid }: { batchUid: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['batches', batchUid],
    queryFn: () => fetchBatch(batchUid),
    refetchInterval: (q) => {
      const d = q.state.data as BatchResponse | undefined
      return d && !('error' in d) && d.active.length > 0 ? 3000 : false
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

  const strategies = [...new Set(data.runs.map((r) => r.strategy))]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-mono">{data.batchUid}</CardTitle>
            <Badge variant="secondary">
              {data.runs.length} run{data.runs.length === 1 ? '' : 's'}
            </Badge>
            {data.active.length > 0 && (
              <Badge variant="warning">
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {data.active.length} in flight
              </Badge>
            )}
            {strategies.length > 0 && (
              <span className="text-xs text-muted-foreground">{strategies.join(', ')}</span>
            )}
          </div>
        </CardHeader>
      </Card>

      {data.active.map((a) => (
        <ActiveSubmissionCard key={a.submissionUid} data={a} />
      ))}

      {data.runs.length > 0 && (
        <section>
          <SectionHeading
            title="Runs"
            subtitle="Finalized database runs with this batch label."
            icon={Hash}
          />
          <BacktestSummaryTable
            rows={data.runs}
            prefixColumns={[
              {
                header: '#ID',
                render: (run) => (
                  <Link
                    href={`/backtests/${run.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    #{run.id}
                  </Link>
                ),
              },
            ]}
            extraColumns={[
              {
                header: 'Created',
                align: 'right',
                render: (run) => (
                  <span className="text-xs text-muted-foreground">{shortTime(run.createdAt)}</span>
                ),
              },
            ]}
            renderLeading={(run) => (
              <div className="flex items-start">
                <div className="min-w-0">
                  <Link
                    href={`/batches/${encodeURIComponent(run.batchUid)}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {run.batchUid}
                  </Link>
                  {run.comment && (
                    <div
                      className="mt-0.5 truncate text-[11px] text-muted-foreground"
                      title={run.comment}
                    >
                      {run.comment}
                    </div>
                  )}
                  {run.failuresCount > 0 && (
                    <div className="text-[11px] text-destructive">
                      {run.failuresCount} failed
                    </div>
                  )}
                </div>
                <StatusChip status={run.status} />
              </div>
            )}
            renderActions={(run) => (
              <Link
                href={`/backtests/${run.id}`}
                className="inline-flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Open backtest detail"
              >
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          />
        </section>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: BatchRun['status'] }) {
  if (status === 'completed') return null
  if (status === 'partial') {
    return (
      <Badge variant="warning" className="ml-2 align-middle">
        partial
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="ml-2 align-middle">
      failed
    </Badge>
  )
}

function ActiveSubmissionCard({ data }: { data: ActiveSubmission }) {
  const failedEntries = Object.entries(data.failedChildrenValues ?? {})
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="warning">
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {data.parentState}
          </Badge>
          <CardTitle className="text-base">{data.strategy}</CardTitle>
          <span className="font-mono text-[11px] text-muted-foreground">
            {data.submissionUid}
          </span>
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        {failedEntries.length > 0 && (
          <div className="mt-4">
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
          </div>
        )}
      </CardContent>
    </Card>
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
