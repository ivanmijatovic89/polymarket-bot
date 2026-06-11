#!/usr/bin/env tsx
/**
 * Telonex sync-markets: fetch the Telonex Polymarket markets catalogue and
 * upsert filtered rows into the telonex_markets table.
 *
 * The catalogue is fetched in a single GET (Bearer auth) and saved to a temp
 * parquet so DuckDB can apply the filter predicate locally. The temp file is
 * deleted on exit. DuckDB's httpfs extension issues many HTTP range requests
 * per query and hits the Telonex rate limit immediately, so reading the
 * catalogue remotely is not viable.
 *
 * See docs/datasets/telonex/sync-design.md for the full pipeline design.
 *
 * Usage:
 *   npm run telonex:sync -- [--slug-pattern '<like-pattern>'] [--limit N] [--dry-run]
 *
 * Default: slug-pattern='btc-updown-15m-%'
 */

import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import { getDb, closeDb, telonexMarkets } from '../db/index.js'

const CATALOG_URL = 'https://api.telonex.io/v1/datasets/polymarket/markets'

type Args = {
  slugPatterns: string[]
  limit: number | null
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  let slugPatterns = ['btc-updown-15m-%']
  const out: Args = {
    slugPatterns,
    limit: null,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--slug-pattern') {
      // Accept a comma-separated list so the ~660 MB catalogue is downloaded
      // once and all patterns are filtered in a single DuckDB query.
      const raw = argv[++i] ?? ''
      slugPatterns = raw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
      if (slugPatterns.length === 0) {
        throw new Error('[telonex:sync] --slug-pattern requires at least one pattern')
      }
      out.slugPatterns = slugPatterns
    } else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null
    else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`[telonex:sync] unknown arg: ${a}`)
  }
  return out
}

function readApiKey(): string {
  const k = process.env.TELONEX_API_KEY
  if (!k || k.trim() === '') {
    throw new Error('[telonex:sync] TELONEX_API_KEY is required')
  }
  return k.trim()
}

