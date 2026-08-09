'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** TEMPORARY view — see the note in `page.tsx` for how to delete this feature. */

type LevelRow = {
  runId: number
  level: number
  batchUid: string
  status: string
  createdAtMs: number
  markets: number
  played: number
  wins: number
  losses: number
  pnl: number
  cost: number
}

type SessionRow = {
  runId: number
  number: number
  status: string
  action: string | null
  summary: string | null
  error: string | null
  startedAtMs: number | null
  finishedAtMs: number | null
  costUsd: number | null
  model: string | null
}

type PrefixSummary = {
  runId: number
  createdAtMs: number
  markets: number
  passedLevel: number
  pnlAtPassed: number
  playedAtPassed: number
  minPlayedAtPassed: number
  nextLevel: number | null
  nextShortfallUsd: number | null
  finalPnl: number
  finalPlayed: number
}

type Payload = {
  fetchedAtMs: number
  gitError: string | null
  prefix: PrefixSummary | null
  state: {
    status: string | null
    champion: string | null
    journal: string | null
    proposals: string | null
    inbox: string | null
  }
  levels: LevelRow[]
  run: {
    id: number
    name: string
    status: string
    machineId: string
    model: string | null
    effort: string | null
    maxSessions: number
    updatedAtMs: number
    sessionsDone: number
    costUsd: number | null
    inputTokens: number
    outputTokens: number
    allRuns: number
    allSessionsDone: number
    allCostUsd: number | null
  } | null
  sessions: SessionRow[]
}

const PARTICIPATION_FLOOR = 0.7

async function fetchData(): Promise<Payload> {
  const r = await fetch('/api/directional-game', { cache: 'no-store' })
  if (!r.ok) throw new Error('failed to fetch /api/directional-game')
  return r.json()
}

function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—'
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(digits)}`
}

function ago(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-400',
          tone === 'bad' && 'text-red-400',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  )
}

/** One bar per level, height ∝ total PnL. Red when the level total is negative. */
function LevelChart({ levels }: { levels: LevelRow[] }) {
  if (levels.length === 0) return null
  const max = Math.max(...levels.map((l) => Math.abs(l.pnl)), 1)
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-sm font-medium">Total PnL by level</div>
        <div className="text-xs text-muted-foreground">latest run per level</div>
      </div>
      <div className="flex h-40 items-end gap-[2px] overflow-x-auto">
        {levels.map((l) => (
          <div
            key={l.level}
            title={`L${l.level} · run ${l.runId} · ${usd(l.pnl)} · played ${l.played}/${l.markets}`}
            className="group flex min-w-[6px] flex-1 flex-col justify-end"
          >
            <div
              className={cn(
                'w-full rounded-sm transition-opacity group-hover:opacity-70',
                l.pnl >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70',
              )}
              style={{ height: `${Math.max(2, (Math.abs(l.pnl) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>L{levels[0]?.level}</span>
        <span>L{levels[levels.length - 1]?.level}</span>
      </div>
    </Card>
  )
}

function Doc({ title, body }: { title: string; body: string | null }) {
  const [open, setOpen] = useState(false)
  if (!body) return null
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">{open ? 'hide' : 'show'}</span>
      </button>
      {open ? (
        <pre className="mt-3 max-h-[600px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {body}
        </pre>
      ) : null}
    </Card>
  )
}

