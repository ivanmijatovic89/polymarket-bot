'use client'

import { useMemo } from 'react'
import CalendarHeatmap from 'react-calendar-heatmap'
import 'react-calendar-heatmap/dist/styles.css'
import type { CoverageBucket } from './types'
import './coverage-heatmap.css'

const MS_PER_DAY = 24 * 60 * 60 * 1000

type Value = {
  date: string
  state: CoverageBucket['state']
  eligible: number
  covered: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function classForValue(v: Value | null | undefined): string {
  if (!v) return 'color-empty'
  if (v.state === 'full') return 'color-full'
  if (v.state === 'partial') return 'color-partial'
  return 'color-gap'
}

function titleForValue(v: Value | null | undefined): string {
  if (!v) return 'no eligible markets'
  return `${v.date} · ${v.covered}/${v.eligible} covered`
}

export function CoverageHeatmap({
  buckets,
  selectedDay,
  onSelectDay,
}: {
  buckets: CoverageBucket[]
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}) {
  const { startDate, endDate, values } = useMemo(() => {
    if (buckets.length === 0) {
      const today = new Date()
      return { startDate: today, endDate: today, values: [] as Value[] }
    }
    const first = new Date(buckets[0]!.startMs)
    const last = new Date(buckets[buckets.length - 1]!.startMs)
    return {
      startDate: first,
      endDate: last,
      values: buckets.map<Value>((b) => ({
        date: isoDay(b.startMs),
        state: b.state,
        eligible: b.eligible,
        covered: b.covered,
      })),
    }
  }, [buckets])

  if (buckets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No eligible markets in the configured range.</p>
    )
  }

  return (
    <div className="coverage-heatmap">
      <CalendarHeatmap
        startDate={startDate}
        endDate={new Date(endDate.getTime() + MS_PER_DAY)}
        values={values}
        showWeekdayLabels
        gutterSize={2}
        classForValue={(v) => {
          const value = v as Value | null
          const base = classForValue(value)
          if (value && selectedDay && value.date === selectedDay) return `${base} selected`
          return base
        }}
        titleForValue={(v) => titleForValue(v as Value | null)}
        onClick={(v) => {
          const value = v as Value | null
          if (!value) {
            onSelectDay(null)
            return
          }
          onSelectDay(selectedDay === value.date ? null : value.date)
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <LegendSwatch className="color-full" label="full" />
        <LegendSwatch className="color-partial" label="partial" />
        <LegendSwatch className="color-gap" label="empty (all missing)" />
        <span className="ml-2">Click a cell to filter the table below.</span>
        {selectedDay && (
          <button
            type="button"
            onClick={() => onSelectDay(null)}
            className="ml-auto text-xs text-foreground underline-offset-2 hover:underline"
          >
            Clear day filter
          </button>
        )}
      </div>
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`coverage-swatch ${className}`} />
      {label}
    </span>
  )
}
