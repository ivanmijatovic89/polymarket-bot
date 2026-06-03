'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Flame,
  Gauge,
  GitBranch,
  Hash,
  Layers,
  PieChart,
  ShieldAlert,
  Sigma,
  Skull,
  Target,
  Terminal,
  TrendingDown,
  TrendingUp,
  Trophy,
  Waves,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { SectionHeading } from './SectionHeading'
import { StatCard } from './StatCard'
import { CmdModal } from './CmdModal'
import { cn, formatNumber, formatPnl } from '@/lib/utils'

/** Subset of the response fields the view actually consumes. */
type RunDetail = {
  id: number
  batchUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  symbol: string | null
  comment: string | null
  baselineId: string | null
  cmd: string | null
  pnlTotal: number
  capitalInitial: number
  capitalFinal: number
  totalFeesPaid: number
  winRatePct: number
  pnlAvgWin: number
  pnlAvgLose: number
  pnlMaxWin: number
  pnlMaxLose: number
  evPerMarketPlayed: number
  evPerMarketTotal: number
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  marketsWon: number
  marketsLost: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxSkipped: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  qualitySystem: number | null
  qualityTrade: number | null
  failuresCount: number
  marketStats: Array<{
    slug: string | null
    finalOutcome: string | number | null
    pnl: number
    tradeCount: number
    execution?: {
      machineId: string
      durationMs: number
      eventsProcessed: number
    }
  }> | null
  chunkedBatchStats: Record<string, unknown> | null
  failedMarkets: Array<{ idx: number | null; slug: string | null; reason: string }> | null
}

type RunResponse = { batch: RunDetail } | { error: string }

async function fetchRun(id: number): Promise<RunResponse> {
  const r = await fetch(`/api/backtests/${id}`, { cache: 'no-store' })
  if (r.status === 404) return { error: 'not found' }
  if (!r.ok) throw new Error(`failed to fetch /api/backtests/${id}`)
  return r.json()
}

function pair(a: number, b: number): string {
  return `${formatPnl(a)} / ${formatPnl(b)}`
}

function StatusBadge({ status }: { status: RunDetail['status'] }) {
  if (status === 'completed') {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        completed
      </Badge>
    )
  }
  if (status === 'partial') {
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3" />
        partial
      </Badge>
    )
  }
  return (
    <Badge variant="destructive">
      <AlertTriangle className="h-3 w-3" />
      failed
    </Badge>
  )
}

