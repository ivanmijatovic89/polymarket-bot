#!/usr/bin/env tsx
/**
 * Processes pending PMXT v1 conversion jobs from the pmxt_dataset_catalogue table.
 *
 * For each pending job it:
 *   1. Downloads the raw PMXT hourly parquet to temp/
 *   2. Converts it to native parquet files (one per 15m window)
 *   3. Deletes the raw temp file
 *   4. Updates the job status in the DB
 *
 * Runs up to --concurrency N jobs in parallel. Downloads are fully parallel (network I/O);
 * conversions are internally capped at 3 because each makes 4 Gamma API calls + DuckDB —
 * too many at once triggers rate-limiting.
 *
 * Usage:
 *   npx tsx src/pmxt/download-and-convert-v1.ts --symbol btc --out <dir> [--limit N] [--concurrency N] [--retry-failed]
 */

import { eq, and, inArray } from 'drizzle-orm'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'

import { getDb, closeDb, pmxtDatasetCatalogue } from '../db/index.js'
import { convertPmxtFile, type SkippedWindow } from './convert.js'

// Files with 0 bytes at the end of the v1 archive — skip without downloading.
const SKIP_FILENAMES = new Set([
  'polymarket_orderbook_2026-04-15T09.parquet',
  'polymarket_orderbook_2026-04-15T10.parquet',
  'polymarket_orderbook_2026-04-15T11.parquet',
  'polymarket_orderbook_2026-04-15T12.parquet',
  'polymarket_orderbook_2026-04-15T13.parquet',
  'polymarket_orderbook_2026-04-15T14.parquet',
  'polymarket_orderbook_2026-04-15T15.parquet',
  'polymarket_orderbook_2026-04-15T16.parquet',
  'polymarket_orderbook_2026-04-15T17.parquet',
  'polymarket_orderbook_2026-04-15T18.parquet',
  'polymarket_orderbook_2026-04-15T19.parquet',
  'polymarket_orderbook_2026-04-15T20.parquet',
  'polymarket_orderbook_2026-04-15T21.parquet',
  'polymarket_orderbook_2026-04-15T22.parquet',
  'polymarket_orderbook_2026-04-15T23.parquet',
  'polymarket_orderbook_2026-04-16T00.parquet',
  'polymarket_orderbook_2026-04-16T01.parquet',
  'polymarket_orderbook_2026-04-16T02.parquet',
  'polymarket_orderbook_2026-04-16T03.parquet',
  'polymarket_orderbook_2026-04-16T04.parquet',
  'polymarket_orderbook_2026-04-16T05.parquet',
])

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const get = (flag: string) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

const symbol = get('--symbol') ?? 'btc'
const limit = get('--limit') ? parseInt(get('--limit')!, 10) : undefined
const retryFailed = args.includes('--retry-failed')
const windowMinutes = parseInt(get('--window') ?? '15', 10)
const outDir = get('--out') ?? `data/events/${symbol}`
const tempDir = get('--temp') ?? 'temp'
const concurrency = parseInt(get('--concurrency') ?? '1', 10)
const convertConcurrency = concurrency

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent access to a resource
// ---------------------------------------------------------------------------

class Semaphore {
  private slots: number
  private readonly waiters: (() => void)[] = []

  constructor(slots: number) {
    this.slots = slots
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
    } else {
      this.slots++
    }
  }
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
  if (!res.body) throw new Error(`No response body for ${url}`)
  const ws = createWriteStream(destPath)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, ws)
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function fmtEta(doneCount: number, totalCount: number, elapsedMs: number): string {
  if (doneCount === 0) return '?'
  const msPerJob = elapsedMs / doneCount
  return fmtDuration(msPerJob * (totalCount - doneCount))
}

