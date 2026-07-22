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
 *   npm run telonex:download -- --slug-pattern '<like>[,<like>...]' [--concurrency N] [--limit N] [--channel C] [--dry-run]
 *
 * --slug-pattern is required (no default). Defaults: concurrency=1, channel=book_snapshot_full
 *
 * See docs/datasets/telonex/sync-design.md for the full pipeline design.
 */

import '../config/env.js'
import crypto from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, closeDb, telonexMarkets, telonexMarketFiles } from '../db/index.js'
import { buildSlugSelection, type SlugSelection } from '../db/telonexMarkets.js'
import { getDefaultBucket, putObject } from '../r2/client.js'
import { claimFromCandidates, claimNextOrConfirmEmpty } from './claimQueue.js'
import {
  TELONEX_DOWNLOAD_BASE,
  HttpError,
  fetchTelonexFile,
  readTelonexApiKey,
  abortableSleep as sleep,
} from './telonexHttp.js'

const MAX_IN_PROCESS_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]
const MAX_429_RETRIES = 10
// A null claim is usually transient under heavy fan-out (many machines/panes
// over one DB): the claimable rows were momentarily won by peers. On an empty
// claim we back off this long, then re-check a real count before deciding the
// queue is actually drained (see worker()).
const EMPTY_CLAIM_BACKOFF_MS = 750

type Args = {
  concurrency: number
  channel: string
  limit: number | null
  slugPatterns: string[]
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    concurrency: 1,
    channel: 'book_snapshot_full',
    limit: null,
    slugPatterns: [],
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '1'))
    else if (a === '--channel') out.channel = argv[++i] ?? out.channel
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--slug-pattern') {
      // Comma-separated LIKE patterns. Markets are processed in pattern order
      // (all of pattern[0] first, then pattern[1], …) and chronologically
      // within each pattern. Required — there is no default.
      const raw = argv[++i] ?? ''
      out.slugPatterns = raw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
    } else throw new Error(`[telonex:download] unknown arg: ${a}`)
  }
  if (out.slugPatterns.length === 0) {
    throw new Error(
      "[telonex:download] --slug-pattern is required, e.g. --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%'",
    )
  }
  return out
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
        const waitMs = err.retryAfterMs ?? 4000
        console.warn(
          `[telonex:download] WARN 429 rate-limited ${candidate.date}/${candidate.assetId.slice(0, 8)} ` +
            `retry ${r429}/${MAX_429_RETRIES} after ${fmtMs(waitMs)}`,
        )
        if (r429 > MAX_429_RETRIES) break
        await sleep(waitMs, signal)
        attempt-- // don't count 429 toward the 3-retry budget
        continue
      }
      if (attempt < MAX_IN_PROCESS_RETRIES) {
        const httpStatus = err instanceof HttpError ? err.status : 'net'
        const waitMs = RETRY_DELAYS_MS[attempt - 1] ?? 4000
        console.warn(
          `[telonex:download] WARN ${httpStatus} ${candidate.date}/${candidate.assetId.slice(0, 8)} ` +
            `attempt ${attempt}/${MAX_IN_PROCESS_RETRIES} retry in ${fmtMs(waitMs)}: ${(err as Error).message}`,
        )
        await sleep(waitMs, signal)
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

function isDeadlock(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; cause?: { code?: string; errno?: number } }
  if (e?.code === 'ER_LOCK_DEADLOCK' || e?.errno === 1213) return true
  if (e?.cause?.code === 'ER_LOCK_DEADLOCK' || e?.cause?.errno === 1213) return true
  return false
}

