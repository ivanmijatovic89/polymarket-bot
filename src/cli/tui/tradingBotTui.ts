import blessed from 'blessed'
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
   * Entire log history as lines. We'll append diffs into a blessed.log widget.
   */
  getLogLines: () => string[]
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
  let lastLogLen = 0

  const screen = blessed.screen({
    smartCSR: true,
    title: opts.title,
    dockBorders: true,
    fullUnicode: true,
  })

  const top = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 4,
    tags: true,
    border: 'line',
    style: { border: { fg: 'green' } },
    content: '',
  })

  const log = blessed.log({
    top: 4,
    left: 0,
    width: '80%',
    height: '100%-7',
    tags: true,
    border: 'line',
    style: { border: { fg: 'gray' } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
  })

  const right = blessed.box({
    top: 4,
    left: '80%',
    width: '20%',
    height: '100%-7',
    tags: true,
    border: 'line',
    style: { border: { fg: 'magenta' } },
    content: '',
  })

  // Two child boxes so UP and DOWN are guaranteed visible (no string padding/clipping issues).
  const rightUp = blessed.box({
    parent: right,
    top: 0,
    left: 0,
    width: '50%',
    height: '100%',
    tags: true,
    // No border here: outer `right` already has a border. Nested borders waste space.
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
    content: '',
  })

  const rightDown = blessed.box({
    parent: right,
    top: 0,
    left: '50%',
    width: '50%',
    height: '100%',
    tags: true,
    // No border here: outer `right` already has a border. Nested borders waste space.
    padding: { left: 1, right: 1 },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
    content: '',
  })

  const status = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: false,
    border: 'line',
    style: { border: { fg: 'cyan' } },
    content: '',
  })

  screen.append(top)
  screen.append(log)
  screen.append(right)
  screen.append(status)

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

    // Log lines (append only new lines to avoid re-rendering the whole buffer)
    const lines = (() => {
      try {
        return opts.getLogLines()
      } catch {
        return []
      }
    })()

    if (lines.length < lastLogLen) {
      // buffer trimmed -> rebuild the widget content
      ;(log as unknown as { setContent: (s: string) => void }).setContent('')
      for (const ln of lines) log.log(ln)
      lastLogLen = lines.length
    } else if (lines.length > lastLogLen) {
      for (let i = lastLogLen; i < lines.length; i++) {
        const ln = lines[i]
        if (typeof ln === 'string') log.log(ln)
      }
      lastLogLen = lines.length
    }

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


