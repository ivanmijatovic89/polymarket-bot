import blessed from 'blessed'
import { createRequire } from 'node:module'
import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../../market/orderbook/index.js'

export type TradingBotTui = {
  start: () => void
  stop: () => void
}

export type TradingBotTuiState = {
  symbol: string
  slug?: string
  candleLeftMs: number
  wsAttempt: number
  wsEventsTotal: number
  market?: MarketOrderBooksSnapshot
  upAssetId?: string
  downAssetId?: string
}

export type TradingBotTuiOptions = {
  title: string
  getState: () => TradingBotTuiState
  /**
   * Entire log history as lines. We'll append diffs into a log widget.
   */
  getLogLines: () => string[]
  /**
   * Optional: intention-specific log history (typically filtered from the main logger).
   */
  getIntentLogLines?: () => string[]
  onExitRequest?: () => void
  /**
   * How many orderbook levels per side to render. Default 8.
   */
  orderbookLevels?: number
  /**
   * UI refresh cadence. Default 250ms.
   */
  refreshMs?: number
}

const require = createRequire(import.meta.url)
// blessed-contrib is CommonJS (export =) so require() is the most reliable interop under NodeNext ESM.
const contrib = require('blessed-contrib') as typeof import('blessed-contrib')

function fmtPrice(n: number | null | undefined, width = 7): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'.padStart(width, ' ')
  return n.toFixed(4).padStart(width, ' ')
}

function fmtSize(n: number | null | undefined, width = 8): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'.padStart(width, ' ')
  return n.toFixed(3).padStart(width, ' ')
}

function shortAsset(id: string | undefined): string {
  if (!id) return 'n/a'
  return `…${id.slice(-8)}`
}

function renderTop(state: TradingBotTuiState): string {
  const snap = state.market
  const up = state.upAssetId ? snap?.byAssetId[state.upAssetId] : undefined
  const down = state.downAssetId ? snap?.byAssetId[state.downAssetId] : undefined

  const upAsk = fmtPrice(up?.bestAsk ?? null)
  const downAsk = fmtPrice(down?.bestAsk ?? null)

  return (
    `{bold}UP{/bold}   bestAsk=${upAsk}  asset=${shortAsset(state.upAssetId)}\n` +
    `{bold}DOWN{/bold} bestAsk=${downAsk}  asset=${shortAsset(state.downAssetId)}`
  )
}

function renderBottomStatus(state: TradingBotTuiState): string {
  const slug = state.slug ?? 'n/a'
  return `[trading-bot] symbol=${state.symbol} slug=${slug} candle_left_ms=${state.candleLeftMs} ws_attempt=${state.wsAttempt} ws_events_total=${state.wsEventsTotal}`
}

function renderOneBook(label: 'UP' | 'DOWN', book: OrderBookSnapshot | undefined, levels: number): string {
  const bb = fmtPrice(book?.bestBid ?? null)
  const ba = fmtPrice(book?.bestAsk ?? null)
  const spread =
    typeof book?.bestBid === 'number' &&
    Number.isFinite(book.bestBid) &&
    typeof book?.bestAsk === 'number' &&
    Number.isFinite(book.bestAsk)
      ? book.bestAsk - book.bestBid
      : null
  const spreadStr = spread === null ? 'n/a' : spread.toFixed(4)
  const out: string[] = []
  // Keep header short so side-by-side columns don't push each other off-screen.
  out.push(`{bold}${label}{/bold} {red-fg}${ba}{/} / {green-fg}${bb}{/}`)
  const bids = book?.bids ?? []
  const asks = book?.asks ?? []
  out.push(`{gray-fg}ASK (px/size){/}`)
  for (let i = levels - 1; i >= 0; i--) {
    const a = asks[i]
    const aStr = a ? `{red-fg}${fmtPrice(a.price)}{/}/${fmtSize(a.size)}` : '   -   /   -   '
    out.push(`${String(i + 1).padStart(2, ' ')} ${aStr}`)
  }
  out.push(`{gray-fg}--- spread=${spreadStr} ---{/}`)
  out.push(`{gray-fg}BID (px/size){/}`)
  for (let i = 0; i < levels; i++) {
    const b = bids[i]
    const bStr = b ? `{green-fg}${fmtPrice(b.price)}{/}/${fmtSize(b.size)}` : '   -   /   -   '
    out.push(`${String(i + 1).padStart(2, ' ')} ${bStr}`)
  }
  return out.join('\n')
}

function getUpDownBooks(state: TradingBotTuiState): { up?: OrderBookSnapshot; down?: OrderBookSnapshot } {
  const snap = state.market
  const up = state.upAssetId ? snap?.byAssetId[state.upAssetId] : undefined
  const down = state.downAssetId ? snap?.byAssetId[state.downAssetId] : undefined
  return {
    ...(up ? { up } : {}),
    ...(down ? { down } : {}),
  }
}

