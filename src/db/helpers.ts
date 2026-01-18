import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from './index.js'
import { backtests, markets } from './schema.js'
import type { MarketDataForTable } from '../polymarket/gamma.js'

export type Market = typeof markets.$inferSelect
export type MarketInsert = typeof markets.$inferInsert

function mustGetDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!db) {
    throw new Error('[db] getDb() returned null (unexpected)')
  }
  return db
}

/**
 * Get market by slug from database.
 * Returns null if market not found.
 */
export async function getMarketBySlug(slug: string): Promise<Market | null> {
  const db = mustGetDb()
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
  const db = mustGetDb()
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
    random?: boolean
  }
): Promise<Market[]> {
  const db = mustGetDb()
  const symbolWhere = eq(markets.symbol, symbol.toLowerCase())
  const where = options?.onlyWithDataset
    ? and(
        symbolWhere,
        sql`${markets.dataset} is not null`,
        sql`TRIM(${markets.dataset}) <> ''`,
      )
    : symbolWhere

  const results = await db
    .select()
    .from(markets)
    .where(where)
    .orderBy(options?.random ? sql`RAND()` : asc(markets.slug))
    .limit(options?.limit ?? 1000)

  return results
}

/**
 * Insert a new market into the database.
 * Throws if market with same slug already exists (unique constraint).
 *
 * Accepts MarketDataForTable type from gamma.ts which is compatible with Drizzle insert.
 */
export async function insertMarket(marketData: MarketDataForTable): Promise<void> {
  const db = mustGetDb()
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
  const db = mustGetDb()
  await db
    .update(markets)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(markets.slug, slug))
}

/**
 * Get all markets from database.
 * Returns all markets ordered by symbol and slug.
 */
export async function getAllMarkets(): Promise<Market[]> {
  const db = mustGetDb()
  const results = await db
    .select()
    .from(markets)
    .orderBy(asc(markets.symbol), asc(markets.slug))

  return results
}

/**
 * Delete market by slug from database.
 */
export async function deleteMarketBySlug(slug: string): Promise<void> {
  const db = mustGetDb()
  await db
    .delete(markets)
    .where(eq(markets.slug, slug))
}

export async function insertBacktestRun(row: {
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  limit: number | null
  random: boolean
  batchStats: Record<string, unknown>
  marketStats: unknown[]
}): Promise<void> {
  const db = mustGetDb()
  await db.insert(backtests).values({
    strategy: row.strategy,
    params: row.params,
    symbol: row.symbol,
    limit: row.limit,
    random: row.random,
    batchStats: row.batchStats,
    marketStats: row.marketStats,
  })
}
