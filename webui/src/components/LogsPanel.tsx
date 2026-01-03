import { useEffect, useMemo, useRef, useState } from 'react'

type ParsedLine = {
  raw: string
  group: string
  groupToken: string
  rest: string
}

function parseGroup(line: string): ParsedLine {
  const m = line.match(/^\[([^\]]+)\]/)
  if (!m) return { raw: line, group: 'untagged', groupToken: '', rest: line }
  const group = m[1] || 'untagged'
  const groupToken = m[0]
  const rest = line.slice(groupToken.length)
  return { raw: line, group, groupToken, rest }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const GROUP_COLOR_CLASSES = [
  'text-sky-300',
  'text-emerald-300',
  'text-amber-300',
  'text-fuchsia-300',
  'text-lime-300',
  'text-violet-300',
  'text-cyan-300',
  'text-rose-300',
  'text-indigo-300',
  'text-teal-300',
] as const

function groupColorClass(group: string): string {
  const idx = hashString(group) % GROUP_COLOR_CLASSES.length
  return GROUP_COLOR_CLASSES[idx] ?? 'text-zinc-300'
}

function normalize(s: string): string {
  return s.toLowerCase()
}

export function LogsPanel(props: { logLines: string[] }) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)

  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const parsed = useMemo(() => {
    return props.logLines.map(parseGroup)
  }, [props.logLines])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const p of parsed) set.add(p.group)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [parsed])

  // Keep selectedGroups in sync as new groups appear (default ON).
  useEffect(() => {
    setSelectedGroups((prev) => {
      let changed = false
      const next: Record<string, boolean> = { ...prev }
      for (const g of groups) {
        if (typeof next[g] !== 'boolean') {
          next[g] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [groups])

  const filtered = useMemo(() => {
    const q = normalize(search.trim())
    return parsed.filter((p) => {
      if (filterEnabled && selectedGroups[p.group] === false) return false
      if (!q) return true
      return normalize(p.raw).includes(q)
    })
  }, [filterEnabled, parsed, search, selectedGroups])

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollerRef.current
    if (!el) return
    // Scroll ONLY the log container (avoid scrolling the whole page).
    el.scrollTop = el.scrollHeight
  }, [autoScroll, filtered.length])

  // Fullscreen UX: ESC to exit + prevent background scroll.
  useEffect(() => {
    if (!isFullscreen) return

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isFullscreen])

  const selectedCount = useMemo(() => {
    if (!filterEnabled) return groups.length
    let n = 0
    for (const g of groups) if (selectedGroups[g] !== false) n++
    return n
  }, [filterEnabled, groups, selectedGroups])

  return (
    <div
      className={
        isFullscreen ? 'fixed inset-0 z-50 bg-zinc-950/70 p-2 sm:p-3 backdrop-blur' : 'w-full max-w-full min-w-0'
      }
    >
      <div className={['panel p-3 w-full max-w-full min-w-0', isFullscreen ? 'h-full flex flex-col' : ''].join(' ')}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[17px] font-semibold">logs</div>
            <button
              type="button"
              className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800 hover:bg-zinc-900/80"
              onClick={() => setIsFullscreen((v) => !v)}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            >
              {isFullscreen ? 'exit fullscreen' : 'fullscreen'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[16px] text-zinc-300">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              autoscroll
            </label>

            <label className="flex items-center gap-2 text-[16px] text-zinc-300">
              <input
                type="checkbox"
                checked={filterEnabled}
                onChange={(e) => setFilterEnabled(e.target.checked)}
              />
              filter by group
            </label>
          </div>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            className="w-full sm:w-[28rem] rounded-md bg-zinc-900/40 px-3 py-2 text-[16px] text-zinc-200 ring-1 ring-zinc-800 placeholder:text-zinc-500"
            placeholder="search logs (e.g. matched, connected, btcusdt, price_to_beat)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {search.trim() ? (
            <button
              type="button"
              className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800 hover:bg-zinc-900/80"
              onClick={() => setSearch('')}
            >
              clear search
            </button>
          ) : null}

          <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
            lines <span className="ml-1 font-mono">{filtered.length}</span> /{' '}
            <span className="ml-1 font-mono">{parsed.length}</span>
          </span>

          {filterEnabled ? (
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              groups <span className="ml-1 font-mono">{selectedCount}</span> /{' '}
              <span className="ml-1 font-mono">{groups.length}</span>
            </span>
          ) : null}
        </div>

        {filterEnabled && groups.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800 hover:bg-zinc-900/80"
              onClick={() => {
                const next: Record<string, boolean> = {}
                for (const g of groups) next[g] = true
                setSelectedGroups(next)
              }}
              type="button"
            >
              all
            </button>

            <button
              className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800 hover:bg-zinc-900/80"
              onClick={() => {
                const next: Record<string, boolean> = {}
                for (const g of groups) next[g] = false
                setSelectedGroups(next)
              }}
              type="button"
            >
              none
            </button>

            <div className="mx-1 w-px self-stretch bg-zinc-800" />

            {groups.map((g) => {
              const on = selectedGroups[g] !== false
              const c = groupColorClass(g)
              return (
                <button
                  key={g}
                  type="button"
                  className={[
                    'chip ring-1',
                    on ? 'bg-zinc-900/70 ring-zinc-700' : 'bg-zinc-900/30 ring-zinc-800 opacity-60',
                    'hover:bg-zinc-900/80',
                  ].join(' ')}
                  onClick={() => setSelectedGroups((prev) => ({ ...prev, [g]: prev[g] === false }))}
                  title={`Toggle ${g}`}
                >
                  <span className={['font-mono', c].join(' ')}>[{g}]</span>
                </button>
              )
            })}
          </div>
        ) : null}

        <div
          ref={scrollerRef}
          className={[
            'overflow-auto overscroll-contain max-w-full min-w-0 rounded-md bg-zinc-900/40 p-3 font-mono text-[16px] ring-1 ring-zinc-800',
            isFullscreen ? 'flex-1 min-h-0' : 'h-[42rem]',
          ].join(' ')}
        >
          {filtered.length === 0 ? (
            <div className="text-zinc-500">no logs</div>
          ) : (
            <div className="whitespace-pre-wrap break-words text-zinc-200">
              {filtered.map((p, idx) => {
                if (!p.groupToken) {
                  return (
                    <div key={idx} className="leading-relaxed">
                      {p.rest}
                    </div>
                  )
                }

                const c = groupColorClass(p.group)
                return (
                  <div key={idx} className="leading-relaxed">
                    <span className={c}>{p.groupToken}</span>
                    <span>{p.rest}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


