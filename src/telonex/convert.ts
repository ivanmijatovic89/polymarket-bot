#!/usr/bin/env tsx
/**
 * Telonex Step 2 — Convert raw R2 parquets to backtest-ready parquets.
 *
 * For each market whose upload_status='done' and that has not yet been
 * converted for all requested converters, this dispatcher:
 *   - reads the market's telonex_market_files rows (raw uploads)
 *   - downloads each raw parquet from R2 to a per-worker temp directory once
 *   - resolves Up/Down side from telonex_markets.outcome_0/outcome_1
 *   - calls each requested converter function (paired, delta) with explicit sides
 *   - depending on --output: keeps locally, uploads to R2, or both
 *   - writes a telonex_market_conversions row per converter recording status / paths / etag
 *
 * Usage:
 *   npm run telonex:convert -- [--converter paired] [--converter delta] [--output local|r2|both]
 *                              [--concurrency N] [--limit N] [--book-interval N]
 *
 * --converter can be repeated to run multiple converters per market in a single pass,
 * downloading raw files only once. Defaults to paired if omitted.
 *
 * See docs/telonex-sync-design.md.
 */

import '../config/env.js'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { and, eq, inArray, sql } from 'drizzle-orm'
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
  converters: ConverterName[]
  output: OutputMode
  concurrency: number
  limit: number | null
  bookInterval: number | null
  slugFilter: string[] | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    converters: [],
    output: 'r2',
    concurrency: 4,
    limit: null,
    bookInterval: null,
    slugFilter: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--converter') {
      const v = argv[++i]
      if (v !== 'paired' && v !== 'delta') {
        throw new Error(`[telonex:convert] --converter must be paired|delta, got ${v}`)
      }
      if (!out.converters.includes(v)) out.converters.push(v)
    } else if (a === '--output') {
      const v = argv[++i]
      if (v !== 'local' && v !== 'r2' && v !== 'both') {
        throw new Error(`[telonex:convert] --output must be local|r2|both, got ${v}`)
      }
      out.output = v
    } else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '4'))
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null
    else if (a === '--book-interval') out.bookInterval = Number(argv[++i] ?? '0') || null
    else if (a === '--slug')
      out.slugFilter = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else throw new Error(`[telonex:convert] unknown arg: ${a}`)
  }
  if (out.converters.length === 0) out.converters = ['paired']
  return out
}

function fmtMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)}MB`
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

function buildConverterFns(
  names: ConverterName[],
  opts: { bookInterval: number | null },
): Map<ConverterName, ConverterFn> {
  const out = new Map<ConverterName, ConverterFn>()
  for (const name of names) {
    if (name === 'paired') {
      out.set('paired', convertPaired)
    } else {
      out.set(
        'delta',
        createDeltaConverter({
          ...(opts.bookInterval != null ? { bookInterval: opts.bookInterval } : {}),
        }),
      )
    }
  }
  return out
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
  convertersToProcess: ConverterName[]
}

// Safe: converter values are validated to 'paired' | 'delta' before reaching here.
function converterInSql(converters: ConverterName[]): string {
  return converters.map((c) => `'${c}'`).join(', ')
}

function outputDoneConditionSql(output: OutputMode): ReturnType<typeof sql> {
  if (output === 'local') return sql`c.local_path IS NOT NULL`
  if (output === 'r2') return sql`c.r2_url IS NOT NULL`
  return sql`c.local_path IS NOT NULL AND c.r2_url IS NOT NULL`
}

// Excludes markets where any requested converter is currently being processed by
// another worker. Combined with FOR UPDATE SKIP LOCKED this prevents double-claiming.
function noInProgressConditionSql(converters: ConverterName[]): ReturnType<typeof sql> {
  return sql`NOT EXISTS (SELECT 1 FROM telonex_market_conversions c2 WHERE c2.market_id = ${telonexMarkets.id} AND c2.converter IN (${sql.raw(converterInSql(converters))}) AND c2.status = 'in_progress')`
}

function rowNeedsWork(
  row: { status: string | null; localPath: string | null; r2Url: string | null } | undefined,
  output: OutputMode,
): boolean {
  if (!row) return true
  if (row.status === 'pending' || row.status === 'failed') return true
  if (row.status === 'done') {
    if (output === 'local') return row.localPath == null
    if (output === 'r2') return row.r2Url == null
    return row.localPath == null || row.r2Url == null
  }
  return false
}

async function claimMarket(
  converters: ConverterName[],
  output: OutputMode,
  slugFilter: string[] | null = null,
): Promise<ClaimedMarket | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    // Find a market where at least one requested converter is not fully done.
    const rows = await tx
      .select({
        id: telonexMarkets.id,
        slug: telonexMarkets.slug,
        assetId0: telonexMarkets.assetId0,
        assetId1: telonexMarkets.assetId1,
        outcome0: telonexMarkets.outcome0,
        outcome1: telonexMarkets.outcome1,
      })
      .from(telonexMarkets)
      .where(
        and(
          eq(telonexMarkets.uploadStatus, 'done'),
          sql`(SELECT COUNT(*) FROM telonex_market_conversions c WHERE c.market_id = ${telonexMarkets.id} AND c.converter IN (${sql.raw(converterInSql(converters))}) AND c.status = 'done' AND ${outputDoneConditionSql(output)}) < ${converters.length}`,
          noInProgressConditionSql(converters),
          slugFilter && slugFilter.length > 0
            ? sql`${telonexMarkets.slug} IN (${sql.raw(slugFilter.map((s) => `'${s}'`).join(','))})`
            : undefined,
        ),
      )
      .limit(1)
      .for('update', { skipLocked: true })

    const row = rows[0]
    if (!row) return null

    const parts = parseSlug(row.slug)
    if (!parts || !row.assetId0 || !row.assetId1) {
      for (const conv of converters) {
        await tx
          .insert(telonexMarketConversions)
          .values({
            marketId: row.id,
            converter: conv,
            status: 'failed',
            lastError: 'slug parse failed or missing asset ids',
          })
          .onDuplicateKeyUpdate({
            set: { status: 'failed', lastError: 'slug parse failed or missing asset ids' },
          })
      }
      return null
    }

    // Determine which converters still need work for this market.
    const existingRows = await tx
      .select({
        converter: telonexMarketConversions.converter,
        status: telonexMarketConversions.status,
        localPath: telonexMarketConversions.localPath,
        r2Url: telonexMarketConversions.r2Url,
      })
      .from(telonexMarketConversions)
      .where(
        and(
          eq(telonexMarketConversions.marketId, row.id),
          inArray(telonexMarketConversions.converter, converters as string[]),
        ),
      )

    const existingMap = new Map(existingRows.map((r) => [r.converter, r]))
    const convertersToProcess = converters.filter((conv) =>
      rowNeedsWork(existingMap.get(conv), output),
    )

    // Claim: upsert only the converters that actually need work.
    for (const conv of convertersToProcess) {
      await tx
        .insert(telonexMarketConversions)
        .values({
          marketId: row.id,
          converter: conv,
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
    }

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
      convertersToProcess,
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
      ...(args.r2Url ? { r2Url: args.r2Url } : {}),
      ...(args.localPath ? { localPath: args.localPath } : {}),
      sizeBytes: args.sizeBytes,
      ...(args.etag ? { etag: args.etag } : {}),
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

async function revertInProgress(converters: ConverterName[]): Promise<number> {
  const db = getDb()
  const res = await db
    .update(telonexMarketConversions)
    .set({ status: 'pending', startedAt: null })
    .where(
      and(
        inArray(telonexMarketConversions.converter, converters as string[]),
        eq(telonexMarketConversions.status, 'in_progress'),
      ),
    )
  const affected = Array.isArray(res) ? (res[0] as { affectedRows?: number })?.affectedRows : 0
  return affected ?? 0
}

// ---------------------------------------------------------------------------
// Convert one market (all requested converters, one download)
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

type ConverterResult = { rowsWritten: number; sizeBytes: number }

// Returns ConverterResult per converter, or an Error if that converter failed.
async function convertOneMarket(args: {
  workerId: number
  market: ClaimedMarket
  bucket: string
  converterFns: Map<ConverterName, ConverterFn>
  output: OutputMode
  signal: AbortSignal
}): Promise<Map<ConverterName, ConverterResult | Error>> {
  const { market, bucket, output } = args
  const results = new Map<ConverterName, ConverterResult | Error>()

  const rawFiles = await getRawFiles(market.slug)
  if (rawFiles.length === 0) {
    throw new Error(`no raw files in DB for slug ${market.slug}`)
  }

  const tmpDir = path.join(
    os.tmpdir(),
    `telonex-convert-${process.pid}-${args.workerId}-${market.id}`,
  )

  try {
    // Download raw files once, shared across all converters.
    const inputs = await downloadRawFiles({
      marketSlug: market.slug,
      bucket,
      rawFiles,
      sideByAssetId: buildSideByAssetId(market),
      tmpDir,
    })

    for (const converterName of market.convertersToProcess) {
      if (args.signal.aborted) break

      const converter = args.converterFns.get(converterName)!
      const localPath = localOutputPath({
        converter: converterName,
        symbol: market.symbol,
        timeframe: market.timeframe,
        slug: market.slug,
      })

      let outputPath: string
      let keepOutput: boolean
      if (output === 'local' || output === 'both') {
        outputPath = localPath
        keepOutput = true
      } else {
        outputPath = path.join(tmpDir, `${market.slug}-${converterName}.parquet`)
        keepOutput = false
      }

      try {
        const stats = await converter(inputs, outputPath)

        let r2Url: string | null = null
        let r2Etag: string | null = null
        const stat = await fs.stat(outputPath)
        const sizeBytes = stat.size

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

        results.set(converterName, { rowsWritten: stats.rowsWritten, sizeBytes })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        await recordConversionFailure({
          marketId: market.id,
          converter: converterName,
          error: error.message,
        }).catch(() => {})
        results.set(converterName, error)
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  return results
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
    converters: ConverterName[]
    converterFns: Map<ConverterName, ConverterFn>
    output: OutputMode
    bucket: string
    limit: number | null
    slugFilter: string[] | null
  },
  state: SharedState,
): Promise<void> {
  while (!state.signal.aborted) {
    if (!reserveLimitSlot(args.limit, state.reserved)) return
    const market = await claimMarket(args.converters, args.output, args.slugFilter)
    if (!market) return
    if (market.convertersToProcess.length === 0) continue
    state.claimed.count++
    const t0 = Date.now()
    try {
      const results = await convertOneMarket({
        workerId,
        market,
        bucket: args.bucket,
        converterFns: args.converterFns,
        output: args.output,
        signal: state.signal,
      })

      state.completed.count++
      const elapsedRun = (Date.now() - state.runStart) / 1000
      const rate = state.completed.count / Math.max(elapsedRun, 0.001)
      const remaining = Math.max(state.totalQueue - state.completed.count, 0)
      const eta = fmtEta(remaining / rate)

      for (const [convName, result] of results) {
        if (result instanceof Error) {
          console.error(
            `[telonex:convert] w${workerId} ${market.slug} [${convName}] FAIL: ${result.message}`,
          )
        } else {
          console.log(
            `[telonex:convert] w${workerId} ${market.slug} [${convName}] rows=${result.rowsWritten} ${fmtMb(result.sizeBytes)} ${fmtMs(Date.now() - t0)} ` +
              `[${state.completed.count}/${state.totalQueue} rate=${rate.toFixed(2)}/s eta=${eta}]`,
          )
        }
      }
    } catch (err) {
      // Catastrophic failure (e.g. download failed before any converter ran).
      const msg = (err as Error).message ?? String(err)
      console.error(`[telonex:convert] w${workerId} ${market.slug} FAIL: ${msg}`)
      for (const conv of market.convertersToProcess) {
        await recordConversionFailure({
          marketId: market.id,
          converter: conv,
          error: msg,
        }).catch(() => {})
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()
  const converterFns = buildConverterFns(args.converters, { bookInterval: args.bookInterval })
  console.log(
    `[telonex:convert] converters=${args.converters.join(',')} output=${args.output} concurrency=${args.concurrency} limit=${args.limit ?? 'none'} slugFilter=${args.slugFilter ? `[${args.slugFilter.length} slugs]` : 'none'} bucket=${bucket}`,
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

  // Count eligible markets (unique markets, not market×converter pairs).
  const db = getDb()
  const totals = await db
    .select({ c: sql<number>`count(*)` })
    .from(telonexMarkets)
    .where(
      and(
        eq(telonexMarkets.uploadStatus, 'done'),
        sql`(SELECT COUNT(*) FROM telonex_market_conversions c WHERE c.market_id = ${telonexMarkets.id} AND c.converter IN (${sql.raw(converterInSql(args.converters))}) AND c.status = 'done' AND ${outputDoneConditionSql(args.output)}) < ${args.converters.length}`,
        noInProgressConditionSql(args.converters),
        args.slugFilter && args.slugFilter.length > 0
          ? sql`${telonexMarkets.slug} IN (${sql.raw(args.slugFilter.map((s) => `'${s}'`).join(','))})`
          : undefined,
      ),
    )
  const queueTotal = Number(totals[0]?.c ?? 0)
  const totalQueue = args.limit ? Math.min(args.limit, queueTotal) : queueTotal
  const totalFiles = totalQueue * args.converters.length
  const filesLabel =
    args.converters.length > 1
      ? ` · ${totalFiles} files (${args.converters.length} converters × ${totalQueue})`
      : ''
  console.log(`[telonex:convert] queue=${totalQueue} markets${filesLabel}`)

  const reserved = { count: 0 }
  const claimed = { count: 0 }
  const completed = { count: 0 }
  const t0 = Date.now()
  try {
    const workers = Array.from({ length: args.concurrency }, (_, i) =>
      worker(
        i + 1,
        {
          converters: args.converters,
          converterFns,
          output: args.output,
          bucket,
          limit: args.limit,
          slugFilter: args.slugFilter,
        },
        { signal: ac.signal, reserved, claimed, completed, totalQueue, runStart: t0 },
      ),
    )
    await Promise.all(workers)
  } finally {
    const reverted = await revertInProgress(args.converters)
    if (reverted > 0) {
      console.log(`[telonex:convert] reverted ${reverted} 'in_progress' conversion(s) to 'pending'`)
    }
    console.log(`[telonex:convert] done markets=${claimed.count} elapsed=${fmtMs(Date.now() - t0)}`)
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
