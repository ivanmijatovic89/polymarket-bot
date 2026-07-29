'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Pause, Play, RefreshCw, Send, Square } from 'lucide-react'
import { runtimeFetch } from '@/components/MissionControlView'
import { RuntimeStatusBadge } from '@/components/RuntimeStatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RuntimeFile, RuntimeRunDetail } from '@/lib/runtimeTypes'

type FilesResponse = { files: RuntimeFile[] }

export function MissionRunView({ runId }: { runId: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const detailQuery = useQuery({
    queryKey: ['runtime-run', runId],
    queryFn: () => runtimeFetch<RuntimeRunDetail>(`/runs/${runId}`),
    refetchInterval: 3000,
  })
  const filesQuery = useQuery({
    queryKey: ['runtime-files', runId],
    queryFn: () => runtimeFetch<FilesResponse>(`/runs/${runId}/files`),
    refetchInterval: 5000,
  })
  const files = filesQuery.data?.files ?? []
  const visibleFile = files.find((file) => file.path === selectedFile) ?? files[0]

  useEffect(() => {
    if (!selectedFile && files[0]) setSelectedFile(files[0].path)
  }, [files, selectedFile])

  async function action(name: 'start' | 'pause' | 'resume' | 'stop') {
    setBusy(true)
    setError(null)
    try {
      await runtimeFetch(`/runs/${runId}/${name}`, { method: 'POST' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['runtime-run', runId] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-runs'] }),
      ])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function sendMessage() {
    if (!message.trim()) return
    setBusy(true)
    setError(null)
    try {
      await runtimeFetch(`/runs/${runId}/inbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      setMessage('')
      await queryClient.invalidateQueries({ queryKey: ['runtime-files', runId] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const detail = detailQuery.data
  if (detailQuery.isLoading)
    return <div className="text-sm text-muted-foreground">Loading loop…</div>
  if (!detail) {
    return (
      <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
        {String(detailQuery.error)}
      </div>
    )
  }
  const { run, sessions, totals } = detail
  const active = ['running', 'pause_requested', 'rate_limited'].includes(run.status)
  const resumable = ['paused', 'waiting', 'stopped', 'error'].includes(run.status)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/mission-control"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> Mission Control
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{run.name}</h1>
              <RuntimeStatusBadge status={run.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {run.provider} · {run.model} · {run.effort} · session {run.currentSession}/
              {run.maxSessions}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void detailQuery.refetch()}
              className="rounded-md border p-2 hover:bg-accent"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${detailQuery.isFetching ? 'animate-spin' : ''}`} />
            </button>
            {run.status === 'idle' && (
              <Control onClick={() => action('start')} disabled={busy} icon={Play}>
                Start
              </Control>
            )}
            {active && (
              <Control
                onClick={() => action('pause')}
                disabled={busy || run.status === 'pause_requested'}
                icon={Pause}
              >
                Pause
              </Control>
            )}
            {resumable && (
              <Control onClick={() => action('resume')} disabled={busy} icon={Play}>
                Resume
              </Control>
            )}
            {(active || resumable) && (
              <Control onClick={() => action('stop')} disabled={busy} icon={Square}>
                Stop
              </Control>
            )}
          </div>
        </div>
      </div>

      {(error || run.lastError) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error || run.lastError}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sessions" value={`${run.currentSession} / ${run.maxSessions}`} />
        <Stat label="Input tokens" value={formatNumber(totals.inputTokens)} />
        <Stat label="Cached input" value={formatNumber(totals.cachedInputTokens)} />
        <Stat
          label="Output + reasoning"
          value={formatNumber((totals.outputTokens ?? 0) + (totals.reasoningOutputTokens ?? 0))}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <Meta label="Workspace" value={run.workspacePath} mono />
          <Meta label="Mission" value={run.missionPath} mono />
          <Meta label="Last activity" value={formatDate(run.lastActivityAt)} />
          <Meta label="Heartbeat" value={formatDate(run.heartbeatAt)} />
          <Meta label="Next start" value={formatDate(run.nextStartAt)} />
          <div className="md:col-span-2">
            <Meta label="Last result" value={run.lastResultSummary || '—'} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Workspace communication</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1 border-b pb-2">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedFile(file.path)}
                  className={`rounded-md px-2.5 py-1.5 text-xs ${visibleFile?.path === file.path ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  {file.role}: {file.path}
                </button>
              ))}
            </div>
            {visibleFile ? (
              <pre className="mt-3 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-mono text-xs leading-5">
                {visibleFile.exists
                  ? visibleFile.content
                  : `${visibleFile.path} does not exist yet.`}
              </pre>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No files configured.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Steer next session</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={7}
              placeholder="Append an instruction or answer to INBOX.md…"
              className="w-full rounded-md border bg-background p-3 text-sm"
            />
            <button
              type="button"
              disabled={busy || !message.trim()}
              onClick={() => void sendMessage()}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Send to inbox
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              The runtime appends this message. The current or next fresh session reads it and
              records the processed entry in STATUS.md.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b text-muted-foreground">
              <tr>
                {['#', 'Status', 'Action', 'Started', 'Input', 'Cached', 'Output', 'Summary'].map(
                  (label) => (
                    <th key={label} className="px-2 py-2 font-medium">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b last:border-0">
                  <td className="px-2 py-3 tabular-nums">{session.sessionNumber}</td>
                  <td className="px-2 py-3">{session.status}</td>
                  <td className="px-2 py-3">{session.action || '—'}</td>
                  <td className="px-2 py-3 whitespace-nowrap">{formatDate(session.startedAt)}</td>
                  <td className="px-2 py-3 tabular-nums">{formatNumber(session.inputTokens)}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {formatNumber(session.cachedInputTokens)}
                  </td>
                  <td className="px-2 py-3 tabular-nums">{formatNumber(session.outputTokens)}</td>
                  <td className="max-w-md px-2 py-3">{session.summary || session.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessions.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No sessions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Control({
  children,
  icon: Icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: typeof Play }) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  )
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}
function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { hourCycle: 'h23' }) : '—'
}
