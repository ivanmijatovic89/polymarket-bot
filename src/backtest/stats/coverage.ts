// Pure compute for backtest telonex-coverage reports.
//
// Given the eligible universe (already filtered by the dashboard query using
// `TELONEX_DATASET_ELIGIBLE_FROM` floor) and the covered slug set (slugs the
// backtest actually ran on), produce a report the UI can render directly:
// daily buckets with state, summary metrics, and the missing-slug list.
//
// No DB access — caller supplies both lists. Lives here so it can be unit
// tested without a DB and shared between the dashboard route and any future
// CLI report.

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type CoverageBucketState = 'full' | 'partial' | 'empty-gap'

export type CoverageBucket = {
  startMs: number
  endMs: number
  eligible: number
  covered: number
  state: CoverageBucketState
}

export type CoverageGapSide = 'forward' | 'backward' | 'middle'

export type MissingSlugEntry = {
  slug: string
  marketStartMs: number
  bucketKey: string
  side: CoverageGapSide
}

export type CoverageSummary = {
  eligibleTotal: number
  coveredTotal: number
  missingTotal: number
  /** Latest covered market_start_ms, or null if covered set is empty. */
  newestCoveredMs: number | null
  /** Earliest covered market_start_ms, or null if covered set is empty. */
  oldestCoveredMs: number | null
  /** Eligible slugs newer than newestCoveredMs (what `--forward` would run). */
  forwardGapCount: number
  /** Eligible slugs older than oldestCoveredMs (what `--backward` would run). */
  backwardGapCount: number
  /** Missing slugs sandwiched between oldest and newest covered. */
  middleGapCount: number
  /** Longest run of consecutive missing eligible slugs (by marketStartMs ASC). */
  longestContiguousGapCount: number
  longestContiguousGapStartMs: number | null
  longestContiguousGapEndMs: number | null
  /** Number of daily buckets where every eligible slug is missing. */
  fullGapBucketCount: number
}

export type CoverageReport = {
  summary: CoverageSummary
  buckets: CoverageBucket[]
  missingSlugs: MissingSlugEntry[]
}

export type EligibleEntry = { slug: string; marketStartMs: number }

