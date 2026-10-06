import { validateArchivePrefix } from './namespace.js'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, readdir } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { atomicWrite, ensureDirectory, exists, safeComponent, syncDirectory } from './files.js'
import { readArchiveReceipt } from './archiveReceipt.js'
import type { MarketManifest } from './manifest.js'
import { readManifest } from './manifest.js'
import { MAX_LINE_BYTES, journalFiles, readJournals } from './journalReader.js'
import { runParquetJob } from './parquetJob.js'
import { CAPTURE_ROW_GROUP_SIZE } from './parquetLimits.js'
import type {
  CapturedEvent,
  CoverageGap,
  MarketCoverage,
  RecordedMarket,
  RecorderFeed,
} from '../types.js'

const feeds: RecorderFeed[] = [
  'polymarket',
  'binance_agg_trade',
  'binance_book_ticker',
  'chainlink_spot',
  'chainlink_twap',
  'price_to_beat',
]

export type PackageState = {
  schemaVersion: 4
  recordingId: string
  market: RecordedMarket
  createdAtMs: number
  recoveryGaps: CoverageGap[]
  recoveryWarnings: string[]
  initialMarketFrozen?: boolean
}

type PendingWrite = { bytes: Buffer; resolve: () => void; reject: (error: unknown) => void }

/** Small bounded batches amortize fsync; append promises acknowledge durability, not queuing. */
class Journal {
  private pending: PendingWrite[] = []
  private queuedBytes = 0
  private running: Promise<void> | null = null
  private scheduled: NodeJS.Immediate | null = null
  private failure: unknown = null
  private closed = false

  constructor(
    private readonly handle: FileHandle,
    private readonly maxPendingBytes: number,
  ) {}

  append(event: CapturedEvent): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.closed) return Promise.reject(new Error('Journal is closed'))
    const json = JSON.stringify(event)
    const checksum = createHash('sha256').update(json).digest('hex')
    const bytes = Buffer.from(`{"sha256":"${checksum}","event":${json}}\n`)
    if (bytes.length > MAX_LINE_BYTES || this.queuedBytes + bytes.length > this.maxPendingBytes) {
      this.failure = new Error('Recorder journal backpressure limit exceeded; recording must stop')
      return Promise.reject(this.failure)
    }
    this.queuedBytes += bytes.length
    const result = new Promise<void>((resolve, reject) =>
      this.pending.push({ bytes, resolve, reject }),
    )
    if (!this.running && !this.scheduled)
      this.scheduled = setImmediate(() => {
        this.scheduled = null
        this.startFlush()
      })
    return result
  }

  private startFlush(): void {
    if (this.running || !this.pending.length) return
    this.running = this.flushBatches().finally(() => {
      this.running = null
      // Resolving a durable append may enqueue another row before this finally callback runs.
      if (this.pending.length) this.startFlush()
    })
  }

  private async flushBatches(): Promise<void> {
    while (this.pending.length) {
      const batch = this.pending.splice(0)
      const bytes = Buffer.concat(batch.map((entry) => entry.bytes))
      try {
        await this.handle.writeFile(bytes)
        await this.handle.sync()
        for (const entry of batch) entry.resolve()
      } catch (error) {
        this.failure = error
        for (const entry of batch) entry.reject(error)
        for (const entry of this.pending.splice(0)) entry.reject(error)
      } finally {
        this.queuedBytes -= bytes.length
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.scheduled) clearImmediate(this.scheduled)
    this.scheduled = null
    while (this.running || this.pending.length) {
      this.startFlush()
      if (this.running) await this.running
    }
    await this.handle.close()
    if (this.failure) throw this.failure
  }
}

type ActiveMarket = {
  state: PackageState
  directory: string
  journal: Journal
  lastSequence: bigint | null
}
export type ReadyMarket = { directory: string; manifest: MarketManifest }
export type RecoveryResult = { active: RecordedMarket[]; ready: ReadyMarket[] }
export type MarketStoreOptions = {
  spoolDir: string
  prefix?: string
  maxPendingBytes?: number
  rowGroupSize?: number
}

/** Recovery never truncates a journal: a new segment follows its last complete durable row. */
export class DurableMarketStore {
  private readonly active = new Map<string, ActiveMarket>()
  private readonly prefix: string
  private conversionChain = Promise.resolve()

