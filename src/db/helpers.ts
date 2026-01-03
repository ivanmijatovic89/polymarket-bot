import { eq, asc } from 'drizzle-orm'
import { getDb } from './index.js'
import { markets } from './schema.js'
import type { MarketDataForTable } from '../polymarket/gamma.js'

export type Market = typeof markets.$inferSelect
export type MarketInsert = typeof markets.$inferInsert

/**
 * Get market by slug from database.
 * Returns null if market not found.
 */
export async function getMarketBySlug(slug: string): Promise<Market | null> {
  const db = getDb()
  const results = await db
    .select()
    .from(markets)
    .where(eq(markets.slug, slug))
    .limit(1)

  return results[0] ?? null
}

/**
 * Get market by Polymarket ID from database.
 * Returns null if market not found.
 */
export async function getMarketByPolymarketId(polymarketId: string): Promise<Market | null> {
  const db = getDb()
  const results = await db
    .select()
    .from(markets)
    .where(eq(markets.polymarketId, polymarketId))
    .limit(1)

  return results[0] ?? null
}

/**
 * Check if market exists by slug.
 * Returns false on database errors (safe default).
 */
export async function marketExistsBySlug(slug: string): Promise<boolean> {
  try {
    const market = await getMarketBySlug(slug)
    return market !== null
  } catch (err) {
    // If database check fails, assume it doesn't exist (will try to insert)
    console.warn(`[db][⛔️] Failed to check if market exists for slug "${slug}":`, err)
    return false
  }
}

/**
 * Get markets by symbol from database.
 * Returns markets ordered by slug, optionally filtered to only include those with dataset.
 */
export async function getMarketsBySymbol(
  symbol: string,
  options?: {
    limit?: number
    onlyWithDataset?: boolean
  }
): Promise<Market[]> {
  const db = getDb()
  const results = await db
    .select()
    .from(markets)
    .where(eq(markets.symbol, symbol.toLowerCase()))
    .orderBy(asc(markets.slug))
    .limit(options?.limit ?? 1000)

  // Filter out rows where dataset is null or empty if requested
  if (options?.onlyWithDataset) {
    return results.filter((row) => row.dataset && row.dataset.trim() !== '')
  }

  return results
}

/**
 * Insert a new market into the database.
 * Throws if market with same slug already exists (unique constraint).
 *
 * Accepts MarketDataForTable type from gamma.ts which is compatible with Drizzle insert.
 */
export async function insertMarket(marketData: MarketDataForTable): Promise<void> {
  const db = getDb()
  await db.insert(markets).values(marketData)
}

/**
 * Update market by slug with new data.
 * Only updates the specified fields and automatically sets updatedAt.
 */
export async function updateMarketBySlug(
  slug: string,
  updates: Partial<Pick<Market,
    'resolvedOutcome' | 'outcomePrices' | 'umaResolutionStatus' |
    'active' | 'closed' | 'volume' | 'rawJson'
  >>
): Promise<void> {
  const db = getDb()
  await db
    .update(markets)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(markets.slug, slug))
}

