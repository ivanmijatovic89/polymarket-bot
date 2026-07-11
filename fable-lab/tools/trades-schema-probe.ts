/**
 * trades-schema-probe.ts — D40 single-market Telonex `trades` schema probe.
 *
 * Downloads the trades-channel file(s) for EXACTLY ONE exploration-window
 * market straight from the vendor (Bearer TELONEX_API_KEY) and inspects the
 * parquet: schema, row count, timestamp range, side/aggressor-like columns,
 * first/last rows. Purpose: turn the EDGE-SPACE §3.2 queue-realistic
 * fill-model advocacy from catalog-metadata speculation into data-level
 * knowledge (what a trade print actually carries).
 *
 * D40 conditions enforced here:
 *   - one --slug per invocation, REFUSES markets at/after the holdout
 *     boundary (market_start_ms >= 1777237200000, frozen since U43);
 *   - NO R2 upload, NO DB writes (read-only catalog SELECT for asset ids
 *     and trades date range); files land under gitignored fable-lab/logs/.
 *
 * Usage: npx tsx fable-lab/tools/trades-schema-probe.ts --slug <slug>
 */
import '../../src/config/env.js'
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import parquet from '@dsnp/parquetjs'
import { getDb, closeDb } from '../../src/db/index.js'

const TELONEX_DOWNLOAD_BASE = 'https://api.telonex.io/v1/downloads/polymarket'
const HOLDOUT_BOUNDARY_MS = 1777237200000 // 2026-04-26T21:00Z, frozen (U43)
const MAX_DATES = 3 // a 15m market spans 1 date; refuse absurd ranges

function fail(msg: string): never {
  console.error(`[trades-probe] REFUSED: ${msg}`)
  process.exit(1)
}

function parseArgs(argv: string[]): { slug: string } {
  let slug = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') slug = argv[++i] ?? ''
  }
  if (!slug) fail('usage: --slug <btc-updown-15m-...> is required')
  return { slug }
}

function datesInRange(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

async function inspectParquet(filePath: string): Promise<void> {
  const reader = await parquet.ParquetReader.openFile(filePath)
  try {
    const schema = reader.getSchema()
    const rowCount = Number(reader.getRowCount())
    console.log(`  rows: ${rowCount}`)
    console.log('  schema:')
    for (const [name, field] of Object.entries(schema.fields)) {
      const f = field as { primitiveType?: string; originalType?: string; optional?: boolean }
      console.log(
        `    ${name}: ${f.primitiveType ?? '?'}${f.originalType ? ` (${f.originalType})` : ''}${f.optional ? ' optional' : ''}`,
      )
    }
    const cursor = reader.getCursor()
    const rows: Record<string, unknown>[] = []
    for (let r = await cursor.next(); r; r = await cursor.next()) {
      rows.push(r as Record<string, unknown>)
    }
    const show = (r: Record<string, unknown>) =>
      JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    console.log('  first 5 rows:')
    for (const r of rows.slice(0, 5)) console.log(`    ${show(r)}`)
    console.log('  last 5 rows:')
    for (const r of rows.slice(-5)) console.log(`    ${show(r)}`)
    // Column diagnostics: numeric-ish min/max, small-cardinality distincts.
    const cols = rows.length ? Object.keys(rows[0]) : []
    for (const c of cols) {
      const vals = rows.map((r) => r[c])
      const nums = vals
        .map((v) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : NaN))
        .filter((n) => Number.isFinite(n))
      if (nums.length === rows.length && rows.length > 0) {
        console.log(`  ${c}: min=${Math.min(...nums)} max=${Math.max(...nums)}`)
      } else {
        const distinct = new Set(vals.map((v) => String(v)))
        if (distinct.size <= 12) {
          console.log(`  ${c}: distinct=${JSON.stringify([...distinct])}`)
        }
      }
    }
  } finally {
    await reader.close()
  }
}

async function main() {
  const { slug } = parseArgs(process.argv.slice(2))
  const apiKey = process.env.TELONEX_API_KEY
  if (!apiKey || apiKey.trim() === '') fail('TELONEX_API_KEY is required')

  const db = getDb()
  const [rows] = await db.execute(sql`
    SELECT slug, market_start_ms, asset_id_0, asset_id_1, trades_from, trades_to
    FROM telonex_markets
    WHERE slug = ${slug} AND symbol = 'btc' AND timeframe = '15m'
  `)
  const market = (rows as Record<string, unknown>[])[0]
  if (!market) fail(`slug not found in telonex_markets (btc/15m): ${slug}`)
  const startMs = Number(market.market_start_ms)
  if (!Number.isFinite(startMs) || startMs >= HOLDOUT_BOUNDARY_MS) {
    fail(`market_start_ms ${market.market_start_ms} is not strictly before the holdout boundary ${HOLDOUT_BOUNDARY_MS} — D40 permits exploration-window markets only`)
  }
  const tradesFrom = market.trades_from ? String(market.trades_from).slice(0, 10) : null
  const tradesTo = market.trades_to ? String(market.trades_to).slice(0, 10) : null
  if (!tradesFrom || !tradesTo) fail(`catalog reports no trades coverage for ${slug}`)
  const dates = datesInRange(tradesFrom, tradesTo)
  if (dates.length === 0 || dates.length > MAX_DATES) {
    fail(`unexpected trades date range ${tradesFrom}..${tradesTo} (${dates.length} dates; cap ${MAX_DATES})`)
  }
  const assetIds = [market.asset_id_0, market.asset_id_1]
    .map((a) => (a ? String(a) : ''))
    .filter((a) => a !== '')
  if (assetIds.length === 0) fail(`catalog has no asset ids for ${slug}`)

  console.log(`[trades-probe] slug=${slug} start=${new Date(startMs).toISOString()} dates=${dates.join(',')} assets=${assetIds.length}`)
  const outDir = path.join('fable-lab', 'logs', 'trades-probe', slug)

  let totalBytes = 0
  for (const assetId of assetIds) {
    for (const date of dates) {
      const url = `${TELONEX_DOWNLOAD_BASE}/trades/${date}?asset_id=${encodeURIComponent(assetId)}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
      if (res.status === 404) {
        console.log(`\n== asset ${assetId.slice(0, 12)}… ${date}: NO FILE (404)`)
        continue
      }
      if (!res.ok) fail(`GET ${url} -> HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      totalBytes += buf.length
      fs.mkdirSync(outDir, { recursive: true }) // lazy: a fully-403 run leaves no footprint
      const filePath = path.join(outDir, `${assetId.slice(0, 16)}_${date}_trades.parquet`)
      fs.writeFileSync(filePath, buf)
      console.log(`\n== asset ${assetId.slice(0, 12)}… ${date}: ${buf.length} bytes -> ${filePath}`)
      await inspectParquet(filePath)
    }
  }
  console.log(`\n[trades-probe] total downloaded: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(1)} KiB) — D40 one-market probe complete; no R2, no DB writes.`)
  await closeDb()
}

main().catch((err) => {
  console.error('[trades-probe] ERROR:', err)
  process.exit(1)
})
