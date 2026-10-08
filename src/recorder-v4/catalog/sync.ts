import path from 'node:path'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import type { BlobStore } from '../storage/blobStore.js'
import { downloadMarket, downloadResolutions } from '../storage/archive.js'
import { withAdmissionTemporaryDirectory } from '../replay/admissionTemporary.js'
import { inspectOpeningReference } from '../replay/openingReference.js'
import { referenceAdmissionEvidence } from '../replay/eligibility.js'
import { readOpeningReferenceEvents } from '../storage/parquet.js'
import { captureManifestHash } from '../replay/provenance.js'
import { catalogKeyIdentity, catalogRecordingId, resolutionKeysHash } from './identity.js'
import type { CatalogRepository, CatalogScope, CatalogSyncStatus } from './types.js'
import type { ResolutionObservation } from '../types.js'

const RECENT_MS = 30 * 60_000
export function catalogScanPrefixes(
  scope: CatalogScope,
  fullScan: boolean,
  nowMs: number,
): string[] {
  if (fullScan) return [scope.prefix + '/']
  const prefixes: string[] = []
  for (const timeframe of ['5m', '15m'] as const) {
    const duration = timeframe === '5m' ? 300_000 : 900_000
    for (
      let start = Math.floor((nowMs - RECENT_MS) / duration) * duration;
      start <= nowMs;
      start += duration
    )
      prefixes.push(`${scope.prefix}/btc/${timeframe}/btc-updown-${timeframe}-${start / 1000}/`)
  }
  return prefixes
}

/** Index only committed, checksum-verified objects. R2 is read-only; MySQL is rebuildable. */
export async function syncRecorderCatalog(options: {
  store: Pick<BlobStore, 'get' | 'list'>
  repository: CatalogRepository
  scope: CatalogScope
  fullScan: boolean
  maxFiles?: number
  nowMs?: number
  temporaryRoot?: string
  signal?: AbortSignal
  onProgress?: (status: CatalogSyncStatus) => void
}): Promise<CatalogSyncStatus> {
  const { repository, scope } = options
  const now = options.nowMs ?? Date.now()
  const status: CatalogSyncStatus = {
    ...scope,
    startedAtMs: now,
    finishedAtMs: null,
    fullScan: options.fullScan,
    discovered: 0,
    indexed: 0,
    refreshed: 0,
    remaining: 0,
    failures: [],
  }
  await repository.saveStatus(status)
  // The archive helper expects a BlobStore, but no write capability is supplied to the indexer.
  const store: BlobStore = {
    get: (key, signal) => options.store.get(key, signal ?? options.signal),
    list: (prefix, signal) => options.store.list(prefix, signal ?? options.signal),
    putFile: async () => {
      throw new Error('Catalog synchronization cannot write to R2')
    },
  }
  const manifests = new Map<string, string>()
  const resolutions = new Map<string, string[]>()
  for (const prefix of catalogScanPrefixes(scope, options.fullScan, now)) {
    for await (const key of store.list(prefix)) {
      options.signal?.throwIfAborted()
      const identity = catalogKeyIdentity(key, scope.prefix)
      if (!identity) continue
      if (identity.kind === 'manifest') manifests.set(key, identity.directory)
      else
        resolutions.set(identity.directory, [...(resolutions.get(identity.directory) ?? []), key])
    }
  }
  status.discovered = manifests.size
  const known = new Map(
    (
      await repository.listKnown(scope, options.fullScan ? undefined : now - RECENT_MS - 900_000)
    ).map((row) => [row.manifestKey, row]),
  )
  for (const [manifestKey, directory] of manifests) {
    options.signal?.throwIfAborted()
    const previous = known.get(manifestKey)
    const resolutionKeysSha256 = resolutionKeysHash(resolutions.get(directory) ?? [])
    if (previous?.resolutionKeysSha256 === resolutionKeysSha256) continue
    if (status.indexed + status.refreshed + status.failures.length >= (options.maxFiles ?? 100)) {
      status.remaining++
      continue
    }
    try {
      if (previous) {
        const row = await repository.get(previous.id)
        if (!row) throw new Error('Catalog recording disappeared')
        const history = await downloadResolutions(store, row.manifest)
        await repository.put({
          ...row,
          resolutionKeysSha256,
          latestResolution: history.at(-1) ?? null,
        })
        status.refreshed++
      } else {
        await withAdmissionTemporaryDirectory(
          async (temporary) => {
            const downloaded = await downloadMarket(store, manifestKey, temporary)
            const manifest = downloaded.manifest
            const referenceEvidence = referenceAdmissionEvidence(
              await inspectOpeningReference(
                manifest.market,
                readOpeningReferenceEvents(downloaded.parquetPath),
              ),
            )
            const history = JSON.parse(
              await readFile(
                path.join(path.dirname(downloaded.manifestPath), 'resolutions.json'),
                'utf8',
              ),
            ) as ResolutionObservation[]
            await repository.put({
              id: catalogRecordingId(scope.bucket, manifestKey),
              ...scope,
              manifestKey,
              manifestSha256: captureManifestHash(manifest),
              manifest,
              referenceEvidence,
              latestResolution: history.at(-1) ?? null,
              resolutionKeysSha256,
              verifiedAtMs: Date.now(),
            })
          },
          options.temporaryRoot ?? path.join(os.tmpdir(), 'polymarket-recorder-v4-catalog'),
        )
        status.indexed++
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      // Driver/SDK errors can include credential-bearing configuration. Record only a safe class.
      status.failures.push({ manifestKey, message: error instanceof Error ? error.name : 'Error' })
    }
    if ((status.indexed + status.refreshed + status.failures.length) % 20 === 0) {
      await repository.saveStatus(status)
      options.onProgress?.(status)
    }
  }
  status.finishedAtMs = Date.now()
  await repository.saveStatus(status)
  return status
}
