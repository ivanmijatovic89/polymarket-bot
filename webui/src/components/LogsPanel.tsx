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

function safeStringify(v: unknown): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      v,
      (_key, value) => {
        if (typeof value === 'bigint') return `${value}n`
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          }
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
        }
        return value
      },
      0,
    )
  } catch (err) {
    return `[unserializable: ${(err as Error)?.message ?? String(err)}]`
  }
}

function levelColor(level: string): string {
  if (level === 'error') return 'text-red-300'
  if (level === 'warn') return 'text-amber-300'
  if (level === 'debug') return 'text-cyan-300'
  return 'text-zinc-200'
}

export function LogsPanel(props: { logLines: string[]; logRecords: LogRecord[] }) {
  const [mode, setMode] = useState<Mode>('json')
  const [autoScroll, setAutoScroll] = useState(true)
  const TYPE_ALL = '__all__'
  const TYPE_NONE = '__none__'
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_ALL)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const types = useMemo(() => {
    const set = new Set<string>()
    let hasNone = false
    for (const r of props.logRecords) {
      const t = (r.fields as any)?.type
      if (typeof t === 'string' && t.trim().length > 0) set.add(t)
      else hasNone = true
    }
    return { list: Array.from(set).sort(), hasNone }
  }, [props.logRecords])

  const filteredRecords = useMemo(() => {
    if (typeFilter === TYPE_ALL) return props.logRecords
    if (typeFilter === TYPE_NONE) {
      return props.logRecords.filter((r) => {
        const t = (r.fields as any)?.type
        return !(typeof t === 'string' && t.trim().length > 0)
      })
    }
    return props.logRecords.filter((r) => (r.fields as any)?.type === typeFilter)
  }, [props.logRecords, typeFilter])

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollerRef.current
    if (!el) return
    // Scroll ONLY the log container (avoid scrolling the whole page).
    el.scrollTop = el.scrollHeight
  }, [autoScroll, props.logLines.length, filteredRecords.length, mode])

  const jsonText = useMemo(() => {
    return filteredRecords
      .slice(-500)
      .map((r) => {
        const fields = r.fields ? ` ${safeStringify(r.fields)}` : ''
        const data = r.data !== undefined ? ` data=${safeStringify(r.data)}` : ''
        const err = r.err ? ` err=${safeStringify(r.err)}` : ''
        return `${fmtTime(r.tsMs)} ${r.msg}${fields}${data}${err}`
      })
      .join('\n')
  }, [filteredRecords])

  const text = useMemo(() => {
    return mode === 'text' ? props.logLines.slice(-2000).join('\n') : jsonText
  }, [mode, props.logLines, jsonText])

  return (
    <div className="panel p-3 w-full max-w-full min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[17px] font-semibold">logs</div>

        <div className="flex items-center gap-2">
          {mode === 'json' ? (
            <select
              className="rounded-md bg-zinc-900/60 px-2 py-1 text-[16px] text-zinc-200 ring-1 ring-zinc-800"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              title="Filter by fields.type"
            >
              <option value={TYPE_ALL}>type: all</option>
              {types.hasNone ? <option value={TYPE_NONE}>type: (none)</option> : null}
              {types.list.map((t) => (
                <option key={t} value={t}>
                  type: {t}
                </option>
              ))}
            </select>
          ) : null}

          <div className="rounded-md bg-zinc-900/60 p-1 text-[16px] ring-1 ring-zinc-800">
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

          <label className="flex items-center gap-2 text-[16px] text-zinc-300">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            autoscroll
          </label>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="h-[42rem] overflow-auto overscroll-contain max-w-full min-w-0 rounded-md bg-zinc-900/40 p-3 font-mono text-[16px] ring-1 ring-zinc-800"
      >
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
            {filteredRecords.length === 0 ? (
              <div className="text-zinc-500">no logs yet</div>
            ) : (
              filteredRecords.slice(-500).map((r, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-words">
                  {/* <span className="text-zinc-500">{fmtTime(r.tsMs)}</span>{' '} */}
                  <span className={levelColor(r.level)}>{r.msg}</span>
                  {r.fields ? <span className={levelColor(r.level)}> {safeStringify(r.fields)}</span> : null}
                  {r.data !== undefined ? (
                    <span className={levelColor(r.level)}> data={safeStringify(r.data)}</span>
                  ) : null}
                  {r.err ? <span className={levelColor(r.level)}> err={safeStringify(r.err)}</span> : null}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}


