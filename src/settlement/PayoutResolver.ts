import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { PayoutInfo } from './types.js'

/**
 * Interface for resolving payouts (determining winners) for settled markets.
 *
 * Different implementations for different contexts:
 * - GammaApiPayoutResolver: Fetches historical resolution from Gamma API (primary for backtests)
 * - OrderbookInferenceResolver: Infers winner from final orderbook prices (fallback)
 * - ManualPayoutResolver: Uses pre-configured payouts (testing)
 */
export interface PayoutResolver {
  /**
   * Resolve payouts for a settled market.
   *
   * @param market - Condition ID of the market
   * @param assetIds - Asset IDs (token IDs) in the market
   * @param lastSnapshot - Final orderbook snapshot (optional, used for inference)
   * @returns PayoutInfo with payout per asset ($0.00 or $1.00)
   */
  resolvePayouts(params: {
    market: string
    assetIds: string[]
    lastSnapshot?: MarketOrderBooksSnapshot
  }): Promise<PayoutInfo>
}
