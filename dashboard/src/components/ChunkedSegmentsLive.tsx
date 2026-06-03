'use client'

import { useState } from 'react'
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

const PRESETS = [96, 200, 300, 500, 1000, 2880]

async function fetchChunks(
  id: number,
  windowSize: number,
): Promise<{ window: number; segments: ChunkSegmentRow[] }> {
  const r = await fetch(`/api/backtests/${id}/chunks?window=${windowSize}`, {
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`failed to fetch chunks: ${r.status}`)
  return r.json()
}

/**
 * Live-computed chunked segments for a backtest run. Window size (markets
 * per chunk) is user-controlled — no DB read of stored chunkedBatchStats.
 * Each chunk renders as a row matching the persisted backtest summary.
 */
export function ChunkedSegmentsLive({ id, totals }: { id: number; totals: ChunkedRunTotals }) {
  const [windowSize, setWindowSize] = useState(96)
  const [inputValue, setInputValue] = useState('96')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['backtests', id, 'chunks', windowSize],
    queryFn: () => fetchChunks(id, windowSize),
  })

  const apply = (next: number) => {
    const clamped = Math.max(1, Math.min(10_000, Math.floor(next)))
    setWindowSize(clamped)
    setInputValue(String(clamped))
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }
  const onInputCommit = () => {
    const n = Number(inputValue)
    if (Number.isFinite(n) && n >= 1) apply(n)
    else setInputValue(String(windowSize))
  }

  const segments = data?.segments ?? []

  return (
    <section>
      <SectionHeading
        title="Chunked segments (live)"
        subtitle="Splits this run's markets into equal-size chunks and recomputes the full backtest summary per chunk. Trailing remainder rolls into the last chunk."
        icon={Layers}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="chunk-window">
          Window (markets per chunk):
        </label>
        <input
          id="chunk-window"
          type="number"
          min={1}
          max={10000}
          value={inputValue}
          onChange={onInputChange}
          onBlur={onInputCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="h-8 w-24 rounded-md border bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="ml-2 flex items-center gap-1 text-xs">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => apply(n)}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                windowSize === n
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {isFetching && (
          <span className="ml-auto text-[11px] text-muted-foreground">recomputing…</span>
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
          leadingHeader="Chunk"
          emptyTitle="No segments"
          emptyHint="This run has no markets to chunk."
          renderLeading={(row) => (
            <div className="min-w-0">
              <div className="font-mono text-xs">chunk #{row.chunkIndex + 1}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                markets {row.fromMarketIdx + 1}–{row.toMarketIdx + 1}
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
            segments.length > 0
              ? {
                  row: {
                    chunkIndex: -1,
                    fromMarketIdx: 0,
                    toMarketIdx: totals.marketsTotal - 1,
                    fromSlugTs: 0,
                    toSlugTs: 0,
                    status: 'completed' as const,
                    strategy: totals.strategy,
                    symbol: totals.symbol,
                    limit: totals.marketsTotal,
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
                        run aggregate ({segments.length} chunks)
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
