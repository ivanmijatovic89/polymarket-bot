#!/usr/bin/env tsx
/**
 * Converts a PMXT v1 hourly Parquet file into our native format.
 *
 * For each 15m (or Nm) window in the hour it:
 *   1. Resolves the window slug via Gamma API → conditionId + token IDs
 *   2. Filters rows for that market from the PMXT file (via DuckDB)
 *   3. Transforms PMXT row format → Polymarket WS raw_json
 *   4. Writes one output .parquet per window (rawMarketEventParquetSchema)
 *
 * Usage:
 *   npx tsx src/pmxt/convert.ts --file <path> [--symbol btc] [--window 15] [--out <dir>]
 */

import { DuckDBInstance } from '@duckdb/node-api'
import * as parquet from '@dsnp/parquetjs'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

import { fetchGammaMarketBySlug } from '../polymarket/gamma.js'
import { buildGammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import { rawMarketEventParquetSchema } from '../parquet/io/eventSchema.js'
import { buildUpDown15mSlug } from '../utils/timeWindows.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PmxtRow = {
  timestamp_received: Date | bigint | number
  timestamp_created_at: Date | bigint | number
  market_id: string
  update_type: string
  data: string
}

type WindowMeta = {
  windowStart: Date
  slug: string
  conditionId: string
  tokenIds: string[]
}

const BOTH_WARM_TIMEOUT_MS = 15_000

export type WindowQuality = {
  slug: string
  secsToFirstEvent: number | null
  secsToBothWarm: number | null
}

export type SkippedWindow = WindowQuality & { reason: string }

export type ConvertPmxtFileResult = {
  slugs: string[]
  windowsWritten: number
  writtenWindows: WindowQuality[]
  skippedWindows: SkippedWindow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseHourFromFilename(fp: string): Date {
  const base = path.basename(fp, '.parquet')
  const m = base.match(/(\d{4}-\d{2}-\d{2}T\d{2})$/)
  if (!m) throw new Error(`Cannot parse hour from filename: ${base}`)
  return new Date(`${m[1]}:00:00Z`)
}

function windowsForHour(hourDate: Date, winMinutes: number): Date[] {
  const windowMs = winMinutes * 60 * 1000
  const count = 60 / winMinutes
  return Array.from({ length: count }, (_, i) => new Date(hourDate.getTime() + i * windowMs))
}

function pmxtTsToMs(ts: Date | bigint | number): number {
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'bigint') return Number(ts)
  return ts
}

function transformRow(row: PmxtRow): { raw_json: string; ts_exchange_ms: bigint } | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(row.data) as Record<string, unknown>
  } catch {
    return null
  }

  // PMXT timestamp is Unix seconds (float) → convert to ms integer
  const pmxtTsSec = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0
  const tsMs = Math.trunc(pmxtTsSec * 1000)

  if (row.update_type === 'book_snapshot') {
    const bids = ((parsed.bids as [string, string][]) ?? []).map(([price, size]) => ({
      price,
      size,
    }))
    const asks = ((parsed.asks as [string, string][]) ?? []).map(([price, size]) => ({
      price,
      size,
    }))
    const raw_json = JSON.stringify({
      event_type: 'book',
      asset_id: parsed.token_id,
      market: parsed.market_id,
      timestamp: tsMs,
      bids,
      asks,
    })
    return { raw_json, ts_exchange_ms: BigInt(tsMs) }
  }

  if (row.update_type === 'price_change') {
    const raw_json = JSON.stringify({
      event_type: 'price_change',
      market: parsed.market_id,
      timestamp: tsMs,
      price_changes: [
        {
          asset_id: parsed.token_id,
          price: parsed.change_price,
          size: parsed.change_size,
          side: parsed.change_side,
          best_bid: parsed.best_bid,
          best_ask: parsed.best_ask,
        },
      ],
    })
    return { raw_json, ts_exchange_ms: BigInt(tsMs) }
  }

  return null
}

// ---------------------------------------------------------------------------
// Core conversion function (importable)
// ---------------------------------------------------------------------------

