import { buildUpDown15mSlug, FIFTEEN_MIN_MS } from '../utils/timeWindows.js'
import { fetchGammaMarketBySlug } from './gamma.js'
import { buildGammaMarketMeta, type GammaMarketMeta } from './gammaMarketMeta.js'

export type UpDown15mSymbol = 'btc' | 'eth' | 'sol' | 'xrp'

export type UpDown15mMarket = GammaMarketMeta

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
  const candidates = [
    buildUpDown15mSlug(symbol, date),
    buildUpDown15mSlug(symbol, new Date(date.getTime() - FIFTEEN_MIN_MS)),
  ]

  for (const slug of candidates) {
    const raw = await fetchGammaMarketBySlug({ slug })
    if (!raw) continue
    const m = buildGammaMarketMeta(raw, slug)
    if (!m) continue
    return m
  }

  return null
}
