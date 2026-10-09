/**
 * Market grid, capture windows and constants of the pre-start exchange-rules
 * capture (native spec 11 §13.2.1, decision D37).
 *
 * PC6 code boundary: this module imports nothing (the capture modules import
 * only Node built-ins and modules under src/exchange-rules/). The slug grid
 * mirrors `candidateBtcSlugs` in src/recorder-v4/markets.ts on purpose rather
 * than importing it.
 */

export type Timeframe = '5m' | '15m'
export type Origin = 'gamma' | 'clob'
export type Slot = 'first' | 'final'

export const TIMEFRAMES: readonly Timeframe[] = ['5m', '15m']
export const ORIGINS: readonly Origin[] = ['gamma', 'clob']
export const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = { '5m': 300_000, '15m': 900_000 }

/** PC3: a market is in the capture window when `now + 15 s < start <= now + 10 min`. */
export const WINDOW_MIN_LEAD_MS = 15_000
export const WINDOW_MAX_LEAD_MS = 600_000
/** PC3: the `final` slot is fetched at the tick with `start - 90 s < now <= start - 15 s`. */
export const FINAL_MAX_LEAD_MS = 90_000
export const FINAL_MIN_LEAD_MS = 15_000
/** PC3: one tick per wall-clock minute, at second 5. */
export const TICK_OFFSET_MS = 5_000
export const DAY_MS = 86_400_000

export interface GridMarket {
  slug: string
  timeframe: Timeframe
  marketStartMs: number
}

export function gridSlug(timeframe: Timeframe, marketStartMs: number): string {
  return `btc-updown-${timeframe}-${marketStartMs / 1_000}`
}

/** Grid markets with `fromExclusiveMs < start <= toInclusiveMs`, by start, then 5m before 15m. */
export function gridMarketsBetween(
  timeframes: readonly Timeframe[],
  fromExclusiveMs: number,
  toInclusiveMs: number,
): GridMarket[] {
  const markets: GridMarket[] = []
  for (const timeframe of timeframes) {
    const step = TIMEFRAME_MS[timeframe]
    const first = Math.floor(fromExclusiveMs / step) * step + step
    for (let start = first; start <= toInclusiveMs; start += step) {
      markets.push({ slug: gridSlug(timeframe, start), timeframe, marketStartMs: start })
    }
  }
  return markets.sort(
    (a, b) =>
      a.marketStartMs - b.marketStartMs || TIMEFRAME_MS[a.timeframe] - TIMEFRAME_MS[b.timeframe],
  )
}

/** The grid markets a tick at `nowMs` works on (PC3). */
export function captureWindowMarkets(
  nowMs: number,
  timeframes: readonly Timeframe[],
): GridMarket[] {
  return gridMarketsBetween(timeframes, nowMs + WINDOW_MIN_LEAD_MS, nowMs + WINDOW_MAX_LEAD_MS)
}

/** True at the one tick that fetches the `final` slot (normally start - 55 s). */
export function isFinalTick(nowMs: number, marketStartMs: number): boolean {
  return marketStartMs - FINAL_MAX_LEAD_MS < nowMs && nowMs <= marketStartMs - FINAL_MIN_LEAD_MS
}

/** The next wall-clock instant at second 5 of a minute, strictly after `nowMs`. */
export function nextTickMs(nowMs: number): number {
  const candidate = Math.floor(nowMs / 60_000) * 60_000 + TICK_OFFSET_MS
  return candidate > nowMs ? candidate : candidate + 60_000
}

/** Parses `--market btc:5m,btc:15m` into timeframes in canonical order. */
export function parseMarketsArg(value: string): Timeframe[] {
  const selected = new Set<Timeframe>()
  for (const raw of value.split(',')) {
    const item = raw.trim().toLowerCase()
    if (item === 'btc:5m') selected.add('5m')
    else if (item === 'btc:15m') selected.add('15m')
    else throw new Error(`--market accepts btc:5m and btc:15m (comma-separated), got "${raw}"`)
  }
  return TIMEFRAMES.filter((timeframe) => selected.has(timeframe))
}

/** `yyyy-mm-dd` of the UTC date of `ms`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function utcDayStartMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

/** UTC days touched by `[fromMs, toMs]`, oldest first. */
export function utcDaysBetween(fromMs: number, toMs: number): string[] {
  const days: string[] = []
  for (let start = utcDayStartMs(fromMs); start <= toMs; start += DAY_MS) days.push(utcDay(start))
  return days
}