export function BacktestRunDetailView({ id }: { id: number }) {
  const [cmdOpen, setCmdOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['backtests', id],
    queryFn: () => fetchRun(id),
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
        <h3 className="mt-3 text-sm font-medium">Backtest run not found</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          id <span className="font-mono">{id}</span> isn&apos;t in the database.
        </p>
      </Card>
    )
  }

  const b = data.batch
  const pnlTone = b.pnlTotal === 0 ? 'default' : b.pnlTotal > 0 ? 'success' : 'destructive'
  const PnlIcon = b.pnlTotal === 0 ? Coins : b.pnlTotal > 0 ? TrendingUp : TrendingDown

  const roiPct =
    b.capitalInitial > 0
      ? ((b.capitalFinal - b.capitalInitial) / b.capitalInitial) * 100
      : null
  const roiTone = roiPct === null ? 'default' : roiPct >= 0 ? 'success' : 'destructive'

  const makerPct =
    b.tradesMaker + b.tradesTaker > 0
      ? Math.round((b.tradesMaker / (b.tradesMaker + b.tradesTaker)) * 100)
      : null

  // chunkedBatchStats shape: { windows: [{ window, segments: [...] }], version }
  const cbs = b.chunkedBatchStats
  const windowsHead = cbs && (cbs as { windows?: unknown }).windows
  const segmentsList = Array.isArray(windowsHead)
    ? (windowsHead[0] as { window?: unknown; segments?: unknown[] })
    : null
  const segments =
    segmentsList && Array.isArray(segmentsList.segments)
      ? (segmentsList.segments as Array<Record<string, unknown>>)
      : []

  const marketStats = b.marketStats ?? []
  const failed = b.failedMarkets ?? []
  const hasQuality = b.qualitySystem !== null || b.qualityTrade !== null

  return (
    <div className="space-y-8">
      <CmdModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        cmd={b.cmd}
        batchUid={b.batchUid}
      />

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={b.status} />
            <CardTitle className="text-base">{b.strategy}</CardTitle>
            {b.symbol && (
              <Badge variant="outline" className="uppercase">
                {b.symbol}
              </Badge>
            )}
            {b.comment && (
              <span className="text-xs text-muted-foreground">— {b.comment}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {b.baselineId && (
                <Link
                  href={`/backtests/${b.baselineId}`}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  title="Open baseline run"
                >
                  <GitBranch className="h-3 w-3" />
                  baseline #{b.baselineId}
                </Link>
              )}
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Terminal className="h-3 w-3" />
                command
              </button>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">
            id #{b.id} · {b.batchUid}
          </div>
        </CardHeader>
      </Card>

      {/* Profitability */}
      <section>
        <SectionHeading title="Profitability" icon={Trophy} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="PnL total"
            value={
              <span className="inline-flex items-center gap-1">
                {formatPnl(b.pnlTotal)}
              </span>
            }
            tone={pnlTone}
            icon={PnlIcon}
          />
          <StatCard
            label="ROI"
            value={roiPct === null ? '—' : `${roiPct.toFixed(2)}%`}
            tone={roiTone}
            icon={Gauge}
            hint={
              roiPct !== null
                ? `${formatNumber(b.capitalInitial)} → ${formatNumber(b.capitalFinal)}`
                : undefined
            }
          />
          <StatCard
            label="Win rate"
            value={`${b.winRatePct.toFixed(2)}%`}
            tone="success"
            icon={CheckCircle2}
            hint={`${b.marketsWon}W / ${b.marketsLost}L`}
          />
          <StatCard
            label="Avg W / L"
            value={pair(b.pnlAvgWin, b.pnlAvgLose)}
            icon={PieChart}
          />
          <StatCard
            label="EV / market"
            value={formatPnl(b.evPerMarketPlayed)}
            icon={Target}
            hint={`total ${formatPnl(b.evPerMarketTotal)}`}
          />
        </div>
      </section>

      {/* Risk */}
      <section>
        <SectionHeading title="Risk" icon={ShieldAlert} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Max win streak"
            value={`${b.streakMaxWin}W`}
            tone="success"
            icon={Flame}
            hint={formatPnl(b.streakMaxWinPnl)}
          />
          <StatCard
            label="Max lose streak"
            value={`${b.streakMaxLose}L`}
            tone="destructive"
            icon={Skull}
            hint={formatPnl(b.streakMaxLosePnl)}
          />
          <StatCard
            label="Best market"
            value={formatPnl(b.pnlMaxWin)}
            tone="success"
            icon={ArrowUpRight}
          />
          <StatCard
            label="Worst market"
            value={formatPnl(b.pnlMaxLose)}
            tone="destructive"
            icon={ArrowDownRight}
          />
        </div>
      </section>

      {/* Volume */}
      <section>
        <SectionHeading title="Volume" icon={Layers} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Markets played"
            value={String(b.marketsPlayed)}
            hint={`of ${b.marketsTotal}`}
            icon={Hash}
          />
          <StatCard
            label="Markets skipped"
            value={String(b.marketsSkipped)}
            tone="muted"
            icon={Waves}
            hint={
              b.streakMaxSkipped > 0 ? `longest streak ${b.streakMaxSkipped}` : undefined
            }
          />
          <StatCard
            label="Trades"
            value={formatNumber(b.tradesTotal)}
            icon={Sigma}
          />
          <StatCard
            label="Maker / Taker"
            value={
              makerPct === null
                ? '—'
                : `${makerPct}% / ${100 - makerPct}%`
            }
            tone="muted"
            icon={PieChart}
            hint={`${formatNumber(b.tradesMaker)} / ${formatNumber(b.tradesTaker)}`}
          />
          <StatCard
            label="Fees paid"
            value={b.totalFeesPaid.toFixed(2)}
            tone="muted"
            icon={Coins}
          />
        </div>
      </section>

      {/* Quality (only if at least one is non-null) */}
      {hasQuality && (
        <section>
          <SectionHeading title="Quality" icon={Award} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
            <StatCard
              label="System quality"
              value={b.qualitySystem === null ? '—' : b.qualitySystem.toFixed(3)}
              icon={Award}
            />
            <StatCard
              label="Trade quality"
              value={b.qualityTrade === null ? '—' : b.qualityTrade.toFixed(3)}
              icon={Award}
            />
          </div>
        </section>
      )}

      {/* Failures inline warning */}
      {b.failuresCount > 0 && (
        <Card className="border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{b.failuresCount} failed markets</span>
            <span className="text-muted-foreground">— see Failed markets section below.</span>
          </div>
        </Card>
      )}

      {/* Chunked segments — preserved */}
      {segments.length > 0 && (
        <section>
          <SectionHeading
            title="Chunked segments"
            subtitle={`window ${String(segmentsList?.window ?? '?')} — split metrics across run idx ranges`}
          />
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Range</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {segments.map((s, i) => {
                  const bs = (s as { batch_stats?: Record<string, unknown> }).batch_stats ?? {}
                  const sp = (bs as { pnlTotal?: number }).pnlTotal ?? null
                  const wr = (bs as { winRatePct?: number }).winRatePct ?? null
                  const tt = (bs as { tradesTotal?: number }).tradesTotal ?? null
                  const from = (s as { fromTs?: number }).fromTs
                  const to = (s as { toTs?: number }).toTs
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {String(from ?? '?')} – {String(to ?? '?')}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          sp !== null && sp > 0 && 'text-[color:var(--success)]',
                          sp !== null && sp < 0 && 'text-destructive',
                        )}
                      >
                        {sp !== null ? formatPnl(sp) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {wr !== null ? `${wr.toFixed(2)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tt !== null ? formatNumber(tt) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}

      {/* Per-market — preserved */}
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
                    m.pnl > 0
                      ? 'text-[color:var(--success)]'
                      : m.pnl < 0
                        ? 'text-destructive'
                        : ''
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
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {exec?.machineId ?? '—'}
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

      {/* Failed markets — preserved */}
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
