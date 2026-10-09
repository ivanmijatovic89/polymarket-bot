/**
 * The DB-contract check of one `MarketStats` row (21 §19 "TS aggregator",
 * for TS-engine and native rows alike): §11 ranges and quantization, §17
 * vocabularies including `rules.source`, §18 N1 and N6. An invalid row
 * becomes the failure row `invalid_market_stats: <field>: <reason>` instead
 * of aborting the run's insert transaction (`src/db/backtests.ts`).
 */
import type { MarketStats } from '../../backtest/stats/marketStats.js'
import { hasDecimalScale } from './validate.js'

export interface MarketStatsViolation {
  field: string
  reason: string
}

const INT_MAX = 2 ** 31 - 1
const RULES_SOURCES = new Set(['snapshot', 'partial', 'fallback'])

type Check = (field: string, v: unknown) => string | null

const finite: Check = (_f, v) =>
  typeof v === 'number' && Number.isFinite(v) ? null : 'not a finite number (N1)'

function money(scale: number, min: number, max: number, minInclusive: boolean): Check {
  return (f, v) => {
    const bad = finite(f, v)
    if (bad) return bad
    const x = v as number
    if (!hasDecimalScale(scale, x)) return `more than ${scale} decimal places (N6)`
    if (minInclusive ? x < min : x <= min) return `below the column range (${min})`
    if (x >= max) return `at or above the column range (${max})`
    return null
  }
}

const count: Check = (_f, v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= INT_MAX
    ? null
    : 'not an int in 0..2^31-1'

const text255: Check = (_f, v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 255 ? null : 'not a 1..255 string'

/**
 * Returns the first violation, or null for a valid row. Field order follows
 * 21 §11.
 */
export function checkMarketStatsRow(stats: MarketStats): MarketStatsViolation | null {
  const row = stats as unknown as Record<string, unknown>
  const avgPrice: Check = (f, v) => (v === null ? null : money(4, 0, 1, false)(f, v))
  const checks: Array<[string, Check]> = [
    ['marketId', text255],
    ['slug', text255],
    ['finalOutcome', (_f, v) => (v === 'UP' || v === 'DOWN' ? null : 'not UP or DOWN')],
    ['pnl', money(2, -1e10, 1e10, false)],
    ['tradeCount', count],
    ['tradeAsMaker', count],
    ['tradeAsTaker', count],
    ['feesPaid', money(2, 0, 1e10, true)],
    ['avgEntryPriceUp', avgPrice],
    ['avgEntryPriceDown', avgPrice],
    ['upShares', money(2, 0, 1e12, true)],
    ['downShares', money(2, 0, 1e12, true)],
    ['mergableShares', money(2, 0, 1e12, true)],
    ['cost', money(2, -1e10, 1e10, false)],
    ['splitCost', money(2, 0, 1e10, true)],
    ['intentMeta', (_f, v) => (Array.isArray(v) ? null : 'not an array (never null)')],
    [
      'skipReason',
      (_f, v) =>
        v === undefined || v === 'no_in_window_activity' ? null : 'not in the §17 vocabulary',
    ],
    [
      'rules',
      (_f, v) => {
        if (v === undefined || v === null) return null
        const source = (v as { source?: unknown }).source
        return typeof source === 'string' && RULES_SOURCES.has(source)
          ? null
          : 'rules.source not in snapshot|partial|fallback (11 RS4)'
      },
    ],
  ]
  for (const [field, check] of checks) {
    const reason = check(field, row[field])
    if (reason !== null) return { field, reason }
  }
  return null
}

/** `backtest_run_failures.reason` for an invalid row (21 §14, §19). */
export function invalidMarketStatsReason(v: MarketStatsViolation): string {
  return `invalid_market_stats: ${v.field}: ${v.reason}`
}