async function downloadCatalog(destPath: string, apiKey: string): Promise<number> {
  const res = await fetch(CATALOG_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`[telonex:sync] catalog fetch failed: HTTP ${res.status} ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error('[telonex:sync] catalog fetch returned empty body')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(destPath, buf)
  return buf.length
}

function emptyToNull(s: unknown): string | null {
  if (typeof s !== 'string') return null
  return s.trim() === '' ? null : s
}

function dateStringOrNull(s: unknown): Date | null {
  // We CAST(... AS VARCHAR) in DuckDB, so values arrive as 'YYYY-MM-DD' or ''.
  // MySQL DATE columns ignore time-of-day; pick UTC midnight so the calendar
  // day survives regardless of MySQL connection timezone.
  if (s == null) return null
  const str = typeof s === 'string' ? s : String(s)
  if (str.trim() === '') return null
  return new Date(`${str}T00:00:00Z`)
}

function bigintOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') return Number(v)
  return null
}

function stringArrayOrNull(v: unknown): string[] | null {
  if (v == null) return null
  if (Array.isArray(v)) return v.map((x) => String(x))
  return null
}

type CatalogRow = {
  exchange: string
  marketId: string
  slug: string
  // Derived from slug at sync time so eligibility queries don't parse the
  // suffix at runtime. Slug shape: `<symbol>-updown-<timeframe>-<epochSec>`.
  symbol: string
  timeframe: string
  marketStartMs: number
  eventId: string | null
  eventSlug: string | null
  eventTitle: string | null
  question: string | null
  description: string | null
  category: string | null
  tags: string[] | null
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  telonexStatus: string | null
  resultId: string | null
  settledAtUs: number | null
  preparedAtUs: number | null
  startDateUs: number | null
  endDateUs: number | null
  createdAtUs: number | null
  resolutionSource: string | null
  rulesUrl: string | null
  tradesFrom: Date | null
  tradesTo: Date | null
  quotesFrom: Date | null
  quotesTo: Date | null
  bookSnapshot5From: Date | null
  bookSnapshot5To: Date | null
  bookSnapshot25From: Date | null
  bookSnapshot25To: Date | null
  bookSnapshotFullFrom: Date | null
  bookSnapshotFullTo: Date | null
  onchainFillsFrom: Date | null
  onchainFillsTo: Date | null
}

// Column order in SELECT must match this index map.
const COLUMNS = [
  'exchange',
  'market_id',
  'slug',
  'event_id',
  'event_slug',
  'event_title',
  'question',
  'description',
  'category',
  'tags',
  'outcome_0',
  'outcome_1',
  'asset_id_0',
  'asset_id_1',
  'status',
  'result_id',
  'settled_at_us',
  'prepared_at_us',
  'start_date_us',
  'end_date_us',
  'created_at_us',
  'resolution_source',
  'rules_url',
  'trades_from',
  'trades_to',
  'quotes_from',
  'quotes_to',
  'book_snapshot_5_from',
  'book_snapshot_5_to',
  'book_snapshot_25_from',
  'book_snapshot_25_to',
  'book_snapshot_full_from',
  'book_snapshot_full_to',
  'onchain_fills_from',
  'onchain_fills_to',
] as const

// Slug shape `<symbol>-updown-<timeframe>-<epochSec>` is guaranteed by the
// Telonex catalog filter (slugPattern). Anything else is a Telonex schema
// regression and we want to fail loudly rather than silently insert garbage.
function deriveFromSlug(slug: string): {
  symbol: string
  timeframe: string
  marketStartMs: number
} {
  const parts = slug.split('-')
  if (parts.length < 4 || parts[1] !== 'updown') {
    throw new Error(`[telonex:sync] unexpected slug shape (no '-updown-' segment): ${slug}`)
  }
  const symbol = parts[0]!
  const timeframe = parts[2]!
  const epochSec = Number(parts[parts.length - 1])
  if (!Number.isSafeInteger(epochSec) || epochSec <= 0) {
    throw new Error(`[telonex:sync] slug suffix is not a positive epoch: ${slug}`)
  }
  return { symbol, timeframe, marketStartMs: epochSec * 1000 }
}

function rowToCatalog(row: readonly unknown[]): CatalogRow {
  const slug = String(row[2])
  const derived = deriveFromSlug(slug)
  return {
    exchange: String(row[0]),
    marketId: String(row[1]),
    slug,
    symbol: derived.symbol,
    timeframe: derived.timeframe,
    marketStartMs: derived.marketStartMs,
    eventId: emptyToNull(row[3]),
    eventSlug: emptyToNull(row[4]),
    eventTitle: emptyToNull(row[5]),
    question: emptyToNull(row[6]),
    description: emptyToNull(row[7]),
    category: emptyToNull(row[8]),
    tags: stringArrayOrNull(row[9]),
    outcome0: emptyToNull(row[10]),
    outcome1: emptyToNull(row[11]),
    assetId0: emptyToNull(row[12]),
    assetId1: emptyToNull(row[13]),
    telonexStatus: emptyToNull(row[14]),
    resultId: emptyToNull(row[15]),
    settledAtUs: bigintOrNull(row[16]),
    preparedAtUs: bigintOrNull(row[17]),
    startDateUs: bigintOrNull(row[18]),
    endDateUs: bigintOrNull(row[19]),
    createdAtUs: bigintOrNull(row[20]),
    resolutionSource: emptyToNull(row[21]),
    rulesUrl: emptyToNull(row[22]),
    tradesFrom: dateStringOrNull(row[23]),
    tradesTo: dateStringOrNull(row[24]),
    quotesFrom: dateStringOrNull(row[25]),
    quotesTo: dateStringOrNull(row[26]),
    bookSnapshot5From: dateStringOrNull(row[27]),
    bookSnapshot5To: dateStringOrNull(row[28]),
    bookSnapshot25From: dateStringOrNull(row[29]),
    bookSnapshot25To: dateStringOrNull(row[30]),
    bookSnapshotFullFrom: dateStringOrNull(row[31]),
    bookSnapshotFullTo: dateStringOrNull(row[32]),
    onchainFillsFrom: dateStringOrNull(row[33]),
    onchainFillsTo: dateStringOrNull(row[34]),
  }
}

async function queryCatalog(catalogPath: string, args: Args): Promise<CatalogRow[]> {
  // DuckDB returns native DATE/TIMESTAMP types; cast dates to VARCHAR so we
  // can normalise empty-string-to-null on the JS side without TZ surprises.
  const dateCols = [
    'trades_from',
    'trades_to',
    'quotes_from',
    'quotes_to',
    'book_snapshot_5_from',
    'book_snapshot_5_to',
    'book_snapshot_25_from',
    'book_snapshot_25_to',
    'book_snapshot_full_from',
    'book_snapshot_full_to',
    'onchain_fills_from',
    'onchain_fills_to',
  ]
  const cols = COLUMNS.map((c) =>
    dateCols.includes(c) ? `CAST(${c} AS VARCHAR) AS ${c}` : c,
  ).join(', ')

  const limitClause = args.limit ? `LIMIT ${args.limit}` : ''

  const slugPredicate = args.slugPatterns
    .map((p) => `slug LIKE '${p.replace(/'/g, "''")}'`)
    .join(' OR ')

  // Only insert finalized markets: resolved with a final result_id. This keeps
  // INSERT IGNORE correct forever — an active market is never inserted (and thus
  // never downloaded/converted) until Telonex publishes its resolution, so its
  // mutable fields (status/result_id/settled_at_us) can't go stale in our DB.
  // 'resolved' implies a non-empty result_id (verified empirically), but we
  // assert both to match the downstream eligibility predicate exactly.
  const sql = `
    SELECT ${cols}
    FROM read_parquet('${catalogPath.replace(/'/g, "''")}')
    WHERE (${slugPredicate})
      AND book_snapshot_full_from <> ''
      AND status = 'resolved'
      AND result_id <> ''
    ORDER BY slug
    ${limitClause}
  `

  const duckDb = await DuckDBInstance.create(':memory:')
  const conn = await duckDb.connect()
  const result = await conn.run(sql)

  const rows: CatalogRow[] = []
  for (let c = 0; c < result.chunkCount; c++) {
    const chunk = result.getChunk(c)
    const chunkRows = chunk.getRows()
    for (const r of chunkRows) {
      rows.push(rowToCatalog(r))
    }
  }
  return rows
}

