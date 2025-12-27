import fs from 'node:fs/promises'
import path from 'node:path'
import { closeDb, marketExistsBySlug, insertMarket } from './index.js'
import { fetchGammaMarketBySlugAndMapApiResponseToMarketTable } from '../polymarket/gamma.js'

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
  const exists = await marketExistsBySlug(slug)
  if (exists) {
    return { inserted: false, skipped: true, error: false }
  }

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

