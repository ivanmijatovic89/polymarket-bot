'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  RotateCcw,
  Loader2,
} from 'lucide-react'
import {
  displayMetrics,
  type TraceManifest,
  type SimulatorStatus,
  type DisplayBook,
} from '@bot/backtest/simulator/contracts'
import { TraceCache, fetchJson, type Cursor, type DisplayFrame } from './playback'
import { PriceChart } from './PriceChart'

const control =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed'
const money = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`
const clock = (value: number) => new Date(value).toISOString().slice(11, 23)
const pnlColor = (n: number) => (n < 0 ? 'text-rose-400' : 'text-emerald-400')

export function MarketSimulatorView({ runId, slug }: { runId: number; slug: string }) {
  const [status, setStatus] = useState<SimulatorStatus | null>(null)
  const [manifest, setManifest] = useState<TraceManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [display, setDisplay] = useState<DisplayFrame | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [zoom, setZoom] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState<unknown>(null)
  const [showOutcome, setShowOutcome] = useState(false)
  const cache = useRef<TraceCache | null>(null)
  const displayRef = useRef<DisplayFrame | null>(null)
  const requestId = useRef(0)
  const playbackTime = useRef(0)

  const seek = useCallback(async (cursor: Cursor) => {
    const current = cache.current
    if (!current) return
    const request = ++requestId.current
    setBuffering(true)
    try {
      const next = await current.at(cursor)
      if (request !== requestId.current) return
      displayRef.current = next
      setDisplay(next)
      if (cursor.actionSeq === null) setDetail(null)
      if (cursor.actionSeq !== null)
        setDetail(next.frame.actions.find((a) => a.seq === cursor.actionSeq)?.detail ?? null)
    } catch (err) {
      if (request === requestId.current) {
        setError(err instanceof Error ? err.message : 'Could not read trace')
        setPlaying(false)
      }
    } finally {
      if (request === requestId.current) setBuffering(false)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    setStatus(null)
    setManifest(null)
    setDisplay(null)
    setError(null)
    setPlaying(false)
    cache.current = null
    displayRef.current = null
    requestId.current++
    const poll = async (session: string) => {
      try {
        const state = await fetchJson<SimulatorStatus>(`/api/simulator/${session}`, {
          signal: controller.signal,
        })
        if (stopped) return
        if (state.runId !== runId || state.slug !== slug)
          throw new Error('This saved session belongs to another market. Start a new replay.')
        setStatus(state)
        if (state.status === 'ready') {
          const result = await fetchJson<TraceManifest>(`/api/simulator/${session}?manifest=1`, {
            signal: controller.signal,
          })
          if (stopped) return
          setManifest(result)
          cache.current = new TraceCache(session, result)
          playbackTime.current = result.startTime
          if (result.ticks) await seek({ tick: 0, actionSeq: null })
        } else if (state.status === 'queued' || state.status === 'running')
          timer = setTimeout(() => void poll(session), 750)
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Replay unavailable')
      }
    }
    void (async () => {
      try {
        const saved =
          attempt === 0 ? new URL(window.location.href).searchParams.get('session') : null
        if (saved) {
          await poll(saved)
          return
        }
        const state = await fetchJson<SimulatorStatus>(
          `/api/backtests/${runId}/markets/${encodeURIComponent(slug)}/simulator`,
          { method: 'POST', signal: controller.signal },
        )
        if (stopped) return
        const url = new URL(window.location.href)
        url.searchParams.set('session', state.id)
        window.history.replaceState(null, '', url)
        setStatus(state)
        await poll(state.id)
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Could not start replay')
      }
    })()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
      requestId.current++
    }
  }, [runId, slug, attempt, seek])

  useEffect(() => {
    if (!playing || !manifest) return
    let raf = 0,
      previous = performance.now(),
      busy = false,
      stopped = false
    const animate = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(animate)
      if (document.hidden || busy || now - previous < 33) {
        if (document.hidden || busy) previous = now
        return
      }
      playbackTime.current = Math.min(
        manifest.endTime,
        playbackTime.current + (now - previous) * speed,
      )
      previous = now
      busy = true
      void (async () => {
        try {
          const tick = await cache.current!.atTime(playbackTime.current)
          if (stopped) return
          if (displayRef.current?.frame.tick !== tick || displayRef.current.actionSeq !== null)
            await seek({ tick, actionSeq: null })
          if (tick === manifest.ticks - 1) setPlaying(false)
        } catch (err) {
          if (!stopped) {
            setError(err instanceof Error ? err.message : 'Playback failed')
            setPlaying(false)
          }
        } finally {
          busy = false
        }
      })()
    }
    raf = requestAnimationFrame(animate)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [playing, speed, manifest, seek])

  const seekTick = (tick: number, actionSeq: number | null = null) => {
    if (!manifest) return
    setPlaying(false)
    void seek({ tick: Math.max(0, Math.min(manifest.ticks - 1, tick)), actionSeq })
  }
  const seekTime = (time: number) => {
    setPlaying(false)
    const request = ++requestId.current
    void cache.current
      ?.atTime(time)
      .then((tick) => {
        if (requestId.current === request) seekTick(tick)
      })
      .catch((err) => setError(String(err)))
  }
  const nextAction = (fillsOnly: boolean) => {
    if (!manifest || !display) return
    const next = manifest.actions.find(
      (a) =>
        (a.tick > display.frame.tick ||
          (a.tick === display.frame.tick &&
            display.actionSeq !== null &&
            a.seq > display.actionSeq)) &&
        (!fillsOnly || a.kind === 'fill'),
    )
    if (next) seekTick(next.tick, next.seq)
  }
  const cancel = async () => {
    if (!status) return
    try {
      setStatus(
        await fetchJson<SimulatorStatus>(`/api/simulator/${status.id}`, { method: 'DELETE' }),
      )
    } catch (err) {
      setError(String(err))
    }
  }

  const state = display?.state
  const metrics =
    state && manifest ? displayMetrics(state, manifest.provenance.initialCapital) : null
  const visibleActions =
    manifest && display
      ? manifest.actions
          .filter(
            (a) =>
              (a.tick < display.frame.tick ||
                (a.tick === display.frame.tick &&
                  (display.actionSeq === null || a.seq <= display.actionSeq))) &&
              (filter === 'all' ||
                (filter === 'fills'
                  ? a.kind === 'fill'
                  : filter === 'intents'
                    ? a.kind.startsWith('intent:')
                    : /rejected|failed/.test(a.kind))),
          )
          .slice(-150)
          .reverse()
      : []
  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/backtests/${runId}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to run #{runId}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Market simulator</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{slug} · UTC</p>
        </div>
        <div className="flex items-center gap-2">
          {manifest && (
            <span
              className={`rounded-full border px-3 py-1.5 text-xs ${manifest.resultMatches ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/40 text-amber-300'}`}
            >
              {manifest.resultMatches ? 'Saved totals match' : 'Replay differs from saved result'}
            </span>
          )}
          <button
            className={control}
            onClick={() => setAttempt((n) => n + 1)}
            disabled={status?.status === 'running' || status?.status === 'queued'}
          >
            <RotateCcw size={13} />
            New replay
          </button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300"
        >
          {error}
        </div>
      )}
      {!manifest && (
        <div className="rounded-xl border bg-card p-8">
          <div className="flex items-center gap-3">
            {(!status || ['running', 'queued'].includes(status.status)) && !error && (
              <Loader2 className="animate-spin text-sky-400" size={22} />
            )}
            <div>
              <p className="font-medium">{status?.message ?? 'Starting replay…'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The strategy runs once on all original input ticks. Playback becomes available after
                result verification.
              </p>
            </div>
          </div>
          {status && ['running', 'queued'].includes(status.status) && (
            <button className={`${control} mt-5`} onClick={() => void cancel()}>
              Cancel preparation
            </button>
          )}
        </div>
      )}
      {manifest && display && state && metrics && (
        <>
          <div className="sticky top-14 z-20 rounded-xl border bg-background/95 p-4 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`${control} min-w-24 bg-primary text-primary-foreground hover:bg-primary/80`}
                onClick={() => {
                  if (!playing) playbackTime.current = display.frame.time
                  setPlaying((v) => !v)
                }}
                disabled={display.frame.tick === manifest.ticks - 1 && !playing}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
                {playing ? 'Pause' : 'Play'}
              </button>
              <label className="sr-only" htmlFor="playback-speed">
                Playback speed
              </label>
              <select
                id="playback-speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className={control}
              >
                {[1, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
              <button
                className={control}
                disabled={!display.frame.tick}
                onClick={() => seekTick(display.frame.tick - 1)}
              >
                <ChevronLeft size={13} />
                Tick
              </button>
              <button
                className={control}
                disabled={display.frame.tick === manifest.ticks - 1}
                onClick={() => seekTick(display.frame.tick + 1)}
              >
                Tick
                <ChevronRight size={13} />
              </button>
              <button className={control} onClick={() => nextAction(false)}>
                Next action
                <SkipForward size={13} />
              </button>
              <button className={control} onClick={() => nextAction(true)}>
                Next fill
                <SkipForward size={13} />
              </button>
              <span className="ml-auto font-mono text-xs tabular-nums">
                {clock(display.frame.time)} <span className="text-muted-foreground">UTC</span>
              </span>
              {buffering && <Loader2 size={12} className="animate-spin" />}
            </div>
            <input
              aria-label="Replay timeline"
              type="range"
              min={0}
              max={Math.max(0, manifest.ticks - 1)}
              value={display.frame.tick}
              onChange={(e) => seekTick(Number(e.target.value))}
              className="mt-4 w-full accent-sky-400"
            />
            <div className="flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted-foreground">
              <span>
                Tick {(display.frame.tick + 1).toLocaleString()} / {manifest.ticks.toLocaleString()}{' '}
                · {display.frame.kind} ·{' '}
                {display.actionSeq === null ? 'after tick' : `action #${display.actionSeq}`}
              </span>
              <span>
                Exchange {clock(display.frame.exchangeTime)} · Received{' '}
                {display.frame.receiveTime ? clock(display.frame.receiveTime) : 'unavailable'} ·
                Ingest {display.frame.ingestSeq ?? '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Metric
              label="Paired shares"
              value={metrics.pairs.toFixed(2)}
              sub={`UP ${state.up.qty.toFixed(2)} · DOWN ${state.down.qty.toFixed(2)}`}
            />
            <Metric
              label="Unpaired shares"
              value={(metrics.unpairedUp + metrics.unpairedDown).toFixed(2)}
              sub={
                metrics.unpairedUp > 0
                  ? 'UP exposure'
                  : metrics.unpairedDown > 0
                    ? 'DOWN exposure'
                    : 'Balanced'
              }
            />
            <Metric
              label="Remaining cost basis"
              value={money(state.up.cost + state.down.cost)}
              sub={`Fees paid ${money(state.fees)}`}
            />
            <Metric
              label="Simulated cash"
              value={money(metrics.cash)}
              sub={`Open BUY notional ${money(metrics.reserved)}`}
            />
            <Metric
              label="PnL if UP wins"
              value={money(metrics.pnlIfUp)}
              color={pnlColor(metrics.pnlIfUp)}
              sub="Cash flow + UP shares"
            />
            <Metric
              label="PnL if DOWN wins"
              value={money(metrics.pnlIfDown)}
              color={pnlColor(metrics.pnlIfDown)}
              sub="Cash flow + DOWN shares"
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0 rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-medium">Market & execution</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="text-sky-400">Bid</span> ·{' '}
                    <span className="text-amber-300">Ask</span> ·{' '}
                    <span className="text-violet-400">Open orders</span> ·{' '}
                    <span className="text-emerald-400">Buy fill ●</span> ·{' '}
                    <span className="text-rose-400">Sell fill ●</span>
                  </p>
                </div>
                <select
                  aria-label="Chart window"
                  className={control}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  <option value={0}>Full market</option>
                  <option value={60_000}>Last 60 seconds</option>
                  <option value={15_000}>Last 15 seconds</option>
                </select>
              </div>
              {(['UP', 'DOWN'] as const).map((outcome) => (
                <div key={outcome} className="border-b last:border-0">
                  <div className="flex justify-between px-4 pt-3 text-xs">
                    <span
                      className={
                        outcome === 'UP'
                          ? 'font-semibold text-sky-300'
                          : 'font-semibold text-violet-300'
                      }
                    >
                      {outcome}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {outcome === 'UP' ? state.up.qty.toFixed(2) : state.down.qty.toFixed(2)}{' '}
                      shares
                    </span>
                  </div>
                  <PriceChart
                    manifest={manifest}
                    display={display}
                    outcome={outcome}
                    zoom={zoom}
                    onSeek={seekTime}
                  />
                </div>
              ))}
              <p className="px-4 pb-3 text-[11px] text-muted-foreground">
                Click to seek. Chart preserves each second’s quote extremes; tick controls show
                every input tick. Future prices stay hidden.
              </p>
            </section>
            <section className="min-w-0 rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">
                Order books{' '}
                <span className="font-normal text-muted-foreground">· top 10 levels</span>
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Book name="UP" book={display.frame.up} />
                <Book name="DOWN" book={display.frame.down} />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                The replay engine uses the full recorded depth. The panel shows the ten best levels.
              </p>
            </section>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <section className="min-w-0 rounded-xl border bg-card">
              <div className="border-b px-4 py-3 text-sm font-medium">
                Active orders{' '}
                <span className="ml-2 text-muted-foreground">{state.orders.length}</span>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      {['Side', 'Price', 'Filled / size', 'Remaining', 'Status', 'Type'].map(
                        (s) => (
                          <th key={s} className="px-3 py-2 font-normal">
                            {s}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {state.orders.map((o) => (
                      <tr
                        key={o.id}
                        className="cursor-pointer border-t hover:bg-accent/50"
                        onClick={() => setDetail(o)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.side}{' '}
                          <span className={o.outcome === 'UP' ? 'text-sky-300' : 'text-violet-300'}>
                            {o.outcome}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">{(o.price * 100).toFixed(1)}¢</td>
                        <td className="px-3 py-2 font-mono">
                          {o.filled.toFixed(2)} / {o.size.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 font-mono">{o.remaining.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {o.cancelRequested ? 'cancel requested' : o.state}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {o.type}
                          {o.postOnly ? ' · post-only' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!state.orders.length && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    No active orders at this point.
                  </p>
                )}
              </div>
              <details className="border-t p-4">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  External feeds seen by the strategy
                </summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                  {display.context
                    ? JSON.stringify(display.context, null, 2)
                    : 'No external feed snapshot on this tick.'}
                </pre>
              </details>
            </section>
            <section className="min-w-0 rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-medium">Execution timeline</h2>
                <select
                  aria-label="Event filter"
                  className="rounded border bg-background px-2 py-1 text-xs"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All actions</option>
                  <option value="fills">Fills</option>
                  <option value="intents">Intentions</option>
                  <option value="errors">Rejections / failures</option>
                </select>
              </div>
              <div className="h-80 overflow-auto">
                {visibleActions.map((a) => (
                  <button
                    key={a.seq}
                    className={`block w-full border-b px-4 py-2.5 text-left hover:bg-accent/60 ${a.seq === display.actionSeq ? 'bg-accent' : ''}`}
                    onClick={() => seekTick(a.tick, a.seq)}
                  >
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {clock(a.time)} · tick {a.tick + 1} · #{a.seq}
                    </span>
                    <span
                      className={`mt-1 block text-xs ${a.kind === 'fill' ? 'text-emerald-300' : /rejected|failed/.test(a.kind) ? 'text-rose-300' : ''}`}
                    >
                      {a.label}
                    </span>
                  </button>
                ))}
                {!visibleActions.length && (
                  <p className="p-6 text-sm text-muted-foreground">
                    No matching actions yet. Use Next fill to jump to a trade.
                  </p>
                )}
              </div>
              <p className="px-4 py-2 text-[10px] text-muted-foreground">
                Latest 150 matching events up to the cursor. Click an event to inspect the state
                immediately after it.
              </p>
            </section>
          </div>
          {detail !== null && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex justify-between">
                <h2 className="text-sm font-medium">Selected event / order</h2>
                <button className="text-xs text-muted-foreground" onClick={() => setDetail(null)}>
                  Close
                </button>
              </div>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
      {manifest && (
        <details className="rounded-xl border bg-card p-4" open={!manifest.resultMatches}>
          <summary className="cursor-pointer text-sm font-medium">
            Replay verification & inputs{' '}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Reconstructed replay · {(manifest.durationMs / 1000).toFixed(1)}s preparation
            </span>
          </summary>
          <div className="mt-4 space-y-4 text-xs">
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {manifest.provenance.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Simulated cash starts at the run’s reference capital (
              {money(manifest.provenance.initialCapital)}). It is not a wallet enforced by the
              execution engine. Pending BUY notional excludes possible fees. Conditional PnL uses
              exact fill cash flows; saved PnL uses the engine’s rounded portfolio accounting.
            </p>
            <button className={control} onClick={() => setShowOutcome((v) => !v)}>
              {showOutcome
                ? `Winner: ${manifest.provenance.outcome} · Hide`
                : 'Reveal final winner'}
            </button>
            <div className="overflow-auto">
              <table className="text-left text-xs">
                <thead>
                  <tr>
                    {['Check', 'Saved', 'Replay', 'Match'].map((s) => (
                      <th className="px-4 py-2" key={s}>
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {manifest.comparison.map((r) => (
                    <tr key={r.field} className="border-t">
                      <td className="px-4 py-2">{r.field}</td>
                      <td className="px-4 py-2 font-mono">{r.saved}</td>
                      <td className="px-4 py-2 font-mono">{r.replay ?? 'unavailable'}</td>
                      <td className={r.matches ? 'text-emerald-400' : 'text-amber-300'}>
                        {r.matches ? '✓' : 'Different'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-[11px]">
              {JSON.stringify(
                {
                  ...manifest.provenance,
                  outcome: showOutcome ? manifest.provenance.outcome : 'hidden',
                  warnings: undefined,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </details>
      )}
      {manifest && !manifest.ticks && (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          There were no strategy ticks in this market window.
        </p>
      )}
    </div>
  )
}
function Metric({
  label,
  value,
  sub,
  color = '',
}: {
  label: string
  value: string
  sub: string
  color?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-mono text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
function Book({ name, book }: { name: string; book: DisplayBook | null }) {
  return (
    <div>
      <h3
        className={`mb-2 text-xs font-semibold ${name === 'UP' ? 'text-sky-300' : 'text-violet-300'}`}
      >
        {name}
      </h3>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Price</span>
        <span>Size</span>
      </div>
      {[...(book?.asks ?? [])].reverse().map(([p, q]) => (
        <div key={`ask${p}`} className="flex justify-between font-mono text-[11px] leading-5">
          <span className="text-rose-300">{(p * 100).toFixed(1)}¢</span>
          <span>{q.toFixed(1)}</span>
        </div>
      ))}
      <div className="my-2 border-y py-1.5 text-center font-mono text-[10px] text-muted-foreground">
        Spread{' '}
        {book?.ask != null && book.bid != null
          ? `${((book.ask - book.bid) * 100).toFixed(1)}¢`
          : '—'}
      </div>
      {(book?.bids ?? []).map(([p, q]) => (
        <div key={`bid${p}`} className="flex justify-between font-mono text-[11px] leading-5">
          <span className="text-emerald-300">{(p * 100).toFixed(1)}¢</span>
          <span>{q.toFixed(1)}</span>
        </div>
      ))}
      {book && <p className="mt-2 text-[9px] text-muted-foreground">{clock(book.timestamp)}</p>}
    </div>
  )
}