  constructor(private readonly options: MarketStoreOptions) {
    this.prefix = validateArchivePrefix(options.prefix ?? 'recorder-v4')
  }

  get activeSlugs(): string[] {
    return [...this.active.keys()]
  }

  /** Flush and close unused/pre-opened journals without inventing a market end. */
  async close(): Promise<void> {
    const journals = [...this.active.values()].map((active) => active.journal)
    this.active.clear()
    const results = await Promise.allSettled(journals.map((journal) => journal.close()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  async openMarket(market: RecordedMarket): Promise<string> {
    const existing = this.active.get(market.slug)
    if (existing) {
      if (JSON.stringify(existing.state.market) !== JSON.stringify(market)) {
        // Discovery may enrich raw metadata, but identity and time boundaries must stay fixed.
        const prior = existing.state.market
        if (
          prior.conditionId !== market.conditionId ||
          prior.startMs !== market.startMs ||
          prior.endMs !== market.endMs ||
          JSON.stringify(prior.tokenIds) !== JSON.stringify(market.tokenIds)
        )
          throw new Error('Recovered market identity changed')
      }
      return existing.directory
    }
    const state: PackageState = {
      schemaVersion: 4,
      recordingId: randomUUID(),
      market,
      createdAtMs: Date.now(),
      recoveryGaps: [],
      recoveryWarnings: [],
    }
    const directory = path.join(
      this.options.spoolDir,
      `${safeComponent(market.slug)}--${state.recordingId}`,
    )
    await ensureDirectory(directory)
    await atomicWrite(path.join(directory, 'state.json'), JSON.stringify(state))
    const journal = await this.newJournal(directory)
    this.active.set(market.slug, { state, directory, journal, lastSequence: null })
    return directory
  }

  append(slug: string, event: CapturedEvent): Promise<void> {
    const active = this.active.get(slug)
    if (!active) return Promise.reject(new Error(`Market is not open: ${slug}`))
    const sequence = BigInt(event.sequence)
    if (active.lastSequence !== null && sequence <= active.lastSequence)
      return Promise.reject(new Error('Recorder sequence must strictly increase within a market'))
    active.lastSequence = sequence
    return active.journal.append(event)
  }

  async freezeInitialMarket(market: RecordedMarket): Promise<void> {
    const active = this.active.get(market.slug)
    if (!active) throw new Error('Cannot freeze metadata for a market that is not open')
    const prior = active.state.market
    if (
      prior.conditionId !== market.conditionId ||
      prior.startMs !== market.startMs ||
      prior.endMs !== market.endMs ||
      JSON.stringify(prior.tokenIds) !== JSON.stringify(market.tokenIds) ||
      JSON.stringify(prior.outcomes) !== JSON.stringify(market.outcomes) ||
      prior.twapEnabled !== market.twapEnabled ||
      prior.twapLookbackSeconds !== market.twapLookbackSeconds ||
      prior.resolutionSource !== market.resolutionSource
    )
      throw new Error('Initial market identity or reference configuration changed')
    if (active.state.initialMarketFrozen) return
    active.state.market = structuredClone(market)
    active.state.initialMarketFrozen = true
    await atomicWrite(path.join(active.directory, 'state.json'), JSON.stringify(active.state))
  }

  /** Low-disk shutdown can leave a durable closing marker and defer compression until recovery. */
  async seal(slug: string, coverage: MarketCoverage): Promise<void> {
    await this.sealMarket(slug, coverage)
  }

  async finalize(slug: string, coverage: MarketCoverage): Promise<ReadyMarket> {
    const sealed = await this.sealMarket(slug, coverage)
    return this.buildParquet(sealed.directory, sealed.state, sealed.coverage)
  }

  private async sealMarket(
    slug: string,
    coverage: MarketCoverage,
  ): Promise<{ directory: string; state: PackageState; coverage: MarketCoverage }> {
    const active = this.active.get(slug)
    if (!active) throw new Error(`Market is not open: ${slug}`)
    this.active.delete(slug)
    await active.journal.close()
    const combined: MarketCoverage = {
      ...coverage,
      complete: coverage.complete && active.state.recoveryGaps.length === 0,
      gaps: [...active.state.recoveryGaps, ...coverage.gaps],
      warnings: [...active.state.recoveryWarnings, ...coverage.warnings],
    }
    await atomicWrite(path.join(active.directory, 'closing.json'), JSON.stringify(combined))
    return { directory: active.directory, state: active.state, coverage: combined }
  }

  async recover(nowMs = Date.now()): Promise<RecoveryResult> {
    if (this.active.size) throw new Error('Recover must run before opening markets')
    await ensureDirectory(this.options.spoolDir)
    const result: RecoveryResult = { active: [], ready: [] }
    for (const entry of await readdir(this.options.spoolDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = path.join(this.options.spoolDir, entry.name)
      if (
        !(await exists(path.join(directory, 'state.json'))) ||
        (await readArchiveReceipt(directory))
      )
        continue
      if (await exists(path.join(directory, 'manifest.json'))) {
        result.ready.push({
          directory,
          manifest: await readManifest(path.join(directory, 'manifest.json')),
        })
        continue
      }
      const state = JSON.parse(
        await readFile(path.join(directory, 'state.json'), 'utf8'),
      ) as PackageState
      if (state.schemaVersion !== 4) throw new Error('Unsupported local recording state')
      if (await exists(path.join(directory, 'closing.json'))) {
        const coverage = JSON.parse(
          await readFile(path.join(directory, 'closing.json'), 'utf8'),
        ) as MarketCoverage
        result.ready.push(await this.buildParquet(directory, state, coverage))
        continue
      }
      let last: CapturedEvent | null = null
      let first: CapturedEvent | null = null
      for await (const event of readJournals(directory)) {
        if (last && BigInt(event.sequence) <= BigInt(last.sequence))
          throw new Error('Corrupt journal sequence')
        first ??= event
        last = event
      }
      if (nowMs >= state.market.startMs || (last && last.receivedAtMs >= state.market.startMs)) {
        state.recoveryGaps.push(
          ...feeds.map(
            (feed): CoverageGap => ({
              feed,
              startMs: Math.max(
                state.market.startMs,
                Math.min(last?.receivedAtMs ?? state.createdAtMs, nowMs, state.market.endMs),
              ),
              endMs: Math.min(Math.max(nowMs, state.market.startMs), state.market.endMs),
              certainty: 'uncertain',
              reason:
                'Recorder restarted without a durable closing marker; an incomplete tail may be absent',
            }),
          ),
        )
        state.recoveryWarnings.push('Recovered from append journal after an unclean recorder exit')
      }
      await atomicWrite(path.join(directory, 'state.json'), JSON.stringify(state))
      if (state.market.endMs <= nowMs) {
        const coverage: MarketCoverage = {
          complete: false,
          startedAtMs: first?.receivedAtMs ?? state.createdAtMs,
          endedAtMs: Math.max(
            first?.receivedAtMs ?? state.createdAtMs,
            last?.receivedAtMs ?? state.createdAtMs,
          ),
          missingInitialBook: true,
          gaps: state.recoveryGaps,
          warnings: state.recoveryWarnings,
        }
        await atomicWrite(path.join(directory, 'closing.json'), JSON.stringify(coverage))
        result.ready.push(await this.buildParquet(directory, state, coverage))
      } else {
        if (this.active.has(state.market.slug))
          throw new Error('Multiple unfinished recordings for the same market')
        this.active.set(state.market.slug, {
          state,
          directory,
          journal: await this.newJournal(directory),
          lastSequence: last ? BigInt(last.sequence) : null,
        })
        result.active.push(state.market)
      }
    }
    return result
  }

  private async newJournal(directory: string): Promise<Journal> {
    const segments = await journalFiles(directory)
    const file = path.join(directory, `wal-${String(segments.length).padStart(6, '0')}.jsonl`)
    const handle = await open(file, 'wx', 0o600)
    await syncDirectory(directory)
    return new Journal(handle, this.options.maxPendingBytes ?? 16 * 1024 * 1024)
  }

  private buildParquet(
    directory: string,
    state: PackageState,
    coverage: MarketCoverage,
  ): Promise<ReadyMarket> {
    const operation = this.conversionChain.then(() =>
      runParquetJob({
        directory,
        state,
        coverage,
        prefix: this.prefix,
        rowGroupSize: this.options.rowGroupSize ?? CAPTURE_ROW_GROUP_SIZE,
      }),
    )
    this.conversionChain = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
}
