import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { MarketResolution } from '../../backtest/stats/marketResolution.js'
import type { ExternalFeedsRequestConfig } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { isR2Url } from '../../r2/parseR2Url.js'
import { marketManifestSchema, readManifest, type MarketManifest } from '../storage/manifest.js'
import { digestFile } from '../storage/files.js'
import {
  captureMarketMetadata,
  downloadCaptureForReplay,
  type ResolvedCapturePackage,
} from './package.js'
import { validateCapturedFeedRequest } from './feedState.js'

/** Immutable input evidence saved with the result, independent of mutable catalog state. */
export type RecorderV4Capture = {
  version: 1
  manifest: MarketManifest
  /** SHA-256 of canonical JSON, so database object key ordering cannot alter identity. */
  manifestSha256: string
  input: string
  marketResolution: MarketResolution
  allowGaps: boolean
  requiredFeeds: ExternalFeedsRequestConfig
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Capture provenance is not JSON serializable')
  return encoded
}

export function captureManifestHash(manifest: MarketManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex')
}

const referenceSchema = z.object({
  version: z.literal(1),
  manifest: marketManifestSchema,
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  input: z.string().min(1),
  marketResolution: z.object({
    tokenMap: z.record(z.string(), z.string()),
    outcome: z.enum(['UP', 'DOWN']).nullable(),
  }),
  allowGaps: z.boolean(),
  requiredFeeds: z.record(z.string(), z.unknown()),
})

export function parseCaptureReference(value: unknown): RecorderV4Capture {
  const parsed = referenceSchema.parse(value) as RecorderV4Capture
  if (captureManifestHash(parsed.manifest) !== parsed.manifestSha256)
    throw new Error('Saved recorder manifest checksum does not match its metadata')
  const market = parsed.manifest.market
  for (const [i, outcome] of market.outcomes.entries()) {
    if (parsed.marketResolution.tokenMap[outcome.toUpperCase()] !== market.tokenIds[i])
      throw new Error('Saved resolution token map differs from the recording')
  }
  if (!isR2Url(parsed.input) && !path.isAbsolute(parsed.input))
    throw new Error('Saved local recorder input must be an absolute path')
  validateCapturedFeedRequest(parsed.requiredFeeds, market)
  return parsed
}

export function createCaptureReference(args: {
  manifest: MarketManifest
  input: string
  marketResolution: MarketResolution
  allowGaps?: boolean
  requiredFeeds: ExternalFeedsRequestConfig
}): RecorderV4Capture {
  return parseCaptureReference({
    version: 1,
    manifest: args.manifest,
    manifestSha256: captureManifestHash(args.manifest),
    input: isR2Url(args.input) ? args.input : path.resolve(args.input),
    marketResolution: args.marketResolution,
    allowGaps: args.allowGaps ?? false,
    requiredFeeds: args.requiredFeeds,
  })
}

/** Resolve only this saved package. Later settlement observations do not rewrite an old result. */
export async function resolveCaptureReference(
  reference: RecorderV4Capture,
  options: { cacheDirectory?: string } = {},
): Promise<ResolvedCapturePackage> {
  const saved = parseCaptureReference(reference)
  let manifest: MarketManifest
  let filePath: string
  if (isR2Url(saved.input)) {
    if (!options.cacheDirectory) throw new Error('A cache directory is required for remote replay')
    const downloaded = await downloadCaptureForReplay(saved.input, options.cacheDirectory)
    manifest = downloaded.manifest
    filePath = downloaded.filePath
  } else {
    filePath =
      path.basename(saved.input) === 'manifest.json'
        ? path.join(path.dirname(saved.input), 'events.parquet')
        : saved.input
    manifest = await readManifest(path.join(path.dirname(filePath), 'manifest.json'))
  }
  if (captureManifestHash(manifest) !== saved.manifestSha256)
    throw new Error('The available recording differs from the original backtest input')
  const digest = await digestFile(filePath)
  if (digest.sha256 !== manifest.events.sha256 || digest.bytes !== manifest.events.bytes)
    throw new Error('Recorder parquet integrity verification failed')
  return {
    manifest,
    filePath,
    marketMeta: captureMarketMetadata(manifest),
    marketResolution: structuredClone(saved.marketResolution),
  }
}
