// backtestSegments.ts
//
// Replaces the old `chunkedBatchStats.ts` (fixed-window sequential chunks).
// Produces a flat list of segment rows persisted into `backtest_run_segments`.
//
// Segment kinds:
//   - all     : single row over the whole run.
//   - last_n  : one row per N in LAST_N_BUCKETS where markets.length >= N.
//               Each row is computed over markets.slice(-N) — the most recent
//               N markets. Not chunking; the last_n=1000 row's input is a
//               superset of last_n=500's input.
//   - daily   : one row per non-empty UTC calendar day.
//   - weekly  : one row per non-empty ISO-8601 week.
//   - monthly : one row per non-empty UTC calendar month.
//
// All rows compute against the same `capitalInitial`. Calendar buckets reset
// capital per bucket — these are isolated-window views, not running-capital
// chunks.

import type { MarketStats } from './marketStats.js'
import type { BatchStatsFields } from './batchStats.js'
import { computeBatchStats } from './batchStats.js'

export type SegmentKind = 'all' | 'last_n' | 'daily' | 'weekly' | 'monthly'

export type MarketWithStartMs = MarketStats & { marketStartMs: number }

export type SegmentRow = {
  segmentKind: SegmentKind
  segmentKey: string
  segmentOrd: number
  fromMs: number
  toMs: number
  stats: BatchStatsFields
}

/**
 * Last-N tail buckets. Edit + rerun `rebuild-backtest-segments` to change.
 */
export const LAST_N_BUCKETS = [500, 1000, 3000, 6000] as const

const MS_PER_DAY = 86_400_000

/**
 * Extracts the epoch suffix from a Polymarket 15m slug
 * (`<symbol>-updown-15m-<epochStart>`). Kept for recorded-mode writers that
 * compute `marketStartMs` at insert time. Returns ms.
 */
export function slugTs(slug: string): number {
  return Number(slug.split('-').pop()) * 1000
}

// ---------------------------------------------------------------------------
// Date bucket helpers (UTC).
// ---------------------------------------------------------------------------

function dayStartMs(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
}

function monthStartMs(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** Returns the UTC ms of Monday 00:00 of the ISO week containing `ms`. */
function isoWeekStartMs(ms: number): number {
  const d = new Date(ms)
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. ISO weeks start Monday.
  const dow = d.getUTCDay()
  const daysFromMonday = (dow + 6) % 7
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return monday - daysFromMonday * MS_PER_DAY
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function formatMonth(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/**
 * Returns the ISO 8601 week label 'YYYY-Www' for `ms`.
 *
 * Algorithm: the ISO week year is determined by the Thursday of the week
 * containing the date. Week 01 is the week containing the first Thursday of
 * the ISO year.
 */
function formatIsoWeek(ms: number): string {
  const d = new Date(ms)
  const dayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const dow = new Date(dayUtc).getUTCDay() // 0=Sun..6=Sat
  // Shift to the Thursday of the current ISO week.
  const thursday = dayUtc + ((dow === 0 ? -3 : 4 - dow) as number) * MS_PER_DAY
  const isoYear = new Date(thursday).getUTCFullYear()
  const jan4 = Date.UTC(isoYear, 0, 4)
  const jan4Dow = new Date(jan4).getUTCDay()
  const week1Monday = jan4 - (((jan4Dow + 6) % 7) as number) * MS_PER_DAY
  const week = Math.floor((thursday - week1Monday) / (7 * MS_PER_DAY)) + 1
  return `${isoYear}-W${week.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Segment builders.
// ---------------------------------------------------------------------------

function buildSegment(
  kind: SegmentKind,
  key: string,
  ord: number,
  bucket: MarketWithStartMs[],
  capitalInitial: number,
): SegmentRow {
  // computeBatchStats is order-sensitive (streak fields reduce in array
  // order). Caller passes markets sorted ascending by marketStartMs.
  const first = bucket[0]
  const last = bucket[bucket.length - 1]
  if (!first || !last) {
    throw new Error(`internal: empty bucket for ${kind}/${key}`)
  }
  return {
    segmentKind: kind,
    segmentKey: key,
    segmentOrd: ord,
    fromMs: first.marketStartMs,
    toMs: last.marketStartMs,
    stats: computeBatchStats(bucket, capitalInitial),
  }
}

function buildDateBuckets(
  marketsSortedAsc: MarketWithStartMs[],
  capitalInitial: number,
  kind: 'daily' | 'weekly' | 'monthly',
): SegmentRow[] {
  const fmt = kind === 'daily' ? formatDay : kind === 'weekly' ? formatIsoWeek : formatMonth
  const startMs = kind === 'daily' ? dayStartMs : kind === 'weekly' ? isoWeekStartMs : monthStartMs

  const groups = new Map<string, { ord: number; markets: MarketWithStartMs[] }>()
  for (const m of marketsSortedAsc) {
    const key = fmt(m.marketStartMs)
    const existing = groups.get(key)
    if (existing) {
      existing.markets.push(m)
    } else {
      groups.set(key, { ord: startMs(m.marketStartMs), markets: [m] })
    }
  }

  const rows: SegmentRow[] = []
  for (const [key, { ord, markets }] of groups) {
    rows.push(buildSegment(kind, key, ord, markets, capitalInitial))
  }
  rows.sort((a, b) => a.segmentOrd - b.segmentOrd)
  return rows
}

/**
 * Computes all segment rows for a backtest run.
 *
 * Input: markets in any order; this function sorts ascending by
 * `marketStartMs` once, then derives every segment kind from the sorted view.
 */
export function computeBacktestSegments(
  markets: MarketWithStartMs[],
  capitalInitial: number,
): SegmentRow[] {
  if (markets.length === 0) return []

  const sorted = [...markets].sort((a, b) => a.marketStartMs - b.marketStartMs)

  const rows: SegmentRow[] = []

  // all
  rows.push(buildSegment('all', 'all', 0, sorted, capitalInitial))

  // last_n
  for (const n of LAST_N_BUCKETS) {
    if (sorted.length < n) continue
    const tail = sorted.slice(-n)
    rows.push(buildSegment('last_n', String(n), n, tail, capitalInitial))
  }

  // daily / weekly / monthly
  rows.push(...buildDateBuckets(sorted, capitalInitial, 'daily'))
  rows.push(...buildDateBuckets(sorted, capitalInitial, 'weekly'))
  rows.push(...buildDateBuckets(sorted, capitalInitial, 'monthly'))

  return rows
}
