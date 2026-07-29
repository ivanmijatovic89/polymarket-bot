'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronRight, Pause, Play, Plus, RefreshCw, Sparkles, Square, X } from 'lucide-react'
import { RuntimeStatusBadge } from '@/components/RuntimeStatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import type { RuntimeRun, RuntimeRunSummary } from '@/lib/runtimeTypes'

type RunsResponse = { runs: RuntimeRunSummary[] }
type ClaudeProfile = 'default' | 'balsa'
type ClaudeSmokeTemplate = {
  id: 'fable' | 'opus' | 'opus-5'
  label: string
  provider: 'claude'
  model: string
  description: string
}
type CodexSmokeTemplate = {
  id: 'gpt-5.6'
  label: string
  provider: 'codex'
  model: string
  description: string
}
type SmokeTemplate = ClaudeSmokeTemplate | CodexSmokeTemplate

const SMOKE_TEMPLATES: SmokeTemplate[] = [
  {
    id: 'fable',
    label: 'Fable',
    provider: 'claude',
    model: 'claude-fable-5',
    description: 'Claude Fable 5 · shared three-session mission',
  },
  {
    id: 'opus',
    label: 'Opus 4.8',
    provider: 'claude',
    model: 'claude-opus-4-8',
    description: 'Claude Opus 4.8 · shared three-session mission',
  },
  {
    id: 'opus-5',
    label: 'Opus 5',
    provider: 'claude',
    model: 'opus',
    description: 'Latest Claude Opus alias · shared three-session mission',
  },
  {
    id: 'gpt-5.6',
    label: 'GPT-5.6',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    description: 'Codex GPT-5.6 Sol · shared three-session mission',
  },
]

const SMOKE_WORKSPACE = 'shared-loop'
const SMOKE_SESSION_COUNT = 3
const fieldClass = 'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm'

