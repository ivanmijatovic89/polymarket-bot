#!/usr/bin/env tsx
/**
 * Phase 2: build one giant master parquet of every BTC up/down 15m event
 * present in the PMXT v2 archive.
 *
 * For each pending v2 hourly file:
 *   1. Download to temp/
 *   2. INSERT all rows whose market is in pmxt_slug_cache into a DuckDB
 *      persistent intermediate (data/pmxt-v2-master/btc-events.duckdb)
 *   3. Delete the download
 *   4. Mark the catalogue row as status='master_done'
 *
 * After all rows are ingested (or with --finalize on a subsequent run), the
 * script writes the consolidated `btc-master.parquet`.
 *
 * Crash-safe: state lives in DuckDB on disk. Re-running picks up where it
 * stopped, using pmxt_dataset_catalogue.status to know which hours are done.
 *
 * Usage:
 *   npx tsx src/pmxt/build-master-v2.ts --symbol btc \
 *     [--limit N] [--concurrency 4] [--retry-failed] \
 *     [--finalize | --finalize-only]
 */

import { eq, and, inArray } from 'drizzle-orm'
import { DuckDBInstance } from '@duckdb/node-api'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'

import { getDb, closeDb, pmxtDatasetCatalogue, pmxtSlugCache } from '../db/index.js'

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
const concurrency = parseInt(get('--concurrency') ?? '1', 10)
const finalize = args.includes('--finalize')
const finalizeOnly = args.includes('--finalize-only')
const tempDir = get('--temp') ?? 'temp'

const outDir = get('--out') ?? 'data/pmxt-v2-master'
const duckPath = path.join(outDir, `${symbol}-events.duckdb`)
const masterPath = path.join(outDir, `${symbol}-master.parquet`)

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })

// ---------------------------------------------------------------------------
// Semaphore
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
    if (next) next()
    else this.slots++
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function fmtEta(doneCount: number, totalCount: number, elapsedMs: number): string {
  if (doneCount === 0) return '?'
  return fmtDuration((elapsedMs / doneCount) * (totalCount - doneCount))
}

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
// DuckDB setup
// ---------------------------------------------------------------------------

const duckDb = await DuckDBInstance.create(duckPath)
const duckConn = await duckDb.connect()

await duckConn.run(`CREATE SEQUENCE IF NOT EXISTS ingest_seq_gen`)
await duckConn.run(`
  CREATE TABLE IF NOT EXISTS btc_events (
    ingest_seq BIGINT,
    timestamp_received TIMESTAMP WITH TIME ZONE,
    timestamp TIMESTAMP WITH TIME ZONE,
    market VARCHAR,
    event_type VARCHAR,
    asset_id VARCHAR,
    bids VARCHAR,
    asks VARCHAR,
    price DECIMAL(9,4),
    size DECIMAL(18,6),
    side VARCHAR,
    best_bid DECIMAL(9,4),
    best_ask DECIMAL(9,4),
    fee_rate_bps USMALLINT,
    transaction_hash VARCHAR,
    old_tick_size DECIMAL(9,4),
    new_tick_size DECIMAL(9,4),
    PRIMARY KEY (ingest_seq)
  )
`)
await duckConn.run(`CREATE INDEX IF NOT EXISTS idx_market_ts ON btc_events(market, timestamp)`)

// ---------------------------------------------------------------------------
// Finalize-only path
// ---------------------------------------------------------------------------

async function writeMasterParquet(): Promise<void> {
  console.log(`\nFinalizing master parquet → ${masterPath}`)
  const rowsRes = await duckConn.run(`SELECT COUNT(*) FROM btc_events`)
  let totalRows = 0n
  for (let c = 0; c < rowsRes.chunkCount; c++) {
    for (const row of rowsRes.getChunk(c).getRows()) totalRows = row[0] as bigint
  }
  console.log(`  events in intermediate: ${totalRows.toString()}`)

  if (totalRows === 0n) {
    console.error('  No rows to write — skipping COPY.')
    return
  }

  const tmpPath = `${masterPath}.tmp`
  if (existsSync(tmpPath)) unlinkSync(tmpPath)

  const start = Date.now()
  await duckConn.run(`
    COPY (SELECT * FROM btc_events ORDER BY market, timestamp, ingest_seq)
    TO '${tmpPath}'
    (FORMAT PARQUET, COMPRESSION GZIP);
  `)
  if (existsSync(masterPath)) unlinkSync(masterPath)
  // rename
  const fs = await import('fs/promises')
  await fs.rename(tmpPath, masterPath)
  console.log(`  master parquet written in ${fmtDuration(Date.now() - start)}`)
}

