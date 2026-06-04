import { sql } from 'drizzle-orm'
import { getDb } from '../db'

export type BacktestDatasetParams = {
  symbol: string
  timeframe: string
  converter: 'delta-typed' | 'paired'
}

export type CoveragePeriod = {
  key: string
  expected: number
  telonexMarkets: number
  localReady: number
  r2Ready: number
  telonexCoveragePct: number
  localReadyPct: number
  r2ReadyPct: number
  firstStartMs: number
  lastStartMs: number
}

export type BacktestDatasetCoverage = {
  params: BacktestDatasetParams
  summary: {
    rawMarkets: number
    localReady: number
    r2Ready: number
    firstStartMs: number | null
    lastStartMs: number | null
    expectedPerDay: number
  }
  total: CoveragePeriod
  byMonth: CoveragePeriod[]
  byWeek: CoveragePeriod[]
  byDay: CoveragePeriod[]
}

type CountRow = {
  count: number | string | bigint
}

type MarketRow = {
  slug: string
  conversionStatus: string | null
  localPath: string | null
  r2Url: string | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toInt(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
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

function pct(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 10000) / 100
}

function expectedPerDayForTimeframe(timeframe: string): number {
  const match = timeframe.match(/^(\d+)m$/)
  if (!match) return 0
  const minutes = Number(match[1])
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.trunc((24 * 60) / minutes)
}

function daysInUtcMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate()
}

function expectedForMonth(key: string, expectedPerDay: number): number {
  const [yearRaw, monthRaw] = key.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0
  return daysInUtcMonth(year, month) * expectedPerDay
}

function expectedForPeriod(key: string, expectedPerDay: number): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return expectedPerDay
  if (/^\d{4}-W\d{2}$/.test(key)) return expectedPerDay * 7
  return expectedForMonth(key, expectedPerDay)
}

function marketStartMsFromSlug(slug: string): number | null {
  const raw = slug.split('-').pop()
  if (!raw || !/^\d+$/.test(raw)) return null
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null
  return seconds * 1000
}

function groupCoverage(
  markets: Array<{ startMs: number; localReady: boolean; r2Ready: boolean }>,
  keyFor: (ms: number) => string,
  expectedPerDay: number,
): CoveragePeriod[] {
  const groups = new Map<
    string,
    { telonexMarkets: number; localReady: number; r2Ready: number; firstStartMs: number; lastStartMs: number }
  >()
  for (const market of markets) {
    const startMs = market.startMs
    const key = keyFor(startMs)
    const cur = groups.get(key)
    if (!cur) {
      groups.set(key, {
        telonexMarkets: 1,
        localReady: market.localReady ? 1 : 0,
        r2Ready: market.r2Ready ? 1 : 0,
        firstStartMs: startMs,
        lastStartMs: startMs,
      })
      continue
    }
    cur.telonexMarkets += 1
    if (market.localReady) cur.localReady += 1
    if (market.r2Ready) cur.r2Ready += 1
    cur.firstStartMs = Math.min(cur.firstStartMs, startMs)
    cur.lastStartMs = Math.max(cur.lastStartMs, startMs)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const expected = expectedForPeriod(key, expectedPerDay)
      return {
        key,
        expected,
        telonexMarkets: value.telonexMarkets,
        localReady: value.localReady,
        r2Ready: value.r2Ready,
        telonexCoveragePct: pct(value.telonexMarkets, expected),
        localReadyPct: pct(value.localReady, value.telonexMarkets),
        r2ReadyPct: pct(value.r2Ready, value.telonexMarkets),
        firstStartMs: value.firstStartMs,
        lastStartMs: value.lastStartMs,
      }
    })
}

export async function getBacktestDatasetCoverage(
  params: BacktestDatasetParams,
): Promise<BacktestDatasetCoverage> {
  const db = getDb()
  const symbol = params.symbol.toLowerCase()
  const slugPrefix = `${symbol}-updown-${params.timeframe}-%`
  const expectedPerDay = expectedPerDayForTimeframe(params.timeframe)

  const [rawCountRows] = (await db.execute(sql`
    select count(*) as count
    from telonex_markets
    where slug like ${slugPrefix}
  `)) as unknown as [CountRow[], unknown]

  const [marketRows] = (await db.execute(sql`
    select
      m.slug as slug,
      c.status as conversionStatus,
      c.local_path as localPath,
      c.r2_url as r2Url
    from telonex_markets m
    left join telonex_market_conversions c
      on c.market_id = m.id
      and c.converter = ${params.converter}
    where m.slug like ${slugPrefix}
    order by cast(substring_index(m.slug, '-', -1) as unsigned) asc, m.slug asc
  `)) as unknown as [MarketRow[], unknown]

  const markets = marketRows.flatMap((row) => {
    const startMs = marketStartMsFromSlug(row.slug)
    if (startMs === null) return []
    const done = row.conversionStatus === 'done'
    return [
      {
        startMs,
        localReady: done && typeof row.localPath === 'string' && row.localPath.trim() !== '',
        r2Ready: done && typeof row.r2Url === 'string' && row.r2Url.trim() !== '',
      },
    ]
  })

  const localReady = markets.filter((m) => m.localReady).length
  const r2Ready = markets.filter((m) => m.r2Ready).length

  const firstStartMs = markets[0]?.startMs ?? null
  const lastStartMs = markets[markets.length - 1]?.startMs ?? null
  const totalExpected =
    firstStartMs !== null && lastStartMs !== null
      ? Math.floor((startOfUtcDayMs(lastStartMs) - startOfUtcDayMs(firstStartMs)) / MS_PER_DAY + 1) *
        expectedPerDay
      : 0

  return {
    params,
    summary: {
      rawMarkets: toInt(rawCountRows[0]?.count),
      localReady,
      r2Ready,
      firstStartMs,
      lastStartMs,
      expectedPerDay,
    },
    total: {
      key: 'Total',
      expected: totalExpected,
      telonexMarkets: markets.length,
      localReady,
      r2Ready,
      telonexCoveragePct: pct(markets.length, totalExpected),
      localReadyPct: pct(localReady, markets.length),
      r2ReadyPct: pct(r2Ready, markets.length),
      firstStartMs: firstStartMs ?? 0,
      lastStartMs: lastStartMs ?? 0,
    },
    byMonth: groupCoverage(markets, monthKey, expectedPerDay),
    byWeek: groupCoverage(markets, isoWeekKey, expectedPerDay),
    byDay: groupCoverage(markets, dayKey, expectedPerDay),
  }
}
