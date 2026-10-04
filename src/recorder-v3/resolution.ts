import { createHash } from 'node:crypto'
import { readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fetchGammaRaw } from './markets.js'
import { parseResolutionObservation } from './resolutionParser.js'
import { appendResolutionHistory, queueResolution, type ArchiveService } from './storage/archive.js'
import { atomicWrite, exists, syncDirectory } from './storage/files.js'
import { readManifest } from './storage/manifest.js'
import type { RecordedMarket, ResolutionObservation } from './types.js'

type ResolutionTask = {
  market: RecordedMarket
  recordingId: string
  nextAttemptAtMs: number
  attempts?: number
  fingerprint?: string
  firstResolvedAtMs?: number
  lastError?: string
}

const CONFIRMATION_MS = 86_400_000

function fingerprint(observation: ResolutionObservation): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        status: observation.status,
        outcome: observation.winningOutcome,
        token: observation.winningTokenId,
        payouts: observation.payouts
          ? Object.fromEntries(
              Object.entries(observation.payouts).sort(([a], [b]) => a.localeCompare(b)),
            )
          : null,
        priceToBeat: observation.priceToBeat,
        finalPrice: observation.finalPrice,
      }),
    )
    .digest('hex')
}

/** Outbox entries are durable before task/history updates, so include them in crash recovery. */
async function latestObservation(
  directory: string,
  market: RecordedMarket,
): Promise<ResolutionObservation | null> {
  const historyFile = path.join(directory, 'resolutions.json')
  const history: ResolutionObservation[] = (await exists(historyFile))
    ? (JSON.parse(await readFile(historyFile, 'utf8')) as ResolutionObservation[])
    : []
  const outbox = path.join(directory, 'resolution-outbox')
  let refreshHistory = false
  if (await exists(outbox)) {
    for (const name of await readdir(outbox)) {
      if (!/^\d+-[a-f0-9]{64}\.json$/.test(name)) continue
      try {
        history.push(
          JSON.parse(await readFile(path.join(outbox, name), 'utf8')) as ResolutionObservation,
        )
      } catch (error) {
        // The uploader may have moved this observation into history since the listing.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        refreshHistory = true
      }
    }
  }
  if (refreshHistory && (await exists(historyFile))) {
    history.push(...(JSON.parse(await readFile(historyFile, 'utf8')) as ResolutionObservation[]))
  }
  for (const observation of history) {
    if (
      observation.schemaVersion !== 3 ||
      observation.slug !== market.slug ||
      observation.conditionId !== market.conditionId ||
      !Number.isFinite(observation.observedAtMs)
    ) {
      throw new Error('Invalid local resolution history')
    }
  }
  return history.sort((a, b) => a.observedAtMs - b.observedAtMs).at(-1) ?? null
}

/** Durable independent scheduler; neither network failures nor pending outcomes block capture. */
export class ResolutionTracker {
  pending = 0
  lastError: string | null = null
  private running = false

  constructor(
    private readonly options: {
      spoolDir: string
      archive?: ArchiveService
      fetchRaw?: typeof fetchGammaRaw
      now?: () => number
      onObservation?: (observation: ResolutionObservation) => void
    },
  ) {}

