import '../config/env.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb, closeDb, markets } from './index.js'
import { fetchGammaMarketBySlug } from '../polymarket/gamma.js'

/**
 * Helper to parse JSON array string from Gamma API response.
 */
function parseJsonArrayString(s: unknown): unknown[] | null {
  if (typeof s !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Parse ISO date string to Date object.
 */
function parseDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string') return null
  const date = new Date(dateStr)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Extract slug from parquet filename.
 * Filename format: <slug>.parquet
 * Returns the filename without .parquet extension.
 */
function extractSlugFromFilename(fileName: string): string | null {
  if (!fileName.endsWith('.parquet')) return null
  return fileName.slice(0, -'.parquet'.length)
}

/**
 * Determine resolved outcome from outcomePrices.
 * Returns the outcome name where price equals 1, or null if not resolved.
 */
function determineResolvedOutcome(
  outcomes: string[],
  outcomePrices: string[] | number[],
): string | null {
  if (outcomes.length !== outcomePrices.length) return null

  for (let i = 0; i < outcomePrices.length; i += 1) {
    const priceRaw = outcomePrices[i]
    if (priceRaw === undefined) continue
    const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : priceRaw
    if (Number.isFinite(price) && price === 1) {
      return outcomes[i] ?? null
    }
  }
  return null
}

/**
 * Map Gamma API response to markets table schema.
 */
function mapApiResponseToMarket(
  raw: Record<string, unknown>,
  slug: string,
  filePath: string,
  symbol: string,
): {
  polymarketId: string
  slug: string
  symbol: string
  dataset: string | null
  question: string
  conditionId: string | null
  outcomes: string[]
  outcomePrices: string[] | number[] | null
  resolvedOutcome: string | null
  endDate: Date | null
  startDate: Date | null
  startDateIso: string | null
  umaResolutionStatus: string | null
  umaResolutionStatuses: unknown | null
  clobTokenIds: string[] | null
  active: boolean
  closed: boolean
  volume: string | null
  rawJson: Record<string, unknown>
} | null {
  // Required fields
  const polymarketId = typeof raw.id === 'string' ? raw.id : null
  const question = typeof raw.question === 'string' ? raw.question : null

  if (!polymarketId || !question) {
    return null
  }

  // Parse outcomes
  const outcomesRaw = parseJsonArrayString(raw.outcomes) ?? []
  const outcomes = outcomesRaw.filter((x): x is string => typeof x === 'string')
  if (outcomes.length === 0) {
    return null
  }

  // Parse outcomePrices - convert to either all strings or all numbers
  const outcomePricesRaw = parseJsonArrayString(raw.outcomePrices) ?? []
  const outcomePricesParsed = outcomePricesRaw.map((x) => {
    if (typeof x === 'string') {
      const num = parseFloat(x)
      return Number.isFinite(num) ? num : x
    }
    if (typeof x === 'number') {
      return x
    }
    return String(x)
  })

  // Convert to either all numbers or all strings
  const allNumbers = outcomePricesParsed.every((x) => typeof x === 'number')
  const outcomePrices: string[] | number[] = allNumbers
    ? (outcomePricesParsed as number[])
    : outcomePricesParsed.map((x) => String(x))

  // Parse clobTokenIds
  const clobTokenIdsRaw = parseJsonArrayString(raw.clobTokenIds) ?? []
  const clobTokenIds = clobTokenIdsRaw.filter((x): x is string => typeof x === 'string')

  // Parse dates
  const startDateIso = typeof raw.startDate === 'string' ? raw.startDate : null
  const startDate = startDateIso ? parseDate(startDateIso) : null
  const endDate = typeof raw.endDate === 'string' ? parseDate(raw.endDate) : null

  // Determine resolved outcome
  const resolvedOutcome = determineResolvedOutcome(outcomes, outcomePrices)

  // Other fields
  const conditionId = typeof raw.conditionId === 'string' ? raw.conditionId : null
  const umaResolutionStatus =
    typeof raw.umaResolutionStatus === 'string' ? raw.umaResolutionStatus : null
  const umaResolutionStatuses = raw.umaResolutionStatuses ?? null

  // Convert absolute file path to relative path (e.g., data/events/btc/filename.parquet)
  const dataset = (() => {
    const cwd = process.cwd()
    if (filePath.startsWith(cwd)) {
      return filePath.slice(cwd.length + 1) // +1 to remove leading slash
    }
    // If path doesn't start with cwd, try to make it relative
    return path.relative(cwd, filePath)
  })()
  const active = typeof raw.active === 'boolean' ? raw.active : false
  const closed = typeof raw.closed === 'boolean' ? raw.closed : false
  const volume = typeof raw.volume === 'string' ? raw.volume : typeof raw.volume === 'number' ? String(raw.volume) : null

  return {
    polymarketId,
    slug,
    symbol,
    dataset,
    question,
    conditionId,
    outcomes,
    outcomePrices: outcomePrices.length > 0 ? outcomePrices : null,
    resolvedOutcome,
    endDate,
    startDate,
    startDateIso,
    umaResolutionStatus,
    umaResolutionStatuses,
    clobTokenIds: clobTokenIds.length > 0 ? clobTokenIds : null,
    active,
    closed,
    volume,
    rawJson: raw,
  }
}

/**
 * Check if market with given slug already exists in database.
 */
async function marketExists(slug: string): Promise<boolean> {
  const db = getDb()!
  const existing = await db.select().from(markets).where(eq(markets.slug, slug)).limit(1)
  return existing.length > 0
}

/**
 * Process a single parquet file: fetch market data and insert into database.
 */
async function processFile(
  filePath: string,
  fileName: string,
  symbol: string,
): Promise<{ inserted: boolean; skipped: boolean; error: boolean }> {
  // Extract slug from filename
  const slug = extractSlugFromFilename(fileName)
  if (!slug) {
    console.error(`[insert-local-parquet] Invalid filename format: ${fileName}`)
    return { inserted: false, skipped: false, error: true }
  }

  // Check if market already exists
  const exists = await marketExists(slug)
  if (exists) {
    return { inserted: false, skipped: true, error: false }
  }

  // Fetch market data from Gamma API
  let raw: Record<string, unknown> | null
  try {
    raw = await fetchGammaMarketBySlug({ slug })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[insert-local-parquet] Failed to fetch market for slug "${slug}": ${msg}`)
    return { inserted: false, skipped: false, error: true }
  }

  if (!raw) {
    console.warn(`[insert-local-parquet] Market not found for slug: ${slug}`)
    return { inserted: false, skipped: false, error: true }
  }

  // Map API response to database schema
  const marketData = mapApiResponseToMarket(raw, slug, filePath, symbol)
  if (!marketData) {
    console.error(`[insert-local-parquet] Failed to map market data for slug: ${slug}`)
    return { inserted: false, skipped: false, error: true }
  }

  // Insert into database
  try {
    const db = getDb()!
    await db.insert(markets).values(marketData)
    return { inserted: true, skipped: false, error: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[insert-local-parquet] Failed to insert market "${slug}": ${msg}`)
    return { inserted: false, skipped: false, error: true }
  }
}

/**
 * Process all parquet files in a symbol directory.
 */
async function processSymbolDirectory(symbol: string, rootDir: string): Promise<{
  inserted: number
  skipped: number
  errors: number
}> {
  const symbolDir = path.join(rootDir, symbol)
  let entries: Array<{ name: string; isFile: boolean }>

  try {
    const dirents = await fs.readdir(symbolDir, { withFileTypes: true })
    entries = dirents.map((d) => ({ name: d.name, isFile: d.isFile() }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[insert-local-parquet] Failed to read directory "${symbolDir}": ${msg}`)
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  const parquetFiles = entries.filter((e) => e.isFile && e.name.endsWith('.parquet')).map((e) => e.name)

  if (parquetFiles.length === 0) {
    console.warn(`[insert-local-parquet] No .parquet files found in "${symbolDir}"`)
    return { inserted: 0, skipped: 0, errors: 0 }
  }

  console.log(`[insert-local-parquet] Processing symbol: ${symbol} (${parquetFiles.length} files)`)

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const fileName of parquetFiles) {
    const filePath = path.join(symbolDir, fileName)
    const result = await processFile(filePath, fileName, symbol)

    if (result.inserted) inserted += 1
    else if (result.skipped) skipped += 1
    else if (result.error) errors += 1
  }

  return { inserted, skipped, errors }
}

/**
 * Main function: process all parquet files in /data/events.
 */
async function main(): Promise<void> {
  const rootDir = path.resolve(process.cwd(), 'data/events')

  // Read all symbol directories
  let symbolDirs: string[]
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true })
    symbolDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[insert-local-parquet] Failed to read root directory "${rootDir}": ${msg}`)
    process.exit(1)
  }

  if (symbolDirs.length === 0) {
    console.error(`[insert-local-parquet] No symbol directories found in "${rootDir}"`)
    process.exit(1)
  }

  console.log(`[insert-local-parquet] Found ${symbolDirs.length} symbol directories: ${symbolDirs.join(', ')}`)

  let totalInserted = 0
  let totalSkipped = 0
  let totalErrors = 0

  // Process each symbol directory
  for (const symbol of symbolDirs) {
    const stats = await processSymbolDirectory(symbol, rootDir)
    totalInserted += stats.inserted
    totalSkipped += stats.skipped
    totalErrors += stats.errors
  }

  // Close database connection
  await closeDb()

  // Print summary
  console.log('\n[insert-local-parquet] Summary:')
  console.log(`  Inserted: ${totalInserted}`)
  console.log(`  Skipped: ${totalSkipped}`)
  console.log(`  Errors: ${totalErrors}`)
}

await main()

