#!/usr/bin/env tsx
/**
 * Telonex Step 1 — Download raw files per market and upload to R2.
 *
 * For each pending market in telonex_markets:
 *   - expand the book_snapshot_full date range × (asset_id_0, asset_id_1)
 *     into candidate (date, asset_id) pairs
 *   - for each candidate: GET the Telonex download endpoint, follow the
 *     redirect to S3, verify MD5, PUT to our R2 with Content-MD5 server-side
 *     validation
 *   - 404 = gap (recorded as no_file row), 5xx/network = retried 3× then
 *     marked failed
 *   - per-file outcome is written to telonex_market_files
 *   - per-market outcome is written to telonex_markets.upload_status
 *
 * Usage:
 *   npm run telonex:download -- [--concurrency N] [--limit N] [--channel C]
 *
 * Defaults: concurrency=4, channel=book_snapshot_full
 *
 * See docs/telonex-sync-design.md for the full pipeline design.
 */

import '../config/env.js'
import crypto from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, closeDb, telonexMarkets, telonexMarketFiles } from '../db/index.js'
import { getDefaultBucket, putObject } from '../r2/client.js'

const TELONEX_DOWNLOAD_BASE = 'https://api.telonex.io/v1/downloads/polymarket'
const MAX_IN_PROCESS_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]
const MAX_429_RETRIES = 10

type Args = {
  concurrency: number
  channel: string
  limit: number | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { concurrency: 4, channel: 'book_snapshot_full', limit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '4'))
    else if (a === '--channel') out.channel = argv[++i] ?? out.channel
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null
    else throw new Error(`[telonex:download] unknown arg: ${a}`)
  }
  return out
}

