'use client'

import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BacktestsFilterValues = {
  strategy: string
  symbol: string
  status: string
  limit: number
}

export type BacktestsFiltersProps = {
  value: BacktestsFilterValues
  onChange: (next: BacktestsFilterValues) => void
}

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
]

const LIMIT_OPTIONS = [50, 100, 200, 500]

async function fetchFilterOptions(): Promise<{ strategies: string[]; symbols: string[] }> {
  const r = await fetch('/api/batches/filter-options', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/batches/filter-options')
  return r.json()
}

/** Pure filter-bar — owns no state. Parent drives `value` and `onChange`. */
export function BacktestsFilters({ value, onChange }: BacktestsFiltersProps) {
  const { data } = useQuery({
    queryKey: ['batches', 'filter-options'],
    queryFn: fetchFilterOptions,
    staleTime: 60_000,
  })
  const strategies = data?.strategies ?? []
  const symbols = data?.symbols ?? []

  const hasActiveFilters = value.strategy || value.symbol || value.status

  const select =
    'h-8 rounded-md border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={select}
        value={value.strategy}
        onChange={(e) => onChange({ ...value, strategy: e.target.value })}
        aria-label="Strategy filter"
      >
        <option value="">Any strategy</option>
        {strategies.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        className={select}
        value={value.symbol}
        onChange={(e) => onChange({ ...value, symbol: e.target.value })}
        aria-label="Symbol filter"
      >
        <option value="">Any symbol</option>
        {symbols.map((s) => (
          <option key={s} value={s}>
            {s.toUpperCase()}
          </option>
        ))}
      </select>

      <select
        className={select}
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value })}
        aria-label="Status filter"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>Show</span>
        <select
          className={select}
          value={value.limit}
          onChange={(e) => onChange({ ...value, limit: Number(e.target.value) })}
          aria-label="Result limit"
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange({ strategy: '', symbol: '', status: '', limit: value.limit })}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground',
            'hover:text-foreground hover:bg-accent transition-colors',
          )}
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  )
}
