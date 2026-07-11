'use client'

import { useEffect, type RefObject } from 'react'

type Options = {
  /** Viewport offset (px) to pin the floating header at. Defaults to the height
   * of the page's sticky `<header>` (app nav), or 0 if there isn't one. */
  top?: number
  /** Turn the behaviour off without unmounting the host component. */
  enabled?: boolean
}

/**
 * Viewport-sticky header for a horizontally-scrollable table — without the
 * bounded inner scroll region a pure-CSS `position: sticky` would require.
 *
 * Why JS: a wide table needs `overflow-x: auto`, and CSS forces the cross axis
 * to `auto` too, which traps `position: sticky` inside that scroll box (and
 * shows a vertical scrollbar). Instead we let the page scroll normally (no box,
 * no vertical scrollbar) and, once the real `<thead>` scrolls above the pin
 * line, paint a `position: fixed` clone of it that mirrors the table's
 * horizontal scroll and column widths.
 *
 * Generic: pass a ref to the element that scrolls horizontally (the wrapper
 * that has `overflow-x: auto` and directly contains the `<table>`). Works with
 * any table markup, including grouped (multi-row) headers.
 */
export function useStickyTableHeader(
  containerRef: RefObject<HTMLElement | null>,
  { top, enabled = true }: Options = {},
) {
  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return
    const table = container.querySelector('table')
    const thead = table?.querySelector('thead') as HTMLElement | null
    if (!table || !thead) return

    // Fixed overlay that holds a clone of the header, clipped to the table's
    // visible width and translated to match horizontal scroll.
    const overlay = document.createElement('div')
    overlay.className = 'bg-card'
    Object.assign(overlay.style, {
      position: 'fixed',
      overflow: 'hidden',
      zIndex: '20',
      display: 'none',
      pointerEvents: 'none',
      boxShadow: '0 1px 0 0 var(--border)',
    } satisfies Partial<CSSStyleDeclaration>)

    const cloneTable = document.createElement('table')
    cloneTable.className = table.className
    cloneTable.setAttribute('aria-hidden', 'true')
    Object.assign(cloneTable.style, { margin: '0', tableLayout: 'fixed' })
    const colgroup = document.createElement('colgroup')
    cloneTable.appendChild(colgroup)
    cloneTable.appendChild(thead.cloneNode(true))
    overlay.appendChild(cloneTable)
    document.body.appendChild(overlay)

    const pinTop = () =>
      top ?? (document.querySelector('header')?.getBoundingClientRect().height ?? 0)

    const update = () => {
      const cRect = container.getBoundingClientRect()
      const tRect = table.getBoundingClientRect()
      const headH = thead.getBoundingClientRect().height
      const y = pinTop()
      const show = tRect.top < y && tRect.bottom > y + headH && cRect.width > 0
      if (!show) {
        overlay.style.display = 'none'
        return
      }
      // Mirror column widths from the real body row (leaf columns, no spans).
      const bodyRow = table.querySelector('tbody tr')
      if (bodyRow) {
        const widths = Array.from(bodyRow.children, (c) => c.getBoundingClientRect().width)
        if (colgroup.childElementCount !== widths.length) {
          colgroup.replaceChildren(...widths.map(() => document.createElement('col')))
        }
        widths.forEach((w, i) => {
          ;(colgroup.children[i] as HTMLElement).style.width = `${w}px`
        })
      }
      overlay.style.display = 'block'
      overlay.style.top = `${y}px`
      overlay.style.left = `${cRect.left}px`
      overlay.style.width = `${cRect.width}px`
      overlay.style.height = `${headH}px`
      cloneTable.style.width = `${tRect.width}px`
      cloneTable.style.transform = `translateX(${-container.scrollLeft}px)`
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    container.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(table)
    update()

    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      container.removeEventListener('scroll', update)
      ro.disconnect()
      overlay.remove()
    }
  }, [containerRef, top, enabled])
}
