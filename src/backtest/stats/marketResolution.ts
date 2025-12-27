import { fetchGammaMarketBySlug } from '../../polymarket/gamma.js'

/**
 * Parses slug from parquet filename.
 * Expected format: `<symbol>-updown-15m-<epochSeconds>.parquet`
 * Also supports Azure downloaded files: `azure_<hex>_<symbol>-updown-15m-<epochSeconds>.parquet`
 * Returns null if format doesn't match.
 */
export function parseSlugFromFilename(filePath: string): string | null {
  // Handle both Unix and Windows path separators
  const basename = filePath.split(/[/\\]/).pop() ?? filePath

  // Try to match the slug pattern, with optional azure prefix
  const match = basename.match(/(?:azure_[0-9a-f]+_)?([a-z]+)-updown-15m-(\d+)\.parquet$/)
  if (!match) return null

  // Extract the slug part (without .parquet extension)
  // If there's an azure prefix, remove it
  const slugWithExt = match[0]!
  const slug = slugWithExt.replace(/^azure_[0-9a-f]+_/, '').replace(/\.parquet$/, '')
  return slug
}

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

export type MarketResolution = {
  tokenMap: Record<string, string> // { "UP": assetId, "DOWN": assetId }
  outcome: 'UP' | 'DOWN' | null // Resolved outcome, or null if not resolved yet
}

/**
 * Fetches market data from Gamma API and extracts both tokenMap and outcome.
 *
 * Makes a single API call to fetchGammaMarketBySlug and extracts:
 * - tokenMap: outcome -> assetId mapping
 * - outcome: resolved outcome (UP/DOWN) if market is resolved
 *
 * TODO: Later replace with database lookup (MySQL/SQLite).
 */
export async function getMarketResolution(slug: string): Promise<MarketResolution | null> {
  const raw = await fetchGammaMarketBySlug({ slug })
  if (!raw) {
    console.warn(`[marketResolution] Could not fetch market from Gamma API for slug: ${slug}`)
    return null
  }

  // Parse outcomes and clobTokenIds
  const outcomesRaw = parseJsonArrayString(raw.outcomes) ?? []
  const clobTokenIdsRaw = parseJsonArrayString(raw.clobTokenIds) ?? []

  const outcomes = outcomesRaw.filter((x): x is string => typeof x === 'string')
  const clobTokenIds = clobTokenIdsRaw.filter((x): x is string => typeof x === 'string')

  if (outcomes.length < 2 || clobTokenIds.length < 2) {
    console.warn(
      `[marketResolution] Invalid market data. outcomes=${JSON.stringify(outcomes)} clobTokenIds=${JSON.stringify(clobTokenIds)}`,
    )
    return null
  }

  // Build tokenMap: outcome -> assetId
  // Normalize outcomes to uppercase for consistent lookup (Gamma API returns "Up"/"Down")
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
    console.warn(
      `[marketResolution] Missing UP or DOWN in tokenMap. outcomes=${JSON.stringify(outcomes)} tokenMap=${JSON.stringify(tokenMap)}`,
    )
    return null
  }

  // Extract resolved outcome from Gamma API response
  let outcome: 'UP' | 'DOWN' | null = null

  // Check umaResolutionStatus - if "resolved", market is resolved
  const resolutionStatus = raw.umaResolutionStatus
  const isResolved = typeof resolutionStatus === 'string' && resolutionStatus.toLowerCase() === 'resolved'

  if (isResolved) {
    // Parse outcomePrices to determine winner
    // outcomePrices format: "[\"0\", \"1\"]" where "1" indicates the winning outcome
    const outcomePricesRaw = parseJsonArrayString(raw.outcomePrices) ?? []
    const outcomePrices = outcomePricesRaw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => parseFloat(x))
      .filter((x) => Number.isFinite(x))

    // Find which outcome has price = 1 (winner)
    if (outcomePrices.length === outcomes.length) {
      for (let i = 0; i < outcomePrices.length; i += 1) {
        if (outcomePrices[i] === 1) {
          // Winner found - map to UP/DOWN based on normalized outcome name
          const winnerOutcome = outcomes[i]
          if (typeof winnerOutcome === 'string') {
            const normalized = winnerOutcome.toUpperCase()
            if (normalized === 'UP' || normalized.includes('UP')) {
              outcome = 'UP'
            } else if (normalized === 'DOWN' || normalized.includes('DOWN')) {
              outcome = 'DOWN'
            }
          }
          break
        }
      }
    }
  }

  // If outcome is null, market might not be resolved yet
  // (this is OK - we'll skip stats for unresolved markets)

  return {
    tokenMap,
    outcome,
  }
}