async function batchInsert(
  rows: CatalogRow[],
  label: string,
): Promise<{ attempted: number; inserted: number }> {
  if (rows.length === 0) return { attempted: 0, inserted: 0 }
  const db = getDb()
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    const res = await db.insert(telonexMarkets).ignore().values(slice)
    // mysql2 affectedRows is on the first element for insert; with .ignore(),
    // it counts only newly inserted rows (duplicates are skipped silently).
    const affected = Array.isArray(res) ? (res[0] as { affectedRows?: number })?.affectedRows : 0
    inserted += affected ?? 0
    const progress = Math.min(i + slice.length, rows.length)
    console.log(
      `[telonex:sync] [${label}] inserted batch ${progress}/${rows.length} (new=${inserted})`,
    )
  }
  return { attempted: rows.length, inserted }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(1)}s`
}

// Group rows by `<symbol>-<timeframe>` (both derived from the slug at parse
// time), preserving a stable sorted key order for the breakdown table.
function groupBySymbolTimeframe(rows: CatalogRow[]): Map<string, CatalogRow[]> {
  const groups = new Map<string, CatalogRow[]>()
  for (const row of rows) {
    const key = `${row.symbol}-${row.timeframe}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

// Minimal fixed-width table printer. `rows[0]` is the header; numeric columns
// are right-aligned (index >= 1), the label column left-aligned.
function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)))
  for (const r of rows) {
    const line = r
      .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!)))
      .join('  ')
    console.log(`[telonex:sync]   ${line}`)
  }
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const args = parseArgs(process.argv.slice(2))
  const apiKey = readApiKey()
  console.log(
    `[telonex:sync] slug-patterns=${args.slugPatterns.join(',')} limit=${args.limit ?? 'none'} dry-run=${args.dryRun}`,
  )

  const tmpPath = path.join(os.tmpdir(), `telonex-catalog-${process.pid}-${Date.now()}.parquet`)
  try {
    console.log(`[telonex:sync] downloading catalog from ${CATALOG_URL}`)
    const tDl0 = Date.now()
    const bytes = await downloadCatalog(tmpPath, apiKey)
    const tDl = Date.now() - tDl0
    console.log(
      `[telonex:sync] catalog downloaded ${(bytes / 1024 / 1024).toFixed(1)} MB in ${fmtMs(tDl)}`,
    )

    console.log(`[telonex:sync] querying catalog via DuckDB...`)
    const tQ0 = Date.now()
    const rows = await queryCatalog(tmpPath, args)
    const tQ = Date.now() - tQ0
    console.log(`[telonex:sync] matched ${rows.length} markets (query=${fmtMs(tQ)})`)

    const groups = groupBySymbolTimeframe(rows)

    if (args.dryRun) {
      console.log(`[telonex:sync] dry-run: skipping DB writes`)
      if (groups.size > 0) {
        console.log(`[telonex:sync] matched by symbol/timeframe:`)
        printTable([
          ['group', 'matched'],
          ...[...groups.entries()].map(([key, rs]) => [key, String(rs.length)]),
          ['TOTAL', String(rows.length)],
        ])
        console.log(`[telonex:sync] sample row:`, JSON.stringify(rows[0]!, null, 2))
      }
      console.log(
        `[telonex:sync] timing: download=${fmtMs(tDl)} query=${fmtMs(tQ)} total=${fmtMs(Date.now() - t0)}`,
      )
      return
    }

    const tI0 = Date.now()
    let attempted = 0
    let inserted = 0
    const breakdown: string[][] = [['group', 'matched', 'inserted', 'skipped']]
    for (const [key, groupRows] of groups) {
      const res = await batchInsert(groupRows, key)
      attempted += res.attempted
      inserted += res.inserted
      breakdown.push([
        key,
        String(res.attempted),
        String(res.inserted),
        String(res.attempted - res.inserted),
      ])
    }
    const tI = Date.now() - tI0
    const skipped = attempted - inserted
    breakdown.push(['TOTAL', String(attempted), String(inserted), String(skipped)])
    console.log(`[telonex:sync] breakdown by symbol/timeframe:`)
    printTable(breakdown)
    console.log(
      `[telonex:sync] done attempted=${attempted} inserted=${inserted} skipped=${skipped}`,
    )
    console.log(
      `[telonex:sync] timing: download=${fmtMs(tDl)} query=${fmtMs(tQ)} insert=${fmtMs(tI)} total=${fmtMs(Date.now() - t0)}`,
    )
  } finally {
    await fs.unlink(tmpPath).catch(() => {})
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