function fmtSecs(secs: number | null, prefix = '+'): string {
  if (secs === null) return '—'
  return `${secs >= 0 ? prefix : ''}${secs.toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = getDb()

// Always reset stuck in-progress jobs from a previous interrupted run
const stuck = await db
  .update(pmxtDatasetCatalogue)
  .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
  .where(
    and(
      eq(pmxtDatasetCatalogue.symbol, symbol),
      inArray(pmxtDatasetCatalogue.status, ['downloading', 'converting']),
    ),
  )
if (stuck[0].affectedRows > 0) {
  console.log(`Reset ${stuck[0].affectedRows} stuck job(s) to pending`)
}

// Mark known-empty files as done so they are never downloaded or retried.
const skippedEmpty = await db
  .update(pmxtDatasetCatalogue)
  .set({ status: 'done', windowsWritten: 0, slugs: [], finishedAt: new Date() })
  .where(
    and(
      inArray(pmxtDatasetCatalogue.filename, [...SKIP_FILENAMES]),
      inArray(pmxtDatasetCatalogue.status, ['pending', 'failed']),
    ),
  )
if (skippedEmpty[0].affectedRows > 0) {
  console.log(`Skipped ${skippedEmpty[0].affectedRows} known-empty file(s) (0 MB)`)
}

if (retryFailed) {
  const reset = await db
    .update(pmxtDatasetCatalogue)
    .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
    .where(and(eq(pmxtDatasetCatalogue.symbol, symbol), eq(pmxtDatasetCatalogue.status, 'failed')))
  console.log(`Reset ${reset[0].affectedRows} failed job(s) to pending`)
}

const pendingRows = await db
  .select({
    id: pmxtDatasetCatalogue.id,
    filename: pmxtDatasetCatalogue.filename,
    url: pmxtDatasetCatalogue.url,
  })
  .from(pmxtDatasetCatalogue)
  .where(and(eq(pmxtDatasetCatalogue.symbol, symbol), eq(pmxtDatasetCatalogue.status, 'pending')))
  .limit(limit ?? 100_000)

type PendingRow = (typeof pendingRows)[number]

const total = pendingRows.length
if (total === 0) {
  console.log('No pending jobs found.')
  await closeDb()
  process.exit(0)
}

console.log(
  `Starting pipeline: ${total} pending jobs  symbol=${symbol}  concurrency=${concurrency}  out=${outDir}`,
)

// Cap parallel downloads to avoid bandwidth saturation — more than 3-4 simultaneous
// downloads share the pipe and each takes proportionally longer, killing throughput.
const downloadSemaphore = new Semaphore(Math.min(concurrency, 4))
const convertSemaphore = new Semaphore(convertConcurrency)
console.log()

if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

// ---------------------------------------------------------------------------
// Interrupt handling — mark in-progress jobs as failed on Ctrl+C / SIGTERM
// ---------------------------------------------------------------------------

const activeJobs = new Map<number, { tempPath: string; filename: string }>()
let shuttingDown = false

async function shutdown(signal: string): Promise<never> {
  if (shuttingDown) process.exit(1)
  shuttingDown = true
  console.log(`\n${signal} — resetting ${activeJobs.size} in-progress job(s) to pending...`)
  for (const [id, { tempPath, filename }] of activeJobs) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch {}
    try {
      await db
        .update(pmxtDatasetCatalogue)
        .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
        .where(eq(pmxtDatasetCatalogue.id, id))
    } catch {}
    console.log(`  ${filename} → pending`)
  }
  try {
    await closeDb()
  } catch {}
  process.exit(1)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

// ---------------------------------------------------------------------------
// Per-job processor
// ---------------------------------------------------------------------------

const startTime = Date.now()
let done = 0
let failed = 0
const allSkipped: { sourceFile: string; window: SkippedWindow }[] = []

async function processJob(job: PendingRow, slotIndex: number): Promise<void> {
  if (shuttingDown) return

  const jobIndex = pendingRows.indexOf(job) + 1
  const tempPath = path.join(tempDir, job.filename!)
  const jobLabel = `[${jobIndex}/${total}]${concurrency > 1 ? `[w${slotIndex}]` : ''} ${job.filename}`
  const jobStart = Date.now()

  activeJobs.set(job.id, { tempPath, filename: job.filename! })

  try {
    await downloadSemaphore.acquire()

    console.log(`${jobLabel}  downloading...`)

    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'downloading', startedAt: new Date() })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    try {
      await downloadFile(job.url!, tempPath)
    } finally {
      downloadSemaphore.release()
    }

    if (shuttingDown) return

    await convertSemaphore.acquire()

    if (shuttingDown) {
      convertSemaphore.release()
      return
    }

    console.log(`${jobLabel}  converting...`)

    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'converting' })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    let result: Awaited<ReturnType<typeof convertPmxtFile>>
    try {
      result = await convertPmxtFile(tempPath, symbol, windowMinutes, outDir, () => {})
    } finally {
      convertSemaphore.release()
    }

    if (existsSync(tempPath)) unlinkSync(tempPath)

    await db
      .update(pmxtDatasetCatalogue)
      .set({
        status: 'done',
        slugs: result.slugs,
        windowsWritten: result.windowsWritten,
        outDir,
        finishedAt: new Date(),
      })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    for (const w of result.skippedWindows) {
      allSkipped.push({ sourceFile: job.filename!, window: w })
    }

    done++
    const elapsed = fmtDuration(Date.now() - jobStart)
    const eta = fmtEta(done, total, Date.now() - startTime)
    const skippedNote =
      result.skippedWindows.length > 0 ? `  skipped: ${result.skippedWindows.length}` : ''
    console.log(
      `${jobLabel}  done (${result.windowsWritten} windows${skippedNote}, ${elapsed})  ETA: ${eta}`,
    )

    for (const w of result.writtenWindows) {
      console.log(
        `         ✓ ${w.slug}  first_event: ${fmtSecs(w.secsToFirstEvent)}  both_warm: ${fmtSecs(w.secsToBothWarm)}`,
      )
    }
    for (const w of result.skippedWindows) {
      console.log(
        `         [skip] ${w.slug}  first_event: ${fmtSecs(w.secsToFirstEvent)}  both_warm: ${fmtSecs(w.secsToBothWarm)}  → ${w.reason}`,
      )
    }
  } catch (err) {
    if (existsSync(tempPath)) unlinkSync(tempPath)

    const errMsg = err instanceof Error ? err.message : String(err)
    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'failed', error: errMsg, finishedAt: new Date() })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    failed++
    console.log(`${jobLabel}  FAILED: ${errMsg}`)
  } finally {
    activeJobs.delete(job.id)
  }
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

const queue = [...pendingRows]
const pool = new Set<Promise<void>>()

for (let slot = 0; slot < Math.min(concurrency, queue.length); slot++) {
  const runSlot = async (slotIndex: number) => {
    let job: PendingRow | undefined
    while ((job = queue.shift()) !== undefined) {
      await processJob(job, slotIndex)
    }
  }
  pool.add(runSlot(slot))
}

await Promise.all(pool)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

await closeDb()

const totalElapsed = fmtDuration(Date.now() - startTime)
console.log()
console.log(`Pipeline finished in ${totalElapsed}`)
console.log(`  done:   ${done}`)
console.log(`  failed: ${failed}`)
console.log(`  total:  ${total}`)

if (allSkipped.length > 0) {
  console.log(`\nSkipped windows (${allSkipped.length} total):`)
  for (const { sourceFile, window: w } of allSkipped) {
    console.log(
      `  [${sourceFile}]  ${w.slug}  first_event: ${fmtSecs(w.secsToFirstEvent)}  both_warm: ${fmtSecs(w.secsToBothWarm)}  → ${w.reason}`,
    )
  }
}