if (finalizeOnly) {
  await writeMasterParquet()
  duckConn.closeSync()
  await closeDb()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

const db = getDb()

// Load conditionIds from cache
const cachedRows = await db
  .select({ conditionId: pmxtSlugCache.conditionId })
  .from(pmxtSlugCache)
  .where(eq(pmxtSlugCache.symbol, symbol))

if (cachedRows.length === 0) {
  console.error(`No slugs cached for symbol=${symbol}. Run pmxt:resolve-slugs:v2 first.`)
  duckConn.closeSync()
  await closeDb()
  process.exit(1)
}

const conditionIds = Array.from(new Set(cachedRows.map((r) => r.conditionId)))
console.log(`Loaded ${conditionIds.length} unique conditionIds from pmxt_slug_cache`)

const conditionList = conditionIds.map((c) => `'${c}'`).join(',')

// Reset stuck in-progress jobs from previous interrupted run
const stuck = await db
  .update(pmxtDatasetCatalogue)
  .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
  .where(
    and(
      eq(pmxtDatasetCatalogue.version, 'v2'),
      eq(pmxtDatasetCatalogue.symbol, symbol),
      inArray(pmxtDatasetCatalogue.status, ['downloading', 'converting']),
    ),
  )
if (stuck[0].affectedRows > 0) {
  console.log(`Reset ${stuck[0].affectedRows} stuck job(s) to pending`)
}

if (retryFailed) {
  const reset = await db
    .update(pmxtDatasetCatalogue)
    .set({ status: 'pending', error: null, startedAt: null, finishedAt: null })
    .where(
      and(
        eq(pmxtDatasetCatalogue.version, 'v2'),
        eq(pmxtDatasetCatalogue.symbol, symbol),
        eq(pmxtDatasetCatalogue.status, 'failed'),
      ),
    )
  console.log(`Reset ${reset[0].affectedRows} failed job(s) to pending`)
}

const pendingRows = await db
  .select({
    id: pmxtDatasetCatalogue.id,
    filename: pmxtDatasetCatalogue.filename,
    url: pmxtDatasetCatalogue.url,
  })
  .from(pmxtDatasetCatalogue)
  .where(
    and(
      eq(pmxtDatasetCatalogue.version, 'v2'),
      eq(pmxtDatasetCatalogue.symbol, symbol),
      eq(pmxtDatasetCatalogue.status, 'pending'),
    ),
  )
  .limit(limit ?? 100_000)

type PendingRow = (typeof pendingRows)[number]

const total = pendingRows.length
if (total === 0) {
  console.log('No pending v2 jobs.')
  if (finalize) await writeMasterParquet()
  duckConn.closeSync()
  await closeDb()
  process.exit(0)
}

console.log(
  `Starting build-master: ${total} pending v2 files  symbol=${symbol}  concurrency=${concurrency}`,
)
console.log()

// Cap parallel downloads (network) — convert/insert is always serial (1)
const downloadSemaphore = new Semaphore(Math.min(concurrency, 4))
const insertSemaphore = new Semaphore(1)

// ---------------------------------------------------------------------------
// Interrupt handling
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
    duckConn.closeSync()
  } catch {}
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

    await insertSemaphore.acquire()

    if (shuttingDown) {
      insertSemaphore.release()
      return
    }

    console.log(`${jobLabel}  inserting...`)

    await db
      .update(pmxtDatasetCatalogue)
      .set({ status: 'converting' })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    let rowsInserted = 0n
    try {
      const sqlStr = `
        INSERT INTO btc_events
        SELECT
          nextval('ingest_seq_gen'),
          timestamp_received,
          timestamp,
          CAST(market AS VARCHAR),
          event_type,
          asset_id,
          bids,
          asks,
          price,
          size,
          side,
          best_bid,
          best_ask,
          fee_rate_bps,
          transaction_hash,
          old_tick_size,
          new_tick_size
        FROM read_parquet('${tempPath}')
        WHERE CAST(market AS VARCHAR) IN (${conditionList})
      `
      const beforeRes = await duckConn.run(`SELECT COUNT(*) FROM btc_events`)
      let beforeCount = 0n
      for (let c = 0; c < beforeRes.chunkCount; c++) {
        for (const r of beforeRes.getChunk(c).getRows()) beforeCount = r[0] as bigint
      }
      await duckConn.run(sqlStr)
      const afterRes = await duckConn.run(`SELECT COUNT(*) FROM btc_events`)
      let afterCount = 0n
      for (let c = 0; c < afterRes.chunkCount; c++) {
        for (const r of afterRes.getChunk(c).getRows()) afterCount = r[0] as bigint
      }
      rowsInserted = afterCount - beforeCount
    } finally {
      insertSemaphore.release()
    }

    if (existsSync(tempPath)) unlinkSync(tempPath)

    await db
      .update(pmxtDatasetCatalogue)
      .set({
        status: 'master_done',
        finishedAt: new Date(),
      })
      .where(eq(pmxtDatasetCatalogue.id, job.id))

    done++
    const elapsed = fmtDuration(Date.now() - jobStart)
    const eta = fmtEta(done, total, Date.now() - startTime)
    console.log(`${jobLabel}  done (+${rowsInserted.toString()} rows, ${elapsed})  ETA: ${eta}`)
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
// Summary + optional finalize
// ---------------------------------------------------------------------------

const totalElapsed = fmtDuration(Date.now() - startTime)
console.log()
console.log(`Pipeline finished in ${totalElapsed}`)
console.log(`  done:        ${done}`)
console.log(`  failed:      ${failed}`)
console.log(`  total:       ${total}`)

if (finalize) await writeMasterParquet()
else
  console.log(`\nIntermediate at ${duckPath}. Run with --finalize-only to produce ${masterPath}.`)

duckConn.closeSync()
await closeDb()