export function MissionControlView({ examplesRoot }: { examplesRoot: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionRunId, setActionRunId] = useState<number | null>(null)
  const [startingTemplate, setStartingTemplate] = useState<SmokeTemplate['id'] | null>(null)
  const [claudeProfiles, setClaudeProfiles] = useState<
    Record<'fable' | 'opus' | 'opus-5', ClaudeProfile>
  >({
    fable: 'default',
    opus: 'default',
    'opus-5': 'default',
  })
  const [error, setError] = useState<string | null>(null)
  const {
    data,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['runtime-runs'],
    queryFn: () => runtimeFetch<RunsResponse>('/runs'),
    refetchInterval: 5000,
  })

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const values = new FormData(event.currentTarget)
    try {
      await runtimeFetch('/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          provider: values.get('provider'),
          model: values.get('model'),
          effort: values.get('effort'),
          accessMode: values.get('accessMode'),
          authHome: String(values.get('authHome') || '').trim() || null,
          workspacePath: values.get('workspacePath'),
          missionPath: values.get('missionPath'),
          maxSessions: Number(values.get('maxSessions')),
          delaySeconds: Number(values.get('delaySeconds')),
          statusFile: 'STATUS.md',
          journalFile: 'JOURNAL.md',
          inboxFile: 'INBOX.md',
          readOnlyFiles: String(values.get('readOnlyFiles') || '')
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      })
      setCreating(false)
      await queryClient.invalidateQueries({ queryKey: ['runtime-runs'] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function controlRun(runId: number, action: 'start' | 'pause' | 'resume' | 'stop') {
    setActionRunId(runId)
    setError(null)
    try {
      await runtimeFetch(`/runs/${runId}/${action}`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['runtime-runs'] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionRunId(null)
    }
  }

  async function startSmokeTest(template: SmokeTemplate) {
    setStartingTemplate(template.id)
    setError(null)
    const profile = template.provider === 'claude' ? claudeProfiles[template.id] : null
    const profileLabel = profile === 'balsa' ? 'Balsa' : 'default account'
    try {
      const stateDirectory = `.global-runtime/example-runs/${crypto.randomUUID()}`
      const created = await runtimeFetch<{ run: RuntimeRun }>('/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name:
            template.provider === 'claude'
              ? `Example: ${template.label} (${profileLabel})`
              : `Example: ${template.label}`,
          provider: template.provider,
          model: template.model,
          effort: 'low',
          accessMode: 'workspace-write',
          authHome:
            template.provider === 'claude' && profile === 'balsa' ? '~/.claude-balsa' : null,
          workspacePath: `${examplesRoot}/${SMOKE_WORKSPACE}`,
          missionPath: 'MISSION.md',
          maxSessions: SMOKE_SESSION_COUNT,
          delaySeconds: 0,
          statusFile: `${stateDirectory}/STATUS.md`,
          journalFile: `${stateDirectory}/JOURNAL.md`,
          inboxFile: `${stateDirectory}/INBOX.md`,
          readOnlyFiles: ['RESULT.md'],
        }),
      })
      await runtimeFetch(`/runs/${created.run.id}/start`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['runtime-runs'] })
      router.push(`/mission-control/${created.run.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setStartingTemplate(null)
    }
  }

  const runs = data?.runs ?? []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mission Control</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Durable Claude Code and Codex mission loops. Each session starts fresh from workspace
            files.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {creating ? 'Close' : 'New loop'}
          </button>
        </div>
      </div>

      {(error || queryError) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error || String(queryError)}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Shared loop example
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every model runs the same low-cost mission through three fresh sessions: continue,
            continue, complete.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {SMOKE_TEMPLATES.map((template) => {
            return (
              <Card key={template.id}>
                <CardContent className="space-y-3 py-4">
                  <div>
                    <div className="font-medium">{template.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                  </div>
                  {template.provider === 'claude' && (
                    <label className="block text-xs text-muted-foreground">
                      Claude account
                      <select
                        value={claudeProfiles[template.id]}
                        onChange={(event) =>
                          setClaudeProfiles((current) => ({
                            ...current,
                            [template.id]: event.target.value as ClaudeProfile,
                          }))
                        }
                        className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-sm text-foreground"
                      >
                        <option value="default">Default (normal claude login)</option>
                        <option value="balsa">Balsa (~/.claude-balsa)</option>
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => void startSmokeTest(template)}
                    disabled={startingTemplate !== null}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" />
                    {startingTemplate === template.id ? 'Starting…' : 'Start 3-session example'}
                  </button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {creating && (
        <Card>
          <CardContent className="py-5">
            <form onSubmit={createRun} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Name">
                <input name="name" required className={fieldClass} />
              </Field>
              <Field label="Provider">
                <select name="provider" defaultValue="codex" className={fieldClass}>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                </select>
              </Field>
              <Field label="Model">
                <input name="model" required placeholder="gpt-5.6-sol" className={fieldClass} />
              </Field>
              <Field label="Effort">
                <select name="effort" defaultValue="high" className={fieldClass}>
                  {['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Access">
                <select name="accessMode" defaultValue="workspace-write" className={fieldClass}>
                  <option value="workspace-write">Workspace write</option>
                  <option value="full-access">Full access</option>
                </select>
              </Field>
              <Field label="Auth home (optional)">
                <input name="authHome" placeholder="~/.codex-account" className={fieldClass} />
              </Field>
              <Field label="Workspace path" wide>
                <input
                  name="workspacePath"
                  required
                  placeholder="/absolute/path/to/workspace"
                  className={fieldClass}
                />
              </Field>
              <Field label="Mission file">
                <input
                  name="missionPath"
                  required
                  defaultValue="MISSION.md"
                  className={fieldClass}
                />
              </Field>
              <Field label="Maximum sessions">
                <input
                  name="maxSessions"
                  required
                  type="number"
                  min={1}
                  defaultValue={50}
                  className={fieldClass}
                />
              </Field>
              <Field label="Delay between sessions (seconds)">
                <input
                  name="delaySeconds"
                  required
                  type="number"
                  min={0}
                  defaultValue={20}
                  className={fieldClass}
                />
              </Field>
              <Field label="Additional read-only files (one per line)" wide>
                <textarea name="readOnlyFiles" rows={3} className={fieldClass} />
              </Field>
              <div className="flex items-end">
                <button
                  disabled={submitting}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create loop'}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {runs.map((run) => (
          <div key={run.id} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{run.name}</span>
                  <RuntimeStatusBadge status={run.status} />
                </div>
                <div className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-6">
                  <SummaryMetric label="Account" value={formatAccount(run)} />
                  <SummaryMetric label="Exact model" value={run.resolvedModel ?? run.model} mono />
                  <SummaryMetric
                    label="Duration"
                    value={formatDurationBetween(run.startedAt, run.endedAt)}
                  />
                  <SummaryMetric
                    label="Sessions"
                    value={`${run.currentSession} / ${run.maxSessions}`}
                  />
                  <SummaryMetric label="Tokens" value={formatRunTokens(run)} />
                  <SummaryMetric
                    label="Est. API cost"
                    value={formatUsd(run.totals.estimatedApiCostUsd)}
                  />
                </div>
                <div className="mt-2 truncate text-xs text-muted-foreground">
                  {run.workspacePath} · last activity {formatDate(run.lastActivityAt)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {run.status === 'idle' && (
                  <RunButton
                    label="Start"
                    icon={Play}
                    onClick={() => controlRun(run.id, 'start')}
                    disabled={actionRunId === run.id}
                  />
                )}
                {['running', 'pause_requested', 'rate_limited'].includes(run.status) && (
                  <RunButton
                    label="Pause"
                    icon={Pause}
                    onClick={() => controlRun(run.id, 'pause')}
                    disabled={actionRunId === run.id || run.status === 'pause_requested'}
                  />
                )}
                {['paused', 'waiting', 'stopped', 'error'].includes(run.status) && (
                  <RunButton
                    label="Resume"
                    icon={Play}
                    onClick={() => controlRun(run.id, 'resume')}
                    disabled={actionRunId === run.id}
                  />
                )}
                {!['idle', 'completed'].includes(run.status) && (
                  <RunButton
                    label="Stop"
                    icon={Square}
                    onClick={() => controlRun(run.id, 'stop')}
                    disabled={actionRunId === run.id}
                  />
                )}
                <Link
                  href={`/mission-control/${run.id}`}
                  aria-label={`Open ${run.name}`}
                  className="group ml-1 rounded-md border p-2 hover:bg-accent"
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        ))}
        {!isFetching && runs.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No loops yet.
          </div>
        )}
      </div>
    </div>
  )
}

function RunButton({
  label,
  icon: Icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: typeof Play }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className="rounded-md border p-2 hover:bg-accent disabled:opacity-50"
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`text-xs text-muted-foreground ${wide ? 'md:col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  )
}

function SummaryMetric({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-foreground ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

export async function runtimeFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/mission-control${path}`, { ...init, cache: 'no-store' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { hourCycle: 'h23' }) : '—'
}

function formatAccount(run: RuntimeRun): string {
  if (run.provider === 'claude') {
    if (!run.authHome) return 'Default Claude login'
    return run.authHome === '~/.claude-balsa'
      ? `Balsa (${run.authHome})`
      : `Claude profile (${run.authHome})`
  }
  return run.authHome ? `Codex profile (${run.authHome})` : 'Default Codex login'
}

function formatRunTokens(run: RuntimeRunSummary): string {
  const values = [
    run.totals.inputTokens,
    run.totals.cacheReadInputTokens,
    run.totals.cacheCreationInputTokens,
    run.totals.outputTokens,
  ]
  if (values.every((value) => value === null)) return '—'
  return values.reduce<number>((total, value) => total + (value ?? 0), 0).toLocaleString()
}

function formatDurationBetween(start: string | null, end: string | null): string {
  if (!start) return '—'
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  return formatDuration(Math.max(0, endMs - startMs))
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
}
