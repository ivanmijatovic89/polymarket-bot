'use client'

import { useEffect, useRef, useState } from 'react'
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
  plan?: string
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

function fmtLeft(iso: string): string {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

function fmtAt(iso: string): string {
  const resets = new Date(iso)
  const sameDay = resets.toDateString() === new Date().toDateString()
  const day = sameDay ? '' : resets.toLocaleDateString(undefined, { weekday: 'short' }) + ' '
  const time = resets.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `${day}${time}`
}

function WindowRow({ w }: { w: RateLimitWindow }) {
  const pct = w.percentUsed === null ? null : Math.min(100, Math.max(0, w.percentUsed))
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{w.label}</span>
        <span className="text-lg font-semibold tabular-nums">
          {pct === null ? '?' : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        {pct !== null && pct > 0 && (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: barColor(pct) }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">
          resets in <span className="font-semibold text-foreground">{fmtLeft(w.resetsAt)}</span>
        </span>
        <span className="text-muted-foreground">at {fmtAt(w.resetsAt)}</span>
      </div>
    </div>
  )
}

function AccountCard({ acc, stale }: { acc: AccountUsage; stale?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold tracking-tight">
        {acc.account}
        {acc.plan && <span className="ml-1.5 font-normal text-muted-foreground">({acc.plan})</span>}
      </h2>
      {acc.error ? (
        <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} />
          {acc.error}
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {acc.windows.map((w) => (
            <WindowRow key={w.label} w={w} />
          ))}
          {stale && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                style={{ color: 'var(--warning)' }}
              />
              refresh failed ({stale}) — showing last data
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const INTERVAL_KEY = 'llm-usage-refresh-seconds'
const INTERVAL_PRESETS = [
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 0, label: 'off' },
]

export function LlmUsageView() {
  const [intervalSec, setIntervalSec] = useState(60)
  const [customMode, setCustomMode] = useState(false)
  const showCustom = customMode || !INTERVAL_PRESETS.some((p) => p.value === intervalSec)

  // Load the persisted interval after mount (localStorage is client-only,
  // reading it during render would cause a hydration mismatch).
  useEffect(() => {
    const stored = window.localStorage.getItem(INTERVAL_KEY)
    if (stored !== null) {
      const sec = Number(stored)
      if (Number.isFinite(sec) && sec >= 0) setIntervalSec(sec)
    }
  }, [])

  function changeInterval(sec: number) {
    const clamped = sec > 0 ? Math.max(30, sec) : 0
    setIntervalSec(clamped)
    window.localStorage.setItem(INTERVAL_KEY, String(clamped))
  }

  const { data, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['llm-usage'],
    queryFn: fetchUsage,
    refetchInterval: intervalSec > 0 ? intervalSec * 1000 : false,
  })

  // Remember the last good result per account so a transient failure
  // (e.g. HTTP 429 from the provider) doesn't blank out a card.
  const lastGood = useRef<Map<string, AccountUsage>>(new Map())
  const accounts = (data ?? []).map((acc) => {
    if (!acc.error) {
      lastGood.current.set(acc.account, acc)
      return { acc, stale: undefined }
    }
    const cached = lastGood.current.get(acc.account)
    return cached ? { acc: cached, stale: acc.error } : { acc, stale: undefined }
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
            updated {new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hourCycle: 'h23' })}
          </span>
        )}
        {dataUpdatedAt > 0 && intervalSec > 0 && (
          <span>
            · next at{' '}
            {new Date(dataUpdatedAt + intervalSec * 1000).toLocaleTimeString(undefined, {
              hourCycle: 'h23',
            })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          auto-refresh
          <select
            // Some mobile browsers inject `__gcruniqueid` into select controls
            // before React hydrates. The attribute is browser-owned and harmless.
            suppressHydrationWarning
            value={showCustom ? -1 : intervalSec}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 0) {
                setCustomMode(false)
                changeInterval(v)
              } else {
                setCustomMode(true)
              }
            }}
            className="rounded-md border bg-background px-1.5 py-1 text-xs"
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value={-1}>custom…</option>
          </select>
          {showCustom && (
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={30}
                step={10}
                value={intervalSec}
                onChange={(e) => changeInterval(Number(e.target.value) || 30)}
                className="w-16 rounded-md border bg-background px-1.5 py-1 text-xs tabular-nums"
              />
              s
            </span>
          )}
        </span>
      </div>
      {error && (
        <div
          className="rounded-lg border bg-card p-4 text-xs"
          style={{ color: 'var(--destructive)' }}
        >
          {String(error)}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {accounts.map(({ acc, stale }) => (
          <AccountCard key={acc.account} acc={acc} stale={stale} />
        ))}
      </div>
    </div>
  )
}
