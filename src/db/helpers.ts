import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
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
 * Get markets by slug list from database.
 * Returns any matching markets (order not guaranteed).
 */
export async function getMarketsBySlugs(slugs: string[]): Promise<Market[]> {
  if (slugs.length === 0) return []
  const db = mustGetDb()
  const results = await db
    .select()
    .from(markets)
    .where(inArray(markets.slug, slugs))
  return results
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
    latest?: boolean
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

  let orderBy
  if (options?.random) {
    orderBy = sql`RAND()`
  } else {
    orderBy = asc(markets.slug)
  }

  let offset: number | undefined
  if (options?.latest && options?.limit !== undefined) {
    // Count total markets matching the where clause
    const countResult = await db
      .select({ count: count() })
      .from(markets)
      .where(where)

    const total = countResult[0]?.count ?? 0
    // Calculate offset: skip older markets, get only the latest N
    offset = Math.max(0, total - options.limit)
  }

  const queryBuilder = db
    .select()
    .from(markets)
    .where(where)
    .orderBy(orderBy)
    .limit(options?.limit ?? 1000)

  const results = offset !== undefined
    ? await queryBuilder.offset(offset)
    : await queryBuilder

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
  batchUid: string
  baselineId: string | null
  cmd: string
  comment: string | null
  strategy: string
  params: Record<string, unknown>
  symbol: string | null
  slugs: string[] | null
  limit: number | null
  random: boolean
  latest: boolean
  batchStats: Record<string, unknown>
  marketStats: unknown[]
  chunkedBatchStats?: Record<string, unknown> | null
}): Promise<void> {
  const db = mustGetDb()
  await db.insert(backtests).values({
    batchUid: row.batchUid,
    baselineId: row.baselineId,
    cmd: row.cmd,
    comment: row.comment,
    strategy: row.strategy,
    params: row.params,
    symbol: row.symbol,
    slugs: row.slugs,
    limit: row.limit,
    random: row.random,
    latest: row.latest,
    batchStats: row.batchStats,
    marketStats: row.marketStats,
    ...(row.chunkedBatchStats !== undefined ? { chunkedBatchStats: row.chunkedBatchStats } : {}),
  })
}
