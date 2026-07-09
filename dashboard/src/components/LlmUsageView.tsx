'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type RateLimitWindow = {
  label: string
  percentUsed: number | null
  resetsAt: string
}

type AccountUsage = {
  account: string
  windows: RateLimitWindow[]
  error?: string
}

async function fetchUsage(): Promise<AccountUsage[]> {
  const r = await fetch('/api/llm-usage', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/llm-usage')
  return r.json()
}

function barColor(pct: number): string {
  if (pct >= 85) return 'var(--destructive)'
  if (pct >= 60) return 'var(--warning)'
  return 'var(--success)'
}

function fmtReset(iso: string): string {
  const resets = new Date(iso)
  const minutes = Math.max(0, Math.floor((resets.getTime() - Date.now()) / 60_000))
  const left =
    minutes < 60
      ? `${minutes}m`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  const sameDay = resets.toDateString() === new Date().toDateString()
  const day = sameDay ? '' : resets.toLocaleDateString(undefined, { weekday: 'short' }) + ' '
  const time = resets.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `resets ${day}${time} (in ${left})`
}

function WindowRow({ w }: { w: RateLimitWindow }) {
  const pct = w.percentUsed === null ? null : Math.min(100, Math.max(0, w.percentUsed))
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{w.label}</span>
        <span className="tabular-nums font-medium">{pct === null ? '?' : `${Math.round(pct)}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        {pct !== null && pct > 0 && (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: barColor(pct) }}
          />
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{fmtReset(w.resetsAt)}</div>
    </div>
  )
}

function AccountCard({ acc }: { acc: AccountUsage }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold tracking-tight">{acc.account}</h2>
      {acc.error ? (
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
          {acc.error}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {acc.windows.map((w) => (
            <WindowRow key={w.label} w={w} />
          ))}
        </div>
      )}
    </div>
  )
}

export function LlmUsageView() {
  const { data, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['llm-usage'],
    queryFn: fetchUsage,
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-colors',
            'hover:bg-accent hover:text-foreground disabled:opacity-50',
          )}
        >
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
          Refresh
        </button>
        {dataUpdatedAt > 0 && (
          <span>
            updated{' '}
            {new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hourCycle: 'h23' })}
          </span>
        )}
      </div>
      {error && (
        <div className="rounded-lg border bg-card p-4 text-xs" style={{ color: 'var(--destructive)' }}>
          {String(error)}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((acc) => (
          <AccountCard key={acc.account} acc={acc} />
        ))}
      </div>
    </div>
  )
}