export function createTradingBotTui(opts: TradingBotTuiOptions): TradingBotTui {
  let running = false
  let renderTimer: NodeJS.Timeout | undefined
  let lastLogLenAll = 0
  let lastLogLenIntents = 0

  const screen = blessed.screen({
    smartCSR: true,
    title: opts.title,
    dockBorders: true,
    fullUnicode: true,
  })

  // Use blessed-contrib grid for layout (no more brittle % math).
  // Keep widgets as blessed primitives for now; we'll swap in contrib.table/log later.
  // Use 24 columns so we can split the right pane into 2 equal columns cleanly.
  const grid = new contrib.grid({ rows: 12, cols: 24, screen })

  const top = grid.set(0, 0, 2, 24, blessed.box, {
    tags: true,
    border: 'line',
    style: { border: { fg: 'green' } },
    content: '',
  }) as blessed.Widgets.BoxElement

  const logAll = grid.set(2, 0, 4, 18, contrib.log, {
    label: 'log',
    tags: true,
    border: 'line',
    style: { border: { fg: 'gray' } },
    bufferLength: 5000,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
  }) as unknown as { log: (s: string) => void; setItems?: (items: string[]) => void; logLines?: string[] }

  const logIntents = grid.set(6, 0, 4, 18, contrib.log, {
    label: 'intents',
    tags: true,
    border: 'line',
    style: { border: { fg: 'gray' } },
    bufferLength: 2000,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
  }) as unknown as { log: (s: string) => void; setItems?: (items: string[]) => void; logLines?: string[] }

  const rightUp = grid.set(2, 18, 8, 3, blessed.box, {
    tags: true,
    border: 'line',
    style: { border: { fg: 'magenta' } },
    content: '',
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
  }) as blessed.Widgets.BoxElement

  const rightDown = grid.set(2, 21, 8, 3, blessed.box, {
    tags: true,
    border: 'line',
    style: { border: { fg: 'magenta' } },
    content: '',
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
  }) as blessed.Widgets.BoxElement

  const status = grid.set(10, 0, 2, 24, blessed.box, {
    tags: false,
    border: 'line',
    style: { border: { fg: 'cyan' } },
    content: '',
  }) as blessed.Widgets.BoxElement

  const renderOnce = (): void => {
    const state = (() => {
      try {
        return opts.getState()
      } catch {
        return {
          symbol: 'n/a',
          candleLeftMs: 0,
          wsAttempt: 0,
          wsEventsTotal: 0,
        } satisfies TradingBotTuiState
      }
    })()

    // Top panel
    try {
      top.setContent(renderTop(state))
    } catch {
      top.setContent('(error rendering top panel)')
    }

    // Bottom status line (single line)
    try {
      status.setContent(renderBottomStatus(state))
    } catch {
      status.setContent('(error rendering status)')
    }

    const readLines = (get: () => string[]): string[] => {
      try {
        return get()
      } catch {
        return []
      }
    }

    const resetLog = (w: { setItems?: (items: string[]) => void; logLines?: string[] }): void => {
      // blessed-contrib log maintains an internal `logLines` buffer; clear it if present.
      if (Array.isArray(w.logLines)) w.logLines.length = 0
      w.setItems?.([])
    }

    const syncLog = (
      w: { log: (s: string) => void; setItems?: (items: string[]) => void; logLines?: string[] },
      lines: string[],
      lastLen: number,
    ): number => {
      if (lines.length < lastLen) {
        resetLog(w)
        for (const ln of lines) if (typeof ln === 'string') w.log(ln)
        return lines.length
      }
      if (lines.length > lastLen) {
        for (let i = lastLen; i < lines.length; i++) {
          const ln = lines[i]
          if (typeof ln === 'string') w.log(ln)
        }
        return lines.length
      }
      return lastLen
    }

    // Log panes: append only new lines to avoid re-rendering the whole buffer.
    const allLines = readLines(opts.getLogLines)
    lastLogLenAll = syncLog(logAll, allLines, lastLogLenAll)

    const intentLines = opts.getIntentLogLines ? readLines(opts.getIntentLogLines) : []
    lastLogLenIntents = syncLog(logIntents, intentLines, lastLogLenIntents)

    // Right pane
    try {
      const levels = Math.max(1, opts.orderbookLevels ?? 8)
      const { up, down } = getUpDownBooks(state)
      rightUp.setContent(renderOneBook('UP', up, levels))
      rightDown.setContent(renderOneBook('DOWN', down, levels))
    } catch {
      rightUp.setContent('(error)')
      rightDown.setContent('(error)')
    }

    screen.render()
  }

  const stop = (): void => {
    if (!running) return
    running = false
    if (renderTimer) clearInterval(renderTimer)
    renderTimer = undefined
    try {
      screen.destroy()
    } catch {
      // ignore
    }
  }

  const start = (): void => {
    if (running) return
    running = true

    screen.key([ 'C-c'], () => {
      if (opts.onExitRequest) opts.onExitRequest()
      else stop()
    })

    const refreshMs = Math.max(50, opts.refreshMs ?? 250)
    renderOnce()
    renderTimer = setInterval(renderOnce, refreshMs)
  }

  return { start, stop }
}


