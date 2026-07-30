'use client'

import { useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Pause, Play, Plus, RefreshCw, Sparkles, Square, X } from 'lucide-react'
import { RuntimeStatusBadge } from '@/components/RuntimeStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { runtimeFetch } from '@/lib/runtimeClient'
import {
  formatAccount,
  formatCompact,
  formatDurationBetween,
  formatNumber,
  formatRelative,
  formatUsd,
} from '@/lib/runtimeFormat'
import { cn } from '@/lib/utils'
import type { RuntimeRun, RuntimeRunSummary } from '@/lib/runtimeTypes'

type RunsResponse = { runs: RuntimeRunSummary[] }
type ProviderId = 'claude' | 'codex'
type ClaudeProfile = 'default' | 'balsa'
type ModelOption = { id: string; label: string; hint: string }

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
]

// Model ids the provider CLIs accept for `--model`. Aliases (e.g. `opus`) let a
// loop follow the newest model in a family without editing this list.
const EXAMPLE_MODELS: Record<ProviderId, ModelOption[]> = {
  claude: [
    { id: 'claude-opus-5', label: 'Opus 5', hint: 'Current Opus generation' },
    { id: 'claude-fable-5', label: 'Fable 5', hint: 'Most capable, highest cost' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Near-Opus quality, lower cost' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Fastest and cheapest' },
    { id: 'opus', label: 'Opus (alias)', hint: 'Whatever the CLI resolves as latest Opus' },
  ],
  codex: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: 'Highest capability tier' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', hint: 'Mid tier' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', hint: 'Cheapest tier' },
  ],
}

const DEFAULT_MODEL: Record<ProviderId, string> = {
  claude: 'claude-opus-5',
  codex: 'gpt-5.6-sol',
}

const ACTIVE_STATUSES = ['running', 'pause_requested', 'rate_limited']
const RESUMABLE_STATUSES = ['paused', 'waiting', 'stopped', 'error']
// Stop only makes sense while there is something to stop or hold: an active
// session, or a loop parked in waiting/paused. Stopping a run that is already
// stopped (or errored out) would only rewrite its recorded end state.
const STOPPABLE_STATUSES = [...ACTIVE_STATUSES, 'waiting', 'paused']
const SMOKE_WORKSPACE = 'shared-loop'
const SMOKE_SESSION_COUNT = 3
const fieldClass = 'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm'
const selectClass = 'rounded-md border bg-background px-2.5 py-2 text-sm text-foreground'

