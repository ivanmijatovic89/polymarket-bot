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
  if (e instanceof Error) {
    return {
      ...(typeof e.name === 'string' && e.name.length > 0 ? { name: e.name } : {}),
      ...(typeof e.message === 'string' && e.message.length > 0 ? { message: e.message } : {}),
      ...(typeof e.stack === 'string' && e.stack.length > 0 ? { stack: e.stack } : {}),
    }
  }
  if (typeof e === 'object') {
    const any = e as Record<string, unknown>
    return {
      ...(typeof any.name === 'string' && any.name.length > 0 ? { name: any.name } : {}),
      ...(typeof any.message === 'string' && any.message.length > 0 ? { message: any.message } : {}),
      ...(typeof any.stack === 'string' && any.stack.length > 0 ? { stack: any.stack } : {}),
      ...(typeof any.message !== 'string' ? { message: String(e) } : {}),
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
    const err = args?.err ? toErr(args.err) : undefined
    const r: LogRecord = {
      tsMs: Date.now(),
      level,
      msg,
      ...(haveFields ? { fields: mergedFields } : {}),
      ...(args?.data !== undefined ? { data: args.data } : {}),
      ...(err ? { err } : {}),
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

function escapeBlessedTags(s: string): string {
  // Prevent accidental blessed tag parsing from arbitrary log content.
  // Prefer blessed's documented {open}/{close} escapes so we don't render backslashes.
  return s.replaceAll('{', '{open}').replaceAll('}', '{close}')
}

export function formatRecordToBlessedLine(r: LogRecord): string {
  const timeIso = new Date(r.tsMs).toISOString()
  const time = escapeBlessedTags(timeIso.slice(11, 23))

  const lvlRaw = r.level.toUpperCase().padEnd(5, ' ')
  const lvl =
    r.level === 'error'
      ? `{red-fg}${lvlRaw}{/}`
      : r.level === 'warn'
        ? `{yellow-fg}${lvlRaw}{/}`
        : r.level === 'debug'
          ? `{cyan-fg}${lvlRaw}{/}`
          : `{white-fg}${lvlRaw}{/}`

  const msg = escapeBlessedTags(r.msg)

  // TUI formatting: keep meta compact and avoid noisy duplication.
  // - fields: key=value
  // - err: message (and optional name)
  const parts: string[] = []
  if (r.fields) {
    for (const [k, v] of Object.entries(r.fields)) {
      if (v === undefined) continue
      const vv = typeof v === 'string' ? v : safeInspect(v)
      parts.push(`${k}=${vv}`)
    }
  }
  if (r.err) {
    const e = `${r.err.name ? `${r.err.name}:` : ''}${r.err.message ?? 'error'}`
    parts.push(`err=${e}`)
  }
  const metaStr =
    parts.length > 0 ? ` {gray-fg}${escapeBlessedTags(parts.join(' '))}{/}` : ''

  return `${time} ${lvl} ${msg}${metaStr}`
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

/** Ring buffer sink: keeps structured records for JSON UI / later replay. */
export function ringBufferRecordsSink(opts: { maxRecords: number }): {
  sink: LogSink
  snapshotRecords: () => LogRecord[]
} {
  const maxRecords = Math.max(1, opts.maxRecords)
  const buf: LogRecord[] = []

  const sink: LogSink = (r) => {
    buf.push(r)
    if (buf.length > maxRecords) {
      buf.splice(0, buf.length - maxRecords)
    }
  }

  return {
    sink,
    snapshotRecords: () => buf.slice(),
  }
}

export type SequencedWindow<T> = {
  startSeq: number
  endSeq: number
  items: T[]
}

function createSequencedRingBuffer<T>(maxItems: number): {
  push: (t: T) => void
  snapshotWindow: () => SequencedWindow<T>
} {
  const max = Math.max(1, maxItems)
  const buf: T[] = []
  let startSeq = 0 // seq of buf[0]

  const push = (t: T): void => {
    buf.push(t)
    if (buf.length > max) {
      const drop = buf.length - max
      buf.splice(0, drop)
      startSeq += drop
    }
  }

  const snapshotWindow = (): SequencedWindow<T> => ({
    startSeq,
    endSeq: startSeq + buf.length,
    items: buf.slice(),
  })

  return { push, snapshotWindow }
}

/**
 * Sequenced ring buffer for UI streaming:
 * - keeps a fixed-size window in memory
 * - also keeps a monotonic sequence (startSeq/endSeq) so consumers can request deltas reliably
 */
export function ringBufferSequencedLinesSink(opts: { maxLines: number; format?: (r: LogRecord) => string }): {
  sink: LogSink
  snapshotWindow: () => SequencedWindow<string>
} {
  const rb = createSequencedRingBuffer<string>(opts.maxLines)
  const sink: LogSink = (r) => {
    const line = (opts.format ?? ((x) => formatRecordToLine(x)))(r)
    rb.push(line)
  }
  return { sink, snapshotWindow: rb.snapshotWindow }
}

export function ringBufferSequencedRecordsSink(opts: { maxRecords: number }): {
  sink: LogSink
  snapshotWindow: () => SequencedWindow<LogRecord>
} {
  const rb = createSequencedRingBuffer<LogRecord>(opts.maxRecords)
  const sink: LogSink = (r) => rb.push(r)
  return { sink, snapshotWindow: rb.snapshotWindow }
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
  table: (tabularData?: unknown, properties?: string[]) => void
}

function formatConsoleArgs(args: unknown[]): { msg: string } {
  // Match Node formatting semantics as closely as practical.
  const msg = format(...args)
  return { msg }
}

function renderTable(tabularData: unknown, properties?: string[]): string {
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
    const { msg } = formatConsoleArgs(args)
    logger.info(msg)
  }
  console.info = (...args: unknown[]) => {
    const { msg } = formatConsoleArgs(args)
    logger.info(msg)
  }
  console.warn = (...args: unknown[]) => {
    const { msg } = formatConsoleArgs(args)
    logger.warn(msg)
  }
  console.error = (...args: unknown[]) => {
    // If an Error is passed, attach it for stack rendering downstream.
    const err = args.find((a) => a instanceof Error)
    const { msg } = formatConsoleArgs(args)
    logger.error(msg, { ...(err ? { err } : {}) })
  }
  console.table = (tabularData?: unknown, properties?: string[]) => {
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


