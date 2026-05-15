#!/usr/bin/env tsx
/**
 * Phase 1: Resolve every up/down 15m slug in the PMXT v2 archive range
 * to its Polymarket conditionId + tokenIds, caching results in pmxt_slug_cache.
 *
 * Range is derived from pmxt_dataset_catalogue (min/max hour_ts where version='v2').
 *
 * Idempotent — cached slugs are skipped without hitting Gamma. Re-run as v2
 * archive grows to keep cache current.
 *
 * Usage:
 *   npx tsx src/pmxt/resolve-slugs-v2.ts [--symbol btc] [--delay-ms 300]
 */

import { eq, sql } from 'drizzle-orm'

import { getDb, closeDb, pmxtDatasetCatalogue, pmxtSlugCache } from '../db/index.js'
import { buildUpDown15mSlug } from '../utils/timeWindows.js'
import { resolveSlugCachedOrGamma } from './resolveSlug.js'

const args = process.argv.slice(2)
const get = (flag: string) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

const symbol = get('--symbol') ?? 'btc'
const delayMs = parseInt(get('--delay-ms') ?? '300', 10)

const db = getDb()

// 1. Determine v2 hour range from catalogue
const rangeRows = await db
  .select({
    minHour: sql<Date>`MIN(${pmxtDatasetCatalogue.hourTs})`,
    maxHour: sql<Date>`MAX(${pmxtDatasetCatalogue.hourTs})`,
    n: sql<number>`COUNT(*)`,
  })
  .from(pmxtDatasetCatalogue)
  .where(eq(pmxtDatasetCatalogue.version, 'v2'))

const minHour = rangeRows[0]?.minHour
const maxHour = rangeRows[0]?.maxHour
const fileCount = rangeRows[0]?.n

if (!minHour || !maxHour || fileCount === 0) {
  console.error('No v2 files in pmxt_dataset_catalogue. Run pmxt:sync-catalog:v2 first.')
  await closeDb()
  process.exit(1)
}

const start = new Date(minHour)
const end = new Date(new Date(maxHour).getTime() + 60 * 60 * 1000) // include the last hour

console.log(`v2 range: ${start.toISOString()} → ${end.toISOString()}  (${fileCount} files)`)

// 2. Enumerate all 15-min windows in the range
const windowStarts: Date[] = []
for (let t = start.getTime(); t < end.getTime(); t += 15 * 60 * 1000) {
  windowStarts.push(new Date(t))
}
console.log(`Total 15-min windows in range: ${windowStarts.length}`)

// 3. Pre-load already-cached slugs to avoid per-slug DB roundtrips when nothing to do
const cachedRows = await db
  .select({ slug: pmxtSlugCache.slug })
  .from(pmxtSlugCache)
  .where(eq(pmxtSlugCache.symbol, symbol))
const cachedSet = new Set(cachedRows.map((r) => r.slug))
console.log(`Already cached for symbol=${symbol}: ${cachedSet.size}`)

// 4. Resolve each missing slug
let resolved = 0
let missing = 0
let cachedHit = 0
let i = 0
const total = windowStarts.length

for (const ws of windowStarts) {
  i++
  const slug = buildUpDown15mSlug(symbol, ws)

  if (cachedSet.has(slug)) {
    cachedHit++
    continue
  }

  const result = await resolveSlugCachedOrGamma(slug, symbol, ws)
  if (result) {
    resolved++
  } else {
    missing++
  }

  if (i % 50 === 0 || i === total) {
    process.stdout.write(
      `\r  [${i}/${total}]  cached=${cachedHit}  resolved=${resolved}  missing=${missing}`,
    )
  }

  // Rate-limit Gamma when we actually hit it
  if (!result || resolved > 0) {
    await new Promise((r) => setTimeout(r, delayMs))
  }
}

console.log()
console.log(`\nDone.`)
console.log(`  cached hits:  ${cachedHit}`)
console.log(`  resolved:     ${resolved}`)
console.log(`  missing:      ${missing}`)
console.log(`  total cache:  ${cachedSet.size + resolved}`)

await closeDb()
