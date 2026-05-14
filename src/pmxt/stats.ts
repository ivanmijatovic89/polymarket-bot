#!/usr/bin/env tsx
/**
 * Shows the current state of the PMXT conversion pipeline.
 *
 * Usage:
 *   npx tsx src/pmxt/stats.ts [--symbol btc]
 */

import { eq, count } from 'drizzle-orm'
import { getDb, closeDb, pmxtDatasetCatalogue } from '../db/index.js'

const args = process.argv.slice(2)
const symbol = args[args.indexOf('--symbol') + 1] ?? 'btc'

const db = getDb()

const rows = await db
  .select({
    status: pmxtDatasetCatalogue.status,
    count: count(),
  })
  .from(pmxtDatasetCatalogue)
  .where(eq(pmxtDatasetCatalogue.symbol, symbol))
  .groupBy(pmxtDatasetCatalogue.status)

const counts: Record<string, number> = {}
for (const r of rows) counts[r.status ?? 'unknown'] = Number(r.count)

const statuses = ['pending', 'downloading', 'converting', 'done', 'failed'] as const
const total = statuses.reduce((s, st) => s + (counts[st] ?? 0), 0)
const pending = counts['pending'] ?? 0

console.log(`\nPMXT v1 pipeline — symbol: ${symbol}`)
console.log('─'.repeat(36))

for (const st of statuses) {
  const n = counts[st] ?? 0
  const bar = n > 0 ? `  ${'█'.repeat(Math.min(20, Math.round((n / total) * 20)))}` : ''
  console.log(`  ${st.padEnd(12)} ${String(n).padStart(5)}${bar}`)
}

console.log('─'.repeat(36))
console.log(`  ${'total'.padEnd(12)} ${String(total).padStart(5)}`)

if (pending > 0) {
  // Estimate based on average job time from done jobs (if available)
  // Rough default: ~30s per job
  const secPerJob = 30
  const estSec = pending * secPerJob
  const estH = Math.floor(estSec / 3600)
  const estM = Math.floor((estSec % 3600) / 60)
  console.log(`\n  estimated remaining: ~${estH}h ${estM}m  (${secPerJob}s/job estimate)`)
}

console.log()

await closeDb()
