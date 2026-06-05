'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { Card } from '../ui/card'
import { Skeleton } from '../ui/skeleton'
import { SectionHeading } from '../SectionHeading'
import { CoverageSummary } from './CoverageSummary'
import { CoverageHeatmap } from './CoverageHeatmap'
import { MissingMarketsPanel } from './MissingMarketsPanel'
import type { CoverageResponse } from './types'

async function fetchCoverage(id: number): Promise<CoverageResponse> {
  const r = await fetch(`/api/backtests/${id}/coverage`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`failed to fetch coverage for ${id}`)
  return r.json()
}

export function CoverageSection({ id }: { id: number }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['backtests', id, 'coverage'],
    queryFn: () => fetchCoverage(id),
  })

  if (isLoading) {
    return (
      <section>
        <SectionHeading
          title="Telonex coverage"
          subtitle="Eligible markets covered by this backtest."
          icon={Layers}
        />
        <Skeleton className="h-40 w-full" />
      </section>
    )
  }

  if (isError || !data) {
    return null
  }

  // Recorded-mode or legacy run — nothing to show.
  if (!data.available) return null

  const { meta, report } = data

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Telonex coverage"
        subtitle={`Run targeted ${meta.symbol}/${meta.timeframe} via ${meta.converter} (${meta.readFrom}). Compared against all eligible markets since ${new Date(meta.eligibleFromMs).toISOString().slice(0, 10)}.`}
        icon={Layers}
      />
      <Card className="space-y-4 p-4">
        <CoverageSummary summary={report.summary} meta={meta} />
        <CoverageHeatmap
          buckets={report.buckets}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />
      </Card>
      <MissingMarketsPanel
        missing={report.missingSlugs}
        selectedDay={selectedDay}
        onClearSelectedDay={() => setSelectedDay(null)}
      />
    </section>
  )
}
