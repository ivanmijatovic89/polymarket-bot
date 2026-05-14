#!/usr/bin/env tsx
/**
 * Fetches the complete list of Parquet files from the pmxt archive and saves to file.
 * Sizes are parsed directly from the page HTML — no extra requests needed.
 *
 * Usage:
 *   npx tsx src/pmxt/list-files.ts                  # v2 (default), plain URL list
 *   npx tsx src/pmxt/list-files.ts --version v1     # v1
 *   npx tsx src/pmxt/list-files.ts --json           # JSON with size_mb per file + totals
 */

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ARCHIVE_BASE = 'https://archive.pmxt.dev/Polymarket'

// v1 serves files from r2.pmxt.dev, v2 from r2v2.pmxt.dev
const CDN_HOSTS: Record<string, string> = {
  v1: 'r2.pmxt.dev',
  v2: 'r2v2.pmxt.dev',
}

interface FileEntry {
  url: string
  filename: string
  timestamp: string
  size_mb: number
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const DELAY_MS = 600

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
  // Matches the URL and the size (e.g. "372.6 MB") from the same table row in the HTML
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
    const size_mb = parseFloat(m[3]!)
    const timestamp = filename.replace('polymarket_orderbook_', '').replace('.parquet', '')
    entries.push({ url, filename, timestamp, size_mb })
  }
  return entries
}

async function listAllFiles(version: string): Promise<FileEntry[]> {
  const baseUrl = `${ARCHIVE_BASE}/${version}`
  const cdnHost = CDN_HOSTS[version]
  if (!cdnHost)
    throw new Error(`Unknown version "${version}". Supported: ${Object.keys(CDN_HOSTS).join(', ')}`)

  const entryRe = buildEntryRe(cdnHost)
  const seen = new Map<string, FileEntry>()

  // ?page=0 and ?page=1 both alias to the base URL — fetch it once without a param.
  const firstHtml = await fetchHtml(baseUrl)
  extractEntries(firstHtml, entryRe).forEach((e) => seen.set(e.url, e))
  process.stderr.write(`  page 1 fetched (${seen.size} files, total: ${seen.size})\n`)

  // Subsequent pages start at 2.
  let page = 2
  while (true) {
    await sleep(DELAY_MS)
    const html = await fetchHtml(`${baseUrl}?page=${page}`)
    const found = extractEntries(html, entryRe)

    if (found.length === 0) break

    found.forEach((e) => seen.set(e.url, e))
    process.stderr.write(`  page ${page} fetched (${found.length} files, total: ${seen.size})\n`)
    page++
  }

  return Array.from(seen.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const versionArg = args.find((_, i) => args[i - 1] === '--version')
const version = versionArg ?? 'v2'

process.stderr.write(`Scraping Polymarket ${version} archive\n`)
process.stderr.write(`Source: ${ARCHIVE_BASE}/${version}\n\n`)

const files = await listAllFiles(version)
const totalGb = Math.round((files.reduce((sum, f) => sum + f.size_mb, 0) / 1024) * 100) / 100
const outputFile = join(__dirname, jsonMode ? `files-${version}.json` : `files-${version}.txt`)

if (jsonMode) {
  writeFileSync(
    outputFile,
    JSON.stringify({ total_files: files.length, total_gb: totalGb, files }, null, 2),
  )
} else {
  writeFileSync(outputFile, files.map((f) => f.url).join('\n') + '\n')
}

process.stderr.write(`\nTotal files: ${files.length}\n`)
process.stderr.write(`Total size:  ${totalGb} GB\n`)
process.stderr.write(`Saved to: ${outputFile}\n`)