export function MissionControlView({ examplesRoot }: { examplesRoot: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionRunId, setActionRunId] = useState<number | null>(null)
  const [startingExample, setStartingExample] = useState(false)
  const exampleStartInFlight = useRef(false)
  const [provider, setProvider] = useState<ProviderId>('claude')
  const [modelByProvider, setModelByProvider] = useState<Record<ProviderId, string>>(DEFAULT_MODEL)
  const [claudeProfile, setClaudeProfile] = useState<ClaudeProfile>('default')
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

  const runs = useMemo(() => data?.runs ?? [], [data])
  const fleet = useMemo(
    () => ({
      active: runs.filter((run) => ACTIVE_STATUSES.includes(run.status)).length,
      sessions: runs.reduce((total, run) => total + run.currentSession, 0),
      cost: runs.reduce((total, run) => total + (run.totals.estimatedApiCostUsd ?? 0), 0),
    }),
    [runs],
  )

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
          // State-file names are defaulted by the runtime so the convention
          // lives in one place (src/global-runtime/types.ts).
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

  async function startExample() {
    if (exampleStartInFlight.current) return
    exampleStartInFlight.current = true
    setStartingExample(true)
    setError(null)
    const modelId = modelByProvider[provider]
    const model = EXAMPLE_MODELS[provider].find((option) => option.id === modelId)
    const isClaude = provider === 'claude'
    const profileLabel = claudeProfile === 'balsa' ? 'Balsa' : 'default account'
    try {
      const created = await runtimeFetch<{ run: RuntimeRun }>('/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: isClaude
            ? `Example: ${model?.label ?? modelId} (${profileLabel})`
            : `Example: ${model?.label ?? modelId}`,
          provider,
          model: modelId,
          effort: 'low',
          accessMode: 'workspace-write',
          authHome: isClaude && claudeProfile === 'balsa' ? '~/.claude-balsa' : null,
          workspacePath: `${examplesRoot}/${SMOKE_WORKSPACE}`,
          missionPath: 'MISSION.md',
          maxSessions: SMOKE_SESSION_COUNT,
          delaySeconds: 0,
          isolatedStateFiles: true,
          readOnlyFiles: ['RESULT.md'],
        }),
      })
      await runtimeFetch(`/runs/${created.run.id}/start`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['runtime-runs'] })
      router.push(`/mission-control/${created.run.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      exampleStartInFlight.current = false
      setStartingExample(false)
    }
  }

  const models = EXAMPLE_MODELS[provider]
  const selectedModel = models.find((option) => option.id === modelByProvider[provider])

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

      <Card>
        <CardContent className="py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Shared loop example
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Three fresh sessions — continue, continue, complete — over the same mission.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <span className="block text-xs text-muted-foreground">Provider</span>
              <div className="mt-1 flex rounded-md border p-0.5">
                {PROVIDERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setProvider(option.id)}
                    aria-pressed={provider === option.id}
                    className={cn(
                      'rounded px-3 py-1.5 text-sm transition-colors',
                      provider === option.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="example-model" className="block text-xs text-muted-foreground">
                Model
              </label>
              <select
                id="example-model"
                value={modelByProvider[provider]}
                suppressHydrationWarning
                onChange={(event) =>
                  setModelByProvider((current) => ({ ...current, [provider]: event.target.value }))
                }
                className={cn(selectClass, 'mt-1 block w-64 font-mono')}
              >
                {models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.id}
                  </option>
                ))}
              </select>
            </div>

            {provider === 'claude' && (
              <div>
                <label htmlFor="example-account" className="block text-xs text-muted-foreground">
                  Claude account
                </label>
                <select
                  id="example-account"
                  value={claudeProfile}
                  suppressHydrationWarning
                  onChange={(event) => setClaudeProfile(event.target.value as ClaudeProfile)}
                  className={cn(selectClass, 'mt-1 block w-48')}
                >
                  <option value="default">Default login</option>
                  <option value="balsa">Balsa (~/.claude-balsa)</option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => void startExample()}
              disabled={startingExample}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {startingExample ? 'Starting…' : 'Start 3-session example'}
            </button>
          </div>

          {selectedModel && (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="text-foreground">{selectedModel.label}</span> — {selectedModel.hint}.
              Runs at <span className="font-mono">low</span> effort with isolated state files.
            </p>
          )}
        </CardContent>
      </Card>

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
                  {['low', 'medium', 'high', 'xhigh', 'max', 'ultracode', 'ultra'].map((value) => (
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

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-3 py-2.5 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">{runs.length}</span> loops
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">{fleet.active}</span> active
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">{fleet.sessions}</span>{' '}
              sessions run
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {formatUsd(fleet.cost)}
              </span>{' '}
              est. API cost
            </span>
          </div>

          <Table containerClassName="max-w-full" className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Loop</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} className="align-top">
                  <TableCell className="max-w-[22rem]">
                    <Link
                      href={`/mission-control/${run.id}`}
                      className="font-medium hover:underline"
                    >
                      {run.name}
                    </Link>
                    <div
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={`${run.workspacePath}/${run.missionPath}`}
                    >
                      #{run.id} · {shortenPath(run.workspacePath)} · {run.missionPath}
                    </div>
                  </TableCell>

                  <TableCell className="max-w-[16rem]">
                    <div className="flex flex-wrap items-center gap-1">
                      <RuntimeStatusBadge status={run.status} />
                      {run.accessMode === 'full-access' && (
                        <Badge variant="warning">full access</Badge>
                      )}
                    </div>
                    {statusDetail(run) && (
                      <div
                        className={cn(
                          'mt-1 line-clamp-2 text-[11px]',
                          run.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                        title={statusDetail(run) ?? undefined}
                      >
                        {statusDetail(run)}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs whitespace-nowrap">
                      {run.resolvedModel ?? run.model}
                    </div>
                    <div className="mt-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
                      {run.provider === 'claude' ? 'Claude Code' : 'Codex'} · {run.effort}
                      {run.resolvedModel && run.resolvedModel !== run.model
                        ? ` · asked ${run.model}`
                        : ''}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs whitespace-nowrap">{formatAccount(run)}</TableCell>

                  <TableCell className="text-right">
                    <div className="text-xs tabular-nums">
                      {run.currentSession} / {run.maxSessions}
                    </div>
                    <div className="mt-1 ml-auto h-1 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.min(100, Math.round((run.currentSession / Math.max(1, run.maxSessions)) * 100))}%`,
                        }}
                      />
                    </div>
                  </TableCell>

                  <TableCell className="text-right whitespace-nowrap">
                    <div className="text-xs tabular-nums">
                      {formatDurationBetween(run.startedAt, run.endedAt)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {run.lastActivityAt ? `active ${formatRelative(run.lastActivityAt)}` : '—'}
                    </div>
                  </TableCell>

                  <TableCell className="text-right whitespace-nowrap">
                    <div className="text-xs tabular-nums" title={tokenBreakdown(run)}>
                      {formatCompact(totalTokens(run))}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {formatCompact(run.totals.inputTokens)}i ·{' '}
                      {formatCompact(run.totals.cacheReadInputTokens)}r ·{' '}
                      {formatCompact(run.totals.outputTokens)}o
                    </div>
                  </TableCell>

                  <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                    {formatUsd(run.totals.estimatedApiCostUsd)}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {run.status === 'idle' && (
                        <RunButton
                          label="Start"
                          icon={Play}
                          onClick={() => controlRun(run.id, 'start')}
                          disabled={actionRunId === run.id}
                        />
                      )}
                      {ACTIVE_STATUSES.includes(run.status) && (
                        <RunButton
                          label="Pause"
                          icon={Pause}
                          onClick={() => controlRun(run.id, 'pause')}
                          disabled={actionRunId === run.id || run.status === 'pause_requested'}
                        />
                      )}
                      {RESUMABLE_STATUSES.includes(run.status) && (
                        <RunButton
                          label="Resume"
                          icon={Play}
                          onClick={() => controlRun(run.id, 'resume')}
                          disabled={actionRunId === run.id}
                        />
                      )}
                      {STOPPABLE_STATUSES.includes(run.status) && (
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!isFetching && !queryError && runs.length === 0 && (
            <div className="px-3 py-12 text-center text-sm text-muted-foreground">
              No loops yet. Start the shared example above, or create one with{' '}
              <span className="font-medium text-foreground">New loop</span>.
            </div>
          )}
        </CardContent>
      </Card>
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

// The runtime surfaces one reason at a time: a pending retry beats a stale
// error, and an error beats the previous session's summary.
function statusDetail(run: RuntimeRunSummary): string | null {
  if (run.status === 'rate_limited' && run.nextStartAt) {
    return `retry ${formatRelative(run.nextStartAt)}`
  }
  return run.lastError ?? run.lastResultSummary ?? null
}

function shortenPath(value: string): string {
  const segments = value.split('/').filter(Boolean)
  return segments.length <= 2 ? value : `…/${segments.slice(-2).join('/')}`
}

function totalTokens(run: RuntimeRunSummary): number | null {
  const values = [
    run.totals.inputTokens,
    run.totals.cacheReadInputTokens,
    run.totals.cacheCreationInputTokens,
    run.totals.outputTokens,
  ]
  if (values.every((value) => value === null)) return null
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function tokenBreakdown(run: RuntimeRunSummary): string {
  return [
    `input ${formatNumber(run.totals.inputTokens)}`,
    `cache read ${formatNumber(run.totals.cacheReadInputTokens)}`,
    `cache write ${formatNumber(run.totals.cacheCreationInputTokens)}`,
    `output ${formatNumber(run.totals.outputTokens)}`,
    `reasoning ${formatNumber(run.totals.reasoningOutputTokens)}`,
  ].join('\n')
}

