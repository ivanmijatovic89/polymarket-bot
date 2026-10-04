import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { BlobStore } from './blobStore.js'
import { readArchiveReceipt } from './archiveReceipt.js'
import type { ArchiveReceipt } from './archiveReceipt.js'
import {
  atomicWrite,
  digestFile,
  digestStream,
  ensureDirectory,
  exists,
  readSmallStream,
  safeComponent,
  syncDirectory,
} from './files.js'
import type { FileDigest } from './files.js'
import type { MarketManifest } from './manifest.js'
import { parseManifest, readManifest } from './manifest.js'
import {
  parseResolutionArtifact,
  readResolutionArtifact,
  validateResolutionCompletion,
  validateResolutionObservation,
} from './resolutionArtifact.js'
import type { ResolutionObservation } from '../types.js'

export { readArchiveReceipt } from './archiveReceipt.js'
export type { ArchiveReceipt } from './archiveReceipt.js'
export type ArchiveRunResult = {
  uploaded: ArchiveReceipt[]
  failures: Array<{ directory: string; message: string }>
  attemptedDirectories: string[]
}

/** Content-addressed objects are accepted only after a complete streamed read-back. */
export async function putVerified(
  store: BlobStore,
  key: string,
  file: string,
  expected: FileDigest,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  if (!sameDigest(await digestFile(file), expected))
    throw new Error('Local archive content differs from its manifest')
  signal?.throwIfAborted()
  const existing = await store.get(key, signal)
  if (existing) {
    if (!sameDigest(await digestStream(existing), expected))
      throw new Error('Existing archive object failed integrity verification')
    return
  }
  let uploadError: unknown
  try {
    await store.putFile(key, file, contentType, signal)
  } catch (error) {
    uploadError = error
  }
  // A timeout can happen after the object was committed; verify before deciding to retry.
  signal?.throwIfAborted()
  const uploaded = await store.get(key, signal)
  if (!uploaded) throw uploadError ?? new Error('Uploaded archive object is missing')
  if (!sameDigest(await digestStream(uploaded), expected))
    throw new Error('Uploaded archive object failed integrity verification')
}

function sameDigest(a: FileDigest, b: FileDigest): boolean {
  return a.bytes === b.bytes && a.sha256 === b.sha256
}

export class ArchiveService {
  private running = false
  private cursor: string | null = null

  constructor(private readonly options: { spoolDir: string; blobStore: BlobStore }) {}

