'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight, RefreshCw, Terminal } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { cn, shortTime } from '@/lib/utils'
import { BacktestSummaryTable } from './BacktestSummaryTable'
import { CmdModal } from './CmdModal'
import type { HistoricalBatch, HistoricalBatchPage } from '@/lib/queries/batches'
import { BacktestsPagination } from './BacktestsPagination'
import { backtestBrowseParams, type BacktestSort } from '@/lib/backtestBrowse'

export type BacktestsTableProps = {
  limit?: number
  page?: number
  sort?: BacktestSort
  snapshot?: number
  onPageChange?: (page: number, snapshot?: number, replace?: boolean) => void
  protocol?: string
  model?: string
  strategy?: string
  symbol?: string
  status?: HistoricalBatch['status']
  emptyHint?: string
  /** Viewport-pinned header that follows page scroll. Only the full /backtests
   * page wants this; embeds keep a static header. */
  stickyHeader?: boolean
}

async function fetchHistory(
  params: BacktestsTableProps & { limit: number },
  signal: AbortSignal,
): Promise<HistoricalBatchPage> {
  const sp = backtestBrowseParams({
    protocol: params.protocol ?? '',
    model: params.model ?? '',
    strategy: params.strategy ?? '',
    symbol: params.symbol ?? '',
    status: params.status ?? '',
    limit: params.limit,
    page: params.page ?? 1,
    sort: params.sort ?? 'newest',
    snapshot: params.snapshot,
  })
  sp.set('limit', String(params.limit))
  const r = await fetch(`/api/batches/history?${sp.toString()}`, { cache: 'no-store', signal })
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
  page = 1,
  sort = 'newest',
  snapshot,
  onPageChange,
  protocol,
  model,
  strategy,
  symbol,
  status,
  emptyHint,
  stickyHeader,
}: BacktestsTableProps = {}) {
  const params = { limit, page, sort, snapshot, protocol, model, strategy, symbol, status }
  const { data, isLoading, isFetching, isPlaceholderData, isError, refetch } = useQuery({
    queryKey: ['batches', 'history', params],
    queryFn: ({ signal }) => fetchHistory(params, signal),
    placeholderData: keepPreviousData,
    refetchInterval: snapshot === undefined ? 10000 : false,
    refetchOnWindowFocus: snapshot === undefined,
  })
  const [cmdBatch, setCmdBatch] = useState<HistoricalBatch | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (data && !isPlaceholderData && !isError && data.page !== page) {
      onPageChange?.(data.page, data.snapshot, true)
    }
  }, [data, isPlaceholderData, isError, page, onPageChange])

  if (isError) {
    return (
      <Card className="p-6 text-sm" role="alert">
        Could not load backtests.{' '}
        <button type="button" onClick={() => void refetch()} className="underline">
          Retry
        </button>
      </Card>
    )
  }

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
  const pagination = (position: 'top' | 'bottom') =>
    data &&
    onPageChange && (
      <BacktestsPagination
        {...data}
        position={position}
        disabled={isPlaceholderData || isFetching}
        onPageChange={(next) => {
          onPageChange(next, data.snapshot)
          if (position === 'bottom') topRef.current?.scrollIntoView({ block: 'start' })
        }}
      />
    )
  return (
    <div ref={topRef} className="scroll-mt-20 space-y-3" aria-busy={isFetching}>
      {onPageChange && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {isPlaceholderData
              ? 'Updating results…'
              : snapshot !== undefined
                ? 'Refresh to include newly completed runs.'
                : 'Results update automatically.'}
          </span>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => {
              if (snapshot !== undefined || page !== 1) onPageChange(1, undefined)
              else void refetch()
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh results
          </button>
        </div>
      )}
      {pagination('top')}
      <CmdModal
        open={cmdBatch !== null}
        onClose={() => setCmdBatch(null)}
        cmd={cmdBatch?.cmd ?? null}
        batchUid={cmdBatch?.batchUid ?? null}
      />
      <div className={cn(isPlaceholderData && 'pointer-events-none opacity-50')}>
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
            {
              header: 'Protocol',
              render: (b) => (
                <span
                  className="block max-w-[160px] truncate font-mono text-[11px] text-muted-foreground"
                  title={b.protocol ?? 'Not recorded for this run'}
                >
                  {b.protocol ?? '—'}
                </span>
              ),
            },
            {
              header: 'Model',
              render: (b) => (
                <span
                  className="block max-w-[180px] truncate font-mono text-[11px] text-muted-foreground"
                  title={b.model ?? 'Not recorded for this run'}
                >
                  {b.model ?? '—'}
                </span>
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
              <div className="min-w-0 max-w-[380px]">
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
      </div>
      {pagination('bottom')}
    </div>
  )
}
