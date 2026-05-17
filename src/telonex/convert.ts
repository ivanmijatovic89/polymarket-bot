#!/usr/bin/env tsx
/**
 * Telonex Step 2 — Convert raw R2 parquets to backtest-ready parquets.
 *
 * For each market whose upload_status='done' and that has not yet been
 * converted for the chosen converter, this dispatcher:
 *   - reads the market's telonex_market_files rows (raw uploads)
 *   - downloads each raw parquet from R2 to a per-worker temp directory
 *   - resolves Up/Down side from telonex_markets.outcome_0/outcome_1
 *   - calls the converter function (paired or delta) with explicit sides
 *   - depending on --output: keeps locally, uploads to R2, or both
 *   - writes a telonex_market_conversions row recording status / paths / etag
 *
 * Usage:
 *   npm run telonex:convert -- [--converter paired|delta] [--output local|r2|both]
 *                              [--concurrency N] [--limit N] [--book-interval N]
 *
 * See docs/telonex-sync-design.md.
 */

import '../config/env.js'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  getDb,
  closeDb,
  telonexMarkets,
  telonexMarketFiles,
  telonexMarketConversions,
} from '../db/index.js'
import { getDefaultBucket, getObjectToFile, putObject } from '../r2/client.js'
import { convertPaired } from './converters/paired.js'
import { createDeltaConverter } from './converters/delta.js'
import type { ConverterFn, ConverterInput, Side } from './converters/types.js'

type ConverterName = 'paired' | 'delta'
type OutputMode = 'local' | 'r2' | 'both'

type Args = {
  converter: ConverterName
  output: OutputMode
  concurrency: number
  limit: number | null
  bookInterval: number | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    converter: 'paired',
    output: 'r2',
    concurrency: 4,
    limit: null,
    bookInterval: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--converter') {
      const v = argv[++i]
      if (v !== 'paired' && v !== 'delta') {
        throw new Error(`[telonex:convert] --converter must be paired|delta, got ${v}`)
      }
      out.converter = v
    } else if (a === '--output') {
      const v = argv[++i]
      if (v !== 'local' && v !== 'r2' && v !== 'both') {
        throw new Error(`[telonex:convert] --output must be local|r2|both, got ${v}`)
      }
      out.output = v
    } else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '4'))
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null
    else if (a === '--book-interval') out.bookInterval = Number(argv[++i] ?? '0') || null
    else throw new Error(`[telonex:convert] unknown arg: ${a}`)
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