export function DirectionalGameView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['directional-game'],
    queryFn: fetchData,
    refetchInterval: 30_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <Card className="p-6 text-sm text-red-400">
        {error instanceof Error ? error.message : 'failed to load'}
      </Card>
    )
  }

  // Latest run per level, ascending by level.
  const byLevel = new Map<number, LevelRow>()
  for (const row of data.levels) if (!byLevel.has(row.level)) byLevel.set(row.level, row)
  const levels = [...byLevel.values()].sort((a, b) => a.level - b.level)

  const totalPlayed = levels.reduce((s, l) => s + l.played, 0)
  const wins = levels.reduce((s, l) => s + l.wins, 0)
  const losses = levels.reduce((s, l) => s + l.losses, 0)
  const run = data.run
  // Prefix scoring: the claimed level is where the run's contiguous PASS prefix
  // ends, not how many markets the run covers — see tools/prefixScan.ts.
  const prefix = data.prefix
  const prefixParticipation =
    prefix && prefix.passedLevel > 0 ? prefix.playedAtPassed / prefix.passedLevel : null

  const statusHeadline = (data.state.status ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Directional Game Opus</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Temporary protocol watch page · auto-refreshes every 30s · updated{' '}
            {ago(data.fetchedAtMs)}
            {data.gitError ? ' · git fetch failed (state may be stale)' : ''}
          </p>
        </div>
        {run ? (
          <span
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium',
              run.status === 'running'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            runtime run #{run.id} · {run.status}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Passed level (prefix)"
          value={prefix ? `L${prefix.passedLevel}` : '—'}
          hint={
            prefix
              ? `run ${prefix.runId} · ${prefix.markets}-market prefix · ${ago(prefix.createdAtMs)}` +
                (prefix.nextLevel
                  ? ` · L${prefix.nextLevel} short ${usd(prefix.nextShortfallUsd)}`
                  : '')
              : undefined
          }
        />
        <Stat
          label="PnL at passed level"
          value={prefix ? usd(prefix.pnlAtPassed) : '—'}
          tone={prefix && prefix.pnlAtPassed >= prefix.passedLevel ? 'good' : 'bad'}
          hint={
            prefix
              ? `floor ${usd(prefix.passedLevel)} · whole run ${usd(prefix.finalPnl)} over ${prefix.markets}`
              : undefined
          }
        />
        <Stat
          label="Participation at passed level"
          value={
            prefixParticipation === null ? '—' : `${(prefixParticipation * 100).toFixed(1)}%`
          }
          tone={
            prefixParticipation === null
              ? 'default'
              : prefixParticipation >= PARTICIPATION_FLOOR
                ? 'good'
                : 'bad'
          }
          hint={
            prefix
              ? `${prefix.playedAtPassed}/${prefix.passedLevel} played · floor ${prefix.minPlayedAtPassed} · run total ${prefix.finalPlayed}/${prefix.markets}`
              : undefined
          }
        />
        <Stat
          label="Sessions"
          value={run ? `${run.sessionsDone}/${run.maxSessions}` : '—'}
          hint={
            run
              ? `${run.model ?? '?'}${run.effort ? ` · ${run.effort}` : ''} · ${run.allSessionsDone} total over ${run.allRuns} run(s) · ${usd(run.allCostUsd)}`
              : undefined
          }
        />
      </div>

      {run ? (
        <Card className="p-4">
          <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Session budget</span>
            <span>
              {run.sessionsDone} of {run.maxSessions}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, (run.sessionsDone / Math.max(1, run.maxSessions)) * 100)}%`,
              }}
            />
          </div>
        </Card>
      ) : null}

      {statusHeadline.length > 0 ? (
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">STATUS.md — headline</div>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {statusHeadline.join('\n')}
          </pre>
        </Card>
      ) : null}

      <LevelChart levels={levels} />

      <Card className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Levels ({levels.length}) — win/loss counts are per played market
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>Level</th>
                <th>Run</th>
                <th>Status</th>
                <th className="text-right">Played</th>
                <th className="text-right">Part.</th>
                <th className="text-right">W/L</th>
                <th className="text-right">Capital</th>
                <th className="text-right">PnL</th>
                <th className="text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {[...levels].reverse().map((l) => {
                const part = l.markets > 0 ? l.played / l.markets : 0
                return (
                  <tr key={l.level} className="border-t [&>td]:px-3 [&>td]:py-1.5">
                    <td className="font-medium">L{l.level}</td>
                    <td className="font-mono text-muted-foreground">{l.runId}</td>
                    <td className="text-muted-foreground">{l.status}</td>
                    <td className="text-right tabular-nums">
                      {l.played}/{l.markets}
                    </td>
                    <td
                      className={cn(
                        'text-right tabular-nums',
                        part >= PARTICIPATION_FLOOR ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {(part * 100).toFixed(1)}%
                    </td>
                    <td className="text-right tabular-nums text-muted-foreground">
                      {l.wins}/{l.losses}
                    </td>
                    <td className="text-right tabular-nums text-muted-foreground">{usd(l.cost)}</td>
                    <td
                      className={cn(
                        'text-right tabular-nums font-medium',
                        l.pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {usd(l.pnl)}
                    </td>
                    <td className="text-right text-muted-foreground">{ago(l.createdAtMs)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          Across listed levels: {totalPlayed} played markets · {wins}W / {losses}L
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Sessions (newest first, last 60)
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>Run</th>
                <th>#</th>
                <th>Status</th>
                <th>Summary</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Finished</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr
                  key={`${s.runId}-${s.number}`}
                  className="border-t align-top [&>td]:px-3 [&>td]:py-1.5"
                >
                  <td className="font-mono text-muted-foreground">#{s.runId}</td>
                  <td className="font-medium tabular-nums">{s.number}</td>
                  <td
                    className={cn(
                      s.status === 'completed'
                        ? 'text-emerald-400'
                        : s.status === 'running'
                          ? 'text-blue-400'
                          : s.status === 'failed'
                            ? 'text-red-400'
                            : 'text-muted-foreground',
                    )}
                  >
                    {s.status}
                  </td>
                  <td className="max-w-[720px] text-muted-foreground">
                    {s.error ?? s.summary ?? s.action ?? '—'}
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">{usd(s.costUsd)}</td>
                  <td className="text-right text-muted-foreground">
                    {ago(s.finishedAtMs ?? s.startedAtMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3">
        <Doc title="STATUS.md (full)" body={data.state.status} />
        <Doc title="CHAMPION.md" body={data.state.champion} />
        <Doc title="JOURNAL.md" body={data.state.journal} />
        <Doc title="PROPOSALS.md" body={data.state.proposals} />
        <Doc title="INBOX.md" body={data.state.inbox} />
      </div>
    </div>
  )
}
