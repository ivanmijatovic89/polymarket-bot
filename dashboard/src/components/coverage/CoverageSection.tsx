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
          title="Dataset coverage"
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
        title={meta.inputMode === 'recorder-v4' ? 'Recorder V4 coverage' : 'Telonex coverage'}
        subtitle={
          meta.metadataOnly
            ? `Saved selection and current archive metadata for ${meta.symbol}/${meta.timeframe}.`
            : `Run targeted ${meta.symbol}/${meta.timeframe} via ${meta.converter} (${meta.readFrom}). Compared against all eligible markets since ${new Date(meta.eligibleFromMs).toISOString().slice(0, 10)}.`
        }
        icon={Layers}
      />
      {meta.selectionSummary && (
        <Card className="space-y-2 p-4 text-sm">
          <p className="font-medium">Verified eligibility at the saved selection</p>
          <p>
            {meta.selectionSummary.eligible.toLocaleString()} eligible ·{' '}
            {meta.selectionSummary.selected.toLocaleString()} selected ·{' '}
            {meta.selectionSummary.excluded.toLocaleString()} excluded
          </p>
          <p className="text-xs text-muted-foreground">
            {meta.completedMarkets?.toLocaleString()} completed market results currently saved in
            this run. The selection snapshot is historical; later extensions can add results.
          </p>
        </Card>
      )}
      {meta.metadataOnly && (
        <p className="text-sm text-muted-foreground">
          Current catalog: manifest and official-resolution checks only, refreshed at most every
          five minutes. No event files are downloaded by this view.
          {Boolean(meta.unverifiedReferences) &&
            ` ${meta.unverifiedReferences} captures need event-level PTB verification and are not counted as eligible here. The backtest selector performs that verification before launching jobs.`}
        </p>
      )}
      {meta.exclusions && Object.keys(meta.exclusions).length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Excluded recordings</summary>
          <pre className="mt-2">{JSON.stringify(meta.exclusions, null, 2)}</pre>
        </details>
      )}
      {!meta.feedRequirementsRecorded && (
        <p className="text-sm text-muted-foreground">
          This older run did not record its feed requirements. Coverage shows orderbook availability
          only.
        </p>
      )}
      {!meta.unverifiedReferences && (
        <>
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
        </>
      )}
    </section>
  )
}
