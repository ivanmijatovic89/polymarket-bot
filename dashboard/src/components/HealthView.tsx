'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  Gauge,
  Layers,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { SectionHeading } from './SectionHeading'
import { cn } from '@/lib/utils'
import type { HealthCheck, HealthReport } from '@/lib/queries/health'
import type { LucideIcon } from 'lucide-react'

async function fetchHealth(): Promise<HealthReport> {
  // /api/health returns 503 when any check is "down" — read body either way.
  const r = await fetch('/api/health', { cache: 'no-store' })
  return r.json()
}

const ICONS: Record<string, LucideIcon> = {
  Redis: Server,
  MySQL: Database,
  'BullMQ queues': Layers,
  Workers: Gauge,
}

export function HealthView() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const downCount = data.checks.filter((c) => c.status === 'down').length
  const degradedCount = data.checks.filter((c) => c.status === 'degraded').length
  const overallTone: 'success' | 'warning' | 'destructive' =
    downCount > 0 ? 'destructive' : degradedCount > 0 ? 'warning' : 'success'
  const OverallIcon = downCount > 0 ? XCircle : degradedCount > 0 ? AlertTriangle : CheckCircle2
  const overallLabel =
    downCount > 0
      ? `${downCount} check${downCount === 1 ? '' : 's'} down`
      : degradedCount > 0
        ? `${degradedCount} check${degradedCount === 1 ? '' : 's'} degraded`
        : 'All systems operational'
  const checkedAgo = Math.max(0, Math.round((Date.now() - data.checkedAtMs) / 1000))

  return (
    <div className="space-y-6">
      <Card className={cn(downCount > 0 && 'border-destructive/40')}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg',
                  overallTone === 'success' &&
                    'bg-[color:var(--success)]/15 text-[color:var(--success)]',
                  overallTone === 'warning' &&
                    'bg-[color:var(--warning)]/15 text-[color:var(--warning)]',
                  overallTone === 'destructive' && 'bg-destructive/15 text-destructive',
                )}
              >
                <OverallIcon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">{overallLabel}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Last checked {checkedAgo}s ago · auto-refresh 5s
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
              {isFetching ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
            <Info
              label="Status"
              value={data.ok ? 'OK' : 'FAIL'}
              tone={data.ok ? 'success' : 'destructive'}
            />
            <Info label="Market queue" value={data.queues.market} mono />
            <Info label="Aggregate queue" value={data.queues.aggregate} mono />
            <Info label="Checks" value={`${data.checks.length}`} />
          </div>
        </CardContent>
      </Card>

      <section>
        <SectionHeading
          title="Checks"
          subtitle="Each component is probed with a lightweight call (PING, SELECT 1, queue counts)."
          icon={Activity}
        />
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.checks.map((c) => (
                <CheckRow key={c.name} check={c} />
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground">
        Raw JSON:{' '}
        <a
          href="/api/health"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          /api/health
          <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  )
}

function CheckRow({ check }: { check: HealthCheck }) {
  const Icon = ICONS[check.name] ?? Activity
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{check.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={check.status} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
        {check.latencyMs !== null ? `${check.latencyMs} ms` : '—'}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{check.detail}</TableCell>
    </TableRow>
  )
}

function StatusBadge({ status }: { status: HealthCheck['status'] }) {
  if (status === 'ok')
    return (
      <Badge variant="success">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        operational
      </Badge>
    )
  if (status === 'degraded')
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3" />
        degraded
      </Badge>
    )
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3" />
      down
    </Badge>
  )
}

function Info({
  label,
  value,
  tone = 'default',
  mono = false,
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'destructive'
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-sm font-medium',
          mono && 'font-mono text-xs',
          tone === 'success' && 'text-[color:var(--success)]',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  )
}
