import { fetchGammaMarketBySlugAndMapApiResponseToMarketTable } from '../../polymarket/gamma.js'
import { getMarketBySlug, updateMarketBySlug, insertMarket } from '../../db/helpers.js'

/**
 * Parses slug from parquet filename.
 * Expected format: `<symbol>-updown-15m-<epochSeconds>.parquet`
 * Returns null if format doesn't match.
 */
export function parseSlugFromFilename(filePath: string): string | null {
  const basename = filePath.split('/').pop() ?? filePath
  const match = basename.match(/^([a-z]+)-updown-15m-(\d+)\.parquet$/)
  if (!match) return null
  return match[0]!.replace(/\.parquet$/, '')
}

/**
 * Extract symbol from slug.
 * Slug format: `<symbol>-updown-15m-<epochSeconds>`
 * Returns null if format doesn't match.
 */
function extractSymbolFromSlug(slug: string): string | null {
  const match = slug.match(/^([a-z]+)-updown-15m-/)
  return match ? match[1]! : null
}

export type MarketResolution = {
  tokenMap: Record<string, string> // { "UP": assetId, "DOWN": assetId }
  outcome: 'UP' | 'DOWN' | null // Resolved outcome, or null if not resolved yet
}

/**
 * Build tokenMap from outcomes and clobTokenIds arrays.
 */
function buildTokenMap(outcomes: string[], clobTokenIds: string[]): Record<string, string> | null {
  if (outcomes.length < 2 || clobTokenIds.length < 2) {
    return null
  }

  const tokenMap: Record<string, string> = {}
  for (let i = 0; i < Math.min(outcomes.length, clobTokenIds.length); i += 1) {
    const outcome = outcomes[i]
    const tokenId = clobTokenIds[i]
    if (typeof outcome === 'string' && typeof tokenId === 'string') {
      const normalizedOutcome = outcome.toUpperCase()
      tokenMap[normalizedOutcome] = tokenId
    }
  }

  if (!tokenMap['UP'] || !tokenMap['DOWN']) {
    return null
  }

  return tokenMap
}

/**
 * Normalize resolved outcome to 'UP' | 'DOWN' | null.
 */
function normalizeResolvedOutcome(resolvedOutcome: string | null, outcomes: string[]): 'UP' | 'DOWN' | null {
  if (!resolvedOutcome) return null

  const normalized = resolvedOutcome.toUpperCase()
  if (normalized === 'UP' || normalized.includes('UP')) {
    return 'UP'
  }
  if (normalized === 'DOWN' || normalized.includes('DOWN')) {
    return 'DOWN'
  }

  // Try to match against outcomes array
  for (const outcome of outcomes) {
    const outcomeUpper = outcome.toUpperCase()
    if (outcomeUpper === 'UP' || outcomeUpper.includes('UP')) {
      if (normalized === outcomeUpper || normalized.includes('UP')) {
        return 'UP'
      }
    }
    if (outcomeUpper === 'DOWN' || outcomeUpper.includes('DOWN')) {
      if (normalized === outcomeUpper || normalized.includes('DOWN')) {
        return 'DOWN'
      }
    }
  }

  return null
}

/**
 * Fetches market resolution data, checking database first, then API if needed.
 *
 * Flow:
 * 1. Check database using getMarketBySlug
 * 2. If resolvedOutcome exists in DB, use that data
 * 3. If resolvedOutcome is null, fetch from API and update DB
 * 4. Extract tokenMap and outcome from the data
 * 5. Return MarketResolution or null if still not resolved
 */
export async function getMarketResolution(
  slug: string,
  filePath: string,
): Promise<MarketResolution | null> {
  // Extract symbol from slug
  const symbol = extractSymbolFromSlug(slug)
  if (!symbol) {
    console.warn(`[marketResolution] Could not extract symbol from slug: ${slug}`)
    return null
  }

  // First, check database
  const dbMarket = await getMarketBySlug(slug)

  // If market exists in DB and has resolvedOutcome, use it
  if (dbMarket && dbMarket.resolvedOutcome) {
    const outcomes = dbMarket.outcomes ?? []
    const clobTokenIds = dbMarket.clobTokenIds ?? []
    const tokenMap = buildTokenMap(outcomes, clobTokenIds)

    if (!tokenMap) {
      console.warn(
        `[marketResolution] Invalid tokenMap from DB for slug: ${slug}. outcomes=${JSON.stringify(outcomes)} clobTokenIds=${JSON.stringify(clobTokenIds)}`,
      )
      return null
    }

    const outcome = normalizeResolvedOutcome(dbMarket.resolvedOutcome, outcomes)
    return {
      tokenMap,
      outcome,
    }
  }

  // If resolvedOutcome is null (or market doesn't exist), fetch from API
  const marketData = await fetchGammaMarketBySlugAndMapApiResponseToMarketTable({
    slug,
    filePath,
    symbol,
  })

  if (!marketData) {
    console.warn(`[marketResolution] Could not fetch market from Gamma API for slug: ${slug}`)
    return null
  }

  // Update database with fetched data
  if (dbMarket) {
    // Market exists, update it
    await updateMarketBySlug(slug, {
      resolvedOutcome: marketData.resolvedOutcome,
      outcomePrices: marketData.outcomePrices,
      umaResolutionStatus: marketData.umaResolutionStatus,
      active: marketData.active,
      closed: marketData.closed,
      volume: marketData.volume,
      rawJson: marketData.rawJson,
    })
  } else {
    // Market doesn't exist, insert it
    try {
      await insertMarket(marketData)
    } catch (err) {
      // If insert fails (e.g., race condition - market was inserted by another process),
      // try to update instead
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Duplicate entry') || msg.includes('UNIQUE constraint')) {
        // Market was inserted between our check and insert, update it instead
        await updateMarketBySlug(slug, {
          resolvedOutcome: marketData.resolvedOutcome,
          outcomePrices: marketData.outcomePrices,
          umaResolutionStatus: marketData.umaResolutionStatus,
          active: marketData.active,
          closed: marketData.closed,
          volume: marketData.volume,
          rawJson: marketData.rawJson,
        })
      } else {
        console.warn(`[marketResolution] Failed to insert market for slug: ${slug}: ${msg}`)
      }
    }
  }

  // Extract tokenMap and outcome from fetched data
  const outcomes = marketData.outcomes ?? []
  const clobTokenIds = marketData.clobTokenIds ?? []
  const tokenMap = buildTokenMap(outcomes, clobTokenIds)

  if (!tokenMap) {
    console.warn(
      `[marketResolution] Invalid tokenMap from API for slug: ${slug}. outcomes=${JSON.stringify(outcomes)} clobTokenIds=${JSON.stringify(clobTokenIds)}`,
    )
    return null
  }

  const outcome = normalizeResolvedOutcome(marketData.resolvedOutcome, outcomes)

  // Return MarketResolution even if outcome is null (backtest will skip stats)
  return {
    tokenMap,
    outcome,
  }
}
