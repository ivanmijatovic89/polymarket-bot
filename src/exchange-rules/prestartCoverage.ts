/**
 * Coverage of the pre-start capture (native spec 11 §13.2.1 PC4/PC5): which
 * grid markets have a `pre_start` 200 per origin. Used by `status.json` (last
 * 24 h, every tick) and by `--report` (per UTC day). Both read the JSONL files
 * only, so the numbers survive restarts.
 */
import { readDayFile, type DayFile, type RecordSummary } from './prestartFiles.js'
import {
  DAY_MS,
  ORIGINS,
  TIMEFRAME_MS,
  WINDOW_MAX_LEAD_MS,
  gridMarketsBetween,
  utcDay,
  utcDayStartMs,
  utcDaysBetween,
  type GridMarket,
  type Origin,
  type Slot,
  type Timeframe,
} from './prestartGrid.js'

export interface CoverageCounts {
  gridMarkets: number
  preStart200: Record<Origin | 'both', number>
  /** Percent of grid markets, 2 decimals; null without grid markets. */
  coveragePct: Record<Origin | 'both', number | null>
}

export interface MissedMarket {
  slug: string
  marketStartMs: number
  missing: Origin[]
}

export interface Coverage {
  counts: CoverageCounts
  missed: MissedMarket[]
}

/** A record proves capture when it is a 200 with a stored body received before the start. */
export function isPreStart200(record: RecordSummary): boolean {
  return record.httpStatus === 200 && record.hasBody && record.fetchedAtMs < record.marketStartMs
}

/** slug -> origins with a `pre_start` 200. */
export function capturedOrigins(records: Iterable<RecordSummary>): Map<string, Set<Origin>> {
  const captured = new Map<string, Set<Origin>>()
  for (const record of records) {
    if (!isPreStart200(record)) continue
    const origins = captured.get(record.slug) ?? new Set<Origin>()
    origins.add(record.origin)
    captured.set(record.slug, origins)
  }
  return captured
}

function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 10_000) / 100
}

export function computeCoverage(
  markets: readonly GridMarket[],
  captured: ReadonlyMap<string, ReadonlySet<Origin>>,
): Coverage {
  const preStart200 = { gamma: 0, clob: 0, both: 0 }
  const missed: MissedMarket[] = []
  for (const market of markets) {
    const origins = captured.get(market.slug)
    const missing = ORIGINS.filter((origin) => !origins?.has(origin))
    for (const origin of ORIGINS) if (origins?.has(origin)) preStart200[origin] += 1
    if (missing.length === 0) preStart200.both += 1
    else missed.push({ slug: market.slug, marketStartMs: market.marketStartMs, missing })
  }
  const total = markets.length
  return {
    counts: {
      gridMarkets: total,
      preStart200,
      coveragePct: {
        gamma: pct(preStart200.gamma, total),
        clob: pct(preStart200.clob, total),
        both: pct(preStart200.both, total),
      },
    },
    missed,
  }
}

function readDays(outDir: string, days: readonly string[]): DayFile[] {
  return days.map((day) => readDayFile(outDir, day))
}

// ---------------------------------------------------------------- status.json

export interface LastOk {
  slug: string
  slot: Slot
  marketStartMs: number
  fetchedAtMs: number
}

export interface CaptureStatus {
  v: 1
  lastTickAtMs: number
  host: string
  captureCommit: string
  timeframes: Timeframe[]
  /** Newest 200 with a stored body per origin among the files of the last 24 h. */
  lastOk: Record<Origin, LastOk | null>
  /** Grid markets that started in `(fromMs, toMs]` vs those with a `pre_start` 200. */
  coverage24h: {
    fromMs: number
    toMs: number
    byTimeframe: Partial<Record<Timeframe, CoverageCounts>>
  }
  /** The started grid markets of that window that lack a `pre_start` 200 from an origin. */
  missedSlugs: Partial<Record<Timeframe, MissedMarket[]>>
}

export function buildStatus(input: {
  outDir: string
  nowMs: number
  timeframes: readonly Timeframe[]
  host: string
  captureCommit: string
}): CaptureStatus {
  const { outDir, nowMs, timeframes } = input
  const fromMs = nowMs - DAY_MS
  // A market starting right after `fromMs` was fetched up to 10 min earlier.
  const files = readDays(outDir, utcDaysBetween(fromMs - WINDOW_MAX_LEAD_MS, nowMs))
  const records = files.flatMap((file) => file.records)
  const lastOk: Record<Origin, LastOk | null> = { gamma: null, clob: null }
  for (const record of records) {
    if (record.httpStatus !== 200 || !record.hasBody) continue
    const current = lastOk[record.origin]
    if (current === null || record.fetchedAtMs > current.fetchedAtMs) {
      lastOk[record.origin] = {
        slug: record.slug,
        slot: record.slot,
        marketStartMs: record.marketStartMs,
        fetchedAtMs: record.fetchedAtMs,
      }
    }
  }
  const captured = capturedOrigins(records)
  const byTimeframe: Partial<Record<Timeframe, CoverageCounts>> = {}
  const missedSlugs: Partial<Record<Timeframe, MissedMarket[]>> = {}
  for (const timeframe of timeframes) {
    const coverage = computeCoverage(gridMarketsBetween([timeframe], fromMs, nowMs), captured)
    byTimeframe[timeframe] = coverage.counts
    missedSlugs[timeframe] = coverage.missed
  }
  return {
    v: 1,
    lastTickAtMs: nowMs,
    host: input.host,
    captureCommit: input.captureCommit,
    timeframes: [...timeframes],
    lastOk,
    coverage24h: { fromMs, toMs: nowMs, byTimeframe },
    missedSlugs,
  }
}

