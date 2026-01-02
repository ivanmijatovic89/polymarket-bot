import { format, inspect } from 'node:util'
import { createWriteStream, type WriteStream } from 'node:fs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export type LogRecord = {
  tsMs: number
  level: LogLevel
  msg: string
  /**
   * Small, structured fields for filtering / grouping (component, market, symbol, etc).
   */
  fields?: Record<string, unknown>
  /**
   * Optional payload. Avoid huge objects in hot paths.
   */
  data?: unknown
  /**
   * Normalized error (if provided).
   */
  err?: { name?: string; message?: string; stack?: string }
}

export type LogSink = (r: LogRecord) => void

export type Logger = {
  debug: (msg: string, args?: { data?: unknown; fields?: Record<string, unknown>; err?: unknown }) => void
  info: (msg: string, args?: { data?: unknown; fields?: Record<string, unknown>; err?: unknown }) => void
  warn: (msg: string, args?: { data?: unknown; fields?: Record<string, unknown>; err?: unknown }) => void
  error: (msg: string, args?: { data?: unknown; fields?: Record<string, unknown>; err?: unknown }) => void
  child: (fields: Record<string, unknown>) => Logger
}

function toErr(e: unknown): LogRecord['err'] | undefined {
  if (!e) return undefined
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack }
  if (typeof e === 'object') {
    const any = e as Record<string, unknown>
    return {
      name: typeof any.name === 'string' ? any.name : undefined,
      message: typeof any.message === 'string' ? any.message : String(e),
      stack: typeof any.stack === 'string' ? any.stack : undefined,
    }
  }
  return { message: String(e) }
}

export function createLogger(opts: {
  level?: LogLevel
  baseFields?: Record<string, unknown>
  sinks: LogSink[]
}): Logger {
  const minLevel: LogLevel = opts.level ?? 'info'
  const baseFields: Record<string, unknown> = opts.baseFields ?? {}
  const sinks = opts.sinks

  const emit = (
    level: LogLevel,
    msg: string,
    args?: { data?: unknown; fields?: Record<string, unknown>; err?: unknown },
  ): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return
    const mergedFields = { ...baseFields, ...(args?.fields ?? {}) }
    const haveFields = Object.keys(mergedFields).length > 0
    const r: LogRecord = {
      tsMs: Date.now(),
      level,
      msg,
      ...(haveFields ? { fields: mergedFields } : {}),
      ...(args?.data !== undefined ? { data: args.data } : {}),
      ...(args?.err ? { err: toErr(args.err) } : {}),
    }
    for (const s of sinks) s(r)
  }

  const api: Logger = {
    debug: (msg, args) => emit('debug', msg, args),
    info: (msg, args) => emit('info', msg, args),
    warn: (msg, args) => emit('warn', msg, args),
    error: (msg, args) => emit('error', msg, args),
    child: (fields) =>
      createLogger({
        level: minLevel,
        baseFields: { ...baseFields, ...fields },
        sinks,
      }),
  }
  return api
}

export function formatRecordToLine(
  r: LogRecord,
  opts?: { includeIsoDate?: boolean; maxLen?: number },
): string {
  const timeIso = new Date(r.tsMs).toISOString()
  const time = opts?.includeIsoDate ? timeIso : timeIso.slice(11, 23) // HH:MM:SS.mmm
  const lvl = r.level.toUpperCase().padEnd(5, ' ')
  const meta: Record<string, unknown> = {}
  if (r.fields && Object.keys(r.fields).length > 0) meta.fields = r.fields
  if (r.data !== undefined) meta.data = r.data
  if (r.err) meta.err = r.err

  const metaStr = Object.keys(meta).length > 0 ? ` ${safeInspect(meta)}` : ''
  const raw = `${time} ${lvl} ${r.msg}${metaStr}`
  const maxLen = opts?.maxLen ?? 5000
  return raw.length > maxLen ? raw.slice(0, Math.max(0, maxLen - 1)) + '…' : raw
}