  async runOnce(options: number | { nowMs?: number; signal?: AbortSignal } = {}): Promise<void> {
    const now =
      typeof options === 'number' ? options : (options.nowMs ?? this.options.now?.() ?? Date.now())
    const signal = typeof options === 'number' ? undefined : options.signal
    if (this.running || signal?.aborted) return
    this.running = true
    this.pending = 0
    let requests = 0
    let passError: string | null = null
    try {
      for (const entry of await readdir(this.options.spoolDir, { withFileTypes: true })) {
        if (signal?.aborted) break
        if (!entry.isDirectory()) continue
        const directory = path.join(this.options.spoolDir, entry.name)
        try {
          const manifestFile = path.join(directory, 'manifest.json')
          if (!(await exists(manifestFile))) continue
          const taskFile = path.join(directory, 'resolution.pending.json')
          if (await exists(path.join(directory, 'resolution.complete.json'))) {
            // A crash between writing the completion marker and removing its task
            // must not leave the directory permanently ineligible for cleanup.
            if (await exists(taskFile)) {
              await unlink(taskFile)
              await syncDirectory(directory)
            }
            await this.options.archive?.cleanupCompleted(directory)
            continue
          }
          if (!(await exists(taskFile))) {
            const manifest = await readManifest(manifestFile)
            await atomicWrite(
              taskFile,
              JSON.stringify({
                market: manifest.market,
                recordingId: manifest.recordingId,
                nextAttemptAtMs: manifest.market.endMs,
              } satisfies ResolutionTask),
            )
          }
          this.pending++
          const task = JSON.parse(await readFile(taskFile, 'utf8')) as ResolutionTask
          const manifest = await readManifest(manifestFile)
          if (
            task.recordingId !== manifest.recordingId ||
            task.market?.slug !== manifest.market.slug ||
            task.market?.conditionId !== manifest.market.conditionId ||
            !Number.isFinite(task.nextAttemptAtMs)
          ) {
            throw new Error('Invalid resolution retry task')
          }
          if (task.nextAttemptAtMs > now || requests >= 8) {
            if (task.lastError) passError = task.lastError
            continue
          }
          requests++
          try {
            let responseRaw: string | undefined
            let receivedAtMs: number | undefined
            const clock = this.options.now ?? Date.now
            const raw = await (this.options.fetchRaw ?? fetchGammaRaw)(task.market.slug, {
              ...(signal ? { signal } : {}),
              onResponse(response) {
                receivedAtMs = clock()
                responseRaw = response.rawJson
              },
            })
            if (!raw) throw new Error('Resolution market is not available from Gamma')
            const observedAtMs = receivedAtMs ?? clock()
            const observation = parseResolutionObservation(
              task.market,
              responseRaw ?? JSON.stringify(raw),
              observedAtMs,
            )
            const currentFingerprint = fingerprint(observation)
            const previous = await latestObservation(directory, task.market)
            const previousFingerprint = previous ? fingerprint(previous) : task.fingerprint
            const changed = currentFingerprint !== previousFingerprint
            if (changed) {
              await queueResolution(directory, observation)
              await appendResolutionHistory(directory, observation)
            } else if (previous) {
              // Repair a crash after durable outbox insertion but before local history.
              await appendResolutionHistory(directory, previous)
            }
            task.fingerprint = currentFingerprint
            this.options.onObservation?.(observation)
            task.attempts = 0
            delete task.lastError
            if (observation.status === 'resolved') {
              if (changed) task.firstResolvedAtMs = observedAtMs
              task.firstResolvedAtMs ??=
                previous?.status === 'resolved' ? previous.observedAtMs : observedAtMs
              // A corrected terminal outcome starts another confirmation interval.
              if (observedAtMs - task.firstResolvedAtMs >= CONFIRMATION_MS) {
                await atomicWrite(
                  path.join(directory, 'resolution.complete.json'),
                  JSON.stringify({ observedAtMs, fingerprint: currentFingerprint }),
                )
                await unlink(taskFile)
                await syncDirectory(directory)
                this.pending--
                continue
              }
              task.nextAttemptAtMs = task.firstResolvedAtMs + CONFIRMATION_MS
            } else {
              delete task.firstResolvedAtMs
              task.nextAttemptAtMs =
                observedAtMs + (now - task.market.endMs > 3_600_000 ? 300_000 : 15_000)
            }
          } catch (error) {
            if (signal?.aborted) return
            task.attempts = (task.attempts ?? 0) + 1
            task.nextAttemptAtMs = now + Math.min(900_000, 15_000 * 2 ** Math.min(task.attempts, 6))
            passError = error instanceof Error ? error.message : String(error)
            task.lastError = passError
          }
          await atomicWrite(taskFile, JSON.stringify(task))
        } catch (error) {
          passError = error instanceof Error ? error.message : String(error)
        }
      }
      if (passError !== null || requests > 0) this.lastError = passError
    } finally {
      this.running = false
    }
  }
}
