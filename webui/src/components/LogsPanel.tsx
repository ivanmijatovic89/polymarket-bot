import { useEffect, useMemo, useRef, useState } from 'react'

function fmtTime(tsMs: number): string {
  try {
    return new Date(tsMs).toISOString().slice(11, 23)
  } catch {
    return 'n/a'
  }
}

export function LogsPanel(props: { logLines: string[] }) {
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollerRef.current
    if (!el) return
    // Scroll ONLY the log container (avoid scrolling the whole page).
    el.scrollTop = el.scrollHeight
  }, [autoScroll, props.logLines.length])

  const text = useMemo(() => {
    return props.logLines.join('\n')
  }, [props.logLines])

  return (
    <div className="panel p-3 w-full max-w-full min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[17px] font-semibold">logs</div>

        <div className="flex items-center gap-2">
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
        {props.logLines.length === 0 ? (
          <div className="text-zinc-500">no logs yet</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-zinc-200">{text}</pre>
        )}
      </div>
    </div>
  )
}


