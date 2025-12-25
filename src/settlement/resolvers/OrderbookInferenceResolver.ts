import type { MarketOrderBooksSnapshot } from '../../market/orderbook/index.js'
import type { PayoutInfo } from '../types.js'
import type { PayoutResolver } from '../PayoutResolver.js'

/**
 * Infers market winner from final orderbook prices.
 *
 * Logic: Higher bid price = market thinks this outcome will win
 * - If YES bid > NO bid → YES wins ($1.00), NO loses ($0.00)
 * - If NO bid > YES bid → NO wins ($1.00), YES loses ($0.00)
 *
 * Fallback used when:
 * - Gamma API is unavailable
 * - API rate-limited
 * - Testing without external dependencies
 *
 * Note: Less accurate than real resolution data, but reasonable approximation
 */
export class OrderbookInferenceResolver implements PayoutResolver {
  async resolvePayouts(params: {
    market: string
    assetIds: string[]
    lastSnapshot?: MarketOrderBooksSnapshot
  }): Promise<PayoutInfo> {
    const { market, assetIds, lastSnapshot } = params

    // Ensure we have exactly 2 assets (binary market)
    if (assetIds.length !== 2) {
      throw new Error(
        `OrderbookInferenceResolver only supports binary markets (got ${assetIds.length} assets)`,
      )
    }

    const [assetA, assetB] = assetIds

    if (!assetA || !assetB) {
      throw new Error('Invalid asset IDs')
    }

    // Need orderbook snapshot to infer winner
    if (!lastSnapshot || !lastSnapshot.byAssetId) {
      throw new Error('No orderbook snapshot available for inference')
    }

    const bookA = lastSnapshot.byAssetId[assetA]
    const bookB = lastSnapshot.byAssetId[assetB]

    // Get best bids (fallback to best ask if no bid)
    const bidA = bookA?.bestBid ?? bookA?.bestAsk ?? 0
    const bidB = bookB?.bestBid ?? bookB?.bestAsk ?? 0

    // Infer winner: higher bid = market expects this outcome
    const winnerAssetId = bidA >= bidB ? assetA : assetB
    const loserAssetId = bidA >= bidB ? assetB : assetA

    const payouts: Record<string, number> = {
      [winnerAssetId]: 1.0,
      [loserAssetId]: 0.0,
    }

    return {
      market,
      payouts,
      winningOutcome: winnerAssetId === assetA ? 'A' : 'B', // Generic labels
      resolvedAt: lastSnapshot.timestamp || Date.now(),
      source: 'orderbook_inference',
    }
  }
}
