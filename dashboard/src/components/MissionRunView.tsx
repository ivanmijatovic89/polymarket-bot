'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Pause, Play, Plus, RefreshCw, Send, Square } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { runtimeFetch } from '@/components/MissionControlView'
import { RuntimeStatusBadge } from '@/components/RuntimeStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { RuntimeFile, RuntimeRunDetail, RuntimeSession } from '@/lib/runtimeTypes'

type FilesResponse = { files: RuntimeFile[] }

// #, Status, Model, Started, Duration, Tokens, Est. cost, Summary, Details
const SESSION_COLUMNS = 9

// The dashboard has no typography plugin, so the rendered-markdown styles live
// here as descendant variants rather than a `prose` class.
const MARKDOWN_CLASS = cn(
  'max-h-[34rem] overflow-auto rounded-md bg-muted/50 p-4 text-sm leading-6',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li]:pl-0.5',
  '[&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold',
  '[&_code]:rounded [&_code]:bg-background/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-background [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-xs',
  '[&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium',
  '[&_td]:border-b [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-4 [&_hr]:border-t',
)

export function MissionRunView({ runId }: { runId: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [extendTarget, setExtendTarget] = useState<string | null>(null)
  const [promptSession, setPromptSession] = useState<number | null>(null)
  const [renderMarkdown, setRenderMarkdown] = useState(true)
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

  async function extendLimit() {
    const maxSessions = Number(extendTarget)
    setBusy(true)
    setError(null)
    try {
      await runtimeFetch(`/runs/${runId}/extend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxSessions }),
      })
      setExtendTarget(null)
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
  const resolvedModel = latestResolvedModel(sessions)
  const tokenTotal = sumTokens(totals)

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
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{run.name}</h1>
              <RuntimeStatusBadge status={run.status} />
              {run.accessMode === 'full-access' && <Badge variant="warning">full access</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              #{run.id} · {run.provider === 'claude' ? 'Claude Code' : 'Codex'} ·{' '}
              <span className="font-mono">{resolvedModel ?? run.model}</span> · {run.effort} effort ·{' '}
              {formatAccount(run)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
            {run.status !== 'completed' &&
              (extendTarget === null ? (
                <Control
                  onClick={() => setExtendTarget(String(run.maxSessions + 5))}
                  disabled={busy}
                  icon={Plus}
                >
                  Extend
                </Control>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={run.maxSessions + 1}
                    max={10000}
                    value={extendTarget}
                    onChange={(event) => setExtendTarget(event.target.value)}
                    className="w-20 rounded-md border bg-background px-2 py-2 text-sm tabular-nums"
                    aria-label="New session limit"
                  />
                  <button
                    type="button"
                    disabled={busy || Number(extendTarget) <= run.maxSessions}
                    onClick={() => void extendLimit()}
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    Set limit
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtendTarget(null)}
                    className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>

      {(error || run.lastError) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error || run.lastError}
        </div>
      )}
      {!run.lastError && run.lastResultSummary && (
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <span className="text-xs text-muted-foreground">Last result — </span>
          {run.lastResultSummary}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sessions" value={`${run.currentSession} / ${run.maxSessions}`}>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, Math.round((run.currentSession / Math.max(1, run.maxSessions)) * 100))}%`,
              }}
            />
          </div>
        </Stat>
        <Stat label="Run duration" value={formatDurationBetween(run.startedAt, run.endedAt)}>
          <div className="mt-1 text-xs text-muted-foreground">
            {run.endedAt ? `ended ${formatDate(run.endedAt)}` : 'still open'}
          </div>
        </Stat>
        <Stat label="Est. API cost" value={formatUsd(totals.estimatedApiCostUsd)}>
          <div className="mt-1 text-xs text-muted-foreground">
            {sessions.length > 0
              ? `${formatUsd(perSession(totals.estimatedApiCostUsd, sessions.length))} / session`
              : '—'}
          </div>
        </Stat>
        <Stat label="Tokens" value={formatCompact(tokenTotal)}>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {formatCompact(totals.inputTokens)} in · {formatCompact(totals.cacheReadInputTokens)}{' '}
            read · {formatCompact(totals.cacheCreationInputTokens)} write ·{' '}
            {formatCompact(totals.outputTokens)} out
          </div>
        </Stat>
      </div>

      <Card>
        <CardContent className="grid gap-x-8 gap-y-5 py-4 text-xs lg:grid-cols-3">
          <Spec title="Configuration">
            <SpecRow label="Model" value={run.model} mono />
            {resolvedModel && resolvedModel !== run.model && (
              <SpecRow label="Resolved" value={resolvedModel} mono />
            )}
            <SpecRow label="Access" value={run.accessMode} />
            <SpecRow label="Session delay" value={`${run.delaySeconds}s`} />
            <SpecRow label="Session limit" value={String(run.maxSessions)} />
            <SpecRow label="Process id" value={run.processId === null ? '—' : String(run.processId)} />
          </Spec>

          <Spec title="Workspace">
            <SpecRow label="Path" value={run.workspacePath} mono />
            <SpecRow label="Mission" value={run.missionPath} mono />
            <SpecRow label="Status" value={run.statusFile} mono />
            <SpecRow label="Journal" value={run.journalFile} mono />
            <SpecRow label="Inbox" value={run.inboxFile} mono />
            <SpecRow
              label="Read-only"
              value={run.readOnlyFiles.length > 0 ? run.readOnlyFiles.join(', ') : '—'}
              mono
            />
          </Spec>

          <Spec title="Timing">
            <SpecRow label="Created" value={formatDate(run.createdAt)} />
            <SpecRow label="Started" value={formatDate(run.startedAt)} />
            <SpecRow label="Ended" value={formatDate(run.endedAt)} />
            <SpecRow label="Last activity" value={formatDate(run.lastActivityAt)} />
            <SpecRow label="Heartbeat" value={formatDate(run.heartbeatAt)} />
            <SpecRow label="Next start" value={formatDate(run.nextStartAt)} />
          </Spec>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Workspace communication</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-1 border-b pb-2">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedFile(file.path)}
                  title={file.path}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-xs',
                    visibleFile?.path === file.path
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {fileLabel(file)}
                  {!file.exists && <span className="ml-1 opacity-60">(missing)</span>}
                </button>
              ))}
              {isMarkdownPath(visibleFile?.path) && (
                <div className="ml-auto flex rounded-md border p-0.5">
                  {[
                    { id: true, label: 'Rendered' },
                    { id: false, label: 'Raw' },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setRenderMarkdown(option.id)}
                      aria-pressed={renderMarkdown === option.id}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition-colors',
                        renderMarkdown === option.id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {visibleFile ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-mono">{visibleFile.path}</span>
                  <span>
                    {visibleFile.modifiedAt ? `modified ${formatDate(visibleFile.modifiedAt)}` : ''}
                  </span>
                </div>
                {visibleFile.truncated && (
                  <p className="rounded-md border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)]">
                    This file is truncated. Mission Control is showing only its latest content.
                  </p>
                )}
                {visibleFile.exists &&
                renderMarkdown &&
                isMarkdownPath(visibleFile.path) &&
                visibleFile.content.trim() ? (
                  <div className={MARKDOWN_CLASS}>
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer noopener">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {visibleFile.content}
                    </Markdown>
                  </div>
                ) : (
                  <pre className="max-h-[34rem] overflow-auto rounded-md bg-muted/50 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
                    {visibleFile.exists
                      ? visibleFile.content
                      : `${visibleFile.path} does not exist yet.`}
                  </pre>
                )}
              </div>
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
        <CardContent className="p-0">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-px text-right">#</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => {
                const open = promptSession === session.sessionNumber
                return (
                  <Fragment key={session.id}>
                    <TableRow className={cn('align-top', open && 'border-0')}>
                      <TableCell className="text-right tabular-nums">
                        {session.sessionNumber}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <SessionStatusBadge status={session.status} />
                          {session.action && (
                            <span className="text-xs text-muted-foreground">{session.action}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {session.resolvedModel ?? session.model}
                        {session.resolvedModel && session.resolvedModel !== session.model && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            asked {session.model}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(session.startedAt)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                        {formatDurationBetween(session.startedAt, session.finishedAt)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="text-xs tabular-nums" title={sessionTokenTitle(session)}>
                          {formatCompact(sumTokens(session))}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {formatCompact(session.inputTokens)}i ·{' '}
                          {formatCompact(session.cacheReadInputTokens)}r ·{' '}
                          {formatCompact(session.outputTokens)}o
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                        {formatUsd(session.estimatedApiCostUsd)}
                      </TableCell>
                      <TableCell className="max-w-md text-xs">
                        <span className={session.error ? 'text-destructive' : undefined}>
                          {session.summary || session.error || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          onClick={() => setPromptSession(open ? null : session.sessionNumber)}
                          className="rounded-md border px-2 py-1 text-xs whitespace-nowrap hover:bg-accent"
                        >
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={SESSION_COLUMNS} className="pt-0">
                          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                            <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                              <Meta
                                label="Contract version"
                                value={
                                  session.contractVersion === null
                                    ? '—'
                                    : `v${session.contractVersion}`
                                }
                              />
                              <Meta
                                label="Mission sha256"
                                value={session.missionHash ?? '—'}
                                mono
                              />
                              <Meta
                                label="Process id"
                                value={session.processId === null ? '—' : String(session.processId)}
                              />
                              <Meta label="Raw output" value={session.rawLogPath} mono />
                            </div>
                            <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                              <Meta label="Effort" value={session.effort} />
                              <Meta label="Ended" value={formatDate(session.finishedAt)} />
                              <Meta label="Input" value={formatNumber(session.inputTokens)} />
                              <Meta
                                label="Cache read"
                                value={formatNumber(session.cacheReadInputTokens)}
                              />
                              <Meta
                                label="Cache write"
                                value={formatNumber(session.cacheCreationInputTokens)}
                              />
                              <Meta label="Output" value={formatNumber(session.outputTokens)} />
                              <Meta
                                label="Reasoning"
                                value={formatNumber(session.reasoningOutputTokens)}
                              />
                              <Meta label="Cache hit" value={formatCacheHit(session)} />
                            </div>
                            <div>
                              <div className="mb-1 text-xs text-muted-foreground">
                                Rendered session prompt
                              </div>
                              {session.prompt ? (
                                <pre className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                                  {session.prompt}
                                </pre>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Not recorded — this session started before prompts were persisted.
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
            {sessions.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-xs">
                    Total · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
                  </TableCell>
                  <TableCell
                    className="text-right text-xs tabular-nums whitespace-nowrap"
                    title="Time inside sessions; the run duration above also counts the gaps between them."
                  >
                    {formatDuration(activeMs(sessions))}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="text-xs tabular-nums">{formatCompact(tokenTotal)}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {formatCompact(totals.inputTokens)}i ·{' '}
                      {formatCompact(totals.cacheReadInputTokens)}r ·{' '}
                      {formatCompact(totals.outputTokens)}o
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                    {formatUsd(totals.estimatedApiCostUsd)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
          {sessions.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">No sessions yet.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        API-equivalent cost is informational even for subscription runs. Cache reads are cumulative
        across every provider turn; they are not the size of one unique prompt. Codex reports token
        usage but not dollar cost or per-request context sizes, so its value uses published standard
        token rates and may differ for long-context pricing.
      </p>
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

function SessionStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'completed' || status === 'running'
      ? 'success'
      : status === 'waiting' || status === 'rate_limited'
        ? 'warning'
        : status === 'failed' || status === 'invalid_result'
          ? 'destructive'
          : 'muted'
  return <Badge variant={variant}>{status.replace('_', ' ')}</Badge>
}

function Stat({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {children}
    </div>
  )
}

function Spec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </div>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">{children}</dl>
    </div>
  )
}

// Long paths truncate rather than wrap — a wrapped workspace path was most of
// what made the old three-card block so tall. Full value stays on the tooltip.
function SpecRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('truncate', mono && 'font-mono')} title={value}>
        {value}
      </dd>
    </>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 break-all', mono && 'font-mono text-xs')} title={value}>
        {value}
      </div>
    </div>
  )
}

function isMarkdownPath(path: string | undefined): boolean {
  return path !== undefined && path.toLowerCase().endsWith('.md')
}

function fileLabel(file: RuntimeFile): string {
  const basename = file.path.split('/').filter(Boolean).pop() ?? file.path
  return file.role === 'read_only' ? basename : `${file.role}: ${basename}`
}

function perSession(total: number | null, sessions: number): number | null {
  return total === null || sessions === 0 ? null : total / sessions
}

// Both the run totals and a single session expose the same four countable
// fields, so one helper covers the summary tiles and each table row.
function sumTokens(usage: {
  inputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
  outputTokens: number | null
}): number | null {
  const values = [
    usage.inputTokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    usage.outputTokens,
  ]
  if (values.every((value) => value === null)) return null
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function sessionTokenTitle(session: RuntimeSession): string {
  return [
    `input ${formatNumber(session.inputTokens)}`,
    `cache read ${formatNumber(session.cacheReadInputTokens)}`,
    `cache write ${formatNumber(session.cacheCreationInputTokens)}`,
    `output ${formatNumber(session.outputTokens)}`,
    `reasoning ${formatNumber(session.reasoningOutputTokens)}`,
  ].join('\n')
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}

function formatCompact(value: number | null): string {
  if (value === null) return '—'
  if (Math.abs(value) < 1000) return String(value)
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { hourCycle: 'h23' }) : '—'
}

function formatAccount(run: RuntimeRunDetail['run']): string {
  if (run.provider === 'claude') {
    if (!run.authHome) return 'Default Claude login'
    return run.authHome === '~/.claude-balsa' ? 'Balsa' : run.authHome
  }
  return run.authHome ? run.authHome : 'Default Codex login'
}

function latestResolvedModel(sessions: RuntimeRunDetail['sessions']): string | null {
  return sessions.find((session) => session.resolvedModel)?.resolvedModel ?? null
}

// Wall-clock time actually spent inside sessions. The run duration on the tile
// above spans the whole loop, so it also counts the delay between sessions.
function activeMs(sessions: RuntimeSession[]): number {
  return sessions.reduce((total, session) => {
    const startMs = new Date(session.startedAt).getTime()
    const endMs = session.finishedAt ? new Date(session.finishedAt).getTime() : Date.now()
    return total + Math.max(0, endMs - startMs)
  }, 0)
}

function formatCacheHit(session: RuntimeSession): string {
  const read = session.cacheReadInputTokens ?? 0
  const prompt = (session.inputTokens ?? 0) + read + (session.cacheCreationInputTokens ?? 0)
  if (prompt === 0) return '—'
  return `${((read / prompt) * 100).toFixed(1)}%`
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
