import type { MarketOrderBooksSnapshot } from '../../market/orderbook/index.js'
import type { PayoutInfo } from '../types.js'
import type { PayoutResolver } from '../PayoutResolver.js'
import { OrderbookInferenceResolver } from './OrderbookInferenceResolver.js'

/**
 * Fetches historical market resolution data from Gamma API.
 *
 * Primary resolver for backtests - provides accurate historical outcomes.
 * Falls back to OrderbookInferenceResolver if API fails.
 *
 * Gamma API endpoint: GET /markets?condition_id={market}
 * Response includes:
 * - closed: boolean
 * - outcome: string ("YES" | "NO" | outcome index)
 * - tokens: array with token IDs and outcomes
 *
 * Caches results to avoid repeated API calls during backtest reruns.
 */
export class GammaApiPayoutResolver implements PayoutResolver {
  private cache: Map<string, PayoutInfo> = new Map()
  private fallbackResolver: OrderbookInferenceResolver
  private baseUrl: string
  private useFallbackOnError: boolean

  constructor(options: {
    gammaApiUrl?: string
    useFallbackOnError?: boolean
  } = {}) {
    this.baseUrl = options.gammaApiUrl || 'https://gamma-api.polymarket.com'
    this.useFallbackOnError = options.useFallbackOnError ?? true
    this.fallbackResolver = new OrderbookInferenceResolver()
  }

  async resolvePayouts(params: {
    market: string
    assetIds: string[]
    lastSnapshot?: MarketOrderBooksSnapshot
  }): Promise<PayoutInfo> {
    const { market, assetIds, lastSnapshot } = params

    // Check cache first
    const cached = this.cache.get(market)
    if (cached) {
      return cached
    }

    try {
      // Fetch market data from Gamma API
      const url = `${this.baseUrl}/markets?condition_id=${encodeURIComponent(market)}`
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      })

      if (!res.ok) {
        throw new Error(`Gamma API HTTP ${res.status}: ${await res.text()}`)
      }

      const data: unknown = await res.json()

      // Parse response (Gamma returns array of markets)
      const markets = Array.isArray(data) ? data : []
      const marketData = markets[0]

      if (!marketData || typeof marketData !== 'object') {
        throw new Error(`Market not found in Gamma API: ${market}`)
      }

      // Extract resolution data
      const payoutInfo = this.parseGammaResponse(market, assetIds, marketData)

      // Cache result
      this.cache.set(market, payoutInfo)

      return payoutInfo
    } catch (error) {
      console.warn(`[GammaApiPayoutResolver] API error for market ${market}:`, error)

      // Fallback to orderbook inference if enabled
      if (this.useFallbackOnError && lastSnapshot) {
        console.log(`[GammaApiPayoutResolver] Falling back to orderbook inference`)
        const fallbackResult = await this.fallbackResolver.resolvePayouts(params)
        // Don't cache fallback results (might want to retry API later)
        return fallbackResult
      }

      throw error
    }
  }

  private parseGammaResponse(
    market: string,
    assetIds: string[],
    data: Record<string, unknown>,
  ): PayoutInfo {
    // Check if market is closed/resolved
    const closed = data.closed === true
    const outcome = data.outcome

    if (!closed || outcome === null || outcome === undefined) {
      throw new Error(`Market not yet resolved: ${market}`)
    }

    // Parse tokens array to map outcomes to token IDs
    const tokens = Array.isArray(data.tokens) ? data.tokens : []

    if (tokens.length === 0) {
      throw new Error(`No tokens found in Gamma response for market: ${market}`)
    }

    // Build payouts: winning outcome gets $1.00, losers get $0.00
    const payouts: Record<string, number> = {}
    let winningOutcome: string | undefined

    for (const token of tokens) {
      if (typeof token !== 'object' || token === null) continue

      const tokenId = (token as { token_id?: string }).token_id
      const tokenOutcome = (token as { outcome?: string }).outcome

      if (!tokenId) continue

      // Check if this is a winner
      // Outcome can be: "YES", "NO", "0", "1", or outcome name
      const isWinner =
        tokenOutcome === outcome ||
        String(tokenOutcome).toLowerCase() === String(outcome).toLowerCase()

      payouts[tokenId] = isWinner ? 1.0 : 0.0

      if (isWinner) {
        winningOutcome = String(tokenOutcome)
      }
    }

    // Verify we got all requested asset IDs
    for (const assetId of assetIds) {
      if (!(assetId in payouts)) {
        throw new Error(`Asset ID ${assetId} not found in Gamma response`)
      }
    }

    const result: PayoutInfo = {
      market,
      payouts,
      resolvedAt: Date.now(),
      source: 'gamma_api',
    }

    if (winningOutcome !== undefined) {
      result.winningOutcome = winningOutcome
    }

    return result
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; markets: string[] } {
    return {
      size: this.cache.size,
      markets: Array.from(this.cache.keys()),
    }
  }
}
