/**
 * Resolves a Polymarket up/down 15m slug to its conditionId + tokenIds.
 *
 * Lookup order:
 *   1. pmxt_slug_cache table (DB)
 *   2. Gamma API (fallback) → inserts a fresh cache row
 *
 * Returns `null` when Gamma has no market for the slug (e.g. window slug that
 * never produced a market). Caller decides how to handle.
 */

import { eq } from 'drizzle-orm'

import { getDb, pmxtSlugCache } from '../db/index.js'
import { fetchGammaMarketBySlug } from '../polymarket/gamma.js'
import { buildGammaMarketMeta } from '../polymarket/gammaMarketMeta.js'

export type ResolvedSlug = {
  slug: string
  symbol: string
  conditionId: string
  tokenIds: string[]
  windowStart: Date
}

export async function resolveSlugCachedOrGamma(
  slug: string,
  symbol: string,
  windowStart: Date,
): Promise<ResolvedSlug | null> {
  const db = getDb()

  const cached = await db.select().from(pmxtSlugCache).where(eq(pmxtSlugCache.slug, slug)).limit(1)

  if (cached.length > 0) {
    const r = cached[0]!
    return {
      slug: r.slug,
      symbol: r.symbol,
      conditionId: r.conditionId,
      tokenIds: r.tokenIds,
      windowStart: r.windowStart,
    }
  }

  const raw = await fetchGammaMarketBySlug({ slug })
  if (!raw) return null

  const meta = buildGammaMarketMeta(raw, slug)
  if (!meta || !raw.conditionId || typeof raw.conditionId !== 'string') return null

  const resolved: ResolvedSlug = {
    slug,
    symbol,
    conditionId: raw.conditionId,
    tokenIds: meta.clobTokenIds,
    windowStart,
  }

  try {
    await db.insert(pmxtSlugCache).values({
      slug,
      symbol,
      conditionId: resolved.conditionId,
      tokenIds: resolved.tokenIds,
      windowStart,
    })
  } catch {
    // Race: another worker may have inserted between our SELECT and INSERT.
    // The next call will read the cache; safe to ignore.
  }

  return resolved
}
