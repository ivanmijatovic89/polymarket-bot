import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BlobStore } from '../storage/blobStore.js'
import { eligibleManifest } from '../replay/selectionFixtures.js'
import { captureManifestHash } from '../replay/provenance.js'
import { writeCapturedEvents } from '../storage/compactWriter.js'
import type {
  CatalogRecording,
  CatalogRepository,
  CatalogScope,
  CatalogSyncStatus,
} from './types.js'
import { catalogRecordingId, resolutionKeysHash } from './identity.js'
import type { ResolutionObservation } from '../types.js'
import { mergeCatalogRecording } from '../../db/recorderV4Catalog.js'

export const scope = { bucket: 'catalog-fixture', prefix: 'recorder-v4' }
export class MemoryArchive implements BlobStore {
  objects = new Map<string, Buffer>()
  gets: string[] = []
  lists: string[] = []
  async putFile(): Promise<void> {
    throw new Error('R2 writes are forbidden')
  }
  async get(key: string) {
    this.gets.push(key)
    const value = this.objects.get(key)
    return value
      ? (async function* () {
          yield value
        })()
      : null
  }
  async *list(prefix: string) {
    this.lists.push(prefix)
    for (const key of [...this.objects.keys()].sort()) if (key.startsWith(prefix)) yield key
  }
}
export class MemoryCatalog implements CatalogRepository {
  rows = new Map<string, CatalogRecording>()
  statuses: CatalogSyncStatus[] = []
  async listKnown(selected: CatalogScope) {
    return [...this.rows.values()].filter(
      (row) => row.bucket === selected.bucket && row.prefix === selected.prefix,
    )
  }
  async get(id: string) {
    return this.rows.get(id) ?? null
  }
  async put(recording: CatalogRecording) {
    const previous = this.rows.get(recording.id)
    this.rows.set(recording.id, previous ? mergeCatalogRecording(previous, recording) : recording)
  }
  async saveStatus(status: CatalogSyncStatus) {
    this.statuses.push(structuredClone(status))
  }
}
export function recording(start = 1_791_244_800_000, id = 'fixture'): CatalogRecording {
  const manifest = eligibleManifest(start, id)
  const raw = JSON.stringify(manifest)
  const manifestKey = `${path.posix.dirname(manifest.events.key)}/manifest-${createHash('sha256').update(raw).digest('hex')}.json`
  return {
    id: catalogRecordingId(scope.bucket, manifestKey),
    ...scope,
    manifestKey,
    manifestSha256: captureManifestHash(manifest),
    manifest,
    referenceEvidence: { websiteObserved: true, openingReasons: [] },
    latestResolution: null,
    resolutionKeysSha256: resolutionKeysHash([]),
    verifiedAtMs: Date.now(),
  }
}
export function resolved(
  r: CatalogRecording,
  observedAtMs = r.manifest.market.endMs + 1000,
): ResolutionObservation {
  return {
    schemaVersion: 4,
    slug: r.manifest.market.slug,
    conditionId: r.manifest.market.conditionId,
    observedAtMs,
    status: 'resolved',
    winningOutcome: 'Up',
    winningTokenId: 'up',
    payouts: { up: '1', down: '0' },
    priceToBeat: '100',
    finalPrice: '101',
    source: 'gamma',
    rawJson: '{}',
  }
}
export function publishResolution(
  store: MemoryArchive,
  r: CatalogRecording,
  observation: ResolutionObservation,
) {
  const body = Buffer.from(JSON.stringify(observation))
  const key = `${path.posix.dirname(r.manifestKey)}/resolutions/${observation.observedAtMs}-${createHash('sha256').update(body).digest('hex')}.json`
  store.objects.set(key, body)
  return key
}
export async function publish(
  store: MemoryArchive,
  directory: string,
  start?: number,
  id?: string,
) {
  const r = recording(start, id)
  const file = path.join(directory, `${r.manifest.recordingId}.parquet`)
  await writeCapturedEvents(file, [
    {
      schemaVersion: 4,
      captureId: 'fixture',
      sessionId: 'session',
      sequence: '1',
      eventId: 'fixture:1',
      receivedAtMs: r.manifest.market.startMs + 1000,
      monotonicNs: '1',
      source: 'price_to_beat',
      connectionId: 'http',
      eventType: 'message',
      sourceTimeMs: null,
      rawJson: JSON.stringify({ openPrice: 100 }),
      detailsJson: null,
    },
  ])
  const body = await readFile(file)
  const sha256 = createHash('sha256').update(body).digest('hex')
  r.manifest.events = {
    ...r.manifest.events,
    bytes: body.length,
    sha256,
    key: `${path.posix.dirname(r.manifestKey)}/events-${sha256}.parquet`,
  }
  const raw = Buffer.from(JSON.stringify(r.manifest))
  r.manifestKey = `${path.posix.dirname(r.manifestKey)}/manifest-${createHash('sha256').update(raw).digest('hex')}.json`
  r.id = catalogRecordingId(scope.bucket, r.manifestKey)
  r.manifestSha256 = captureManifestHash(r.manifest)
  store.objects.set(r.manifestKey, raw)
  store.objects.set(r.manifest.events.key, body)
  return r
}
