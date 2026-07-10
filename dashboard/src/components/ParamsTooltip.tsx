'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

type ParamsTooltipProps = {
  strategy: string
  params: Record<string, unknown> | null | undefined
}

type Entry = { key: string; value: string }

/** Flatten params into displayable key/value rows. Objects are JSON-encoded. */
function toEntries(params: Record<string, unknown>): Entry[] {
  return Object.entries(params).map(([key, v]) => ({
    key,
    value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
  }))
}

/**
 * Strategy label with a styled hover popover listing its params.
 *
 * Replaces the native `title` tooltip: no ~1s browser delay, readable
 * key/value layout, theme-aware. Uses `position: fixed` anchored to the
 * trigger's bounding rect so it escapes the table's `overflow-x-auto`
 * clipping instead of being cut off.
 *
 * When `params` is empty/absent it degrades to plain text (no affordance).
 */
export function ParamsTooltip({ strategy, params }: ParamsTooltipProps) {
  const entries = params ? toEntries(params) : []
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  })

  const show = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => setOpen(true), 120)
  }, [])

  const hide = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    setOpen(false)
  }, [])

  // Position after the popover has mounted so we can measure its real size and
  // flip / clamp it inside the viewport.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const pop = popoverRef.current
    if (!trigger || !pop) return
    const t = trigger.getBoundingClientRect()
    const p = pop.getBoundingClientRect()
    const margin = 8
    const gap = 6
    const placeBelow = t.bottom + gap + p.height <= window.innerHeight - margin
    const top = placeBelow ? t.bottom + gap : t.top - gap - p.height
    const left = Math.max(margin, Math.min(t.left, window.innerWidth - p.width - margin))
    setPos({ top, left, placement: placeBelow ? 'bottom' : 'top' })
  }, [open])

  if (entries.length === 0) {
    return <>{strategy || '—'}</>
  }

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      className="decoration-dotted underline underline-offset-4 decoration-muted-foreground/50 outline-none"
    >
      {strategy || '—'}
      {open && (
        <div
          ref={popoverRef}
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-50 max-w-sm rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b px-3.5 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Params
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-2.5 text-sm">
            {entries.map((e) => (
              <div key={e.key} className="contents">
                <dt className="font-mono text-muted-foreground">{e.key}</dt>
                <dd className="font-mono break-all">{e.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </span>
  )
}
