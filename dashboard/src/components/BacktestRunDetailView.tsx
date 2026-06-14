'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  GitBranch,
  Terminal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { SectionHeading } from './SectionHeading'
import { CmdModal } from './CmdModal'
import { ChunkedSegmentsLive } from './ChunkedSegmentsLive'
import { CoverageSection } from './coverage/CoverageSection'
import { MachineName } from './MachineName'
import { cn, formatNumber, formatPnl } from '@/lib/utils'

/** Subset of the response fields the view actually consumes. */
type RunDetail = {
  id: number
  batchUid: string
  status: 'completed' | 'partial' | 'failed'
  strategy: string
  symbol: string | null
  timeframe: string | null
  inputMode: string | null
  params: Record<string, unknown>
  createdAt: string | Date
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
  inputMarketsTotal: number | null
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
    skipReason?: string | null
    pnl: number
    tradeCount: number
    tradeAsMaker: number
    tradeAsTaker: number
    feesPaid: number
    cost: number
    splitCost: number
    avgEntryPriceUp: number | null
    avgEntryPriceDown: number | null
    upShares: number
    downShares: number
    mergableShares: number
    execution?: {
      machineId: string
      durationMs: number
      eventsProcessed: number
    }
  }> | null
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

/** Dense single-line metric: label above, value below. Used in compact grids. */
function Metric({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'success' | 'destructive' | 'muted'
  hint?: React.ReactNode
}) {
  const toneClass =
    tone === 'success'
      ? 'text-[color:var(--success)]'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground'
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums leading-tight', toneClass)}>
        {value}
      </div>
      {hint !== undefined && hint !== null && hint !== '' && (
        <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{hint}</div>
      )}
    </div>
  )
}

function formatDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatParamValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function ParamsChips({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Params
        <span className="rounded bg-muted px-1 py-px font-mono text-[10px] normal-case tracking-normal text-muted-foreground/80">
          {entries.length}
        </span>
      </span>
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px]"
        >
          <span className="text-muted-foreground">{k}</span>
          <span className="text-muted-foreground/40">=</span>
          <span
            className="max-w-[240px] truncate font-medium text-foreground"
            title={formatParamValue(v)}
          >
            {formatParamValue(v)}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Per-market position cell: `<shares> @ <avg>` with optional `· <mrg> mrg` suffix. */
function renderPosition(
  shares: number,
  avgPrice: number | null,
  mergable: number,
): React.ReactNode {
  if (shares <= 0) return '—'
  const left = avgPrice !== null ? `${shares.toFixed(0)} @ ${avgPrice.toFixed(3)}` : `${shares.toFixed(0)}`
  return (
    <span>
      {left}
      {mergable > 0 && (
        <span className="ml-1 text-[11px]">· {mergable.toFixed(0)} mrg</span>
      )}
    </span>
  )
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

  const evTone =
    b.evPerMarketTotal === 0
      ? 'default'
      : b.evPerMarketTotal > 0
        ? 'success'
        : 'destructive'

  const makerPct =
    b.tradesMaker + b.tradesTaker > 0
      ? Math.round((b.tradesMaker / (b.tradesMaker + b.tradesTaker)) * 100)
      : null

  const marketStats = b.marketStats ?? []
  const failed = b.failedMarkets ?? []
  const selectedMarketsTotal = b.inputMarketsTotal ?? b.marketsTotal
  const missingAuditCount = Math.max(0, selectedMarketsTotal - marketStats.length - failed.length)
  const hasQuality = b.qualitySystem !== null || b.qualityTrade !== null

  return (
    <div className="space-y-8">
      <CmdModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        cmd={b.cmd}
        batchUid={b.batchUid}
      />

      {/* Header — identity, meta, params u 3 jasne zone. */}
      <Card>
        <CardHeader className="gap-3">
          {/* Zona 1: identity (title + badges) + actions */}
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge status={b.status} />
              <CardTitle className="text-base">{b.strategy}</CardTitle>
              {b.symbol && (
                <Badge variant="outline" className="uppercase">
                  {b.symbol}
                </Badge>
              )}
              {b.timeframe && <Badge variant="outline">{b.timeframe}</Badge>}
              {b.inputMode && (
                <Badge variant="outline" className="text-muted-foreground">
                  {b.inputMode}
                </Badge>
              )}
              {b.comment && (
                <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-xs italic text-muted-foreground">
                  {b.comment}
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
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
                title="Show launch command"
                aria-label="Show launch command"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Terminal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Zona 2: meta — id / batchUid / created */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="text-muted-foreground/60">id</span>
              <span className="text-foreground/80">#{b.id}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span
              className="max-w-[260px] truncate text-foreground/80"
              title={b.batchUid}
            >
              {b.batchUid}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(b.createdAt)}
            </span>
          </div>

          {/* Zona 3: params — vizuelno odvojen blok sa top borderom */}
          {Object.keys(b.params).length > 0 && (
            <div className="border-t pt-3">
              <ParamsChips params={b.params} />
            </div>
          )}
        </CardHeader>
      </Card>

      {/* KPI strip — hero (EV/PnL/ROI) prominent + 3 grupisane podsekcije.
          EV / market je primarna metrika jer su markets diskretne epizode i
          EV direktno govori "da li strategy zarađuje po prilici". */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(420px,1.1fr)_2fr]">
        {/* HERO card — EV (primary), PnL (total $), ROI (%) */}
        <Card
          className={cn(
            'overflow-hidden',
            evTone === 'success'
              ? 'bg-[color:var(--success)]/[0.04]'
              : evTone === 'destructive'
                ? 'bg-destructive/[0.04]'
                : '',
          )}
        >
          <div className="grid grid-cols-3 divide-x">
            {/* EV — total je primarno; per-mkt je sekundarni context */}
            <div className="px-4 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                EV total
              </div>
              <div
                className={cn(
                  'mt-1 text-3xl font-bold tabular-nums leading-none',
                  evTone === 'success'
                    ? 'text-[color:var(--success)]'
                    : evTone === 'destructive'
                      ? 'text-destructive'
                      : '',
                )}
              >
                {formatPnl(b.evPerMarketTotal)}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {formatPnl(b.evPerMarketPlayed)} per market
              </div>
            </div>

            {/* PnL total */}
            <div className="px-4 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                PnL total
              </div>
              <div
                className={cn(
                  'mt-1 inline-flex items-center gap-1.5 text-2xl font-bold tabular-nums leading-none',
                  pnlTone === 'success'
                    ? 'text-[color:var(--success)]'
                    : pnlTone === 'destructive'
                      ? 'text-destructive'
                      : '',
                )}
              >
                <PnlIcon className="h-4 w-4" />
                {formatPnl(b.pnlTotal)}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                fees {b.totalFeesPaid.toFixed(2)}
              </div>
            </div>

            {/* ROI */}
            <div className="px-4 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                ROI
              </div>
              <div
                className={cn(
                  'mt-1 text-2xl font-bold tabular-nums leading-none',
                  roiTone === 'success'
                    ? 'text-[color:var(--success)]'
                    : roiTone === 'destructive'
                      ? 'text-destructive'
                      : '',
                )}
              >
                {roiPct === null ? '—' : `${roiPct.toFixed(2)}%`}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {roiPct !== null
                  ? `${formatNumber(b.capitalInitial)} → ${formatNumber(b.capitalFinal)}`
                  : '—'}
              </div>
            </div>
          </div>
        </Card>

        {/* Grouped secondary metrics — Profit / Risk / Volume */}
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
            {/* PROFIT — EV je sad u Hero, ovde ostaju distribuciona svojstva */}
            <div>
              <div className="border-b bg-muted/30 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Profit dist.
              </div>
              <div className="grid grid-cols-2 divide-x">
                <Metric
                  label="Win rate"
                  value={`${b.winRatePct.toFixed(2)}%`}
                  tone="success"
                  hint={`${b.marketsWon}W / ${b.marketsLost}L`}
                />
                <Metric label="Avg W / L" value={pair(b.pnlAvgWin, b.pnlAvgLose)} />
              </div>
            </div>

            {/* RISK — 3 cells za simetriju sa Profit/Volume.
                "Streaks" objedinjuje W/L u jedan red sa toned brojevima. */}
            <div>
              <div className="border-b bg-muted/30 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Risk
              </div>
              <div className="grid grid-cols-3 divide-x">
                <Metric
                  label="Streaks"
                  value={
                    <span className="inline-flex items-baseline gap-1">
                      <span className="text-[color:var(--success)]">{b.streakMaxWin}W</span>
                      <span className="text-muted-foreground/60">/</span>
                      <span className="text-destructive">{b.streakMaxLose}L</span>
                    </span>
                  }
                  hint={`${formatPnl(b.streakMaxWinPnl)} / ${formatPnl(b.streakMaxLosePnl)}`}
                />
                <Metric label="Best mkt" value={formatPnl(b.pnlMaxWin)} tone="success" />
                <Metric label="Worst mkt" value={formatPnl(b.pnlMaxLose)} tone="destructive" />
              </div>
            </div>

            {/* VOLUME */}
            <div>
              <div className="border-b bg-muted/30 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Volume
              </div>
              <div className="grid grid-cols-3 divide-x">
                <Metric
                  label="Played"
                  value={formatNumber(b.marketsPlayed)}
                  hint={`of ${selectedMarketsTotal}`}
                />
                <Metric
                  label="Skipped"
                  value={formatNumber(b.marketsSkipped)}
                  tone="muted"
                  hint={
                    b.streakMaxSkipped > 0 ? `streak ${b.streakMaxSkipped}` : undefined
                  }
                />
                <Metric
                  label="Trades"
                  value={formatNumber(b.tradesTotal)}
                  hint={
                    makerPct === null ? undefined : `${makerPct}%m / ${100 - makerPct}%t`
                  }
                />
              </div>
            </div>
          </div>

          {/* Quality — thin inline footer row */}
          {hasQuality && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t bg-muted/20 px-4 py-2 text-xs">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Quality
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">system</span>
                <span className="font-semibold tabular-nums">
                  {b.qualitySystem === null ? '—' : b.qualitySystem.toFixed(3)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">trade</span>
                <span className="font-semibold tabular-nums">
                  {b.qualityTrade === null ? '—' : b.qualityTrade.toFixed(3)}
                </span>
              </span>
            </div>
          )}
        </Card>
      </section>

      {/* Failures inline warning */}
      {(b.failuresCount > 0 || missingAuditCount > 0) && (
        <Card className="border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">
              {b.failuresCount > 0
                ? `${b.failuresCount} failed markets`
                : `${missingAuditCount} markets missing audit rows`}
            </span>
            <span className="text-muted-foreground">
              — selected {selectedMarketsTotal}, persisted {marketStats.length}
              {b.failuresCount > 0 ? '; see Failed markets section below.' : '.'}
            </span>
          </div>
        </Card>
      )}

      {/* Telonex coverage — eligible vs covered. Renders only for telonex-mode runs. */}
      <CoverageSection id={b.id} />

      {/* Chunked segments — live computation, user-controlled window. */}
      <ChunkedSegmentsLive
        id={b.id}
        totals={{
          strategy: b.strategy,
          symbol: b.symbol,
          marketsTotal: b.marketsTotal,
          marketsPlayed: b.marketsPlayed,
          marketsSkipped: b.marketsSkipped,
          pnlTotal: b.pnlTotal,
          winRatePct: b.winRatePct,
          evPerMarketPlayed: b.evPerMarketPlayed,
          evPerMarketTotal: b.evPerMarketTotal,
          tradesTotal: b.tradesTotal,
          tradesMaker: b.tradesMaker,
          tradesTaker: b.tradesTaker,
          pnlAvgWin: b.pnlAvgWin,
          pnlAvgLose: b.pnlAvgLose,
          streakMaxWin: b.streakMaxWin,
          streakMaxLose: b.streakMaxLose,
          streakMaxWinPnl: b.streakMaxWinPnl,
          streakMaxLosePnl: b.streakMaxLosePnl,
          qualitySystem: b.qualitySystem,
          qualityTrade: b.qualityTrade,
          totalFeesPaid: b.totalFeesPaid,
          capitalInitial: b.capitalInitial,
          capitalFinal: b.capitalFinal,
        }}
      />

      {/* Per-market — dense breakdown */}
      <section>
        <SectionHeading
          title="Per-market"
          subtitle={`${marketStats.length} markets. Rows highlighted red ran > 10s.`}
          icon={Cpu}
        />
        <Card className="overflow-hidden">
          <div className="max-h-[600px] overflow-auto">
            <Table className="min-w-[1100px]">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">UP pos</TableHead>
                  <TableHead className="text-right">DOWN pos</TableHead>
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
                  const upPos = renderPosition(m.upShares, m.avgEntryPriceUp, m.mergableShares)
                  const downPos = renderPosition(m.downShares, m.avgEntryPriceDown, 0)
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground tabular-nums text-xs">
                        {i}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.slug ?? '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {m.skipReason ? (
                          <span className="text-muted-foreground italic">
                            {m.skipReason.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          String(m.finalOutcome ?? '—')
                        )}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', pnlClass)}>
                        {formatPnl(m.pnl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {m.feesPaid > 0 ? m.feesPaid.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {m.cost > 0 ? m.cost.toFixed(2) : '—'}
                        {m.splitCost > 0 && (
                          <span className="ml-1 text-[11px]">· {m.splitCost.toFixed(2)} split</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                        {m.tradeCount}
                        {m.tradeCount > 0 && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            · {m.tradeAsMaker}m/{m.tradeAsTaker}t
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {upPos}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {downPos}
                      </TableCell>
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

      {/* Failed markets — preserved */}
      {failed.length > 0 && (
        <section>
          <SectionHeading
            title="Failed markets"
            subtitle={`${failed.length} markets did not produce persisted market stats`}
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
