/**
 * JSONL archive of the pre-start capture (native spec 11 §13.2.1 PC4): one
 * record per completed attempt, appended with one `write` per line to
 * `<outDir>/<yyyy-mm-dd>.jsonl` (UTC date of `fetchedAtMs`), plus the
 * atomically replaced `<outDir>/status.json`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ORIGINS,
  TIMEFRAMES,
  utcDay,
  type Origin,
  type Slot,
  type Timeframe,
} from './prestartGrid.js'

export const RECORD_VERSION = 1

/** PC4 record. Field order is the PC4 table order and is kept on disk. */
export interface CaptureRecord {
  v: typeof RECORD_VERSION
  origin: Origin
  slot: Slot
  slug: string
  timeframe: Timeframe
  marketStartMs: number
  conditionId: string | null
  url: string
  requestedAtMs: number
  fetchedAtMs: number
  httpStatus: number
  error: string | null
  rawSha256: string | null
  rawBody: string | null
  host: string
  captureCommit: string
}

export function dayFilePath(outDir: string, day: string): string {
  return path.join(outDir, `${day}.jsonl`)
}

function writeAllSync(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset)
}

/**
 * Cuts a torn last line (left by a crash in the middle of a write) off `file`
 * so the next append starts on a fresh line. The cut bytes are preserved in
 * `<file>.torn`, which `*.jsonl` readers never pick up. Returns the cut size.
 */
export function repairTornTail(file: string): number {
  if (!fs.existsSync(file)) return 0
  const fd = fs.openSync(file, 'r+')
  try {
    const size = fs.fstatSync(fd).size
    if (size === 0) return 0
    const last = Buffer.alloc(1)
    fs.readSync(fd, last, 0, 1, size - 1)
    if (last[0] === 0x0a) return 0
    const chunk = Buffer.alloc(64 * 1024)
    let keep = 0
    for (let end = size; end > 0 && keep === 0; ) {
      const start = Math.max(0, end - chunk.length)
      const read = fs.readSync(fd, chunk, 0, end - start, start)
      const newline = chunk.subarray(0, read).lastIndexOf(0x0a)
      if (newline >= 0) keep = start + newline + 1
      end = start
    }
    const torn = Buffer.alloc(size - keep)
    fs.readSync(fd, torn, 0, torn.length, keep)
    fs.appendFileSync(`${file}.torn`, Buffer.concat([torn, Buffer.from('\n')]))
    fs.ftruncateSync(fd, keep)
    return torn.length
  } finally {
    fs.closeSync(fd)
  }
}

/** Appends records to the day files; a single writer per output directory. */
export class JsonlWriter {
  private readonly checked = new Set<string>()

  constructor(
    private readonly outDir: string,
    private readonly log: (line: string) => void = () => {},
  ) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  append(record: CaptureRecord): string {
    const file = dayFilePath(this.outDir, utcDay(record.fetchedAtMs))
    if (!this.checked.has(file)) {
      const cut = repairTornTail(file)
      if (cut > 0) this.log(`moved a torn last line (${cut} bytes) of ${file} to ${file}.torn`)
      this.checked.add(file)
    }
    const fd = fs.openSync(file, 'a')
    try {
      writeAllSync(fd, Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'))
    } finally {
      fs.closeSync(fd)
    }
    return file
  }
}

/** Writes `value` as JSON to `file` through a temp file and a rename. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/** The fields of a record that coverage and reports need (the body is dropped). */
export interface RecordSummary {
  origin: Origin
  slot: Slot
  slug: string
  timeframe: Timeframe
  marketStartMs: number
  fetchedAtMs: number
  httpStatus: number
  hasBody: boolean
}

export interface DayFile {
  day: string
  exists: boolean
  records: RecordSummary[]
  /** Complete, well-formed lines. */
  lines: number
  /** True when the file ends in a line without `\n` (a write in progress or a crash); it is skipped. */
  tornTail: boolean
  /** Newline-terminated lines that are not a valid record. */
  malformed: number
}

function summarize(value: unknown): RecordSummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const valid =
    r.v === RECORD_VERSION &&
    ORIGINS.includes(r.origin as Origin) &&
    (r.slot === 'first' || r.slot === 'final') &&
    typeof r.slug === 'string' &&
    TIMEFRAMES.includes(r.timeframe as Timeframe) &&
    Number.isSafeInteger(r.marketStartMs) &&
    Number.isSafeInteger(r.fetchedAtMs) &&
    Number.isSafeInteger(r.httpStatus) &&
    (r.rawBody === null || typeof r.rawBody === 'string')
  if (!valid) return null
  return {
    origin: r.origin as Origin,
    slot: r.slot as Slot,
    slug: r.slug as string,
    timeframe: r.timeframe as Timeframe,
    marketStartMs: r.marketStartMs as number,
    fetchedAtMs: r.fetchedAtMs as number,
    httpStatus: r.httpStatus as number,
    hasBody: typeof r.rawBody === 'string',
  }
}

/** Reads one day file, tolerating a torn last line and counting malformed lines. */
export function readDayFile(outDir: string, day: string): DayFile {
  const result: DayFile = {
    day,
    exists: false,
    records: [],
    lines: 0,
    tornTail: false,
    malformed: 0,
  }
  let text: string
  try {
    text = fs.readFileSync(dayFilePath(outDir, day), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw error
  }
  result.exists = true
  const lines = text.split('\n')
  const tail = lines.pop() ?? ''
  if (tail !== '') result.tornTail = true
  for (const line of lines) {
    let record: RecordSummary | null = null
    try {
      record = summarize(JSON.parse(line))
    } catch {
      record = null
    }
    if (record === null) result.malformed += 1
    else {
      result.records.push(record)
      result.lines += 1
    }
  }
  return result
}