async function claimMarket(selection: SlugSelection): Promise<ClaimedMarket | null> {
  const MAX_DEADLOCK_RETRIES = 5
  for (let attempt = 1; attempt <= MAX_DEADLOCK_RETRIES; attempt++) {
    try {
      return await claimMarketOnce(selection)
    } catch (err) {
      if (isDeadlock(err) && attempt < MAX_DEADLOCK_RETRIES) {
        // Backoff with jitter so retrying workers do not collide again.
        const base = 25 * Math.pow(2, attempt - 1)
        const wait = base + Math.floor(Math.random() * base)
        console.warn(
          `[telonex:download] WARN claim deadlock retry ${attempt}/${MAX_DEADLOCK_RETRIES} after ${wait}ms`,
        )
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
  return null
}

// Count rows that are still claimable for our slug-patterns (pending or partial).
// Used to decide, on an empty claim, whether the queue is genuinely drained vs.
// merely contended. Orphaned 'processing' rows are intentionally excluded — they
// are a separate recovery concern, not claimable work for this worker.
async function countClaimable(selection: SlugSelection): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(telonexMarkets)
    .where(and(inArray(telonexMarkets.uploadStatus, ['pending', 'partial']), selection.where))
  return Number(rows[0]?.c ?? 0)
}

// Number of candidate rows fetched per claim attempt. Sized above the typical
// concurrent-worker count so that, even when many machines/panes draw from the
// same head of the queue, each worker finds an unclaimed candidate in its batch.
const CLAIM_CANDIDATES = 100

type CandidateRow = {
  id: number
  slug: string
  assetId0: string | null
  assetId1: string | null
  bsfFrom: Date | null
  bsfTo: Date | null
}

// NON-LOCKING read of a batch of claimable candidates. Deliberately NOT
// `FOR UPDATE`: a locking scan locks EVERY pending row it reads for the lifetime
// of the claim, so under fan-out one worker momentarily locks the entire queue
// and every peer's claim comes back empty. A plain read holds no row locks.
//
// We read one status at a time (pending first, then the rare 'partial'). A
// single-value `upload_status` equality lets the engine walk the
// `(upload_status, market_start_ms)` index in order and stop at LIMIT — no
// filesort. An `IN ('pending','partial')` predicate cannot early-terminate on an
// ordered LIMIT, so it would fall back to a full scan + filesort.
async function readClaimCandidates(selection: SlugSelection): Promise<CandidateRow[]> {
  const db = getDb()
  const orderCols = selection.order
    ? [selection.order, telonexMarkets.marketStartMs]
    : [telonexMarkets.marketStartMs]
  const candidates: CandidateRow[] = []
  for (const status of ['pending', 'partial'] as const) {
    if (candidates.length >= CLAIM_CANDIDATES) break
    const rows = await db
      .select({
        id: telonexMarkets.id,
        slug: telonexMarkets.slug,
        assetId0: telonexMarkets.assetId0,
        assetId1: telonexMarkets.assetId1,
        bsfFrom: telonexMarkets.bookSnapshotFullFrom,
        bsfTo: telonexMarkets.bookSnapshotFullTo,
      })
      .from(telonexMarkets)
      .where(and(eq(telonexMarkets.uploadStatus, status), selection.where))
      // Pattern order first (combo by combo), then chronological within a combo.
      .orderBy(...orderCols)
      .limit(CLAIM_CANDIDATES - candidates.length)
    candidates.push(...rows)
  }
  return candidates
}

// Atomic single-row claim: flip one candidate pending/partial -> processing via
// a PK-keyed conditional UPDATE. The status guard makes exactly one worker win
// (affectedRows === 1); losers get 0. Locks one row by primary key — no scan, no
// lock storm, no deadlocks.
async function tryClaimRow(row: CandidateRow): Promise<ClaimedMarket | null> {
  const db = getDb()
  if (!row.assetId0 || !row.assetId1 || !row.bsfFrom || !row.bsfTo) {
    // Should never happen given our sync filter; mark failed and skip.
    await db
      .update(telonexMarkets)
      .set({ uploadStatus: 'failed', lastError: 'missing asset_ids or book_snapshot_full range' })
      .where(eq(telonexMarkets.id, row.id))
    return null
  }
  const res = await db
    .update(telonexMarkets)
    .set({ uploadStatus: 'processing' })
    .where(
      and(
        eq(telonexMarkets.id, row.id),
        inArray(telonexMarkets.uploadStatus, ['pending', 'partial']),
      ),
    )
  const affected = Array.isArray(res)
    ? ((res[0] as { affectedRows?: number })?.affectedRows ?? 0)
    : 0
  if (affected !== 1) return null
  return {
    id: row.id,
    slug: row.slug,
    assetId0: row.assetId0,
    assetId1: row.assetId1,
    bookSnapshotFullFrom: row.bsfFrom,
    bookSnapshotFullTo: row.bsfTo,
  }
}

async function claimMarketOnce(selection: SlugSelection): Promise<ClaimedMarket | null> {
  return claimFromCandidates(await readClaimCandidates(selection), tryClaimRow)
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

// Revert ONLY the markets this process claimed and did not finalize. Reverting
// by slug-pattern would clobber the in-flight markets of other concurrent
// processes (e.g. fan-out panes) sharing the same pattern, forcing needless
// re-downloads. We track our own claimed ids and revert just those.
async function revertOwnedProcessing(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const res = await db
    .update(telonexMarkets)
    .set({ uploadStatus: 'pending' })
    .where(and(eq(telonexMarkets.uploadStatus, 'processing'), inArray(telonexMarkets.id, ids)))
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
): Promise<{ ok: number; failed: number; noFile: number; finalized: boolean }> {
  const parts = parseSlug(market.slug)
  if (!parts) {
    await finalizeMarket(market.id, 0, 1)
    return { ok: 0, failed: 1, noFile: 0, finalized: true }
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
      // Not finalized: leave it in 'processing' so the caller reverts it to
      // 'pending' on shutdown and it gets re-claimed cleanly later.
      return { ok, failed, noFile, finalized: false }
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
  return { ok, failed, noFile, finalized: true }
}

function fmtEta(remainingSec: number): string {
  if (!isFinite(remainingSec) || remainingSec <= 0) return '?'
  const h = Math.floor(remainingSec / 3600)
  const m = Math.floor((remainingSec % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m`
  return `${Math.round(remainingSec)}s`
}

type SharedState = {
  signal: AbortSignal
  reserved: { count: number }
  claimed: { count: number }
  completed: { count: number }
  totalQueue: number
  runStart: number
  // Markets this process has claimed but not yet finalized. On shutdown we
  // revert exactly these (and only these) back to 'pending'.
  inFlight: Set<number>
}

function reserveLimitSlot(limit: number | null, reserved: { count: number }): boolean {
  if (!limit) return true
  if (limit && reserved.count >= limit) return false
  reserved.count += 1
  return true
}

async function worker(
  workerId: number,
  args: { apiKey: string; bucket: string; channel: string; limit: number | null },
  state: SharedState,
  selection: SlugSelection,
): Promise<void> {
  while (!state.signal.aborted) {
    if (!reserveLimitSlot(args.limit, state.reserved)) return
    let market: ClaimedMarket | null
    try {
      // Shared drain logic: claim one, and on a miss confirm with a real count
      // before giving up — so "done" never fires while work remains. Returns
      // null ONLY when the queue is genuinely empty (or aborted).
      market = await claimNextOrConfirmEmpty({
        claim: () => claimMarket(selection),
        countRemaining: () => countClaimable(selection),
        backoffMs: EMPTY_CLAIM_BACKOFF_MS,
        signal: state.signal,
      })
    } catch (err) {
      // claimMarket has its own deadlock retry; if it still throws, log and
      // exit this worker cleanly so other workers can drain instead of the
      // pool collapsing through Promise.all.
      if (args.limit) state.reserved.count--
      console.error(`[telonex:download] w${workerId} claim error, exiting:`, err)
      return
    }
    if (!market) {
      // Queue genuinely drained (confirmed by count) or shutting down.
      if (args.limit) state.reserved.count--
      return
    }
    state.claimed.count++
    state.inFlight.add(market.id)
    const t0 = Date.now()
    try {
      const { ok, failed, noFile, finalized } = await processMarket(
        workerId,
        market,
        args,
        state.signal,
      )
      // Drop from the in-flight set only once the market reached a terminal
      // status (done/partial). If aborted mid-market it stays 'processing' and
      // remains in the set so the finally block reverts it.
      if (finalized) state.inFlight.delete(market.id)
      state.completed.count++
      const elapsedRun = (Date.now() - state.runStart) / 1000
      const rate = state.completed.count / Math.max(elapsedRun, 0.001)
      const remaining = Math.max(state.totalQueue - state.completed.count, 0)
      const eta = fmtEta(remaining / rate)
      console.log(
        `[telonex:download] w${workerId} ${market.slug} done ok=${ok} no_file=${noFile} failed=${failed} elapsed=${fmtMs(Date.now() - t0)} ` +
          `[${state.completed.count}/${state.totalQueue} rate=${rate.toFixed(2)}/s eta=${eta}]`,
      )
    } catch (err) {
      console.error(`[telonex:download] w${workerId} ${market.slug} unexpected:`, err)
      const db = getDb()
      await db
        .update(telonexMarkets)
        .set({ uploadStatus: 'partial', lastError: (err as Error).message })
        .where(eq(telonexMarkets.id, market.id))
      // Reached a terminal status here, so it is no longer ours to revert.
      state.inFlight.delete(market.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Main + graceful shutdown
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = readTelonexApiKey('telonex:download')
  const bucket = getDefaultBucket()
  const selection = buildSlugSelection(args.slugPatterns)
  console.log(
    `[telonex:download] slug-patterns=${args.slugPatterns.join(',')} concurrency=${args.concurrency} channel=${args.channel} limit=${args.limit ?? 'none'} bucket=${bucket}`,
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

  const reserved = { count: 0 }
  const claimed = { count: 0 }
  const completed = { count: 0 }
  // Shared across every worker in this process; the same Set reference is passed
  // into each worker's state so shutdown reverts only our own claims.
  const inFlight = new Set<number>()
  const db = getDb()
  // Count markets that are eligible to be claimed. With --limit, cap at that.
  const totals = await db
    .select({ c: sql<number>`count(*)` })
    .from(telonexMarkets)
    .where(and(inArray(telonexMarkets.uploadStatus, ['pending', 'partial']), selection.where))
  const queueTotal = Number(totals[0]?.c ?? 0)
  const totalQueue = args.limit ? Math.min(args.limit, queueTotal) : queueTotal
  console.log(
    `[telonex:download] queue size=${totalQueue} (pending+partial matching slug-patterns, capped by --limit)`,
  )

  if (args.dryRun) {
    console.log('[telonex:download] dry-run — nothing downloaded')
    return
  }

  const t0 = Date.now()
  try {
    const workers = Array.from({ length: args.concurrency }, (_, i) =>
      worker(
        i + 1,
        { ...args, apiKey, bucket },
        { signal: ac.signal, reserved, claimed, completed, totalQueue, runStart: t0, inFlight },
        selection,
      ),
    )
    await Promise.all(workers)
  } finally {
    const reverted = await revertOwnedProcessing([...inFlight])
    if (reverted > 0) {
      console.log(`[telonex:download] reverted ${reverted} 'processing' market(s) to 'pending'`)
    }
    console.log(
      `[telonex:download] done markets_processed=${claimed.count} elapsed=${fmtMs(Date.now() - t0)}`,
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
