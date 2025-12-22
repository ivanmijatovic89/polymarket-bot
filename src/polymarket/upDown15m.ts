import { buildUpDown15mSlug, FIFTEEN_MIN_MS } from '../utils/timeWindows.js'
import { fetchGammaMarketBySlug, GAMMA_DEFAULT } from './gamma.js'

function parseJsonArrayString(s: unknown): unknown[] | null {
  if (typeof s !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export type UpDown15mSymbol = 'btc' | 'eth' | 'sol' | 'xrp'

export type UpDown15mMarket = {
  slug: string
  question?: string
  outcomes: string[]
  clobTokenIds: string[]
}

/**
 * Returns the active "<SYMBOL> Up or Down (15 minute intervals)" market for the current
 * 15-minute UTC window.
 *
 * Defensive: Gamma can be ahead/behind around boundaries, so we also try previous window.
 */
export async function getCurrentUpDown15mMarket(
  symbol: UpDown15mSymbol,
  date = new Date(),
): Promise<UpDown15mMarket | null> {
  const gammaBaseUrl = process.env.GAMMA_API_BASE_URL ?? GAMMA_DEFAULT

  const candidates = [
    buildUpDown15mSlug(symbol, date),
    buildUpDown15mSlug(symbol, new Date(date.getTime() - FIFTEEN_MIN_MS)),
  ]

  for (const slug of candidates) {
    const raw = await fetchGammaMarketBySlug({ gammaBaseUrl, slug })
    if (!raw) continue

    const outcomesRaw = parseJsonArrayString(raw.outcomes) ?? []
    const clobTokenIdsRaw = parseJsonArrayString(raw.clobTokenIds) ?? []

    const outcomes = outcomesRaw.filter((x): x is string => typeof x === 'string')
    const clobTokenIds = clobTokenIdsRaw.filter((x): x is string => typeof x === 'string')

    if (outcomes.length < 2) continue
    if (clobTokenIds.length < 2) continue

    return {
      slug,
      outcomes,
      clobTokenIds,
      ...(typeof raw.question === 'string' ? { question: raw.question } : {}),
    }
  }

  return null
}
