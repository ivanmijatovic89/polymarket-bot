import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import type { LogRecord, SequencedWindow } from '../../utils/logger.js'
import { toBotUiOrderBook, type BotUiSnapshot, type BotUiSourceState } from './botUiState.js'

export type TradingBotWebUiServer = {
  start: () => void
  stop: () => void
}

export type TradingBotWebUiServerOptions = {
  title: string
  host: string
  port: number
  /**
   * UI refresh cadence. Default 250ms.
   */
  refreshMs?: number
  /**
   * How many orderbook levels per side to include in snapshots. Default 8.
   */
  orderbookLevels?: number

  getState: () => BotUiSourceState
  /** Sequenced, fixed-size window for log lines (preferred). */
  getLogLinesWindow?: () => SequencedWindow<string>
  /** Sequenced, fixed-size window for structured log records (preferred). */
  getLogRecordsWindow?: () => SequencedWindow<LogRecord>

  /**
   * Where the frontend build output lives. Default: <repo>/webui/dist
   *
   * NOTE: We keep it runtime-configurable so you can point it at a custom build dir.
   */
  distDir?: string
}

type ClientState = {
  ws: WebSocket
  nextLineSeq: number
  nextRecordSeq: number
}

type WsSnapshotMsg = {
  type: 'snapshot'
  snapshot: BotUiSnapshot
  logsText?: { from: number; to: number; lines: string[] }
  logsJson?: { from: number; to: number; records: LogRecord[] }
}

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x)
  } catch {
    return JSON.stringify({ type: 'error', error: 'json_stringify_failed' })
  }
}

