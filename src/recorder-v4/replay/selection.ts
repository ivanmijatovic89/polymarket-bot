import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { validateArchivePrefix } from '../storage/namespace.js'
import { catalogCapturePackage } from '../catalog/packages.js'
import { digestFile } from '../storage/files.js'
import type { RecorderTimeframe } from '../types.js'
import {
  captureEligibilityReasons,
  referenceAdmissionEvidence,
  type RecorderV4SelectionSource,
  type RecorderV4SelectionSummary,
} from './eligibility.js'
import {
  downloadCaptureForReplay,
  resolveCaptureInputs,
  resolveCapturePackage,
  type ResolvedCapturePackage,
} from './package.js'
import { captureManifestHash } from './provenance.js'
import { inspectOpeningReference } from './openingReference.js'
import { readOpeningReferenceEvents } from '../storage/parquet.js'
import { readAdmissionEvidence, writeAdmissionEvidence } from './admissionCache.js'
import { withAdmissionTemporaryDirectory } from './admissionTemporary.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export type CaptureSelectionFilters = {
  timeframe?: RecorderTimeframe
  fromMs?: number
  toMs?: number
  slugs?: readonly string[]
  excludeSlugs?: readonly string[]
}

export async function discoverCapturePackages(
  source: RecorderV4SelectionSource,
  filters: CaptureSelectionFilters = {},
): Promise<ResolvedCapturePackage[]> {
  let inputs: string[]
  if (source.kind === 'r2') {
    const { queryCatalogRecordings } = await import('../../db/recorderV4Catalog.js')
    const recordings = await queryCatalogRecordings(
      { bucket: source.bucket, prefix: validateArchivePrefix(source.prefix) },
      filters,
    )
    return recordings.map(catalogCapturePackage)
  } else {
    inputs = await resolveCaptureInputs(
      source.kind === 'explicit' ? source.inputs : [],
      source.kind === 'local' ? source.roots : [],
    )
  }
  // Bound remote requests and memory; discovery never downloads event Parquet files.
  const packages: ResolvedCapturePackage[] = []
  for (const input of inputs) {
    const pkg = await resolveCapturePackage(input)
    if (matchesCaptureFilters(pkg.manifest.market, filters)) packages.push(pkg)
  }
  return packages
}

export function matchesCaptureFilters(
  market: { slug: string; timeframe: RecorderTimeframe; startMs: number },
  filters: CaptureSelectionFilters,
): boolean {
  return (
    (!filters.timeframe || market.timeframe === filters.timeframe) &&
    (filters.fromMs === undefined || market.startMs >= filters.fromMs) &&
    (filters.toMs === undefined || market.startMs <= filters.toMs) &&
    (!filters.slugs?.length || filters.slugs.includes(market.slug)) &&
    !filters.excludeSlugs?.includes(market.slug)
  )
}

export type CaptureExclusion = { slug: string; recordingId: string; reasons: string[] }
export type CaptureSelection = {
  packages: ResolvedCapturePackage[]
  summary: RecorderV4SelectionSummary
  excluded: CaptureExclusion[]
}

export async function inspectCapturePackage(
  pkg: ResolvedCapturePackage,
  requiredFeeds: ExternalFeedsRequestConfig,
  allowGaps = false,
): Promise<string[]> {
  if (pkg.catalogEvidence) {
    if (pkg.catalogEvidence.manifestSha256 !== captureManifestHash(pkg.manifest))
      throw new Error('Catalog evidence does not match the selected recording')
    return captureEligibilityReasons(pkg.manifest, requiredFeeds, {
      allowGaps,
      resolution: pkg.marketResolution,
      referenceEvidence: pkg.catalogEvidence.reference,
    })
  }
  const metadataReasons = captureEligibilityReasons(pkg.manifest, requiredFeeds, {
    allowGaps,
    resolution: pkg.marketResolution,
  }).filter((reason) => !reason.startsWith('ptb_unverified:'))
  if (metadataReasons.length) return metadataReasons
  // Reference admission examines only the requested source, in recorded receipt order.
  // A verified worker download still occurs at execution for all remote packages.
  if (!requiredFeeds.polymarketPriceToBeat?.enabled || allowGaps) return []
  const cacheRoot = path.resolve(REPO_ROOT, 'data/recorder-v4-admission-cache')
  const hash = captureManifestHash(pkg.manifest)
  let evidence = pkg.manifestUrl ? await readAdmissionEvidence(cacheRoot, hash) : null
  if (!evidence) {
    if (pkg.manifestUrl) {
      evidence = await withAdmissionTemporaryDirectory(async (temporary) => {
        const downloaded = await downloadCaptureForReplay(pkg.manifestUrl!, temporary)
        if (captureManifestHash(downloaded.manifest) !== hash)
          throw new Error('Recorder manifest changed during eligibility inspection')
        return referenceAdmissionEvidence(
          await inspectOpeningReference(
            pkg.manifest.market,
            readOpeningReferenceEvents(downloaded.filePath),
          ),
        )
      })
      await writeAdmissionEvidence(cacheRoot, hash, evidence)
    } else {
      const digest = await digestFile(pkg.filePath)
      if (
        digest.sha256 !== pkg.manifest.events.sha256 ||
        digest.bytes !== pkg.manifest.events.bytes
      )
        throw new Error(
          'Recorder parquet integrity verification failed during eligibility inspection',
        )
      evidence = referenceAdmissionEvidence(
        await inspectOpeningReference(
          pkg.manifest.market,
          readOpeningReferenceEvents(pkg.filePath),
        ),
      )
    }
  }
  return captureEligibilityReasons(pkg.manifest, requiredFeeds, {
    allowGaps,
    resolution: pkg.marketResolution,
    referenceEvidence: evidence,
  })
}

