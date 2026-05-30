export function ProgressBar({
  total,
  completed,
  active,
  failed,
}: {
  total: number
  completed: number
  active: number
  failed: number
}) {
  if (total <= 0) return <span className="text-muted text-xs">—</span>
  const pctDone = (completed / total) * 100
  const pctActive = (active / total) * 100
  const pctFailed = (failed / total) * 100
  return (
    <div>
      <div
        className="flex h-3.5 rounded overflow-hidden bg-border text-[10px] leading-[14px]"
        title={`${completed} done / ${active} active / ${failed} failed / ${total} total`}
      >
        {pctDone > 0 && <div style={{ width: `${pctDone}%`, background: 'var(--good)' }} />}
        {pctActive > 0 && <div style={{ width: `${pctActive}%`, background: 'var(--warn)' }} />}
        {pctFailed > 0 && <div style={{ width: `${pctFailed}%`, background: 'var(--bad)' }} />}
      </div>
      <div className="text-muted text-[11px] mt-1">
        {completed + active + failed} / {total} ({pctDone.toFixed(1)}% done)
      </div>
    </div>
  )
}