function readApiKey(): string {
  const k = process.env.TELONEX_API_KEY
  if (!k || k.trim() === '') throw new Error('[telonex:download] TELONEX_API_KEY is required')
  return k.trim()
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(1)}s`
}

function parseSlug(slug: string): { symbol: string; timeframe: string; epoch: string } | null {
  // e.g. btc-updown-15m-1765123200 -> symbol=btc, timeframe=15m, epoch=1765123200
  const m = slug.match(/^([a-z0-9]+)-updown-([a-z0-9]+)-(\d+)$/)
  if (!m) return null
  return { symbol: m[1]!, timeframe: m[2]!, epoch: m[3]! }
}

function isoDateString(d: Date): string {
  // Date columns come back as Date at UTC midnight; print as YYYY-MM-DD.
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400 * 1000)
}

type Candidate = {
  date: string // YYYY-MM-DD
  assetId: string
}

function expandCandidates(
  from: Date,
  toExclusive: Date,
  assetIds: ReadonlyArray<string>,
): Candidate[] {
  const out: Candidate[] = []
  for (let d = from; d.getTime() < toExclusive.getTime(); d = addDaysUTC(d, 1)) {
    const date = isoDateString(d)
    for (const aid of assetIds) out.push({ date, assetId: aid })
  }
  return out
}

function buildR2Key(args: {
  symbol: string
  timeframe: string
  epoch: string
  channel: string
  assetId: string
  date: string
}): string {
  const filename = `${args.assetId}_${args.date}_${args.channel}.parquet`
  return `telonex/raw/${args.symbol}/${args.timeframe}/${args.epoch}/${args.channel}/${filename}`
}

class HttpError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number | null,
    message: string,
  ) {
    super(message)
  }
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null
  const n = Number(h)
  if (!isNaN(n)) return Math.max(0, n * 1000)
  const t = Date.parse(h)
  if (!isNaN(t)) return Math.max(0, t - Date.now())
  return null
}

async function fetchTelonexFile(
  url: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; sourceEtag: string | null } | { notFound: true }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'follow',
    signal,
  })
  if (res.status === 404) return { notFound: true }
  if (res.status === 429) {
    const ra = parseRetryAfter(res.headers.get('retry-after'))
    throw new HttpError(429, ra ?? 4000, `429 Too Many Requests`)
  }
  if (!res.ok) {
    throw new HttpError(res.status, null, `HTTP ${res.status} ${res.statusText}`)
  }
  if (!res.body) throw new HttpError(500, null, 'empty body')
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, sourceEtag: res.headers.get('etag')?.replace(/^"|"$/g, '') ?? null }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

type FetchResult =
  | { kind: 'uploaded'; r2Key: string; r2Etag: string | undefined; size: number; attempts: number }
  | { kind: 'no_file'; attempts: number }
  | { kind: 'failed'; attempts: number; error: string }

async function downloadVerifyUpload(args: {
  apiKey: string
  bucket: string
  channel: string
  candidate: Candidate
  market: { slug: string; symbol: string; timeframe: string; epoch: string }
  signal: AbortSignal
}): Promise<FetchResult> {
  const { apiKey, bucket, channel, candidate, market, signal } = args
  const url = `${TELONEX_DOWNLOAD_BASE}/${channel}/${candidate.date}?asset_id=${encodeURIComponent(candidate.assetId)}`
  const r2Key = buildR2Key({
    symbol: market.symbol,
    timeframe: market.timeframe,
    epoch: market.epoch,
    channel,
    assetId: candidate.assetId,
    date: candidate.date,
  })

  let last: Error | null = null
  let r429 = 0
  for (let attempt = 1; attempt <= MAX_IN_PROCESS_RETRIES; attempt++) {
    try {
      const fetched = await fetchTelonexFile(url, apiKey, signal)
      if ('notFound' in fetched) {
        return { kind: 'no_file', attempts: attempt }
      }
      const buf = fetched.buffer
      const md5 = crypto.createHash('md5').update(buf).digest()
      const md5Hex = md5.toString('hex')
      const md5B64 = md5.toString('base64')
      // Telonex source ETag for single-part is MD5 — log mismatch but proceed
      // (R2's Content-MD5 validation is the authoritative check).
      if (fetched.sourceEtag && fetched.sourceEtag !== md5Hex) {
        console.warn(
          `[telonex:download] WARN source ETag mismatch for ${candidate.date}/${candidate.assetId}: src=${fetched.sourceEtag} local=${md5Hex}`,
        )
      }
      const { etag } = await putObject(bucket, r2Key, buf, { contentMD5: md5B64 })
      return { kind: 'uploaded', r2Key, r2Etag: etag, size: buf.length, attempts: attempt }
    } catch (err) {
      last = err as Error
      if (err instanceof HttpError && err.status === 429) {
        r429++
        if (r429 > MAX_429_RETRIES) break
        await sleep(err.retryAfterMs ?? 4000, signal)
        attempt-- // don't count 429 toward the 3-retry budget
        continue
      }
      if (attempt < MAX_IN_PROCESS_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000, signal)
        continue
      }
    }
  }
  return {
    kind: 'failed',
    attempts: MAX_IN_PROCESS_RETRIES,
    error: last?.message ?? 'unknown',
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type ClaimedMarket = {
  id: number
  slug: string
  assetId0: string
  assetId1: string
  bookSnapshotFullFrom: Date
  bookSnapshotFullTo: Date
}

async function claimMarket(): Promise<ClaimedMarket | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    // Hold the row lock only for the duration of claim+UPDATE, then commit.
    const candidates = await tx
      .select({
        id: telonexMarkets.id,
        slug: telonexMarkets.slug,
        assetId0: telonexMarkets.assetId0,
        assetId1: telonexMarkets.assetId1,
        bsfFrom: telonexMarkets.bookSnapshotFullFrom,
        bsfTo: telonexMarkets.bookSnapshotFullTo,
      })
      .from(telonexMarkets)
      .where(inArray(telonexMarkets.uploadStatus, ['pending', 'partial']))
      // 'partial' before 'pending' so failed-mid-flight markets retry first
      // and surface persistent failures quickly instead of getting buried.
      .orderBy(sql`FIELD(${telonexMarkets.uploadStatus}, 'partial', 'pending')`)
      .limit(1)
      .for('update', { skipLocked: true })
    const row = candidates[0]
    if (!row) return null
    if (!row.assetId0 || !row.assetId1 || !row.bsfFrom || !row.bsfTo) {
      // Should never happen given our sync filter; mark failed and skip.
      await tx
        .update(telonexMarkets)
        .set({ uploadStatus: 'failed', lastError: 'missing asset_ids or book_snapshot_full range' })
        .where(eq(telonexMarkets.id, row.id))
      return null
    }
    await tx
      .update(telonexMarkets)
      .set({ uploadStatus: 'processing' })
      .where(eq(telonexMarkets.id, row.id))
    return {
      id: row.id,
      slug: row.slug,
      assetId0: row.assetId0,
      assetId1: row.assetId1,
      bookSnapshotFullFrom: row.bsfFrom,
      bookSnapshotFullTo: row.bsfTo,
    }
  })
}

async function getExistingFiles(
  slug: string,
  channel: string,
): Promise<Map<string, { status: 'uploaded' | 'no_file' | 'failed' }>> {
  const db = getDb()
  const rows = await db
    .select({
      date: telonexMarketFiles.date,
      assetId: telonexMarketFiles.assetId,
      status: telonexMarketFiles.status,
    })
    .from(telonexMarketFiles)
    .where(and(eq(telonexMarketFiles.slug, slug), eq(telonexMarketFiles.channel, channel)))
  const out = new Map<string, { status: 'uploaded' | 'no_file' | 'failed' }>()
  for (const r of rows) {
    const key = `${isoDateString(r.date)}|${r.assetId}`
    out.set(key, { status: r.status })
  }
  return out
}

async function recordFileResult(args: {
  slug: string
  channel: string
  candidate: Candidate
  result: FetchResult
}): Promise<void> {
  const db = getDb()
  const { slug, channel, candidate, result } = args
  const dateObj = new Date(`${candidate.date}T00:00:00Z`)
  const base = {
    slug,
    channel,
    date: dateObj,
    assetId: candidate.assetId,
  }
  const now = new Date()
  if (result.kind === 'uploaded') {
    await db
      .insert(telonexMarketFiles)
      .values({
        ...base,
        r2Key: result.r2Key,
        r2Etag: result.r2Etag ?? null,
        sizeBytes: result.size,
        status: 'uploaded',
        attempts: result.attempts,
        uploadedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          r2Key: result.r2Key,
          r2Etag: result.r2Etag ?? null,
          sizeBytes: result.size,
          status: 'uploaded',
          attempts: result.attempts,
          uploadedAt: now,
          lastError: null,
        },
      })
  } else if (result.kind === 'no_file') {
    await db
      .insert(telonexMarketFiles)
      .values({
        ...base,
        r2Key: '',
        status: 'no_file',
        attempts: result.attempts,
      })
      .onDuplicateKeyUpdate({
        set: { status: 'no_file', attempts: result.attempts, lastError: null },
      })
  } else {
    await db
      .insert(telonexMarketFiles)
      .values({
        ...base,
        r2Key: '',
        status: 'failed',
        attempts: result.attempts,
        lastError: result.error,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: 'failed',
          attempts: result.attempts,
          lastError: result.error,
        },
      })
  }
}

async function finalizeMarket(
  marketId: number,
  okCount: number,
  failedCount: number,
): Promise<void> {
  const db = getDb()
  const status = failedCount > 0 ? 'partial' : 'done'
  await db
    .update(telonexMarkets)
    .set({
      uploadStatus: status,
      filesUploaded: okCount,
      processedAt: new Date(),
      lastError: failedCount > 0 ? `${failedCount} file(s) failed after retries` : null,
    })
    .where(eq(telonexMarkets.id, marketId))
}

async function revertProcessingMarkets(): Promise<number> {
  const db = getDb()
  const res = await db
    .update(telonexMarkets)
    .set({ uploadStatus: 'pending' })
    .where(eq(telonexMarkets.uploadStatus, 'processing'))
  const affected = Array.isArray(res) ? (res[0] as { affectedRows?: number })?.affectedRows : 0
  return affected ?? 0
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

async function processMarket(
  workerId: number,
  market: ClaimedMarket,
  args: { apiKey: string; bucket: string; channel: string },
  signal: AbortSignal,
): Promise<{ ok: number; failed: number; noFile: number }> {
  const parts = parseSlug(market.slug)
  if (!parts) {
    await finalizeMarket(market.id, 0, 1)
    return { ok: 0, failed: 1, noFile: 0 }
  }
  const candidates = expandCandidates(market.bookSnapshotFullFrom, market.bookSnapshotFullTo, [
    market.assetId0,
    market.assetId1,
  ])
  const existing = await getExistingFiles(market.slug, args.channel)

  let ok = 0
  let failed = 0
  let noFile = 0
  for (const cand of candidates) {
    if (signal.aborted) {
      console.log(`[telonex:download] w${workerId} aborted mid-market ${market.slug}`)
      return { ok, failed, noFile }
    }
    const key = `${cand.date}|${cand.assetId}`
    const ex = existing.get(key)
    if (ex && ex.status === 'uploaded') {
      ok++
      continue
    }
    const result = await downloadVerifyUpload({
      apiKey: args.apiKey,
      bucket: args.bucket,
      channel: args.channel,
      candidate: cand,
      market: { ...market, ...parts },
      signal,
    })
    await recordFileResult({ slug: market.slug, channel: args.channel, candidate: cand, result })
    if (result.kind === 'uploaded') ok++
    else if (result.kind === 'no_file') noFile++
    else failed++

    const tag =
      result.kind === 'uploaded'
        ? `OK ${result.size}B`
        : result.kind === 'no_file'
          ? 'NO_FILE'
          : `FAIL ${result.error}`
    console.log(
      `[telonex:download] w${workerId} ${market.slug} ${cand.date}/${cand.assetId.slice(0, 8)} -> ${tag}`,
    )
  }
  await finalizeMarket(market.id, ok, failed)
  return { ok, failed, noFile }
}

async function worker(
  workerId: number,
  args: { apiKey: string; bucket: string; channel: string; limit: number | null },
  state: { signal: AbortSignal; consumed: { count: number } },
): Promise<void> {
  while (!state.signal.aborted) {
    if (args.limit && state.consumed.count >= args.limit) return
    const market = await claimMarket()
    if (!market) {
      // Nothing more to claim; exit the worker.
      return
    }
    state.consumed.count++
    const t0 = Date.now()
    try {
      const { ok, failed, noFile } = await processMarket(workerId, market, args, state.signal)
      console.log(
        `[telonex:download] w${workerId} ${market.slug} done ok=${ok} no_file=${noFile} failed=${failed} elapsed=${fmtMs(Date.now() - t0)}`,
      )
    } catch (err) {
      console.error(`[telonex:download] w${workerId} ${market.slug} unexpected:`, err)
      const db = getDb()
      await db
        .update(telonexMarkets)
        .set({ uploadStatus: 'partial', lastError: (err as Error).message })
        .where(eq(telonexMarkets.id, market.id))
    }
  }
}

// ---------------------------------------------------------------------------
// Main + graceful shutdown
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = readApiKey()
  const bucket = getDefaultBucket()
  console.log(
    `[telonex:download] concurrency=${args.concurrency} channel=${args.channel} limit=${args.limit ?? 'none'} bucket=${bucket}`,
  )

  const ac = new AbortController()
  let shuttingDown = false
  const onSignal = async (sig: string) => {
    if (shuttingDown) {
      console.log(`[telonex:download] second ${sig}, hard exit`)
      process.exit(1)
    }
    shuttingDown = true
    console.log(`[telonex:download] ${sig} received, draining (Ctrl+C again to force)...`)
    ac.abort()
  }
  process.on('SIGINT', () => void onSignal('SIGINT'))
  process.on('SIGTERM', () => void onSignal('SIGTERM'))

  const consumed = { count: 0 }
  const t0 = Date.now()
  try {
    const workers = Array.from({ length: args.concurrency }, (_, i) =>
      worker(i + 1, { ...args, apiKey, bucket }, { signal: ac.signal, consumed }),
    )
    await Promise.all(workers)
  } finally {
    const reverted = await revertProcessingMarkets()
    if (reverted > 0) {
      console.log(`[telonex:download] reverted ${reverted} 'processing' market(s) to 'pending'`)
    }
    console.log(
      `[telonex:download] done markets_processed=${consumed.count} elapsed=${fmtMs(Date.now() - t0)}`,
    )
  }
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
