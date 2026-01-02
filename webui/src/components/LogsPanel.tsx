import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogRecord } from '../types'

type Mode = 'text' | 'json'

function fmtTime(tsMs: number): string {
  try {
    return new Date(tsMs).toISOString().slice(11, 23)
  } catch {
    return 'n/a'
  }
}

function levelColor(level: string): string {
  if (level === 'error') return 'text-red-300'
  if (level === 'warn') return 'text-amber-300'
  if (level === 'debug') return 'text-cyan-300'
  return 'text-zinc-200'
}

export function LogsPanel(props: { logLines: string[]; logRecords: LogRecord[] }) {
  const [mode, setMode] = useState<Mode>('text')
  const [autoScroll, setAutoScroll] = useState(true)
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!autoScroll) return
    tailRef.current?.scrollIntoView({ block: 'end' })
  }, [autoScroll, props.logLines.length, props.logRecords.length, mode])

  const jsonText = useMemo(() => {
    return props.logRecords
      .slice(-500)
      .map((r) => {
        const fields = r.fields ? ` ${JSON.stringify(r.fields)}` : ''
        const data = r.data !== undefined ? ` data=${JSON.stringify(r.data)}` : ''
        const err = r.err ? ` err=${JSON.stringify(r.err)}` : ''
        return `${fmtTime(r.tsMs)} ${r.level.toUpperCase().padEnd(5, ' ')} ${r.msg}${fields}${data}${err}`
      })
      .join('\n')
  }, [props.logRecords])

  return (
    <div className="rounded-lg bg-zinc-950/40 p-3 ring-1 ring-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">logs</div>

        <div className="flex items-center gap-2">
          <div className="rounded-md bg-zinc-900/60 p-1 text-xs ring-1 ring-zinc-800">
            <button
              className={`rounded px-2 py-1 ${mode === 'text' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'}`}
              onClick={() => setMode('text')}
            >
              text
            </button>
            <button
              className={`rounded px-2 py-1 ${mode === 'json' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'}`}
              onClick={() => setMode('json')}
            >
              json
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            autoscroll
          </label>
        </div>
      </div>

      <div className="h-[28rem] overflow-auto rounded-md bg-zinc-900/40 p-2 font-mono text-xs ring-1 ring-zinc-800">
        {mode === 'text' ? (
          <>
            {props.logLines.length === 0 ? (
              <div className="text-zinc-500">no logs yet</div>
            ) : (
              props.logLines.slice(-2000).map((ln, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-words text-zinc-200">
                  {ln}
                </div>
              ))
            )}
          </>
        ) : (
          <>
            {props.logRecords.length === 0 ? (
              <div className="text-zinc-500">no logs yet</div>
            ) : (
              props.logRecords.slice(-500).map((r, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-words">
                  <span className="text-zinc-500">{fmtTime(r.tsMs)}</span>{' '}
                  <span className={levelColor(r.level)}>{r.level.toUpperCase().padEnd(5, ' ')}</span>{' '}
                  <span className="text-zinc-200">{r.msg}</span>
                  {r.fields ? <span className="text-zinc-400"> {JSON.stringify(r.fields)}</span> : null}
                  {r.data !== undefined ? <span className="text-zinc-500"> data={JSON.stringify(r.data)}</span> : null}
                  {r.err ? <span className="text-red-200"> err={JSON.stringify(r.err)}</span> : null}
                </div>
              ))
            )}
          </>
        )}
        <div ref={tailRef} />
      </div>
    </div>
  )
}


