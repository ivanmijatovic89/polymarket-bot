'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, History, Terminal, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn, formatPnl, shortTime } from '@/lib/utils'
import { CmdModal } from './CmdModal'
import type { HistoricalBatch } from '@/lib/queries/batches'

export type BacktestsTableProps = {
  limit?: number
  strategy?: string
  symbol?: string
  status?: HistoricalBatch['status']
  /** Override the empty-state copy. */
  emptyHint?: string
}

async function fetchHistory(params: {
  limit: number
  strategy?: string
  symbol?: string
  status?: string
}): Promise<{ batches: HistoricalBatch[] }> {
  const sp = new URLSearchParams()
  sp.set('limit', String(params.limit))
  if (params.strategy) sp.set('strategy', params.strategy)
  if (params.symbol) sp.set('symbol', params.symbol)
  if (params.status) sp.set('status', params.status)
  const r = await fetch(`/api/batches/history?${sp.toString()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/history')
  return r.json()
}

/** Render a pair as `+a / −b` in tabular-nums. */
function pair(a: number, b: number): string {
  return `${formatPnl(a)} / ${formatPnl(b)}`
}

/** Compact integer formatter (e.g. 12345 → 12.3k). */
function compactInt(n: number): string {
  if (n < 1000) return n.toLocaleString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}

function StatusChip({ status }: { status: HistoricalBatch['status'] }) {
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

export function BacktestsTable({
  limit = 20,
  strategy,
  symbol,
  status,
  emptyHint,
}: BacktestsTableProps = {}) {
  const { data } = useQuery({
    queryKey: ['batches', 'history', { limit, strategy, symbol, status }],
    queryFn: () => fetchHistory({ limit, strategy, symbol, status }),
    refetchInterval: 10000,
  })
  const [cmdBatch, setCmdBatch] = useState<HistoricalBatch | null>(null)
  const batches = data?.batches ?? []
  if (batches.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <History className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium">No backtests found</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {emptyHint ?? 'Past runs will appear here.'}
        </p>
      </Card>
    )
  }
  return (
    <>
      <CmdModal
        open={cmdBatch !== null}
        onClose={() => setCmdBatch(null)}
        cmd={cmdBatch?.cmd ?? null}
        batchUid={cmdBatch?.batchUid ?? null}
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Batch</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="text-right">Markets</TableHead>
              <TableHead className="text-right">EV/mkt</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">Win&nbsp;rate</TableHead>
              <TableHead className="text-right">Avg&nbsp;W/L</TableHead>
              <TableHead className="text-right">Streak</TableHead>
              <TableHead className="text-right">Quality</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b, i) => {
              const pnlNum = typeof b.pnlTotal === 'number' ? b.pnlTotal : null
              const wr = typeof b.winRatePct === 'number' ? `${b.winRatePct.toFixed(2)}%` : '—'
              const uid = b.batchUid ?? ''
              const pnlTone =
                pnlNum === null
                  ? ''
                  : pnlNum >= 0
                    ? 'text-[color:var(--success)]'
                    : 'text-destructive'
              const Trend = pnlNum === null ? null : pnlNum >= 0 ? TrendingUp : TrendingDown
              const qS = b.qualitySystem
              const qT = b.qualityTrade
              const quality =
                qS === null && qT === null
                  ? '—'
                  : `${qS === null ? '—' : qS.toFixed(2)} / ${qT === null ? '—' : qT.toFixed(2)}`
              return (
                <TableRow key={`${uid}-${i}`}>
                  <TableCell>
                    <div className="flex items-start">
                      <div className="min-w-0">
                        {uid ? (
                          <Link
                            href={`/batches/${encodeURIComponent(uid)}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {uid}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {b.comment && (
                          <div
                            className="mt-0.5 truncate text-[11px] text-muted-foreground"
                            title={b.comment}
                          >
                            {b.comment}
                          </div>
                        )}
                        {b.failuresCount > 0 && (
                          <div className="text-[11px] text-destructive">
                            {b.failuresCount} failed
                          </div>
                        )}
                      </div>
                      <StatusChip status={b.status} />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{b.strategy}</TableCell>
                  <TableCell>
                    {b.symbol ? (
                      <Badge variant="outline" className="uppercase">
                        {b.symbol}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {b.limit !== null ? (
                      b.limit
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                    {b.marketsPlayed}
                    <span className="text-muted-foreground">/{b.marketsTotal}</span>
                    {b.marketsSkipped > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        · {b.marketsSkipped} skip
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                    {formatPnl(b.evPerMarketPlayed)}
                    <span className="text-muted-foreground">
                      {' / '}
                      {formatPnl(b.evPerMarketTotal)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                    {compactInt(b.tradesTotal)}
                    {b.tradesMaker + b.tradesTaker > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        · {compactInt(b.tradesMaker)}m/{compactInt(b.tradesTaker)}t
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums font-medium', pnlTone)}>
                    <span className="inline-flex items-center justify-end gap-1">
                      {Trend && <Trend className="h-3.5 w-3.5" />}
                      {formatPnl(pnlNum)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{wr}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                    {pair(b.pnlAvgWin, b.pnlAvgLose)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                    <span className="text-[color:var(--success)]">
                      {b.streakMaxWin}W&nbsp;{formatPnl(b.streakMaxWinPnl)}
                    </span>
                    {' / '}
                    <span className="text-destructive">
                      {b.streakMaxLose}L&nbsp;{formatPnl(b.streakMaxLosePnl)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                    {quality}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {b.totalFeesPaid.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {shortTime(b.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCmdBatch(b)}
                        className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        aria-label="Show reproduce command"
                        title="Show reproduce command"
                      >
                        <Terminal className="h-4 w-4" />
                      </button>
                      {uid && (
                        <Link
                          href={`/batches/${encodeURIComponent(uid)}`}
                          className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          aria-label="Open batch detail"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  )
}
