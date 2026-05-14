#!/usr/bin/env tsx
/**
 * Fetches the complete v1 file catalogue from the PMXT archive and inserts
 * all entries into the pmxt_dataset_catalogue table as pending jobs.
 *
 * Safe to re-run — existing rows (matched by filename) are skipped.
 *
 * Usage:
 *   npx tsx src/pmxt/insert-pmxt-dataset-v1.ts --symbol btc
 */

import { eq } from 'drizzle-orm'
import { getDb, closeDb, pmxtDatasetCatalogue } from '../db/index.js'

// ---------------------------------------------------------------------------
// Archive scraping (v1 only)
// ---------------------------------------------------------------------------

const ARCHIVE_BASE = 'https://archive.pmxt.dev/Polymarket'
const V1_CDN_HOST = 'r2.pmxt.dev'
const DELAY_MS = 600

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

interface FileEntry {
  url: string
  filename: string
  hourTs: Date
  sizeMb: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function buildEntryRe(cdnHost: string): RegExp {
  const escaped = cdnHost.replace(/\./g, '\\.')
  return new RegExp(
    `href="(https://${escaped}/([^"]+\\.parquet))"[^>]+>[\\s\\S]*?<\\/a>[\\s\\S]*?([\\d.]+)\\s*MB`,
    'g',
  )
}

function extractEntries(html: string, re: RegExp): FileEntry[] {
  const entries: FileEntry[] = []
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while ((m = re.exec(html)) !== null) {
    const url = m[1]!
    const filename = m[2]!
    const sizeMb = parseFloat(m[3]!)
    const tsStr = filename.replace('polymarket_orderbook_', '').replace('.parquet', '')
    const hourTs = new Date(`${tsStr}:00:00Z`)
    entries.push({ url, filename, hourTs, sizeMb })
  }
  return entries
}

async function fetchAllV1Files(): Promise<FileEntry[]> {
  const baseUrl = `${ARCHIVE_BASE}/v1`
  const re = buildEntryRe(V1_CDN_HOST)
  const seen = new Map<string, FileEntry>()

  const firstHtml = await fetchHtml(baseUrl)
  extractEntries(firstHtml, re).forEach((e) => seen.set(e.filename, e))
  process.stderr.write(`  page 1 fetched (${seen.size} files)\n`)

  let page = 2
  while (true) {
    await sleep(DELAY_MS)
    const html = await fetchHtml(`${baseUrl}?page=${page}`)
    const found = extractEntries(html, re)
    if (found.length === 0) break
    found.forEach((e) => seen.set(e.filename, e))
    process.stderr.write(`  page ${page} fetched (${found.length} files, total: ${seen.size})\n`)
    page++
  }

  return Array.from(seen.values()).sort((a, b) => a.filename.localeCompare(b.filename))
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Fetching PMXT v1 catalogue...`)
console.log()

const files = await fetchAllV1Files()

console.log(`\nFetched ${files.length} files. Inserting into DB...\n`)

const db = getDb()

let inserted = 0
let skipped = 0

for (const file of files) {
  const existing = await db
    .select({ id: pmxtDatasetCatalogue.id })
    .from(pmxtDatasetCatalogue)
    .where(eq(pmxtDatasetCatalogue.filename, file.filename))
    .limit(1)

  if (existing.length > 0) {
    skipped++
    continue
  }

  await db.insert(pmxtDatasetCatalogue).values({
    version: 'v1',
    filename: file.filename,
    url: file.url,
    hourTs: file.hourTs,
    symbol: 'btc',
    status: 'pending',
    sourceSizeMb: String(file.sizeMb),
  })
  inserted++

  if (inserted % 50 === 0) {
    process.stdout.write(
      `  inserted ${inserted}/${files.length - skipped - (files.length - inserted - skipped)}...\r`,
    )
  }
}

await closeDb()

console.log(`\nDone.`)
console.log(`  inserted: ${inserted}`)
console.log(`  skipped (already existed): ${skipped}`)
console.log(`  total in catalogue: ${files.length}`)