function fmtEta(remainingSec: number): string {
  if (!isFinite(remainingSec) || remainingSec <= 0) return '?'
  const h = Math.floor(remainingSec / 3600)
  const m = Math.floor((remainingSec % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m`
  return `${Math.round(remainingSec)}s`
}

function parseSlug(slug: string): { symbol: string; timeframe: string; epoch: string } | null {
  const m = slug.match(/^([a-z0-9]+)-updown-([a-z0-9]+)-(\d+)$/)
  if (!m) return null
  return { symbol: m[1]!, timeframe: m[2]!, epoch: m[3]! }
}

function localOutputPath(args: {
  converter: string
  symbol: string
  timeframe: string
  slug: string
}): string {
  return path.resolve(
    'data/events/telonex',
    args.converter,
    args.symbol,
    args.timeframe,
    `${args.slug}.parquet`,
  )
}

function r2OutputKey(args: {
  converter: string
  symbol: string
  timeframe: string
  epoch: string
  slug: string
}): string {
  return `telonex/converted/${args.converter}/${args.symbol}/${args.timeframe}/${args.epoch}/${args.slug}.parquet`
}

function getConverter(name: ConverterName, opts: { bookInterval: number | null }): ConverterFn {
  if (name === 'paired') return convertPaired
  return createDeltaConverter({
    ...(opts.bookInterval != null ? { bookInterval: opts.bookInterval } : {}),
  })
}

// ---------------------------------------------------------------------------
// Claim & DB helpers
// ---------------------------------------------------------------------------

type ClaimedMarket = {
  id: number
  slug: string
  symbol: string
  timeframe: string
  epoch: string
  assetId0: string
  assetId1: string
  outcome0: string | null
  outcome1: string | null
}

async function claimMarket(converter: ConverterName): Promise<ClaimedMarket | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    // Pick a 'done' market that has no successful conversion for this converter yet.
    const rows = await tx
      .select({
        id: telonexMarkets.id,
        slug: telonexMarkets.slug,
        assetId0: telonexMarkets.assetId0,
        assetId1: telonexMarkets.assetId1,
        outcome0: telonexMarkets.outcome0,
        outcome1: telonexMarkets.outcome1,
        convId: telonexMarketConversions.id,
        convStatus: telonexMarketConversions.status,
      })
      .from(telonexMarkets)
      .leftJoin(
        telonexMarketConversions,
        and(
          eq(telonexMarketConversions.marketId, telonexMarkets.id),
          eq(telonexMarketConversions.converter, converter),
        ),
      )
      .where(
        and(
          eq(telonexMarkets.uploadStatus, 'done'),
          or(
            isNull(telonexMarketConversions.id),
            inArray(telonexMarketConversions.status, ['pending', 'failed']),
          ),
        ),
      )
      .limit(1)
      .for('update', { skipLocked: true })
    const row = rows[0]
    if (!row) return null

    const parts = parseSlug(row.slug)
    if (!parts || !row.assetId0 || !row.assetId1) {
      // Mark failed and skip.
      await tx
        .insert(telonexMarketConversions)
        .values({
          marketId: row.id,
          converter,
          status: 'failed',
          lastError: 'slug parse failed or missing asset ids',
        })
        .onDuplicateKeyUpdate({
          set: { status: 'failed', lastError: 'slug parse failed or missing asset ids' },
        })
      return null
    }

    // Claim: insert or update to in_progress
    await tx
      .insert(telonexMarketConversions)
      .values({
        marketId: row.id,
        converter,
        status: 'in_progress',
        attempts: 1,
        startedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          status: 'in_progress',
          attempts: sql`attempts + 1`,
          startedAt: new Date(),
          lastError: null,
        },
      })

    return {
      id: row.id,
      slug: row.slug,
      symbol: parts.symbol,
      timeframe: parts.timeframe,
      epoch: parts.epoch,
      assetId0: row.assetId0,
      assetId1: row.assetId1,
      outcome0: row.outcome0,
      outcome1: row.outcome1,
    }
  })
}

async function getRawFiles(slug: string): Promise<Array<{ assetId: string; r2Key: string }>> {
  const db = getDb()
  return db
    .select({ assetId: telonexMarketFiles.assetId, r2Key: telonexMarketFiles.r2Key })
    .from(telonexMarketFiles)
    .where(and(eq(telonexMarketFiles.slug, slug), eq(telonexMarketFiles.status, 'uploaded')))
}

async function recordConversionSuccess(args: {
  marketId: number
  converter: ConverterName
  r2Url: string | null
  localPath: string | null
  sizeBytes: number
  etag: string | null
}): Promise<void> {
  const db = getDb()
  await db
    .update(telonexMarketConversions)
    .set({
      status: 'done',
      r2Url: args.r2Url,
      localPath: args.localPath,
      sizeBytes: args.sizeBytes,
      etag: args.etag,
      completedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(telonexMarketConversions.marketId, args.marketId),
        eq(telonexMarketConversions.converter, args.converter),
      ),
    )
}

async function recordConversionFailure(args: {
  marketId: number
  converter: ConverterName
  error: string
}): Promise<void> {
  const db = getDb()
  await db
    .update(telonexMarketConversions)
    .set({
      status: 'failed',
      lastError: args.error,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(telonexMarketConversions.marketId, args.marketId),
        eq(telonexMarketConversions.converter, args.converter),
      ),
    )
}

async function revertInProgress(converter: ConverterName): Promise<number> {
  const db = getDb()
  const res = await db
    .update(telonexMarketConversions)
    .set({ status: 'pending', startedAt: null })
    .where(
      and(
        eq(telonexMarketConversions.converter, converter),
        eq(telonexMarketConversions.status, 'in_progress'),
      ),
    )
  const affected = Array.isArray(res) ? (res[0] as { affectedRows?: number })?.affectedRows : 0
  return affected ?? 0
}

// ---------------------------------------------------------------------------
// Convert one market
// ---------------------------------------------------------------------------

async function downloadRawFiles(args: {
  marketSlug: string
  bucket: string
  rawFiles: Array<{ assetId: string; r2Key: string }>
  sideByAssetId: Map<string, Side>
  tmpDir: string
}): Promise<ConverterInput[]> {
  await fs.mkdir(args.tmpDir, { recursive: true })
  const inputs: ConverterInput[] = []
  for (const f of args.rawFiles) {
    const side = args.sideByAssetId.get(f.assetId)
    if (!side) {
      throw new Error(
        `unknown asset_id ${f.assetId} for slug ${args.marketSlug} (not recognized as Up or Down)`,
      )
    }
    const localTmp = path.join(args.tmpDir, path.basename(f.r2Key))
    await getObjectToFile(args.bucket, f.r2Key, localTmp)
    inputs.push({ filePath: localTmp, side })
  }
  // Stable order: by side then path. Determinism for the merge.
  inputs.sort((a, b) =>
    a.side !== b.side ? (a.side === 'up' ? -1 : 1) : a.filePath.localeCompare(b.filePath),
  )
  return inputs
}

function buildSideByAssetId(
  market: Pick<ClaimedMarket, 'assetId0' | 'assetId1' | 'outcome0' | 'outcome1' | 'slug'>,
): Map<string, Side> {
  const out = new Map<string, Side>()
  const pairs = [
    { assetId: market.assetId0, outcome: market.outcome0 },
    { assetId: market.assetId1, outcome: market.outcome1 },
  ]
  for (const pair of pairs) {
    const normalized = pair.outcome?.trim().toLowerCase()
    if (normalized === 'up') out.set(pair.assetId, 'up')
    else if (normalized === 'down') out.set(pair.assetId, 'down')
  }
  if (!Array.from(out.values()).includes('up') || !Array.from(out.values()).includes('down')) {
    throw new Error(
      `cannot resolve Up/Down asset ids for slug ${market.slug}: outcome_0=${market.outcome0 ?? 'null'} outcome_1=${market.outcome1 ?? 'null'}`,
    )
  }
  return out
}

async function convertOneMarket(args: {
  workerId: number
  market: ClaimedMarket
  bucket: string
  converterName: ConverterName
  converter: ConverterFn
  output: OutputMode
  signal: AbortSignal
}): Promise<{ rowsWritten: number }> {
  const { market, bucket, converterName, converter, output } = args
  const rawFiles = await getRawFiles(market.slug)
  if (rawFiles.length === 0) {
    throw new Error(`no raw files in DB for slug ${market.slug}`)
  }

  const tmpDir = path.join(
    os.tmpdir(),
    `telonex-convert-${process.pid}-${args.workerId}-${market.id}`,
  )

  let outputPath: string
  let keepOutput: boolean
  const localPath = localOutputPath({
    converter: converterName,
    symbol: market.symbol,
    timeframe: market.timeframe,
    slug: market.slug,
  })
  if (output === 'local' || output === 'both') {
    outputPath = localPath
    keepOutput = true
  } else {
    outputPath = path.join(tmpDir, `${market.slug}.parquet`)
    keepOutput = false
  }

  try {
    const inputs = await downloadRawFiles({
      marketSlug: market.slug,
      bucket,
      rawFiles,
      sideByAssetId: buildSideByAssetId(market),
      tmpDir,
    })

    if (args.signal.aborted) throw new Error('aborted')

    const stats = await converter(inputs, outputPath)

    if (args.signal.aborted) throw new Error('aborted')

    let r2Url: string | null = null
    let r2Etag: string | null = null
    let sizeBytes = 0
    const stat = await fs.stat(outputPath)
    sizeBytes = stat.size

    if (output === 'r2' || output === 'both') {
      const r2Key = r2OutputKey({
        converter: converterName,
        symbol: market.symbol,
        timeframe: market.timeframe,
        epoch: market.epoch,
        slug: market.slug,
      })
      const body = await fs.readFile(outputPath)
      const md5B64 = crypto.createHash('md5').update(body).digest('base64')
      const { etag } = await putObject(bucket, r2Key, body, { contentMD5: md5B64 })
      r2Url = `r2://${bucket}/${r2Key}`
      r2Etag = etag ?? null
    }

    await recordConversionSuccess({
      marketId: market.id,
      converter: converterName,
      r2Url,
      localPath: keepOutput ? localPath : null,
      sizeBytes,
      etag: r2Etag,
    })

    return { rowsWritten: stats.rowsWritten }
  } finally {
    // Cleanup: always remove tmp dir; the output file only gets removed when
    // keepOutput=false AND it lives inside tmpDir (which is the case when
    // output==='r2').
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Worker pool + main
// ---------------------------------------------------------------------------

type SharedState = {
  signal: AbortSignal
  reserved: { count: number }
  claimed: { count: number }
  completed: { count: number }
  totalQueue: number
  runStart: number
}

function reserveLimitSlot(limit: number | null, reserved: { count: number }): boolean {
  if (!limit) return true
  if (limit && reserved.count >= limit) return false
  reserved.count += 1
  return true
}

async function worker(
  workerId: number,
  args: {
    converterName: ConverterName
    converter: ConverterFn
    output: OutputMode
    bucket: string
    limit: number | null
  },
  state: SharedState,
): Promise<void> {
  while (!state.signal.aborted) {
    if (!reserveLimitSlot(args.limit, state.reserved)) return
    const market = await claimMarket(args.converterName)
    if (!market) return
    state.claimed.count++
    const t0 = Date.now()
    try {
      const { rowsWritten } = await convertOneMarket({
        workerId,
        market,
        bucket: args.bucket,
        converterName: args.converterName,
        converter: args.converter,
        output: args.output,
        signal: state.signal,
      })
      state.completed.count++
      const elapsedRun = (Date.now() - state.runStart) / 1000
      const rate = state.completed.count / Math.max(elapsedRun, 0.001)
      const remaining = Math.max(state.totalQueue - state.completed.count, 0)
      const eta = fmtEta(remaining / rate)
      console.log(
        `[telonex:convert] w${workerId} ${market.slug} done rows=${rowsWritten} elapsed=${fmtMs(Date.now() - t0)} ` +
          `[${state.completed.count}/${state.totalQueue} rate=${rate.toFixed(2)}/s eta=${eta}]`,
      )
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      console.error(`[telonex:convert] w${workerId} ${market.slug} FAIL: ${msg}`)
      await recordConversionFailure({
        marketId: market.id,
        converter: args.converterName,
        error: msg,
      }).catch(() => {})
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()
  const converter = getConverter(args.converter, { bookInterval: args.bookInterval })
  console.log(
    `[telonex:convert] converter=${args.converter} output=${args.output} concurrency=${args.concurrency} limit=${args.limit ?? 'none'} bucket=${bucket}`,
  )

  const ac = new AbortController()
  let shuttingDown = false
  const onSignal = (sig: string) => {
    if (shuttingDown) {
      console.log(`[telonex:convert] second ${sig}, hard exit`)
      process.exit(1)
    }
    shuttingDown = true
    console.log(`[telonex:convert] ${sig} received, draining (Ctrl+C again to force)...`)
    ac.abort()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  // Count eligible markets
  const db = getDb()
  const totals = await db
    .select({ c: sql<number>`count(*)` })
    .from(telonexMarkets)
    .leftJoin(
      telonexMarketConversions,
      and(
        eq(telonexMarketConversions.marketId, telonexMarkets.id),
        eq(telonexMarketConversions.converter, args.converter),
      ),
    )
    .where(
      and(
        eq(telonexMarkets.uploadStatus, 'done'),
        or(
          isNull(telonexMarketConversions.id),
          inArray(telonexMarketConversions.status, ['pending', 'failed']),
        ),
      ),
    )
  const queueTotal = Number(totals[0]?.c ?? 0)
  const totalQueue = args.limit ? Math.min(args.limit, queueTotal) : queueTotal
  console.log(`[telonex:convert] queue size=${totalQueue} (capped by --limit)`)

  const reserved = { count: 0 }
  const claimed = { count: 0 }
  const completed = { count: 0 }
  const t0 = Date.now()
  try {
    const workers = Array.from({ length: args.concurrency }, (_, i) =>
      worker(
        i + 1,
        {
          converterName: args.converter,
          converter,
          output: args.output,
          bucket,
          limit: args.limit,
        },
        { signal: ac.signal, reserved, claimed, completed, totalQueue, runStart: t0 },
      ),
    )
    await Promise.all(workers)
  } finally {
    const reverted = await revertInProgress(args.converter)
    if (reverted > 0) {
      console.log(`[telonex:convert] reverted ${reverted} 'in_progress' conversion(s) to 'pending'`)
    }
    console.log(
      `[telonex:convert] done markets_processed=${claimed.count} elapsed=${fmtMs(Date.now() - t0)}`,
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
