'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BacktestsTable } from '@/components/BacktestsTable'
import {
  BacktestsFilters,
  type BacktestsFilterValues,
} from '@/components/BacktestsFilters'
import type { HistoricalBatch } from '@/lib/queries/batches'

const DEFAULT_LIMIT = 100

function readState(sp: URLSearchParams): BacktestsFilterValues {
  const limitRaw = Number(sp.get('limit'))
  return {
    strategy: sp.get('strategy') ?? '',
    symbol: sp.get('symbol') ?? '',
    status: sp.get('status') ?? '',
    limit:
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
        : DEFAULT_LIMIT,
  }
}

function statePassedToTable(v: BacktestsFilterValues): {
  limit: number
  strategy?: string
  symbol?: string
  status?: HistoricalBatch['status']
} {
  const next: ReturnType<typeof statePassedToTable> = { limit: v.limit }
  if (v.strategy) next.strategy = v.strategy
  if (v.symbol) next.symbol = v.symbol
  if (v.status === 'completed' || v.status === 'partial' || v.status === 'failed') {
    next.status = v.status
  }
  return next
}

/**
 * /backtests browser: filter bar + full table. State is reflected in the URL
 * (`?strategy=…&symbol=…&status=…&limit=…`) so links and back/forward work.
 */
export function BacktestsBrowser() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<BacktestsFilterValues>(() =>
    readState(new URLSearchParams(searchParams?.toString() ?? '')),
  )

  // Keep state in sync if the URL changes externally (e.g. browser back).
  useEffect(() => {
    setFilters(readState(new URLSearchParams(searchParams?.toString() ?? '')))
    // We intentionally re-read whenever the searchParams object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.toString()])

  const update = useCallback(
    (next: BacktestsFilterValues) => {
      setFilters(next)
      const sp = new URLSearchParams()
      if (next.strategy) sp.set('strategy', next.strategy)
      if (next.symbol) sp.set('symbol', next.symbol)
      if (next.status) sp.set('status', next.status)
      if (next.limit !== DEFAULT_LIMIT) sp.set('limit', String(next.limit))
      const query = sp.toString()
      router.replace(query ? `/backtests?${query}` : '/backtests', { scroll: false })
    },
    [router],
  )

  const tableProps = statePassedToTable(filters)

  return (
    <div className="space-y-4">
      <BacktestsFilters value={filters} onChange={update} />
      <BacktestsTable
        {...tableProps}
        stickyHeader
        emptyHint="Try widening the filters or removing the symbol / strategy constraint."
      />
    </div>
  )
}