function mimeForExt(ext: string): string {
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.ico') return 'image/x-icon'
  if (ext === '.map') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function resolveDefaultDistDir(): string {
  // When running via tsx from repo root, cwd is already the repo root.
  // Keep this simple and overrideable (opts.distDir).
  return join(process.cwd(), 'webui', 'dist')
}

function readIndexHtml(distDir: string): string | null {
  try {
    const p = join(distDir, 'index.html')
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function serveStatic(distDir: string, req: IncomingMessage, res: ServerResponse): void {
  const urlRaw = req.url ?? '/'
  const u = new URL(urlRaw, 'http://local')
  const pathname = u.pathname

  // Basic path normalization + traversal protection.
  const rel = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '')
  const filePath = join(distDir, rel)

  const send = (status: number, contentType: string, body: string | Buffer): void => {
    res.statusCode = status
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-cache')
    res.end(body)
  }

  // SPA routing: serve index.html for non-asset routes.
  const ext = extname(filePath)
  const looksLikeAsset = ext.length > 0

  if (!looksLikeAsset) {
    const html = readIndexHtml(distDir)
    if (!html) {
      send(
        503,
        'text/plain; charset=utf-8',
        `Web UI not built. Expected ${join(distDir, 'index.html')}.\n\nRun: npm run webui:build\n`,
      )
      return
    }
    send(200, 'text/html; charset=utf-8', html)
    return
  }

  try {
    const st = statSync(filePath)
    if (!st.isFile()) throw new Error('not_a_file')
    const buf = readFileSync(filePath)
    send(200, mimeForExt(ext), buf)
  } catch {
    // If asset missing, still fall back to index.html (nice for client-side routing).
    const html = readIndexHtml(distDir)
    if (html) send(200, 'text/html; charset=utf-8', html)
    else send(404, 'text/plain; charset=utf-8', 'not found')
  }
}

function buildSnapshot(args: {
  title: string
  state: BotUiSourceState
  orderbookLevels: number
}): BotUiSnapshot {
  const nowMs = Date.now()
  const snap = args.state.market
  const up = args.state.upAssetId ? snap?.byAssetId[args.state.upAssetId] : undefined
  const down = args.state.downAssetId ? snap?.byAssetId[args.state.downAssetId] : undefined

  return {
    nowMs,
    title: args.title,
    status: {
      symbol: args.state.symbol,
      ...(typeof args.state.slug === 'string' ? { slug: args.state.slug } : {}),
      candleLeftMs: args.state.candleLeftMs,
      wsAttempt: args.state.wsAttempt,
      wsEventsTotal: args.state.wsEventsTotal,
      ...(typeof args.state.upAssetId === 'string' ? { upAssetId: args.state.upAssetId } : {}),
      ...(typeof args.state.downAssetId === 'string' ? { downAssetId: args.state.downAssetId } : {}),
    },
    books: {
      ...(up ? { up: toBotUiOrderBook(up, args.orderbookLevels) } : {}),
      ...(down ? { down: toBotUiOrderBook(down, args.orderbookLevels) } : {}),
    },
  }
}

export function createTradingBotWebUiServer(opts: TradingBotWebUiServerOptions): TradingBotWebUiServer {
  let running = false
  let timer: NodeJS.Timeout | undefined
  const clients = new Set<ClientState>()

  const distDir = opts.distDir ?? resolveDefaultDistDir()
  const refreshMs = Math.max(50, opts.refreshMs ?? 250)
  const orderbookLevels = Math.max(1, Math.floor(opts.orderbookLevels ?? 8))

  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws) => {
    const c: ClientState = { ws, nextLineSeq: 0, nextRecordSeq: 0 }
    clients.add(c)
    ws.on('close', () => clients.delete(c))
    ws.on('error', () => clients.delete(c))
    // First snapshot ASAP
    try {
      const state = opts.getState()
      const linesWin = opts.getLogLinesWindow ? opts.getLogLinesWindow() : null
      const recWin = opts.getLogRecordsWindow ? opts.getLogRecordsWindow() : null
      if (linesWin) c.nextLineSeq = linesWin.endSeq
      if (recWin) c.nextRecordSeq = recWin.endSeq
      const msg: WsSnapshotMsg = {
        type: 'snapshot',
        snapshot: buildSnapshot({ title: opts.title, state, orderbookLevels }),
        ...(linesWin ? { logsText: { from: linesWin.startSeq, to: linesWin.endSeq, lines: linesWin.items } } : {}),
        ...(recWin ? { logsJson: { from: recWin.startSeq, to: recWin.endSeq, records: recWin.items } } : {}),
      }
      ws.send(safeJson(msg))
    } catch {
      // ignore
    }
  })

  const server = createServer((req, res) => {
    // Health check / metadata
    if (req.url === '/healthz') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(safeJson({ ok: true }))
      return
    }
    serveStatic(distDir, req, res)
  })

  server.on('upgrade', (request, socket, head) => {
    try {
      const { pathname } = new URL(request.url ?? '', 'wss://base.url')
      if (pathname !== '/ws') {
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } catch {
      socket.destroy()
    }
  })

  const tick = (): void => {
    let state: BotUiSourceState | undefined
    try {
      state = opts.getState()
    } catch {
      state = undefined
    }
    if (!state) return

    const snapshot = buildSnapshot({ title: opts.title, state, orderbookLevels })
    const linesWin: SequencedWindow<string> | null = opts.getLogLinesWindow
      ? (() => {
          try {
            return opts.getLogLinesWindow!()
          } catch {
            return null
          }
        })()
      : null
    const recWin: SequencedWindow<LogRecord> | null = opts.getLogRecordsWindow
      ? (() => {
          try {
            return opts.getLogRecordsWindow!()
          } catch {
            return null
          }
        })()
      : null

    for (const c of clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue

      const logsText = (() => {
        if (!linesWin) return undefined
        // If client fell behind the ring window, resync by sending the whole current window.
        if (c.nextLineSeq < linesWin.startSeq) {
          const out = { from: linesWin.startSeq, to: linesWin.endSeq, lines: linesWin.items }
          c.nextLineSeq = linesWin.endSeq
          return out
        }
        if (c.nextLineSeq >= linesWin.endSeq) return undefined
        const offset = Math.max(0, c.nextLineSeq - linesWin.startSeq)
        const lines = linesWin.items.slice(offset)
        const out = { from: c.nextLineSeq, to: linesWin.endSeq, lines }
        c.nextLineSeq = linesWin.endSeq
        return out
      })()

      const logsJson = (() => {
        if (!recWin) return undefined
        if (c.nextRecordSeq < recWin.startSeq) {
          const out = { from: recWin.startSeq, to: recWin.endSeq, records: recWin.items }
          c.nextRecordSeq = recWin.endSeq
          return out
        }
        if (c.nextRecordSeq >= recWin.endSeq) return undefined
        const offset = Math.max(0, c.nextRecordSeq - recWin.startSeq)
        const records = recWin.items.slice(offset)
        const out = { from: c.nextRecordSeq, to: recWin.endSeq, records }
        c.nextRecordSeq = recWin.endSeq
        return out
      })()

      const msg: WsSnapshotMsg = {
        type: 'snapshot',
        snapshot,
        ...(logsText ? { logsText } : {}),
        ...(logsJson ? { logsJson } : {}),
      }

      try {
        c.ws.send(safeJson(msg))
      } catch {
        // If send fails, drop the client (best-effort).
        try {
          c.ws.close()
        } catch {
          // ignore
        } finally {
          clients.delete(c)
        }
      }
    }
  }

  const start = (): void => {
    if (running) return
    running = true
    server.listen(opts.port, opts.host)
    timer = setInterval(tick, refreshMs)
    tick()
  }

  const stop = (): void => {
    if (!running) return
    running = false
    if (timer) clearInterval(timer)
    timer = undefined
    for (const c of clients) {
      try {
        c.ws.close()
      } catch {
        // ignore
      }
    }
    clients.clear()
    try {
      wss.close()
    } catch {
      // ignore
    }
    try {
      server.close()
    } catch {
      // ignore
    }
  }

  return { start, stop }
}