function safeInspect(v: unknown): string {
  try {
    return inspect(v, {
      depth: 6,
      colors: false,
      breakLength: 140,
      compact: true,
      maxArrayLength: 200,
      maxStringLength: 2000,
    })
  } catch (err) {
    return `[uninspectable: ${(err as Error).message}]`
  }
}

/** Console sink: readable lines (use only when TUI is OFF). */
export function consoleSink(): LogSink {
  return (r) => {
    const line = formatRecordToLine(r, { includeIsoDate: true })
    if (r.level === 'error') console.error(line)
    else if (r.level === 'warn') console.warn(line)
    else console.log(line)
  }
}

/** Ring buffer sink: perfect for Blessed log panes. */
export function ringBufferSink(opts: { maxLines: number; format?: (r: LogRecord) => string }): {
  sink: LogSink
  snapshotLines: () => string[]
} {
  const maxLines = Math.max(1, opts.maxLines)
  const buf: string[] = []

  const sink: LogSink = (r) => {
    const line = (opts.format ?? ((x) => formatRecordToLine(x)))(r)
    buf.push(line)
    if (buf.length > maxLines) {
      buf.splice(0, buf.length - maxLines)
    }
  }

  return {
    sink,
    snapshotLines: () => buf.slice(),
  }
}

/** Optional JSONL sink (handy for later replay). */
export function jsonlFileSink(opts: { filePath: string }): { sink: LogSink; close: () => void } {
  const stream: WriteStream = createWriteStream(opts.filePath, { flags: 'a' })
  const sink: LogSink = (r) => {
    try {
      stream.write(JSON.stringify(r) + '\n')
    } catch {
      // ignore
    }
  }
  return { sink, close: () => stream.close() }
}

type ConsoleLike = {
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  table: (tabularData?: unknown, properties?: readonly string[]) => void
}

function formatConsoleArgs(args: unknown[]): { msg: string; data?: unknown } {
  // Match Node formatting semantics as closely as practical.
  const msg = format(...args)
  // Preserve original args as optional payload for deeper debugging (but keep it small).
  const data = args.length > 1 ? args : args.length === 1 ? args[0] : undefined
  return { msg, ...(data !== undefined ? { data } : {}) }
}

function renderTable(tabularData: unknown, properties?: readonly string[]): string {
  // We intentionally do NOT mimic Node's ASCII table precisely; we just make it readable in a log pane.
  const header = properties && properties.length > 0 ? `properties=${properties.join(',')}` : ''
  const body = safeInspect(tabularData)
  return header ? `[table ${header}]\n${body}` : `[table]\n${body}`
}

/**
 * Patch console.* to route output into the provided logger.
 *
 * Intended for TUI mode, where stdout/stderr output corrupts the screen.
 * Returns a restore function.
 */
export function patchConsole(logger: Logger): () => void {
  const orig: ConsoleLike = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    table: console.table.bind(console),
  }

  console.log = (...args: unknown[]) => {
    const { msg, data } = formatConsoleArgs(args)
    logger.info(msg, ...(data !== undefined ? [{ data }] : []))
  }
  console.info = (...args: unknown[]) => {
    const { msg, data } = formatConsoleArgs(args)
    logger.info(msg, ...(data !== undefined ? [{ data }] : []))
  }
  console.warn = (...args: unknown[]) => {
    const { msg, data } = formatConsoleArgs(args)
    logger.warn(msg, ...(data !== undefined ? [{ data }] : []))
  }
  console.error = (...args: unknown[]) => {
    // If an Error is passed, attach it for stack rendering downstream.
    const err = args.find((a) => a instanceof Error)
    const { msg, data } = formatConsoleArgs(args)
    logger.error(msg, { ...(data !== undefined ? { data } : {}), ...(err ? { err } : {}) })
  }
  console.table = (tabularData?: unknown, properties?: readonly string[]) => {
    logger.info(renderTable(tabularData, properties))
  }

  return () => {
    console.log = orig.log
    console.info = orig.info
    console.warn = orig.warn
    console.error = orig.error
    console.table = orig.table
  }
}


