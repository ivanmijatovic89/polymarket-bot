'use client'

import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { SearchableSelect } from './ui/searchable-select'
import {
  BACKTEST_SORT_OPTIONS,
  EMPTY_BACKTEST_FILTERS,
  changeBacktestFilter,
  type BacktestBrowseState,
  type BacktestFilters,
  type BacktestSort,
  type BacktestStatus,
} from '@/lib/backtestBrowse'

async function fetchFilterOptions(
  protocol: string,
  model: string,
  signal: AbortSignal,
): Promise<{
  protocols: string[]
  models: string[]
  strategies: string[]
  symbols: string[]
}> {
  const sp = new URLSearchParams()
  if (protocol) sp.set('protocol', protocol)
  if (model) sp.set('model', model)
  const response = await fetch(`/api/batches/filter-options?${sp}`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error('Could not load filter options.')
  return response.json()
}

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
]

export function BacktestsFilters({
  value,
  onChange,
}: {
  value: BacktestBrowseState
  onChange: (next: BacktestBrowseState) => void
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['batches', 'filter-options', value.protocol, value.model],
    queryFn: ({ signal }) => fetchFilterOptions(value.protocol, value.model, signal),
    staleTime: 60_000,
  })
  const update = <K extends keyof BacktestFilters>(key: K, next: BacktestFilters[K]) =>
    onChange(changeBacktestFilter(value, key, next))
  const options = (items: string[], any: string, uppercase = false) => [
    { value: '', label: any },
    ...items.map((item) => ({ value: item, label: uppercase ? item.toUpperCase() : item })),
  ]
  const hasActiveFilters =
    value.protocol || value.model || value.strategy || value.symbol || value.status
  const limits = [...new Set([25, 50, 100, 200, 500, value.limit])].sort((a, b) => a - b)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          label="Protocol filter"
          value={value.protocol}
          clearable
          disabled={isPending}
          options={options(data?.protocols ?? [], 'Any protocol')}
          onChange={(next) => update('protocol', next)}
          className="w-[210px] max-w-full"
        />
        <SearchableSelect
          label="Model filter"
          value={value.model}
          clearable
          disabled={isPending}
          options={options(data?.models ?? [], 'Any model')}
          onChange={(next) => update('model', next)}
          className="w-[180px] max-w-full"
        />
        <SearchableSelect
          label="Strategy filter"
          value={value.strategy}
          clearable
          disabled={isPending}
          options={options(data?.strategies ?? [], 'Any strategy')}
          onChange={(next) => update('strategy', next)}
          className="w-[290px] max-w-full"
        />
        <SearchableSelect
          label="Symbol filter"
          value={value.symbol}
          clearable
          disabled={isPending}
          options={options(data?.symbols ?? [], 'Any symbol', true)}
          onChange={(next) => update('symbol', next)}
          className="w-[125px] max-w-full"
        />
        <SearchableSelect
          label="Status filter"
          value={value.status}
          clearable
          options={STATUS_OPTIONS}
          onChange={(next) => update('status', next as BacktestStatus | '')}
          className="w-[140px] max-w-full"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...value, ...EMPTY_BACKTEST_FILTERS, page: 1, snapshot: undefined })
            }
            className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <SearchableSelect
            label="Sort order"
            value={value.sort}
            options={BACKTEST_SORT_OPTIONS}
            onChange={(sort) =>
              onChange({ ...value, sort: sort as BacktestSort, page: 1, snapshot: undefined })
            }
            className="w-[205px]"
          />
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <SearchableSelect
            label="Rows per page"
            value={String(value.limit)}
            options={limits.map((limit) => ({ value: String(limit), label: String(limit) }))}
            onChange={(limit) =>
              onChange({ ...value, limit: Number(limit), page: 1, snapshot: undefined })
            }
            className="w-[75px]"
          />
        </div>
      </div>
      {isError && (
        <p role="alert" className="text-xs text-destructive">
          Could not load filter options.{' '}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
    </div>
  )
}
