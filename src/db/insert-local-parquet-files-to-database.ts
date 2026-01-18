import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { closeDb, marketExistsBySlug, insertMarket, getAllMarkets, deleteMarketBySlug, type Market } from './index.js'
import { fetchGammaMarketBySlugAndMapApiResponseToMarketTable } from '../polymarket/gamma.js'

/**
 * Sleep/delay helper function.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
 * Check if file exists on disk.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get expected file path for a market based on slug and symbol.
 */
function getExpectedFilePath(slug: string, symbol: string, rootDir: string): string {
  return path.join(rootDir, symbol, `${slug}.parquet`)
}

/**
 * Check all markets in database and find those without files on disk.
 */
async function checkMarketsWithoutFiles(rootDir: string): Promise<Array<{ market: Market; filePath: string }>> {
  const allMarkets = await getAllMarkets()
  const missingFiles: Array<{ market: Market; filePath: string }> = []

  for (const market of allMarkets) {
    const filePath = getExpectedFilePath(market.slug, market.symbol, rootDir)
    const exists = await fileExists(filePath)

    if (!exists) {
      missingFiles.push({ market, filePath })
    }
  }

  return missingFiles
}

/**
 * Prompt user for yes/no answer.
 */
async function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output })

  try {
    const answer = await rl.question(`${question} (Y/n): `)
    const normalized = answer.trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes' || normalized === ''
  } finally {
    rl.close()
  }
}

/**
 * Clean up markets that don't have files on disk.
 */
async function cleanupMissingFiles(rootDir: string): Promise<void> {
  console.log('[insert-local-parquet] Checking for markets in database without files on disk...')

  const missingFiles = await checkMarketsWithoutFiles(rootDir)

  if (missingFiles.length === 0) {
    console.log('[insert-local-parquet] All markets in database have corresponding files on disk.')
    return
  }

  console.log(`\n[insert-local-parquet] Found ${missingFiles.length} markets in database without files on disk:`)
  console.log('Files in database but not on HDD:')
  for (const { filePath } of missingFiles) {
    console.log(`  - ${filePath}`)
  }

  const shouldDelete = await promptUser('\nDo you want to delete these records from the database?')

  if (shouldDelete) {
    console.log('[insert-local-parquet] Deleting markets from database...')
    let deleted = 0
    let errors = 0

    for (const { market } of missingFiles) {
      try {
        await deleteMarketBySlug(market.slug)
        deleted += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[insert-local-parquet] Failed to delete market "${market.slug}": ${msg}`)
        errors += 1
      }
    }

    console.log(`[insert-local-parquet] Cleanup complete: ${deleted} deleted, ${errors} errors`)
  } else {
    console.log('[insert-local-parquet] Skipping deletion. Continuing with existing records.')
  }
}


/**
 * Process a single parquet file: fetch market data and insert into database.
 */
async function processFile(
  filePath: string,
  fileName: string,
  symbol: string,
  delayMs: number = 50, // Delay between API calls (50ms = ~20 req/s, well under 300/10s limit)
): Promise<{ inserted: boolean; skipped: boolean; error: boolean }> {
  // Extract slug from filename
  const slug = extractSlugFromFilename(fileName)
  if (!slug) {
    console.error(`[insert-local-parquet] Invalid filename format: ${fileName}`)
    return { inserted: false, skipped: false, error: true }
  }

  // Check if market already exists
  const exists = await marketExistsBySlug(slug)
  if (exists) {
    return { inserted: false, skipped: true, error: false }
  }

  // Add delay before API call to respect rate limit (300 requests / 10s = ~33ms minimum)
  // Using 50ms to be safe and account for network latency
  await sleep(delayMs)

  // Fetch and map market data from Gamma API
  const marketData = await fetchGammaMarketBySlugAndMapApiResponseToMarketTable({
    slug,
    filePath,
    symbol,
  })

  if (!marketData) {
    console.warn(`[insert-local-parquet] Failed to fetch or map market for slug: ${slug}`)
    return { inserted: false, skipped: false, error: true }
  }

  // Insert into database
  try {
    await insertMarket(marketData)
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
async function processSymbolDirectory(
  symbol: string,
  rootDir: string,
  delayMs: number = 50,
): Promise<{
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
    const result = await processFile(filePath, fileName, symbol, delayMs)

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

  // Delay between API calls (in milliseconds)
  // Gamma /markets limit: 300 requests / 10s = 30 req/s = ~33ms minimum
  // Using 50ms to be safe and account for network latency
  const API_DELAY_MS = 50

  // First, check for markets in database without files and clean them up
  await cleanupMissingFiles(rootDir)

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
    const stats = await processSymbolDirectory(symbol, rootDir, API_DELAY_MS)
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

