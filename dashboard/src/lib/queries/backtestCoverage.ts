// Dashboard-side coverage query.

import { and, asc, eq } from 'drizzle-orm'
import { buildTelonexEligibilityConditions } from '@bot/db/telonexEligibility'
import { getDb } from '../db'
import {
  backtestRunMarkets,
  backtestRuns,
  telonexMarketConversions,
  telonexMarkets,
} from '../schema'
import { computeCoverage, type CoverageReport } from '@polymarket-bot/stats/coverage'
import { resolveCoverageScope } from './backtestCoverageScope'
import type { RecorderV4SelectionSummary } from '@bot/recorder-v4/replay/eligibility'
import { readRecorderV4Catalog } from './recorderV4Catalog'

const DEFAULT_ELIGIBLE_FROM_ISO = '2025-12-01T00:00:00Z'

function parseEligibleFromMs(): number {
  const raw = (process.env.TELONEX_DATASET_ELIGIBLE_FROM ?? '').trim()
  const iso = raw === '' ? DEFAULT_ELIGIBLE_FROM_ISO : raw
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) {
    return new Date(DEFAULT_ELIGIBLE_FROM_ISO).getTime()
  }
  return ms
}

export type BacktestCoverageMeta = {
  symbol: string
  timeframe: string
  converter: 'delta-typed' | 'paired' | 'recorder-v4'
  readFrom: 'local' | 'r2'
  inputMode: string
  eligibleFromMs: number
  feedRequirementsRecorded: boolean
  unverifiedReferences?: number
  exclusions?: Record<string, number>
  metadataOnly?: boolean
  selectionSummary?: RecorderV4SelectionSummary
  completedMarkets?: number
}

export type BacktestCoverageResponse = {
  meta: BacktestCoverageMeta
  report: CoverageReport
}

/**
 * Slug-selected runs can recover their display scope from the complete saved
 * selection. Recorded runs and runs with an unknown scope remain unavailable.
 */
export async function getBacktestCoverage(
  backtestId: number,
): Promise<BacktestCoverageResponse | null> {
  const db = getDb()

  const [run] = await db
    .select({
      id: backtestRuns.id,
      feedEligibility: backtestRuns.feedEligibility,
      recorderV4Selection: backtestRuns.recorderV4Selection,
      symbol: backtestRuns.symbol,
      timeframe: backtestRuns.timeframe,
      slugs: backtestRuns.slugs,
      inputMode: backtestRuns.inputMode,
      converter: backtestRuns.converter,
      readFrom: backtestRuns.readFrom,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, backtestId))
    .limit(1)

  if (!run) return null
  if (run.inputMode === 'recorder-v4') {
    const selection = run.recorderV4Selection
    if (!selection) return null
    const timeframe = selection.filters.timeframe
    if (timeframe !== undefined && timeframe !== '5m' && timeframe !== '15m') return null
    const available = await readRecorderV4Catalog(
      selection.source,
      { ...selection.filters, ...(timeframe ? { timeframe } : {}) },
      selection.requiredFeeds,
      selection.allowGaps,
    )
    const covered = await db
      .select({ slug: backtestRunMarkets.slug })
      .from(backtestRunMarkets)
      .where(eq(backtestRunMarkets.runId, backtestId))
    const eligibleFromMs =
      selection.filters.fromMs ?? Math.min(...available.rows.map((row) => row.startMs), Date.now())
    return {
      meta: {
        symbol: 'btc',
        timeframe: timeframe ?? '5m + 15m',
        converter: 'recorder-v4',
        readFrom: selection.source.kind === 'r2' ? 'r2' : 'local',
        inputMode: 'recorder-v4',
        eligibleFromMs,
        feedRequirementsRecorded: true,
        metadataOnly: true,
        selectionSummary: selection.summary,
        completedMarkets: covered.length,
        unverifiedReferences: available.summary.exclusions.ptb_unverified ?? 0,
        exclusions: available.summary.exclusions,
      },
      report: computeCoverage(
        available.rows
          .filter((row) => row.eligible)
          .map((row) => ({ slug: row.slug, marketStartMs: row.startMs })),
        new Set(covered.map((row) => row.slug)),
      ),
    }
  }
  if (
    run.inputMode === null ||
    run.inputMode === 'recorded' ||
    run.converter === null ||
    run.readFrom === null
  ) {
    return null
  }

  const scope = resolveCoverageScope(run)
  if (scope === null) return null

  const converter = run.converter as 'delta-typed' | 'paired'
  const readFrom = run.readFrom as 'local' | 'r2'
  const eligibleFromMs = parseEligibleFromMs()

  const eligibleRows = (await db
    .select({
      slug: telonexMarkets.slug,
      marketStartMs: telonexMarkets.marketStartMs,
    })
    .from(telonexMarkets)
    .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
    .where(
      and(
        ...buildTelonexEligibilityConditions(
          {
            markets: {
              slug: telonexMarkets.slug,
              symbol: telonexMarkets.symbol,
              timeframe: telonexMarkets.timeframe,
              marketStartMs: telonexMarkets.marketStartMs,
              telonexStatus: telonexMarkets.telonexStatus,
              resultId: telonexMarkets.resultId,
              binanceUsable: telonexMarkets.binanceUsable,
              chainlinkUsable: telonexMarkets.chainlinkUsable,
              priceToBeat: telonexMarkets.priceToBeat,
            },
            conversions: {
              converter: telonexMarketConversions.converter,
              status: telonexMarketConversions.status,
              localPath: telonexMarketConversions.localPath,
              r2Url: telonexMarketConversions.r2Url,
            },
          },
          {
            converter,
            readFrom,
            requiredFeeds: run.feedEligibility?.requiredFeeds ?? {},
            symbol: scope.symbol,
            timeframe: scope.timeframe,
            fromMs: eligibleFromMs,
          },
        ),
      ),
    )
    .orderBy(asc(telonexMarkets.marketStartMs))) as Array<{
    slug: string
    marketStartMs: number
  }>

  const coveredRows = (await db
    .select({ slug: backtestRunMarkets.slug })
    .from(backtestRunMarkets)
    .where(eq(backtestRunMarkets.runId, backtestId))) as Array<{
    slug: string
  }>

  const coveredSet = new Set(coveredRows.map((r) => r.slug))
  const report = computeCoverage(
    eligibleRows.map((r) => ({
      slug: r.slug,
      marketStartMs: Number(r.marketStartMs),
    })),
    coveredSet,
  )

  return {
    meta: {
      symbol: scope.symbol,
      timeframe: scope.timeframe,
      converter,
      readFrom,
      inputMode: run.inputMode,
      eligibleFromMs,
      feedRequirementsRecorded: run.feedEligibility !== null,
    },
    report,
  }
}
