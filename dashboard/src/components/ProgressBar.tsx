import { cn } from '@/lib/utils'

export function ProgressBar({
  total,
  completed,
  active,
  failed,
  showLabel = true,
  className,
}: {
  total: number
  completed: number
  active: number
  failed: number
  showLabel?: boolean
  className?: string
}) {
  if (total <= 0) return <span className="text-xs text-muted-foreground">—</span>
  const pctDone = (completed / total) * 100
  const pctActive = (active / total) * 100
  const pctFailed = (failed / total) * 100
  const done = completed + active + failed
  return (
    <div className={className}>
      <div
        className="relative flex h-1.5 overflow-hidden rounded-full bg-muted"
        title={`${completed} done · ${active} active · ${failed} failed · ${total} total`}
      >
        {pctDone > 0 && (
          <div
            style={{ width: `${pctDone}%`, background: 'var(--success)' }}
            className="transition-all"
          />
        )}
        {pctActive > 0 && (
          <div
            style={{ width: `${pctActive}%`, background: 'var(--warning)' }}
            className={cn('transition-all', pctActive > 0 && 'animate-pulse')}
          />
        )}
        {pctFailed > 0 && (
          <div
            style={{ width: `${pctFailed}%`, background: 'var(--destructive)' }}
            className="transition-all"
          />
        )}
      </div>
      {showLabel && (
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>
            {done.toLocaleString()} / {total.toLocaleString()}
          </span>
          <span>{pctDone.toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}
