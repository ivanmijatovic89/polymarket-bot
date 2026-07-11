'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { Card } from './ui/card'
import { Skeleton } from './ui/skeleton'
import { SectionHeading } from './SectionHeading'
import { BacktestSummaryTable } from './BacktestSummaryTable'
import { cn } from '@/lib/utils'
import type { ChunkSegmentRow } from '@/app/api/backtests/[id]/chunks/route'

export type ChunkedRunTotals = {
  marketsTotal: number
  marketsPlayed: number
  marketsSkipped: number
  pnlTotal: number
  winRatePct: number
  evPerMarketPlayed: number
  evPerMarketTotal: number
  tradesTotal: number
  tradesMaker: number
  tradesTaker: number
  pnlAvgWin: number
  pnlAvgLose: number
  streakMaxWin: number
  streakMaxLose: number
  streakMaxWinPnl: number
  streakMaxLosePnl: number
  qualitySystem: number | null
  qualityTrade: number | null
  totalFeesPaid: number
  capitalInitial: number
  capitalFinal: number
  strategy: string
  symbol: string | null
}

type SegmentKind = ChunkSegmentRow['segmentKind']

const KIND_TABS: Array<{ kind: SegmentKind; label: string; subtitle: string }> = [
  {
    kind: 'last_n',
    label: 'Last N',
    subtitle: 'Most recent N markets (sorted by market_start_ms desc).',
  },
  { kind: 'monthly', label: 'Monthly', subtitle: 'One row per calendar month (UTC).' },
  { kind: 'weekly', label: 'Weekly', subtitle: 'One row per ISO 8601 week.' },
  { kind: 'daily', label: 'Daily', subtitle: 'One row per UTC calendar day.' },
  { kind: 'all', label: 'All', subtitle: 'The full run as one segment (sanity check).' },
]

async function fetchSegments(
  id: number,
  kind: SegmentKind,
): Promise<{ segments: ChunkSegmentRow[] }> {
  const r = await fetch(`/api/backtests/${id}/chunks?kind=${kind}`, {
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`failed to fetch segments: ${r.status}`)
  return r.json()
}

function formatSegmentLabel(row: ChunkSegmentRow): string {
  if (row.segmentKind === 'last_n') return `last ${row.segmentKey}`
  return row.segmentKey
}

function formatSegmentRange(row: ChunkSegmentRow): string {
  const from = new Date(row.fromMs).toISOString().slice(0, 16).replace('T', ' ')
  const to = new Date(row.toMs).toISOString().slice(0, 16).replace('T', ' ')
  return `${from} → ${to}`
}

/**
 * Reads pre-computed segments from `backtest_run_segments` and renders one
 * row per segment. User picks the kind (last_n / daily / weekly / monthly /
 * all). No on-the-fly chunking.
 */
export function ChunkedSegmentsLive({ id, totals }: { id: number; totals: ChunkedRunTotals }) {
  const [kind, setKind] = useState<SegmentKind>('last_n')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['backtests', id, 'chunks', kind],
    queryFn: () => fetchSegments(id, kind),
  })

  const segments = data?.segments ?? []
  const subtitle = useMemo(
    () => KIND_TABS.find((t) => t.kind === kind)?.subtitle ?? '',
    [kind],
  )

  return (
    <section>
      <SectionHeading
        title="Segments"
        subtitle={subtitle}
        icon={Layers}
      />

      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        {KIND_TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setKind(t.kind)}
            className={cn(
              'rounded-md px-2 py-1 transition-colors',
              kind === t.kind
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {t.label}
          </button>
        ))}
        {isFetching && (
          <span className="ml-auto text-[11px] text-muted-foreground">loading…</span>
        )}
      </div>

      {isLoading ? (
        <Card className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </Card>
      ) : (
        <BacktestSummaryTable
          rows={segments}
          stickyHeader
          leadingHeader="Segment"
          emptyTitle="No segments"
          emptyHint={
            kind === 'last_n'
              ? 'Run has fewer markets than the smallest last-N bucket (500).'
              : 'No segments stored for this kind.'
          }
          renderLeading={(row) => (
            <div className="min-w-0">
              <div className="font-mono text-xs">{formatSegmentLabel(row)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatSegmentRange(row)}
              </div>
            </div>
          )}
          extraColumns={[
            {
              header: 'Capital',
              align: 'right',
              render: (row) => (
                <span className="tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                  {row.capitalInitial.toFixed(0)} → {row.capitalFinal.toFixed(0)}
                </span>
              ),
            },
          ]}
          footerRow={
            kind !== 'all' && segments.length > 0
              ? {
                  row: {
                    segmentKind: 'all',
                    segmentKey: 'all',
                    segmentOrd: 0,
                    fromMs: 0,
                    toMs: 0,
                    status: 'completed' as const,
                    strategy: totals.strategy,
                    symbol: totals.symbol,
                    marketsTotal: totals.marketsTotal,
                    marketsPlayed: totals.marketsPlayed,
                    marketsSkipped: totals.marketsSkipped,
                    failuresCount: 0,
                    pnlTotal: totals.pnlTotal,
                    winRatePct: totals.winRatePct,
                    pnlAvgWin: totals.pnlAvgWin,
                    pnlAvgLose: totals.pnlAvgLose,
                    evPerMarketPlayed: totals.evPerMarketPlayed,
                    evPerMarketTotal: totals.evPerMarketTotal,
                    streakMaxWin: totals.streakMaxWin,
                    streakMaxLose: totals.streakMaxLose,
                    streakMaxWinPnl: totals.streakMaxWinPnl,
                    streakMaxLosePnl: totals.streakMaxLosePnl,
                    qualitySystem: totals.qualitySystem,
                    qualityTrade: totals.qualityTrade,
                    totalFeesPaid: totals.totalFeesPaid,
                    tradesTotal: totals.tradesTotal,
                    tradesMaker: totals.tradesMaker,
                    tradesTaker: totals.tradesTaker,
                    capitalInitial: totals.capitalInitial,
                    capitalFinal: totals.capitalFinal,
                  } satisfies ChunkSegmentRow,
                  renderLeading: (
                    <div className="min-w-0">
                      <div className="font-mono text-xs">TOTAL</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        run aggregate ({segments.length} segments)
                      </div>
                    </div>
                  ),
                }
              : undefined
          }
        />
      )}
    </section>
  )
}