/** Filter the full candidate universe before ordering/sampling/limiting. */
export async function selectEligibleCapturePackages(
  options: CaptureSelectionFilters & {
    packages: readonly ResolvedCapturePackage[]
    requiredFeeds: ExternalFeedsRequestConfig
    allowGaps?: boolean
    limit?: number
    latest?: boolean
    random?: boolean
    inspect?: typeof inspectCapturePackage
    randomValue?: () => number
  },
): Promise<CaptureSelection> {
  const candidates = options.packages.filter((pkg) =>
    matchesCaptureFilters(pkg.manifest.market, options),
  )
  const bySlug = new Map<string, ResolvedCapturePackage[]>()
  for (const pkg of candidates) {
    const group = bySlug.get(pkg.manifest.market.slug) ?? []
    group.push(pkg)
    bySlug.set(pkg.manifest.market.slug, group)
  }
  const eligible: ResolvedCapturePackage[] = []
  const excluded: CaptureExclusion[] = []
  const inspect = options.inspect ?? inspectCapturePackage
  for (const [slug, group] of bySlug) {
    if (group.length > 1) {
      for (const pkg of group)
        excluded.push({
          slug,
          recordingId: pkg.manifest.recordingId,
          reasons: [
            'ambiguous_recording: select one exact manifest; recordings are never stitched or ranked',
          ],
        })
      continue
    }
    const pkg = group[0]!
    let reasons: string[]
    try {
      reasons = await inspect(pkg, options.requiredFeeds, options.allowGaps ?? false)
    } catch (error) {
      reasons = [`invalid_package: ${error instanceof Error ? error.message : String(error)}`]
    }
    if (reasons.length) excluded.push({ slug, recordingId: pkg.manifest.recordingId, reasons })
    else eligible.push(pkg)
  }
  for (const slug of new Set(options.slugs ?? [])) {
    if (!bySlug.has(slug))
      excluded.push({
        slug,
        recordingId: 'unavailable',
        reasons: ['missing_recording: no package matches the requested market and filters'],
      })
  }
  eligible.sort(
    (a, b) =>
      a.manifest.market.startMs - b.manifest.market.startMs ||
      a.manifest.market.slug.localeCompare(b.manifest.market.slug),
  )
  if (options.latest) eligible.reverse()
  if (options.random) {
    const random = options.randomValue ?? Math.random
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!]
    }
  }
  const packages = options.limit === undefined ? eligible : eligible.slice(0, options.limit)
  const exclusions: Record<string, number> = {}
  for (const exclusion of excluded)
    for (const code of new Set(exclusion.reasons.map((reason) => reason.split(':')[0]!)))
      exclusions[code] = (exclusions[code] ?? 0) + 1
  return {
    packages,
    excluded,
    summary: {
      candidates:
        candidates.length + excluded.filter((item) => item.recordingId === 'unavailable').length,
      eligible: eligible.length,
      selected: packages.length,
      excluded: excluded.length,
      exclusions,
    },
  }
}

export function requireCaptureSelectionSize(limit: number | undefined, eligible: number): void {
  if (limit !== undefined && eligible < limit)
    throw new Error(
      `Recorder v4 selection shortfall: requested ${limit} eligible markets, found ${eligible}. No jobs were launched. Review the exclusion summary or lower --limit.`,
    )
}
