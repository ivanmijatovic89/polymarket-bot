import { sql } from 'drizzle-orm'
import { getDb } from '../db'

export type BacktestDatasetParams = {
  symbol: string
  timeframe: string
  converter: 'delta-typed' | 'paired'
  readFrom: 'local' | 'r2'
}

export type CoveragePeriod = {
  key: string
  markets: number
  expected: number
  completenessPct: number
  firstStartMs: number
  lastStartMs: number
  status: 'complete' | 'partial' | 'overfull'
}

export type BacktestDatasetCoverage = {
  params: BacktestDatasetParams
  summary: {
    rawMarkets: number
    convertedMarkets: number
    usableMarkets: number
    firstStartMs: number | null
    lastStartMs: number | null
    expectedPerDay: number
  }
  byMonth: CoveragePeriod[]
  byWeek: CoveragePeriod[]
  byDay: CoveragePeriod[]
}

type CountRow = {
  count: number | string | bigint
}

type MarketRow = {
  slug: string
  startDateUs: number | string | bigint | null
}

const EXPECTED_PER_DAY = 96
const MS_PER_DAY = 24 * 60 * 60 * 1000

function toInt(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function usToMs(value: unknown): number | null {
  const n = toInt(value)
  if (n <= 0) return null
  return Math.trunc(n / 1000)
}

function utcDate(ms: number): Date {
  return new Date(ms)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function monthKey(ms: number): string {
  const d = utcDate(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

function dayKey(ms: number): string {
  const d = utcDate(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function daysInUtcMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate()
}

function startOfUtcDayMs(ms: number): number {
  const d = utcDate(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function isoWeekKey(ms: number): string {
  const d = new Date(startOfUtcDayMs(ms))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / 7)
  return `${d.getUTCFullYear()}-W${pad2(week)}`
}

function statusFor(markets: number, expected: number): CoveragePeriod['status'] {
  if (markets >= expected) return markets === expected ? 'complete' : 'overfull'
  return 'partial'
}

function pct(markets: number, expected: number): number {
  if (expected <= 0) return 0
  return Math.round((markets / expected) * 10000) / 100
}

function groupCoverage(
  starts: number[],
  keyFor: (ms: number) => string,
  expectedFor: (key: string) => number,
): CoveragePeriod[] {
  const groups = new Map<string, { markets: number; firstStartMs: number; lastStartMs: number }>()
  for (const startMs of starts) {
    const key = keyFor(startMs)
    const cur = groups.get(key)
    if (!cur) {
      groups.set(key, { markets: 1, firstStartMs: startMs, lastStartMs: startMs })
      continue
    }
    cur.markets += 1
    cur.firstStartMs = Math.min(cur.firstStartMs, startMs)
    cur.lastStartMs = Math.max(cur.lastStartMs, startMs)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const expected = expectedFor(key)
      return {
        key,
        markets: value.markets,
        expected,
        completenessPct: pct(value.markets, expected),
        firstStartMs: value.firstStartMs,
        lastStartMs: value.lastStartMs,
        status: statusFor(value.markets, expected),
      }
    })
}

function expectedForMonth(key: string): number {
  const [yearRaw, monthRaw] = key.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0
  return daysInUtcMonth(year, month) * EXPECTED_PER_DAY
}

function datasetPathCondition(readFrom: BacktestDatasetParams['readFrom']) {
  return readFrom === 'local'
    ? sql`c.local_path is not null and trim(c.local_path) <> ''`
    : sql`c.r2_url is not null and trim(c.r2_url) <> ''`
}

export async function getBacktestDatasetCoverage(
  params: BacktestDatasetParams,
): Promise<BacktestDatasetCoverage> {
  const db = getDb()
  const symbol = params.symbol.toLowerCase()
  const slugPrefix = `${symbol}-updown-${params.timeframe}-%`
  const pathCondition = datasetPathCondition(params.readFrom)

  const [rawCountRows] = (await db.execute(sql`
    select count(*) as count
    from telonex_markets
    where slug like ${slugPrefix}
  `)) as unknown as [CountRow[], unknown]

  const [convertedCountRows] = (await db.execute(sql`
    select count(*) as count
    from telonex_markets m
    inner join telonex_market_conversions c on c.market_id = m.id
    where m.slug like ${slugPrefix}
      and c.converter = ${params.converter}
      and c.status = 'done'
  `)) as unknown as [CountRow[], unknown]

  const [marketRows] = (await db.execute(sql`
    select m.slug as slug, m.start_date_us as startDateUs
    from telonex_markets m
    inner join telonex_market_conversions c on c.market_id = m.id
    where m.slug like ${slugPrefix}
      and c.converter = ${params.converter}
      and c.status = 'done'
      and ${pathCondition}
      and m.start_date_us is not null
      and m.asset_id_0 is not null
      and m.asset_id_1 is not null
      and m.telonex_status = 'resolved'
      and m.result_id in ('0', '1')
    order by m.start_date_us asc, m.slug asc
  `)) as unknown as [MarketRow[], unknown]

  const starts = marketRows
    .map((row) => usToMs(row.startDateUs))
    .filter((ms): ms is number => ms !== null)

  return {
    params,
    summary: {
      rawMarkets: toInt(rawCountRows[0]?.count),
      convertedMarkets: toInt(convertedCountRows[0]?.count),
      usableMarkets: starts.length,
      firstStartMs: starts[0] ?? null,
      lastStartMs: starts[starts.length - 1] ?? null,
      expectedPerDay: EXPECTED_PER_DAY,
    },
    byMonth: groupCoverage(starts, monthKey, expectedForMonth),
    byWeek: groupCoverage(starts, isoWeekKey, () => 7 * EXPECTED_PER_DAY),
    byDay: groupCoverage(starts, dayKey, () => EXPECTED_PER_DAY),
  }
}
