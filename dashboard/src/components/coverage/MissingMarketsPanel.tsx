'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { cn } from '@/lib/utils'
import type { CoverageGapSide, MissingSlugEntry } from './types'

const PAGE_SIZE = 50
const SIDES: Array<{ value: 'all' | CoverageGapSide; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'forward', label: 'Forward' },
  { value: 'backward', label: 'Backward' },
  { value: 'middle', label: 'Middle' },
]

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`
}

function sideTone(side: CoverageGapSide): 'default' | 'secondary' | 'outline' {
  if (side === 'forward') return 'secondary'
  if (side === 'middle') return 'outline'
  return 'outline'
}

export function MissingMarketsPanel({
  missing,
  selectedDay,
  onClearSelectedDay,
}: {
  missing: MissingSlugEntry[]
  selectedDay: string | null
  onClearSelectedDay: () => void
}) {
  const [side, setSide] = useState<'all' | CoverageGapSide>('all')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    let rows = missing
    if (selectedDay) rows = rows.filter((r) => r.bucketKey === selectedDay)
    if (side !== 'all') rows = rows.filter((r) => r.side === side)
    return rows
  }, [missing, side, selectedDay])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const start = clampedPage * PAGE_SIZE
  const visible = filtered.slice(start, start + PAGE_SIZE)

  if (missing.length === 0) {
    return (
      <Card className="px-4 py-6 text-center text-xs text-muted-foreground">
        No missing markets — this run covered every eligible market.
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-card p-0.5">
          {SIDES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setSide(s.value)
                setPage(0)
              }}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                side === s.value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {selectedDay && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
            day <span className="font-mono">{selectedDay}</span>
            <button
              type="button"
              onClick={onClearSelectedDay}
              className="ml-1 text-[11px] underline-offset-2 hover:underline"
            >
              clear
            </button>
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length.toLocaleString()} missing
          {filtered.length !== missing.length && ` of ${missing.length.toLocaleString()}`}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Market start (UTC)</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Side</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r, i) => (
                <TableRow key={r.slug}>
                  <TableCell className="text-muted-foreground tabular-nums text-xs">
                    {start + i + 1}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.slug}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtDate(r.marketStartMs)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.bucketKey}
                  </TableCell>
                  <TableCell>
                    <Badge variant={sideTone(r.side)} className="text-[11px]">
                      {r.side}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    No markets match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {clampedPage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={clampedPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <button
              type="button"
              disabled={clampedPage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
