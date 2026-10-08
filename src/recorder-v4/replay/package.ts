import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { isR2Url, parseR2Url } from '../../r2/parseR2Url.js'
import type { GammaMarketMeta } from '../../polymarket/gammaMarketMeta.js'
import type { MarketResolution } from '../../backtest/stats/marketResolution.js'
import { R2BlobStore } from '../storage/blobStore.js'
import { downloadMarket, downloadResolutions } from '../storage/archive.js'
import { readSmallStream, exists } from '../storage/files.js'
import { parseManifest, readManifest, type MarketManifest } from '../storage/manifest.js'
import type { ResolutionObservation } from '../types.js'
import { object } from './feedState.js'
import {
  readResolutionArtifact,
  validateResolutionObservation,
} from '../storage/resolutionArtifact.js'

export function replayBlobStore(bucket: string): R2BlobStore {
  const required = (name: string): string => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing ${name} for recorder package download`)
    return value
  }
  return new R2BlobStore({
    bucket,
    endpoint: required('R2_ENDPOINT'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  })
}

export async function resolveCaptureInputs(
  inputs: string[],
  directories: string[],
): Promise<string[]> {
  const found = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (isR2Url(file)) {
      found.add(file)
      return
    }
    const absolute = path.resolve(file)
    if ((await stat(absolute)).isDirectory()) {
      if (await exists(path.join(absolute, 'manifest.json'))) {
        found.add(path.join(absolute, 'manifest.json'))
      } else {
        for (const entry of await readdir(absolute, { withFileTypes: true })) {
          if (entry.isDirectory()) await visit(path.join(absolute, entry.name))
        }
      }
      return
    }
    if (
      path.basename(absolute) !== 'manifest.json' &&
      path.basename(absolute) !== 'events.parquet'
    ) {
      throw new Error(
        'Recorder input must be a package directory, manifest.json, events.parquet, or R2 manifest URL',
      )
    }
    found.add(path.join(path.dirname(absolute), 'manifest.json'))
  }
  for (const file of [...inputs, ...directories]) await visit(file)
  return [...found].sort()
}

export type ResolvedCapturePackage = {
  manifest: MarketManifest
  filePath: string
  manifestUrl?: string
  marketMeta: GammaMarketMeta
  marketResolution: MarketResolution
  /** Verified catalog facts used for selection only; workers recheck the downloaded file. */
  catalogEvidence?: {
    manifestSha256: string
    reference: import('./eligibility.js').PtbAdmissionEvidence
  }
}

export function captureMarketMetadata(manifest: Pick<MarketManifest, 'market'>): GammaMarketMeta {
  const { market } = manifest
  const outcomeTokenMap: Record<string, string> = {}
  market.outcomes.forEach((outcome, i) => {
    outcomeTokenMap[outcome.toLowerCase()] = market.tokenIds[i]!
  })
  let raw: Record<string, unknown> | null = null
  try {
    raw = object(JSON.parse(market.rawJson))
  } catch {
    /* optional */
  }
  // Explicit allowlist: never expose final outcomes, settlement prices, or
  // later API event metadata through the strategy's market context.
  const rules = Object.fromEntries(
    [
      'question',
      'description',
      'orderPriceMinTickSize',
      'orderMinSize',
      'feesEnabled',
      'feeSchedule',
      'negRisk',
    ]
      .filter((key) => raw?.[key] !== undefined)
      .map((key) => [key, raw![key]]),
  )
  return {
    ...rules,
    slug: market.slug,
    conditionId: market.conditionId,
    outcomes: [...market.outcomes],
    clobTokenIds: [...market.tokenIds],
    outcomeTokenMap,
    upAssetId: outcomeTokenMap.up ?? null,
    downAssetId: outcomeTokenMap.down ?? null,
    startDate: new Date(market.startMs).toISOString(),
    endDate: new Date(market.endMs).toISOString(),
    resolutionSource: market.resolutionSource,
    cryptoMarketConfig: {
      twapEnabled: market.twapEnabled,
      twapLookbackSeconds: market.twapLookbackSeconds,
    },
  }
}

export function captureMarketResolution(
  manifest: MarketManifest,
  observations: ResolutionObservation[],
): MarketResolution {
  const tokenMap = Object.fromEntries(
    manifest.market.outcomes.map((outcome, i) => [
      outcome.toUpperCase(),
      manifest.market.tokenIds[i]!,
    ]),
  )
  const latest = observations
    .filter((o) => o.slug === manifest.market.slug && o.conditionId === manifest.market.conditionId)
    .sort((a, b) => a.observedAtMs - b.observedAtMs)
    .at(-1)
  const candidate = latest?.status === 'resolved' ? latest.winningOutcome?.toUpperCase() : null
  const outcome =
    (candidate === 'UP' || candidate === 'DOWN') && latest?.winningTokenId === tokenMap[candidate]
      ? candidate
      : null
  return { tokenMap, outcome }
}

export async function resolveCapturePackage(input: string): Promise<ResolvedCapturePackage> {
  let manifest: MarketManifest
  let observations: ResolutionObservation[] = []
  let filePath: string
  if (isR2Url(input)) {
    const { bucket, key } = parseR2Url(input)
    const store = replayBlobStore(bucket)
    try {
      const stream = await store.get(key)
      if (!stream) throw new Error('Recorder manifest does not exist')
      const body = await readSmallStream(stream)
      const hash = /\/manifest-([a-f0-9]{64})\.json$/.exec(key)?.[1]
      if (!hash || createHash('sha256').update(body).digest('hex') !== hash)
        throw new Error('Recorder manifest integrity verification failed')
      manifest = parseManifest(body.toString('utf8'))
      if (path.posix.dirname(key) !== path.posix.dirname(manifest.events.key))
        throw new Error('Recorder manifest points outside its package')
      observations = await downloadResolutions(store, manifest)
    } finally {
      store.close()
    }
    filePath = input // Worker resolves this to its own verified cache.
  } else {
    const directory = path.dirname(path.resolve(input))
    manifest = await readManifest(path.join(directory, 'manifest.json'))
    filePath = path.join(directory, 'events.parquet')
    // download CLI writes verified observations for fully offline backtests.
    const resolutionFile = path.join(directory, 'resolutions.json')
    if (await exists(resolutionFile)) {
      const history: unknown = JSON.parse(await readFile(resolutionFile, 'utf8'))
      if (!Array.isArray(history)) throw new Error('Invalid local resolution history')
      observations = history.map((value) => validateResolutionObservation(value, manifest.market))
    }
    const outbox = path.join(directory, 'resolution-outbox')
    if (await exists(outbox)) {
      for (const name of await readdir(outbox))
        if (/^\d+-[a-f0-9]{64}\.json$/.test(name))
          observations.push(
            (await readResolutionArtifact(path.join(outbox, name), manifest.market)).observation,
          )
    }
  }
  return {
    manifest,
    filePath,
    ...(isR2Url(input) ? { manifestUrl: input } : {}),
    marketMeta: captureMarketMetadata(manifest),
    marketResolution: captureMarketResolution(manifest, observations),
  }
}

export async function downloadCaptureForReplay(
  manifestUrl: string,
  cacheDir: string,
): Promise<{ filePath: string; manifest: MarketManifest }> {
  const { bucket, key } = parseR2Url(manifestUrl)
  const store = replayBlobStore(bucket)
  try {
    const downloaded = await downloadMarket(store, key, cacheDir)
    return { filePath: downloaded.parquetPath, manifest: downloaded.manifest }
  } finally {
    store.close()
  }
}
