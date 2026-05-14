#!/usr/bin/env tsx
/**
 * Processes pending PMXT conversion jobs from the pmxt_dataset_catalogue table.
 *
 * For each pending job it:
 *   1. Downloads the raw PMXT hourly parquet to temp/
 *   2. Converts it to native parquet files (one per 15m window)
 *   3. Deletes the raw temp file
 *   4. Updates the job status in the DB
 *
 * Usage:
 *   npx tsx src/pmxt/run-pipeline.ts --symbol btc [--limit 10] [--retry-failed]
 */

import { eq, and } from 'drizzle-orm'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'

import { getDb, closeDb, pmxtDatasetCatalogue } from '../db/index.js'
import { convertPmxtFile } from './convert.js'

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
  const remaining = totalCount - doneCount
  return fmtDuration(msPerJob * remaining)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = getDb()

if (retryFailed) {
  const reset = await db
    .update(pmxtDatasetCatalogue)
    .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
    .where(and(eq(pmxtDatasetCatalogue.symbol, symbol), eq(pmxtDatasetCatalogue.status, 'failed')))
  console.log(`Reset failed jobs to pending: ${reset[0].affectedRows}`)
}

// Count total pending
const pendingRows = await db
  .select({
    id: pmxtDatasetCatalogue.id,
    filename: pmxtDatasetCatalogue.filename,
    url: pmxtDatasetCatalogue.url,
  })
  .from(pmxtDatasetCatalogue)
  .where(and(eq(pmxtDatasetCatalogue.symbol, symbol), eq(pmxtDatasetCatalogue.status, 'pending')))
  .limit(limit ?? 100_000)

const total = pendingRows.length
if (total === 0) {
  console.log('No pending jobs found.')
  await closeDb()
  process.exit(0)
}

console.log(`Starting pipeline: ${total} pending jobs  symbol=${symbol}  out=${outDir}`)
console.log()

if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })

const startTime = Date.now()
let done = 0
let failed = 0

for (const job of pendingRows) {
  const jobStart = Date.now()
  const tempPath = path.join(tempDir, job.filename)
  const jobLabel = `[${done + failed + 1}/${total}] ${job.filename}`

  // Mark as downloading
  await db
    .update(pmxtDatasetCatalogue)
    .set({ status: 'downloading', startedAt: new Date() })
    .where(eq(pmxtDatasetCatalogue.id, job.id))

  try {
    // 1. Download
    process.stdout.write(`${jobLabel}  downloading...`)
    await downloadFile(job.url!, tempPath)
    process.stdout.write(`  converting...`)

    // 2. Mark as converting
    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'converting' })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    // 3. Convert (suppress per-row logs)
    const result = await convertPmxtFile(tempPath, symbol, windowMinutes, outDir, () => {})

    // 4. Delete temp file
    if (existsSync(tempPath)) unlinkSync(tempPath)

    // 5. Mark as done
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

    done++
    const elapsed = Date.now() - jobStart
    const eta = fmtEta(done, total, Date.now() - startTime)
    process.stdout.write(
      `  done (${result.windowsWritten} windows, ${fmtDuration(elapsed)})  ETA: ${eta}\n`,
    )
  } catch (err) {
    // Clean up temp file if it exists
    if (existsSync(tempPath)) unlinkSync(tempPath)

    const errMsg = err instanceof Error ? err.message : String(err)
    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'failed', error: errMsg, finishedAt: new Date() })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    failed++
    process.stdout.write(`  FAILED: ${errMsg}\n`)
  }
}

await closeDb()

const totalElapsed = fmtDuration(Date.now() - startTime)
console.log()
console.log(`Pipeline finished in ${totalElapsed}`)
console.log(`  done:   ${done}`)
console.log(`  failed: ${failed}`)
console.log(`  total:  ${total}`)
