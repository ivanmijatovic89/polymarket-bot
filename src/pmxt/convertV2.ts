#!/usr/bin/env tsx
/**
 * Converts a PMXT v2 hourly Parquet file into our native format.
 *
 * Differences from v1:
 *   - typed columns instead of a single `data` JSON blob
 *   - `market` is a BLOB containing the ASCII hex string (0x…)
 *   - 4 event types captured (book, price_change, last_trade_price, tick_size_change)
 *   - `timestamp_received` and `timestamp` (exchange) are separate, so we can populate
 *     `ts_local_ms` and `ts_exchange_ms` with realistic values
 *
 * Usage:
 *   npx tsx src/pmxt/convertV2.ts --file <path> [--symbol btc] [--window 15] [--out <dir>]
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
import {
  parseHourFromFilename,
  type ConvertPmxtFileResult,
  type SkippedWindow,
  type WindowMeta,
  type WindowQuality,
} from './convert.js'

const DEFAULT_BOTH_WARM_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowsForHour(hourDate: Date, winMinutes: number): Date[] {
  const windowMs = winMinutes * 60 * 1000
  const count = 60 / winMinutes
  return Array.from({ length: count }, (_, i) => new Date(hourDate.getTime() + i * windowMs))
}

type Decimal = { value: bigint | string; scale: number } | null | undefined

function decToString(d: Decimal): string {
  if (d == null) return ''
  const { value, scale } = d
  const str = typeof value === 'bigint' ? value.toString() : value
  const neg = str.startsWith('-')
  const abs = neg ? str.slice(1) : str
  if (scale === 0) return (neg ? '-' : '') + abs
  const padded = abs.padStart(scale + 1, '0')
  const intPart = padded.slice(0, -scale)
  const fracPart = padded.slice(-scale).replace(/0+$/, '')
  const out = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart
  return (neg ? '-' : '') + out
}

type V2Row = {
  ts_local_ms: number
  ts_exchange_ms: number
  market: string
  event_type: string
  asset_id: string
  bids: string | null
  asks: string | null
  price: Decimal
  size: Decimal
  side: string | null
  best_bid: Decimal
  best_ask: Decimal
  fee_rate_bps: number | null
  transaction_hash: string | null
  old_tick_size: Decimal
  new_tick_size: Decimal
}

function transformRow(row: V2Row): { raw_json: string; event_type: string } | null {
  const tsStr = String(row.ts_exchange_ms)

  switch (row.event_type) {
    case 'book': {
      const parseSide = (s: string | null): { price: string; size: string }[] => {
        if (!s) return []
        const arr = JSON.parse(s) as [string, string][]
        return arr.map(([price, size]) => ({ price, size }))
      }
      const raw = {
        event_type: 'book',
        asset_id: row.asset_id,
        market: row.market,
        timestamp: tsStr,
        bids: parseSide(row.bids),
        asks: parseSide(row.asks),
      }
      return { raw_json: JSON.stringify(raw), event_type: 'book' }
    }

    case 'price_change': {
      const raw = {
        event_type: 'price_change',
        market: row.market,
        timestamp: tsStr,
        price_changes: [
          {
            asset_id: row.asset_id,
            price: decToString(row.price),
            size: decToString(row.size),
            side: row.side ?? '',
            best_bid: decToString(row.best_bid),
            best_ask: decToString(row.best_ask),
          },
        ],
      }
      return { raw_json: JSON.stringify(raw), event_type: 'price_change' }
    }

    case 'last_trade_price': {
      const raw = {
        event_type: 'last_trade_price',
        asset_id: row.asset_id,
        market: row.market,
        price: decToString(row.price),
        side: row.side ?? '',
        size: decToString(row.size),
        fee_rate_bps: String(row.fee_rate_bps ?? 0),
        timestamp: tsStr,
        transaction_hash: row.transaction_hash ?? '',
      }
      return { raw_json: JSON.stringify(raw), event_type: 'last_trade_price' }
    }

    case 'tick_size_change': {
      const raw = {
        event_type: 'tick_size_change',
        asset_id: row.asset_id,
        market: row.market,
        old_tick_size: decToString(row.old_tick_size),
        new_tick_size: decToString(row.new_tick_size),
        timestamp: tsStr,
      }
      return { raw_json: JSON.stringify(raw), event_type: 'tick_size_change' }
    }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Core conversion function (importable)
// ---------------------------------------------------------------------------

export async function convertPmxtFileV2(
  filePath: string,
  symbol: string,
  windowMinutes: number,
  outDir: string,
  log = console.log,
  bothWarmTimeoutMs: number = DEFAULT_BOTH_WARM_TIMEOUT_MS,
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

  log(`\nReading PMXT v2 parquet (DuckDB)...`)

  const duckDb = await DuckDBInstance.create(':memory:')
  const conn = await duckDb.connect()

  const conditionList = windowMetas.map((w) => `'${w.conditionId}'`).join(', ')
  const sql = `
    SELECT
      epoch_ms(timestamp_received) AS ts_local_ms,
      epoch_ms(timestamp) AS ts_exchange_ms,
      CAST(market AS VARCHAR) AS market,
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
    FROM read_parquet('${filePath}')
    WHERE CAST(market AS VARCHAR) IN (${conditionList})
    ORDER BY timestamp
  `

  const result = await conn.run(sql)

  const buckets = new Map<string, V2Row[]>()
  for (const w of windowMetas) buckets.set(w.conditionId, [])

  let totalRows = 0
  for (let c = 0; c < result.chunkCount; c++) {
    const chunk = result.getChunk(c)
    const rows = chunk.getRows()
    for (const row of rows) {
      const market = row[2] as string
      const bucket = buckets.get(market)
      if (!bucket) continue
      bucket.push({
        ts_local_ms: Number(row[0]),
        ts_exchange_ms: Number(row[1]),
        market,
        event_type: row[3] as string,
        asset_id: row[4] as string,
        bids: row[5] as string | null,
        asks: row[6] as string | null,
        price: row[7] as Decimal,
        size: row[8] as Decimal,
        side: row[9] as string | null,
        best_bid: row[10] as Decimal,
        best_ask: row[11] as Decimal,
        fee_rate_bps: row[12] as number | null,
        transaction_hash: row[13] as string | null,
        old_tick_size: row[14] as Decimal,
        new_tick_size: row[15] as Decimal,
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

    const windowRows = rows.filter(
      (r) => r.ts_exchange_ms >= windowStartMs && r.ts_exchange_ms < windowEndMs,
    )

    const firstRow = windowRows[0]
    const firstEventMs = firstRow !== undefined ? firstRow.ts_exchange_ms : null
    const firstBookByAsset = new Map<string, number>()

    for (const r of windowRows) {
      if (r.event_type !== 'book') continue
      if (!firstBookByAsset.has(r.asset_id)) {
        firstBookByAsset.set(r.asset_id, r.ts_exchange_ms)
      }
    }

    const bothWarmMs = firstBookByAsset.size >= 2 ? Math.max(...firstBookByAsset.values()) : null

    const secsToFirstEvent = firstEventMs !== null ? (firstEventMs - windowStartMs) / 1000 : null
    const secsToBothWarm = bothWarmMs !== null ? (bothWarmMs - windowStartMs) / 1000 : null

    if (bothWarmMs === null || bothWarmMs - windowStartMs > bothWarmTimeoutMs) {
      const reason =
        windowRows.length === 0
          ? '0 rows matched conditionId in PMXT file'
          : bothWarmMs === null
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

    for (const r of windowRows) {
      const transformed = transformRow(r)
      if (!transformed) continue

      await writer.appendRow({
        ingest_seq: seq++,
        ts_local_ms: BigInt(r.ts_local_ms),
        ts_exchange_ms: BigInt(r.ts_exchange_ms),
        event_type: transformed.event_type,
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
  const bothWarmTimeoutMs = parseInt(get('--max-warm-secs') ?? '15', 10) * 1000

  if (!filePath) {
    console.error(
      'Usage: npx tsx src/pmxt/convertV2.ts --file <path> [--symbol btc] [--window 15] [--out <dir>]',
    )
    process.exit(1)
  }

  console.log(`File  : ${filePath}`)
  console.log(`Hour  : ${parseHourFromFilename(filePath).toISOString()}`)
  console.log(`Symbol: ${symbol}  window: ${windowMinutes}m  (v2)`)
  console.log(`Out   : ${outDir}`)
  console.log()

  const result = await convertPmxtFileV2(
    filePath,
    symbol,
    windowMinutes,
    outDir,
    console.log,
    bothWarmTimeoutMs,
  )
  console.log(`\nDone. ${result.windowsWritten} windows written.`)
}
