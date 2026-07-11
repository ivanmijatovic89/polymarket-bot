'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Terminal } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { shortTime } from '@/lib/utils'
import { BacktestSummaryTable } from './BacktestSummaryTable'
import { CmdModal } from './CmdModal'
import type { HistoricalBatch } from '@/lib/queries/batches'

export type BacktestsTableProps = {
  limit?: number
  strategy?: string
  symbol?: string
  status?: HistoricalBatch['status']
  emptyHint?: string
  /** Viewport-pinned header that follows page scroll. Only the full /backtests
   * page wants this; embeds keep a static header. */
  stickyHeader?: boolean
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

/**
 * Data-fetching wrapper around `BacktestSummaryTable`. Owns the query
 * for historical batches and injects:
 *  - leading cell: link to /backtests/[id] + comment subtitle + status chip
 *  - actions cell: CMD modal trigger + arrow link
 *  - trailing extra column: Created time
 */
export function BacktestsTable({
  limit = 20,
  strategy,
  symbol,
  status,
  emptyHint,
  stickyHeader,
}: BacktestsTableProps = {}) {
  const { data, isLoading } = useQuery({
    queryKey: ['batches', 'history', { limit, strategy, symbol, status }],
    queryFn: () => fetchHistory({ limit, strategy, symbol, status }),
    refetchInterval: 10000,
  })
  const [cmdBatch, setCmdBatch] = useState<HistoricalBatch | null>(null)

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>
    )
  }

  const batches = data?.batches ?? []
  return (
    <>
      <CmdModal
        open={cmdBatch !== null}
        onClose={() => setCmdBatch(null)}
        cmd={cmdBatch?.cmd ?? null}
        batchUid={cmdBatch?.batchUid ?? null}
      />
      <BacktestSummaryTable
        rows={batches}
        stickyHeader={stickyHeader}
        actionsHeader="CMD"
        emptyHint={emptyHint ?? 'Past runs will appear here.'}
        prefixColumns={[
          {
            header: '#ID',
            render: (b) => (
              <Link href={`/backtests/${b.id}`} className="font-mono text-xs hover:underline">
                #{b.id}
              </Link>
            ),
          },
        ]}
        extraColumns={[
          {
            header: 'Created',
            align: 'right',
            render: (b) => (
              <span className="text-xs text-muted-foreground">{shortTime(b.createdAt)}</span>
            ),
          },
        ]}
        renderLeading={(b) => (
          <div className="flex items-start">
            <div className="min-w-0">
              {b.batchUid ? (
                <Link
                  href={`/batches/${encodeURIComponent(b.batchUid)}`}
                  className="font-mono text-xs hover:underline"
                >
                  {b.batchUid}
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
                <div className="text-[11px] text-destructive">{b.failuresCount} failed</div>
              )}
            </div>
            <StatusChip status={b.status} />
          </div>
        )}
        renderActions={(b) => (
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
            <Link
              href={`/backtests/${b.id}`}
              className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Open backtest detail"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      />
    </>
  )
}
