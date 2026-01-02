import blessed from 'blessed'

export type TradingBotTui = {
  start: () => void
  stop: () => void
}

export type TradingBotTuiOptions = {
  title: string
  /**
   * Top panel text (e.g. prices).
   */
  getTopText: () => string
  /**
   * Bottom status text (slug, boundary countdown, ws attempt, etc).
   */
  getBottomStatusLine: () => string
  /**
   * Entire log history as lines. We'll append diffs into a blessed.log widget.
   */
  getLogLines: () => string[]
  onExitRequest?: () => void
  /**
   * UI refresh cadence. Default 250ms.
   */
  refreshMs?: number
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
    height: 5,
    tags: true,
    border: 'line',
    style: { border: { fg: 'green' } },
    content: '',
  })

  const log = blessed.log({
    top: 5,
    left: 0,
    width: '100%',
    height: '100%-8',
    tags: false,
    border: 'line',
    style: { border: { fg: 'gray' } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ' },
    keys: true,
    vi: true,
    mouse: true,
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
  screen.append(status)

  const renderOnce = (): void => {
    // Top panel
    try {
      top.setContent(opts.getTopText())
    } catch {
      top.setContent('(error rendering top panel)')
    }

    // Bottom status line (single line)
    try {
      status.setContent(opts.getBottomStatusLine())
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

    screen.key(['C-c'], () => {
      if (opts.onExitRequest) opts.onExitRequest()
      else stop()
    })

    const refreshMs = Math.max(50, opts.refreshMs ?? 250)
    renderOnce()
    renderTimer = setInterval(renderOnce, refreshMs)
  }

  return { start, stop }
}


