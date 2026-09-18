'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { SearchableSelect } from './ui/searchable-select'
import {
  BACKTEST_METRIC_OPTIONS,
  type BacktestMetric,
  type BacktestNumericFilter,
} from '@/lib/backtestBrowse'

export function BacktestsNumericFilters({
  value,
  onChange,
}: {
  value: BacktestNumericFilter[]
  onChange: (next: BacktestNumericFilter[]) => void
}) {
  const [metric, setMetric] = useState<BacktestMetric>('markets-total')
  const [operator, setOperator] = useState<BacktestNumericFilter['operator']>('gt')
  const [input, setInput] = useState('')
  const threshold = input.trim() ? Number(input) : NaN
  const valid = Number.isFinite(threshold)
  const duplicate = value.some(
    (filter) =>
      filter.metric === metric && filter.operator === operator && filter.value === threshold,
  )

  return (
    <div className="space-y-2">
      <form
        aria-label="Add numeric condition"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid || duplicate) return
          onChange([...value, { metric, operator, value: threshold }])
          setInput('')
        }}
      >
        <span className="text-xs text-muted-foreground">Filter by value</span>
        <SearchableSelect
          label="Condition metric"
          value={metric}
          options={BACKTEST_METRIC_OPTIONS}
          onChange={(next) => setMetric(next as BacktestMetric)}
          className="w-[160px]"
        />
        <SearchableSelect
          label="Condition comparison"
          value={operator}
          options={[
            { value: 'gt', label: '> greater than' },
            { value: 'lt', label: '< less than' },
          ]}
          onChange={(next) => setOperator(next as BacktestNumericFilter['operator'])}
          className="w-[135px]"
        />
        <input
          type="number"
          step="any"
          aria-label="Condition value"
          placeholder="Value"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="h-8 w-[110px] rounded-md border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={!valid || duplicate}
          className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Add condition
        </button>
      </form>
      {value.length > 0 && (
        <div aria-label="Active numeric conditions" className="flex flex-wrap items-center gap-2">
          {value.map((filter, index) => {
            const label = `${BACKTEST_METRIC_OPTIONS.find((option) => option.value === filter.metric)?.label} ${filter.operator === 'gt' ? '>' : '<'} ${filter.value}`
            return (
              <button
                key={`${filter.metric}:${filter.operator}:${filter.value}:${index}`}
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="inline-flex items-center gap-1.5 rounded-md border bg-accent/50 px-2 py-1 text-xs hover:bg-accent"
              >
                {label} <X className="h-3 w-3" />
              </button>
            )
          })}
          <span className="text-xs text-muted-foreground">All conditions must match.</span>
        </div>
      )}
    </div>
  )
}