/** UTC midnight for the day containing `ms`. */
function startOfUtcDayMs(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function bucketKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * Compute coverage for a backtest run.
 *
 * @param eligible  Eligible markets sorted by marketStartMs ASC. Caller is
 *                  responsible for applying the eligibility floor and the
 *                  (symbol, timeframe, converter, readFrom) filter.
 * @param coveredSlugs  Set of slugs the backtest actually ran on (from
 *                      backtest_run_markets). Slugs not in `eligible` are
 *                      ignored — they're outside the eligible universe.
 */
export function computeCoverage(
  eligible: EligibleEntry[],
  coveredSlugs: Set<string>,
): CoverageReport {
  if (eligible.length === 0) {
    return {
      summary: {
        eligibleTotal: 0,
        coveredTotal: 0,
        missingTotal: 0,
        newestCoveredMs: null,
        oldestCoveredMs: null,
        forwardGapCount: 0,
        backwardGapCount: 0,
        middleGapCount: 0,
        longestContiguousGapCount: 0,
        longestContiguousGapStartMs: null,
        longestContiguousGapEndMs: null,
        fullGapBucketCount: 0,
      },
      buckets: [],
      missingSlugs: [],
    }
  }

  let coveredTotal = 0
  let newestCoveredMs: number | null = null
  let oldestCoveredMs: number | null = null
  for (const m of eligible) {
    if (coveredSlugs.has(m.slug)) {
      coveredTotal++
      if (newestCoveredMs === null || m.marketStartMs > newestCoveredMs) {
        newestCoveredMs = m.marketStartMs
      }
      if (oldestCoveredMs === null || m.marketStartMs < oldestCoveredMs) {
        oldestCoveredMs = m.marketStartMs
      }
    }
  }
  const eligibleTotal = eligible.length
  const missingTotal = eligibleTotal - coveredTotal

  // Forward / backward / middle decomposition. When covered is empty, all
  // missing are treated as forward (so `--forward` would do the work) by
  // convention; tweak if a downstream consumer needs different semantics.
  let forwardGapCount = 0
  let backwardGapCount = 0
  let middleGapCount = 0
  for (const m of eligible) {
    if (coveredSlugs.has(m.slug)) continue
    if (newestCoveredMs === null || oldestCoveredMs === null) {
      forwardGapCount++
      continue
    }
    if (m.marketStartMs > newestCoveredMs) forwardGapCount++
    else if (m.marketStartMs < oldestCoveredMs) backwardGapCount++
    else middleGapCount++
  }

  // Longest contiguous run of missing eligible (by ascending order). The
  // eligible array is already chronological.
  let longestContiguousGapCount = 0
  let longestContiguousGapStartMs: number | null = null
  let longestContiguousGapEndMs: number | null = null
  let runStart: number | null = null
  let runLast: number | null = null
  let runLen = 0
  function flushRun(): void {
    if (runLen > longestContiguousGapCount) {
      longestContiguousGapCount = runLen
      longestContiguousGapStartMs = runStart
      longestContiguousGapEndMs = runLast
    }
  }
  for (const m of eligible) {
    if (coveredSlugs.has(m.slug)) {
      flushRun()
      runStart = null
      runLast = null
      runLen = 0
    } else {
      if (runStart === null) runStart = m.marketStartMs
      runLast = m.marketStartMs
      runLen++
    }
  }
  flushRun()

  // Daily buckets — cover the full eligible range from first to last day.
  const firstDay = startOfUtcDayMs(eligible[0]!.marketStartMs)
  const lastDay = startOfUtcDayMs(eligible[eligible.length - 1]!.marketStartMs)
  const bucketByKey = new Map<string, { startMs: number; eligible: number; covered: number }>()
  for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
    const key = bucketKey(day)
    bucketByKey.set(key, { startMs: day, eligible: 0, covered: 0 })
  }
  for (const m of eligible) {
    const key = bucketKey(m.marketStartMs)
    const cur = bucketByKey.get(key)
    if (cur) {
      cur.eligible++
      if (coveredSlugs.has(m.slug)) cur.covered++
    }
  }

  const buckets: CoverageBucket[] = []
  let fullGapBucketCount = 0
  for (const [, v] of bucketByKey) {
    let state: CoverageBucketState
    if (v.eligible === 0) continue // skip days with no eligible markets
    if (v.covered === 0) {
      state = 'empty-gap'
      fullGapBucketCount++
    } else if (v.covered === v.eligible) {
      state = 'full'
    } else {
      state = 'partial'
    }
    buckets.push({
      startMs: v.startMs,
      endMs: v.startMs + MS_PER_DAY - 1,
      eligible: v.eligible,
      covered: v.covered,
      state,
    })
  }
  buckets.sort((a, b) => a.startMs - b.startMs)

  // Missing slug list with side classification.
  const missingSlugs: MissingSlugEntry[] = []
  for (const m of eligible) {
    if (coveredSlugs.has(m.slug)) continue
    let side: CoverageGapSide
    if (newestCoveredMs === null || oldestCoveredMs === null) side = 'forward'
    else if (m.marketStartMs > newestCoveredMs) side = 'forward'
    else if (m.marketStartMs < oldestCoveredMs) side = 'backward'
    else side = 'middle'
    missingSlugs.push({
      slug: m.slug,
      marketStartMs: m.marketStartMs,
      bucketKey: bucketKey(m.marketStartMs),
      side,
    })
  }

  return {
    summary: {
      eligibleTotal,
      coveredTotal,
      missingTotal,
      newestCoveredMs,
      oldestCoveredMs,
      forwardGapCount,
      backwardGapCount,
      middleGapCount,
      longestContiguousGapCount,
      longestContiguousGapStartMs,
      longestContiguousGapEndMs,
      fullGapBucketCount,
    },
    buckets,
    missingSlugs,
  }
}