export async function convertPmxtFile(
  filePath: string,
  symbol: string,
  windowMinutes: number,
  outDir: string,
  log = console.log,
): Promise<ConvertPmxtFileResult> {
  const hourDate = parseHourFromFilename(filePath)
  const windows = windowsForHour(hourDate, windowMinutes)
  const windowMs = windowMinutes * 60 * 1000

  // 1. Resolve slugs via Gamma ----------------------------------------------

  log('Resolving slugs via Gamma...')
  const windowMetas: WindowMeta[] = []

  for (const windowStart of windows) {
    const slug = buildUpDown15mSlug(symbol, windowStart)
    const raw = await fetchGammaMarketBySlug({ slug })
    if (!raw) {
      log(`  [skip] ${slug} — not found on Gamma`)
      continue
    }
    const meta = buildGammaMarketMeta(raw, slug)
    if (!meta || !raw.conditionId) {
      log(`  [skip] ${slug} — incomplete Gamma response`)
      continue
    }
    log(`  ✓ ${slug}  conditionId=${raw.conditionId as string}`)
    windowMetas.push({
      windowStart,
      slug,
      conditionId: raw.conditionId as string,
      tokenIds: meta.clobTokenIds,
    })
  }

  if (windowMetas.length === 0) {
    throw new Error('No windows resolved — nothing to write.')
  }

  // 2. Read filtered rows via DuckDB ----------------------------------------

  log(`\nReading PMXT parquet (DuckDB)...`)

  const duckDb = await DuckDBInstance.create(':memory:')
  const conn = await duckDb.connect()

  const conditionList = windowMetas.map((w) => `'${w.conditionId}'`).join(', ')
  const sql = `
    SELECT
      epoch_ms(timestamp_received) AS ts_received_ms,
      epoch_ms(timestamp_created_at) AS ts_created_ms,
      market_id,
      update_type,
      data
    FROM read_parquet('${filePath}')
    WHERE market_id IN (${conditionList})
    ORDER BY timestamp_created_at
  `

  const result = await conn.run(sql)

  const buckets = new Map<string, PmxtRow[]>()
  for (const w of windowMetas) buckets.set(w.conditionId, [])

  let totalRows = 0
  for (let c = 0; c < result.chunkCount; c++) {
    const chunk = result.getChunk(c)
    const rows = chunk.getRows()
    for (const row of rows) {
      const marketId = row[2] as string
      const bucket = buckets.get(marketId)
      if (!bucket) continue
      bucket.push({
        timestamp_received: row[0] as number,
        timestamp_created_at: row[1] as number,
        market_id: marketId,
        update_type: row[3] as string,
        data: row[4] as string,
      })
      totalRows++
    }
  }

  log(`  ${totalRows} rows loaded across ${windowMetas.length} markets`)

  // 3. Write output parquets ------------------------------------------------

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const writtenSlugs: string[] = []
  const writtenWindows: WindowQuality[] = []
  const skippedWindows: SkippedWindow[] = []

  for (const w of windowMetas) {
    const rows = buckets.get(w.conditionId) ?? []
    const windowStartMs = w.windowStart.getTime()
    const windowEndMs = windowStartMs + windowMs

    const windowRows = rows.filter((row) => {
      const tsMs = pmxtTsToMs(row.timestamp_created_at)
      return tsMs >= windowStartMs && tsMs < windowEndMs
    })

    // Check warm state: find first book per asset_id and when both tokens are warm
    const firstRow = windowRows[0]
    const firstEventMs = firstRow !== undefined ? pmxtTsToMs(firstRow.timestamp_created_at) : null
    const firstBookByAsset = new Map<string, number>()

    for (const row of windowRows) {
      if (row.update_type !== 'book_snapshot') continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        continue
      }
      const assetId = parsed.token_id as string
      if (!firstBookByAsset.has(assetId)) {
        firstBookByAsset.set(assetId, pmxtTsToMs(row.timestamp_created_at))
      }
    }

    const bothWarmMs = firstBookByAsset.size >= 2 ? Math.max(...firstBookByAsset.values()) : null

    const secsToFirstEvent = firstEventMs !== null ? (firstEventMs - windowStartMs) / 1000 : null
    const secsToBothWarm = bothWarmMs !== null ? (bothWarmMs - windowStartMs) / 1000 : null

    if (bothWarmMs === null || bothWarmMs - windowStartMs > BOTH_WARM_TIMEOUT_MS) {
      const reason =
        bothWarmMs === null
          ? 'no book for both tokens'
          : `both warm at +${secsToBothWarm?.toFixed(1)}s (> 15s threshold)`
      skippedWindows.push({ slug: w.slug, secsToFirstEvent, secsToBothWarm, reason })
      log(`  [skip] ${w.slug} — ${reason}`)
      continue
    }

    const outPath = path.join(outDir, `${w.slug}.parquet`)
    const writer = await parquet.ParquetWriter.openFile(rawMarketEventParquetSchema, outPath)

    let seq = 0n
    let written = 0

    for (const row of windowRows) {
      const transformed = transformRow(row)
      if (!transformed) continue

      await writer.appendRow({
        ingest_seq: seq++,
        ts_local_ms: BigInt(pmxtTsToMs(row.timestamp_received)),
        ts_exchange_ms: transformed.ts_exchange_ms,
        event_type: row.update_type === 'book_snapshot' ? 'book' : 'price_change',
        raw_json: transformed.raw_json,
      })
      written++
    }

    await writer.close()
    log(`  → ${w.slug}.parquet  (${written} rows)`)
    writtenSlugs.push(w.slug)
    writtenWindows.push({ slug: w.slug, secsToFirstEvent, secsToBothWarm })
  }

  // 4. Verify ---------------------------------------------------------------

  log('\nVerifying output files...')

  for (const slug of writtenSlugs) {
    const outPath = path.join(outDir, `${slug}.parquet`)
    if (!existsSync(outPath)) throw new Error(`MISSING output: ${outPath}`)
    const reader = await parquet.ParquetReader.openFile(outPath)
    const meta = reader.metadata
    const rowCount = (meta?.row_groups ?? []).reduce(
      (s: number, g: { num_rows: unknown }) => s + Number(g.num_rows),
      0,
    )
    await reader.close()
    log(`  ✓ ${slug}.parquet  (${rowCount} rows)`)
  }

  return {
    slugs: writtenSlugs,
    windowsWritten: writtenSlugs.length,
    writtenWindows,
    skippedWindows,
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const filePath = get('--file')
  const symbol = get('--symbol') ?? 'btc'
  const windowMinutes = parseInt(get('--window') ?? '15', 10)
  const outDir = get('--out') ?? `data/events/${symbol}`

  if (!filePath) {
    console.error(
      'Usage: npx tsx src/pmxt/convert.ts --file <path> [--symbol btc] [--window 15] [--out <dir>]',
    )
    process.exit(1)
  }

  console.log(`File  : ${filePath}`)
  console.log(`Hour  : ${parseHourFromFilename(filePath).toISOString()}`)
  console.log(`Symbol: ${symbol}  window: ${windowMinutes}m`)
  console.log(`Out   : ${outDir}`)
  console.log()

  const result = await convertPmxtFile(filePath, symbol, windowMinutes, outDir)
  console.log(`\nDone. ${result.windowsWritten} windows written.`)
}