  async runOnce(
    options: { signal?: AbortSignal; maxMarkets?: number } = {},
  ): Promise<ArchiveRunResult> {
    if (this.running) throw new Error('Archive pass is already running')
    const limit = options.maxMarkets ?? 8
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error('Archive pass limit must be positive')
    this.running = true
    const result: ArchiveRunResult = { uploaded: [], failures: [], attemptedDirectories: [] }
    try {
      await ensureDirectory(this.options.spoolDir)
      const entries = (await readdir(this.options.spoolDir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      const pivot =
        this.cursor === null
          ? -1
          : entries.findIndex((entry) => entry.name.localeCompare(this.cursor!) > 0)
      const ordered = pivot > 0 ? [...entries.slice(pivot), ...entries.slice(0, pivot)] : entries
      let attempted = 0
      for (const entry of ordered) {
        if (options.signal?.aborted || attempted >= limit) break
        if (!entry.isDirectory()) continue
        const directory = path.join(this.options.spoolDir, entry.name)
        if (!(await exists(path.join(directory, 'manifest.json')))) continue
        try {
          const archived = await exists(path.join(directory, 'archived.json'))
          if (archived) {
            await this.removeEventData(directory)
            const outbox = path.join(directory, 'resolution-outbox')
            if (
              !(await exists(outbox)) ||
              !(await readdir(outbox)).some((name) => /^\d+-[a-f0-9]{64}\.json$/.test(name))
            )
              continue
          }
          attempted++
          this.cursor = entry.name
          result.attemptedDirectories.push(directory)
          if (!archived) result.uploaded.push(await this.archiveMarket(directory, options.signal))
          await this.uploadResolutionOutbox(directory, options.signal)
        } catch (error) {
          if (result.attemptedDirectories.at(-1) !== directory) {
            attempted++
            this.cursor = entry.name
            result.attemptedDirectories.push(directory)
          }
          result.failures.push({
            directory,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      this.running = false
    }
    return result
  }

  async archiveMarket(directory: string, signal?: AbortSignal): Promise<ArchiveReceipt> {
    signal?.throwIfAborted()
    const manifestPath = path.join(directory, 'manifest.json')
    const manifest = await readManifest(manifestPath)
    const store = this.options.blobStore
    await putVerified(
      store,
      manifest.events.key,
      path.join(directory, 'events.parquet'),
      manifest.events,
      'application/vnd.apache.parquet',
      signal,
    )
    // This task survives local data deletion and restart, even if no outcome is available yet.
    const resolutionTask = path.join(directory, 'resolution.pending.json')
    if (
      !(await exists(resolutionTask)) &&
      !(await exists(path.join(directory, 'resolution.complete.json')))
    )
      await atomicWrite(
        resolutionTask,
        JSON.stringify({
          market: manifest.market,
          recordingId: manifest.recordingId,
          nextAttemptAtMs: manifest.market.endMs,
        }),
      )
    const digest = await digestFile(manifestPath)
    const manifestKey = `${path.posix.dirname(manifest.events.key)}/manifest-${digest.sha256}.json`
    await putVerified(store, manifestKey, manifestPath, digest, 'application/json', signal)
    const receipt = { manifestKey, verifiedAtMs: Date.now() }
    await atomicWrite(path.join(directory, 'archived.json'), JSON.stringify(receipt))
    await this.removeEventData(directory)
    return receipt
  }

  private async removeEventData(directory: string): Promise<void> {
    if (!(await readArchiveReceipt(directory)))
      throw new Error('Event deletion requires a verified archive receipt')
    // Only recorder-owned event data is deleted. Tiny manifests, receipts, and resolution tasks remain.
    let deleted = false
    for (const file of await readdir(directory)) {
      if (
        /^wal-\d{6}\.jsonl$/.test(file) ||
        file === 'events.parquet' ||
        /^events-[a-f0-9-]+\.parquet\.tmp$/.test(file) ||
        /^unpublished-[a-f0-9-]+\.parquet$/.test(file)
      ) {
        await unlink(path.join(directory, file))
        deleted = true
      }
    }
    if (deleted) await syncDirectory(directory)
  }

  async queueResolution(directory: string, observation: ResolutionObservation): Promise<void> {
    await queueResolution(directory, observation)
  }

  /** The caller removes resolution.pending.json only after its resolution recheck policy is done. */
  async cleanupCompleted(directory: string): Promise<boolean> {
    if (path.dirname(path.resolve(directory)) !== path.resolve(this.options.spoolDir))
      throw new Error('Cleanup path is outside recorder spool')
    if (
      !(await readArchiveReceipt(directory)) ||
      (await exists(path.join(directory, 'resolution.pending.json')))
    )
      return false
    const historyFile = path.join(directory, 'resolutions.json')
    if (!(await exists(historyFile))) return false
    const value: unknown = JSON.parse(await readFile(historyFile, 'utf8'))
    if (!Array.isArray(value)) throw new Error('Invalid local resolution history')
    const manifest = await readManifest(path.join(directory, 'manifest.json'))
    const history = value.map((observation) =>
      validateResolutionObservation(observation, manifest.market),
    )
    if (history.at(-1)?.status !== 'resolved') return false
    const completeFile = path.join(directory, 'resolution.complete.json')
    if (!(await exists(completeFile))) return false
    validateResolutionCompletion(
      JSON.parse(await readFile(completeFile, 'utf8')),
      history.at(-1) ?? null,
    )
    const outbox = path.join(directory, 'resolution-outbox')
    if (await exists(outbox)) {
      const entries = await readdir(outbox, { withFileTypes: true })
      // A crash before atomic rename can strand an uncommitted replacement. Only
      // these exact recorder-owned regular files may be retired with a completed package.
      const temporary =
        /^\d+-[a-f0-9]{64}\.json\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/
      if (entries.some((entry) => !entry.isFile() || !temporary.test(entry.name))) return false
    }
    await rm(directory, { recursive: true })
    await syncDirectory(this.options.spoolDir)
    return true
  }

  private async uploadResolutionOutbox(directory: string, signal?: AbortSignal): Promise<void> {
    const outbox = path.join(directory, 'resolution-outbox')
    if (!(await exists(outbox))) return
    const manifest = await readManifest(path.join(directory, 'manifest.json'))
    for (const name of (await readdir(outbox)).sort()) {
      signal?.throwIfAborted()
      if (!/^\d+-[a-f0-9]{64}\.json$/.test(name)) continue
      const file = path.join(outbox, name)
      const key = `${path.posix.dirname(manifest.events.key)}/resolutions/${name}`
      const { observation: observed, digest } = await readResolutionArtifact(file, manifest.market)
      await putVerified(this.options.blobStore, key, file, digest, 'application/json', signal)
      await appendResolutionHistory(directory, observed)
      await atomicWrite(
        path.join(directory, 'resolution.last-upload.json'),
        JSON.stringify({ key, verifiedAtMs: Date.now() }),
      )
      await unlink(file)
      await syncDirectory(outbox)
    }
  }
}

export type DownloadedMarket = {
  manifest: MarketManifest
  manifestPath: string
  parquetPath: string
}

const resolutionHistoryWrites = new Map<string, Promise<void>>()

/** Recorder spool locking prevents other processes; this serializes its tracker and archive tasks. */
export function appendResolutionHistory(
  directory: string,
  observation: ResolutionObservation,
): Promise<void> {
  const key = path.resolve(directory)
  const operation = (resolutionHistoryWrites.get(key) ?? Promise.resolve()).then(async () => {
    const file = path.join(directory, 'resolutions.json')
    const history = (await exists(file))
      ? (JSON.parse(await readFile(file, 'utf8')) as ResolutionObservation[])
      : []
    const encoded = JSON.stringify(observation)
    if (!history.some((item) => JSON.stringify(item) === encoded)) history.push(observation)
    history.sort((a, b) => a.observedAtMs - b.observedAtMs)
    await atomicWrite(file, JSON.stringify(history))
  })
  const settled = operation.then(
    () => undefined,
    () => undefined,
  )
  resolutionHistoryWrites.set(key, settled)
  void settled.then(() => {
    if (resolutionHistoryWrites.get(key) === settled) resolutionHistoryWrites.delete(key)
  })
  return operation
}

/** Local capture mode uses the same durable resolution outbox without requiring R2 credentials. */
export async function queueResolution(
  directory: string,
  observation: ResolutionObservation,
): Promise<void> {
  const manifest = await readManifest(path.join(directory, 'manifest.json'))
  if (
    observation.slug !== manifest.market.slug ||
    observation.conditionId !== manifest.market.conditionId
  )
    throw new Error('Resolution observation belongs to another market')
  const body = JSON.stringify(observation)
  const hash = createHash('sha256').update(body).digest('hex')
  const file = path.join(directory, 'resolution-outbox', `${observation.observedAtMs}-${hash}.json`)
  if (!(await exists(file))) await atomicWrite(file, body)
}

export async function readRemoteManifest(
  store: BlobStore,
  manifestKey: string,
): Promise<{ manifest: MarketManifest; rawJson: string }> {
  const match = /\/manifest-([a-f0-9]{64})\.json$/.exec(manifestKey)
  if (!match?.[1]) throw new Error('Expected a content-addressed recorder manifest key')
  const stream = await store.get(manifestKey)
  if (!stream) throw new Error('Market manifest does not exist')
  const body = await readSmallStream(stream)
  if (createHash('sha256').update(body).digest('hex') !== match[1])
    throw new Error('Market manifest integrity check failed')
  const manifest = parseManifest(body.toString('utf8'))
  if (path.posix.dirname(manifest.events.key) !== path.posix.dirname(manifestKey))
    throw new Error('Manifest points outside its market package')
  const parts = manifestKey.split('/')
  if (parts.at(-3) !== manifest.market.slug || parts.at(-2) !== manifest.recordingId)
    throw new Error('Manifest identity does not match its market package directory')
  return { manifest, rawJson: body.toString('utf8') }
}

/** No catalog database or recorder-local path is required to recover a published market. */
export async function downloadMarket(
  store: BlobStore,
  manifestKey: string,
  cacheDir: string,
): Promise<DownloadedMarket> {
  const { manifest, rawJson } = await readRemoteManifest(store, manifestKey)
  // Refresh failures must preserve the prior cache. Fetch and verify all sidecars
  // before changing event bytes, and publish the manifest as the final local commit.
  const directory = path.join(
    cacheDir,
    safeComponent(manifest.market.slug),
    safeComponent(manifest.recordingId),
  )
  const parquetPath = path.join(directory, 'events.parquet')
  const manifestPath = path.join(directory, 'manifest.json')
  if ((await exists(manifestPath)) && (await readFile(manifestPath, 'utf8')) !== rawJson)
    throw new Error('Cached recording identity already has a different immutable manifest')
  const resolutions = await downloadResolutions(store, manifest)
  await ensureDirectory(directory)
  if (!(await exists(parquetPath)) || !sameDigest(await digestFile(parquetPath), manifest.events)) {
    const events = await store.get(manifest.events.key)
    if (!events) throw new Error('Market events object does not exist')
    const temporary = `${parquetPath}.${randomUUID()}.tmp`
    let bytes = 0
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(
          bytes > manifest.events.bytes
            ? new Error('Downloaded object exceeds manifest size')
            : null,
          chunk,
        )
      },
    })
    try {
      await pipeline(
        Readable.from(events),
        limit,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      )
      if (!sameDigest(await digestFile(temporary), manifest.events))
        throw new Error('Downloaded market events failed integrity verification')
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    const handle = await open(temporary, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, parquetPath)
    await syncDirectory(directory)
  }
  await atomicWrite(path.join(directory, 'resolutions.json'), JSON.stringify(resolutions))
  await atomicWrite(manifestPath, rawJson)
  return { manifest, manifestPath, parquetPath }
}

export async function downloadResolutions(
  store: BlobStore,
  manifest: MarketManifest,
): Promise<ResolutionObservation[]> {
  const prefix = `${path.posix.dirname(manifest.events.key)}/resolutions/`
  const observations: ResolutionObservation[] = []
  for await (const key of store.list(prefix)) {
    const match = /\/(\d+)-([a-f0-9]{64})\.json$/.exec(key)
    if (!match?.[2]) continue
    const stream = await store.get(key)
    if (!stream) throw new Error('Listed resolution disappeared')
    const body = await readSmallStream(stream)
    const { observation } = parseResolutionArtifact(body, path.posix.basename(key), manifest.market)
    observations.push(observation)
  }
  return observations.sort((a, b) => a.observedAtMs - b.observedAtMs)
}
