import path from 'node:path'
import { loadPolymarketConfigFromEnv } from './config.js'

async function fetchFirstMarket(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gamma HTTP ${res.status}: ${await res.text()}`)
  const arr: unknown = await res.json()
  const first = Array.isArray(arr) ? (arr[0] ?? null) : null
  if (!first || typeof first !== 'object') return null
  return first as Record<string, unknown>
}

export async function fetchGammaMarketBySlug(args: {
  slug: string
}): Promise<Record<string, unknown> | null> {
  const gammaBaseUrl = loadPolymarketConfigFromEnv().gamma.baseUrl
  const slug = encodeURIComponent(args.slug)
  const openOrActiveUrl = `${gammaBaseUrl}/markets?slug=${slug}`
  const openOrActive = await fetchFirstMarket(openOrActiveUrl)
  if (openOrActive) return openOrActive

  // Some historical slugs are only returned when explicitly querying closed markets.
  const closedUrl = `${gammaBaseUrl}/markets?slug=${slug}&closed=true`
  return fetchFirstMarket(closedUrl)
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

/**
 * Parse ISO date string to Date object.
 */
function parseDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string') return null
  const date = new Date(dateStr)
  return Number.isNaN(date.getTime()) ? null : date
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

export type MarketDataForTable = {
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
}

/**
 * Map Gamma API response to markets table schema.
 */
export function mapApiResponseToMarket(
  raw: Record<string, unknown>,
  slug: string,
  filePath: string,
  symbol: string,
): MarketDataForTable | null {
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
 * Fetch Gamma market by slug and map to database table format.
 * Convenience method that combines fetch and mapping in a single call.
 */
export async function fetchGammaMarketBySlugAndMapApiResponseToMarketTable(args: {
  slug: string
  filePath: string
  symbol: string
}): Promise<MarketDataForTable | null> {
  try {
    const raw = await fetchGammaMarketBySlug({ slug: args.slug })
    if (!raw) {
      return null
    }
    return mapApiResponseToMarket(raw, args.slug, args.filePath, args.symbol)
  } catch {
    return null
  }
}
