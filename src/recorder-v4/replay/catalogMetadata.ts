import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { captureEligibilityReasons } from './eligibility.js'
import type { ResolvedCapturePackage } from './package.js'
import { selectEligibleCapturePackages } from './selection.js'

/** Database discovery carries verified reference evidence; unindexed local inputs remain explicit. */
export function inspectRecorderV4Metadata(
  packages: readonly ResolvedCapturePackage[],
  requiredFeeds: ExternalFeedsRequestConfig,
  allowGaps = false,
) {
  return selectEligibleCapturePackages({
    packages,
    requiredFeeds,
    allowGaps,
    inspect: async (pkg, config, gaps) =>
      captureEligibilityReasons(pkg.manifest, config, {
        allowGaps: gaps ?? false,
        resolution: pkg.marketResolution,
        ...(pkg.catalogEvidence ? { referenceEvidence: pkg.catalogEvidence.reference } : {}),
      }),
  })
}

/** Compact display data; no raw Gamma metadata, file paths or final winners are exposed. */
export async function captureCatalogMetadata(
  packages: readonly ResolvedCapturePackage[],
  requiredFeeds: ExternalFeedsRequestConfig,
  allowGaps = false,
) {
  const selection = await inspectRecorderV4Metadata(packages, requiredFeeds, allowGaps)
  const eligible = new Set(
    selection.packages.map((pkg) => `${pkg.manifest.recordingId}/${pkg.manifest.market.slug}`),
  )
  const exclusions = new Map(
    selection.excluded.map((entry) => [`${entry.recordingId}/${entry.slug}`, entry.reasons]),
  )
  return {
    inspectedAtMs: Date.now(),
    catalogSync: null as null | {
      lastCompletedAtMs: number | null
      indexed: number
      remaining: number
      failures: number
    },
    summary: selection.summary,
    rows: packages
      .map((pkg) => ({
        slug: pkg.manifest.market.slug,
        recordingId: pkg.manifest.recordingId,
        startMs: pkg.manifest.market.startMs,
        bytes: pkg.manifest.events.bytes,
        events: pkg.manifest.events.rows,
        complete: pkg.manifest.coverage.complete,
        gaps: pkg.manifest.coverage.gaps.length,
        resolved: pkg.marketResolution.outcome !== null,
        websitePtb: pkg.catalogEvidence?.reference.websiteObserved ?? null,
        openingTwap: pkg.catalogEvidence
          ? pkg.catalogEvidence.reference.openingReasons.length === 0
          : null,
        eligible: eligible.has(`${pkg.manifest.recordingId}/${pkg.manifest.market.slug}`),
        reasons: exclusions.get(`${pkg.manifest.recordingId}/${pkg.manifest.market.slug}`) ?? [],
      }))
      .sort((a, b) => b.startMs - a.startMs),
  }
}
export type CaptureCatalogMetadata = Awaited<ReturnType<typeof captureCatalogMetadata>>
