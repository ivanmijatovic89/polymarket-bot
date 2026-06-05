import { ArrowLeftToLine, ArrowRightToLine, AlignCenter, AlertOctagon, CheckCircle2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { cn } from '@/lib/utils'
import type { CoverageMeta, CoverageSummary } from './types'

function pct(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtDay(ms: number | null): string {
  if (ms === null) return '—'
  const d = new Date(ms)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1)
}

export function CoverageSummary({
  summary,
  meta,
}: {
  summary: CoverageSummary
  meta: CoverageMeta
}) {
  const longestDays = daysBetween(summary.longestContiguousGapStartMs, summary.longestContiguousGapEndMs)
  return (
    <div className="space-y-3">
      {/* Top line: filter meta */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">
          {meta.symbol}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {meta.timeframe}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {meta.converter}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {meta.readFrom}
        </Badge>
        <span className="ml-1">
          eligible from <span className="font-mono">{fmtDay(meta.eligibleFromMs)}</span>
        </span>
      </div>

      {/* Status: covered / missing */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip
          tone="success"
          icon={CheckCircle2}
          label={
            <>
              <span className="font-semibold tabular-nums">{fmt(summary.coveredTotal)}</span> covered
            </>
          }
          right={pct(summary.coveredTotal, summary.eligibleTotal)}
        />
        <SummaryChip
          tone={summary.missingTotal > 0 ? 'warning' : 'muted'}
          icon={AlertOctagon}
          label={
            <>
              <span className="font-semibold tabular-nums">{fmt(summary.missingTotal)}</span> missing
            </>
          }
          right={pct(summary.missingTotal, summary.eligibleTotal)}
        />
        <SummaryChip
          tone="muted"
          label={
            <>
              of <span className="font-semibold tabular-nums">{fmt(summary.eligibleTotal)}</span> eligible
            </>
          }
        />
      </div>

      {/* Distribution */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip
          tone="muted"
          icon={ArrowRightToLine}
          label={
            <>
              forward <span className="font-semibold tabular-nums">{fmt(summary.forwardGapCount)}</span>
            </>
          }
        />
        <SummaryChip
          tone="muted"
          icon={ArrowLeftToLine}
          label={
            <>
              backward <span className="font-semibold tabular-nums">{fmt(summary.backwardGapCount)}</span>
            </>
          }
        />
        <SummaryChip
          tone="muted"
          icon={AlignCenter}
          label={
            <>
              middle <span className="font-semibold tabular-nums">{fmt(summary.middleGapCount)}</span>
            </>
          }
        />
        {summary.longestContiguousGapCount > 0 && (
          <SummaryChip
            tone="warning"
            label={
              <>
                longest gap{' '}
                <span className="font-mono">{fmtDay(summary.longestContiguousGapStartMs)}</span>
                {' → '}
                <span className="font-mono">{fmtDay(summary.longestContiguousGapEndMs)}</span>
                {longestDays !== null && (
                  <span className="ml-1 text-muted-foreground">({longestDays}d)</span>
                )}
                <span className="ml-1 text-muted-foreground">
                  · {fmt(summary.longestContiguousGapCount)} markets
                </span>
              </>
            }
          />
        )}
        {summary.fullGapBucketCount > 0 && (
          <SummaryChip
            tone="warning"
            label={
              <>
                <span className="font-semibold tabular-nums">{fmt(summary.fullGapBucketCount)}</span>{' '}
                full-gap day{summary.fullGapBucketCount === 1 ? '' : 's'}
              </>
            }
          />
        )}
      </div>
    </div>
  )
}

type Tone = 'success' | 'warning' | 'muted'

function SummaryChip({
  tone,
  icon: Icon,
  label,
  right,
}: {
  tone: Tone
  icon?: React.ComponentType<{ className?: string }>
  label: React.ReactNode
  right?: string
}) {
  const toneClass =
    tone === 'success'
      ? 'border-[color:var(--success)]/30 bg-[color:var(--success)]/5 text-[color:var(--success)]'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400'
        : 'border-border/60 bg-muted/30 text-foreground/80'
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
        toneClass,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span>{label}</span>
      {right && <span className="ml-1 text-muted-foreground">· {right}</span>}
    </div>
  )
}
