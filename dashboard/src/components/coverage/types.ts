// Re-export shared types so component files don't need cross-package paths.
export type {
  CoverageBucket,
  CoverageBucketState,
  CoverageGapSide,
  CoverageReport,
  CoverageSummary,
  MissingSlugEntry,
} from '@polymarket-bot/stats/coverage'

export type CoverageMeta = {
  symbol: string
  timeframe: string
  converter: 'delta-typed' | 'paired' | 'recorder-v4'
  readFrom: 'local' | 'r2'
  inputMode: string
  feedRequirementsRecorded: boolean
  eligibleFromMs: number
  selectionSummary?: import('@bot/recorder-v4/replay/eligibility').RecorderV4SelectionSummary
  completedMarkets?: number
  metadataOnly?: boolean
  unverifiedReferences?: number
  exclusions?: Record<string, number>
}

export type CoverageResponse =
  | { available: false }
  | ({ available: true; meta: CoverageMeta } & {
      report: import('@polymarket-bot/stats/coverage').CoverageReport
    })