// ------------------------------------------------------------------ --report

export interface ReportRow {
  day: string
  timeframe: Timeframe
  coverage: Coverage
}

export interface FileStats {
  day: string
  exists: boolean
  lines: number
  byStatus: Record<string, number>
  tornTail: boolean
  malformed: number
}

export interface CaptureReport {
  nowMs: number
  days: string[]
  rows: ReportRow[]
  files: FileStats[]
}

/**
 * Coverage per UTC day and timeframe for the last `days` UTC days (today
 * included). Only markets that already started count; a market's `pre_start`
 * fetches may sit in the previous day's file, so that file is read too.
 */
export function buildReport(input: {
  outDir: string
  nowMs: number
  timeframes: readonly Timeframe[]
  days: number
}): CaptureReport {
  const { outDir, nowMs, timeframes } = input
  const todayStart = utcDayStartMs(nowMs)
  const firstStart = todayStart - (input.days - 1) * DAY_MS
  const files = readDays(outDir, utcDaysBetween(firstStart - DAY_MS, nowMs))
  const captured = capturedOrigins(files.flatMap((file) => file.records))
  const rows: ReportRow[] = []
  const days: string[] = []
  for (let dayStart = firstStart; dayStart <= todayStart; dayStart += DAY_MS) {
    const day = utcDay(dayStart)
    days.push(day)
    const lastStart = Math.min(dayStart + DAY_MS - 1, nowMs)
    for (const timeframe of timeframes) {
      const markets = gridMarketsBetween([timeframe], dayStart - 1, lastStart)
      rows.push({ day, timeframe, coverage: computeCoverage(markets, captured) })
    }
  }
  const fileStats = files
    .filter((file) => days.includes(file.day))
    .map((file) => {
      const byStatus: Record<string, number> = {}
      for (const record of file.records) {
        const key = String(record.httpStatus)
        byStatus[key] = (byStatus[key] ?? 0) + 1
      }
      return {
        day: file.day,
        exists: file.exists,
        lines: file.lines,
        byStatus,
        tornTail: file.tornTail,
        malformed: file.malformed,
      }
    })
  return { nowMs, days, rows, files: fileStats }
}

function formatPct(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(2)}%`
}

/** Collapses consecutive grid markets with the same missing origins into one line. */
function missedLines(timeframe: Timeframe, missed: readonly MissedMarket[]): string[] {
  const lines: string[] = []
  const step = TIMEFRAME_MS[timeframe]
  let i = 0
  while (i < missed.length) {
    const first = missed[i]!
    const key = first.missing.join('+')
    let j = i
    while (
      j + 1 < missed.length &&
      missed[j + 1]!.marketStartMs === missed[j]!.marketStartMs + step &&
      missed[j + 1]!.missing.join('+') === key
    ) {
      j += 1
    }
    const last = missed[j]!
    const count = j - i + 1
    lines.push(
      count === 1
        ? `    ${first.slug}  missing ${key}`
        : `    ${first.slug} .. ${last.slug} (${count} markets)  missing ${key}`,
    )
    i = j + 1
  }
  return lines
}

export function formatReport(report: CaptureReport, outDir: string): string {
  const out: string[] = []
  out.push(`Pre-start rules capture report: ${outDir}`)
  out.push(
    `UTC days ${report.days[0]} .. ${report.days.at(-1)} (markets started by ${new Date(report.nowMs).toISOString()})`,
  )
  out.push('')
  const header = ['day', 'tf', 'grid', 'gamma', 'clob', 'both', 'coverage(both)']
  const table = report.rows.map((row) => {
    const counts = row.coverage.counts
    return [
      row.day,
      row.timeframe,
      String(counts.gridMarkets),
      String(counts.preStart200.gamma),
      String(counts.preStart200.clob),
      String(counts.preStart200.both),
      formatPct(counts.coveragePct.both),
    ]
  })
  const widths = header.map((title, col) =>
    Math.max(title.length, ...table.map((cells) => cells[col]!.length)),
  )
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, col) => (col < 2 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!)))
      .join('  ')
  out.push(line(header))
  for (const cells of table) out.push(line(cells))
  out.push('')
  out.push('Missed slugs (no pre_start 200 from the listed origins):')
  let anyMissed = false
  for (const row of report.rows) {
    if (row.coverage.missed.length === 0) continue
    anyMissed = true
    out.push(`  ${row.day} ${row.timeframe}: ${row.coverage.missed.length}`)
    out.push(...missedLines(row.timeframe, row.coverage.missed))
  }
  if (!anyMissed) out.push('  none')
  out.push('')
  out.push('Files:')
  for (const file of report.files) {
    if (!file.exists) {
      out.push(`  ${file.day}.jsonl  missing`)
      continue
    }
    const statuses = Object.entries(file.byStatus)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([status, count]) => `${status}:${count}`)
      .join(' ')
    out.push(
      `  ${file.day}.jsonl  records ${file.lines} (http ${statuses || '-'})  torn_tail ${file.tornTail ? 1 : 0}  malformed ${file.malformed}`,
    )
  }
  return out.join('\n')
}
