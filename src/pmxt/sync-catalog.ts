#!/usr/bin/env tsx
/**
 * Fetches the PMXT archive file catalogue and inserts new entries into
 * the pmxt_dataset_catalogue table as pending jobs.
 *
 * Safe to re-run — existing rows (matched by filename) are skipped.
 *
 * Usage:
 *   npx tsx src/pmxt/sync-catalog.ts --version v1
 *   npx tsx src/pmxt/sync-catalog.ts --version v2
 */

import { eq } from 'drizzle-orm'
import { getDb, closeDb, pmxtDatasetCatalogue } from '../db/index.js'

// ---------------------------------------------------------------------------
// Archive scraping
// ---------------------------------------------------------------------------

const ARCHIVE_BASE = 'https://archive.pmxt.dev/Polymarket'

const CDN_HOSTS: Record<string, string> = {
  v1: 'r2.pmxt.dev',
  v2: 'r2v2.pmxt.dev',
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const DELAY_MS = 600

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

async function fetchAllFiles(version: string): Promise<FileEntry[]> {
  const cdnHost = CDN_HOSTS[version]
  if (!cdnHost)
    throw new Error(`Unknown version "${version}". Supported: ${Object.keys(CDN_HOSTS).join(', ')}`)

  const baseUrl = `${ARCHIVE_BASE}/${version}`
  const re = buildEntryRe(cdnHost)
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

const args = process.argv.slice(2)
const get = (flag: string) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

const version = get('--version') ?? 'v1'

if (!CDN_HOSTS[version]) {
  console.error(`Unknown version "${version}". Supported: v1, v2`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Fetching PMXT ${version} catalogue...`)
console.log()

const files = await fetchAllFiles(version)

const totalGb = Math.round((files.reduce((s, f) => s + f.sizeMb, 0) / 1024) * 100) / 100
console.log(`\nFetched ${files.length} files (${totalGb} GB total). Inserting into DB...\n`)

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
    version,
    filename: file.filename,
    url: file.url,
    hourTs: file.hourTs,
    symbol: 'btc',
    status: 'pending',
    sourceSizeMb: String(file.sizeMb),
  })
  inserted++

  if (inserted % 50 === 0) {
    process.stdout.write(`  inserted ${inserted}...\r`)
  }
}

await closeDb()

console.log(`\nDone.`)
console.log(`  inserted: ${inserted}`)
console.log(`  skipped (already existed): ${skipped}`)
console.log(`  total in catalogue: ${files.length}`)
