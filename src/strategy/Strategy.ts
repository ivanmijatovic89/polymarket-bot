import type { EngineTick } from '../market/MarketEngine.js'
import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { StrategyContext } from './StrategyContext.js'

export type OrderSide = 'BUY' | 'SELL'

/**
 * Polymarket order type (time-in-force).
 *
 * Docs: create order supports FOK/GTC/GTD.
 */
export type OrderType = 'FOK' | 'GTC' | 'GTD'

export type ClientOrderId = string
export type ExchangeOrderId = string

export type MarketTick = EngineTick & {
  // MarketEngine emits ticks only for book + price_change, but keep type permissive.
  snapshot: MarketOrderBooksSnapshot
}

export type PlaceLimitIntent = {
  kind: 'place_limit'
  clientOrderId: ClientOrderId
  assetId: string
  side: OrderSide
  price: number
  size: number
  orderType: OrderType
  /**
   * Required for GTD. Epoch ms.
   * Note: Polymarket has a minimum expiry threshold; we’ll enforce in OrderManager.
   */
  expireAtMs?: number
  reason?: string
}

export type CancelOrderIntent = {
  kind: 'cancel_order'
  clientOrderId?: ClientOrderId
  orderId?: ExchangeOrderId
  reason?: string
}

export type CancelAllIntent = {
  kind: 'cancel_all'
  reason?: string
}

export type MergePositionsIntent = {
  kind: 'merge_positions'
  /**
   * The two assetIds (tokens) to merge against each other (e.g. YES/NO or UP/DOWN pair).
   */
  assetIdA: string
  assetIdB: string
  /**
   * Requested merge size in "shares" (same units strategies use for order sizes).
   * Execution may return a smaller actual size in `positions_merged`.
   */
  size: number
  reason?: string
}

export type Intent = PlaceLimitIntent | CancelOrderIntent | CancelAllIntent | MergePositionsIntent

export type OrderLifecycleState =
  | 'requested'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'expired'
  | 'killed'

export type OpenOrder = {
  clientOrderId: ClientOrderId
  orderId?: ExchangeOrderId
  market?: string
  assetId: string
  side: OrderSide
  price: number
  size: number
  remaining: number
  filled: number
  orderType: OrderType
  expireAtMs?: number
  state: OrderLifecycleState
  createdAtMs: number
  updatedAtMs: number
  lastError?: string
}

export type Position = {
  assetId: string
  qty: number
  avgEntryPrice: number | null
  /**
   * Average-cost cost basis of the *remaining* shares.
   * This is the best "how much did I actually pay" number for current inventory,
   * without tracking FIFO lots.
   */
  costBasis: number
}

export type Fill = {
  id: string
  tsMs: number
  market?: string
  assetId: string
  side: OrderSide
  price: number
  size: number
  feeRateBps?: number
  clientOrderId?: ClientOrderId
  orderId?: ExchangeOrderId
  /** MAKER/TAKER when known (user channel trade messages include this implicitly via maker_orders) */
  liquidity?: 'MAKER' | 'TAKER'
}

export type WsOrderUpdate = {
  orderId: ExchangeOrderId
  owner?: string
  market?: string
  assetId?: string
  side?: OrderSide
  price?: number
  originalSize?: number
  sizeMatched?: number
  status?: string
  orderType?: string
  outcome?: string
  expirationSec?: number
  createdAtSec?: number
  event: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION'
}

/**
 * Snapshot-friendly view of open orders observed from the Polymarket USER ws channel.
 * These orders may not have a `clientOrderId` (i.e. not placed by this bot).
 */
export type WsOpenOrder = {
  orderId: ExchangeOrderId
  owner?: string
  market?: string
  assetId?: string
  side?: OrderSide
  price?: number
  originalSize?: number
  sizeMatched?: number
  status?: string
  orderType?: string
  outcome?: string
  updatedAtMs: number
}

/**
 * Trade status rank for Polymarket user trade progression:
 * - 0: unknown / not a trade status we care about
 * - 1: MATCHED
 * - 2: MINED
 * - 3: CONFIRMED
 */
export type TradeStatusRank = 0 | 1 | 2 | 3

/**
 * Strategy-friendly, normalized view of an order (keyed by clientOrderId in PortfolioSnapshot).
 * This allows strategies to avoid correlating account events manually.
 */
export type OrderSnapshot = {
  clientOrderId: ClientOrderId
  orderId?: ExchangeOrderId
  assetId: string
  side: OrderSide
  price?: number
  originalSize?: number
  sizeMatched?: number
  remaining?: number
  lifecycleState?: OrderLifecycleState
  tradeStatusRaw?: string
  tradeStatusRank: TradeStatusRank
  updatedAtMs: number
}

/**
 * Derived, strategy/UI-friendly metrics for a 2-outcome UP/DOWN market.
 *
 * NOTE: This is intentionally "basic math" and should be stable across live + backtests.
 */
export type PositionMetrics = {
  shares_mergeable: number

  /**
   * Cost of 1 "merge pair" (1 UP share + 1 DOWN share) under average-cost accounting:
   * pair_avg = up_avg + down_avg
   */
  pair_avg: number | null
  /** Total cost basis across UP+DOWN. */
  total_cost: number

  pnl_merge: number
  pnl_if_up_wins: number
  pnl_if_down_wins: number
  imbalance: number
}

export type PortfolioSnapshot = {
  nowMs: number
  /**
   * Cumulative realized PnL across all assets, including positions that are now closed.
   * This avoids losing realized PnL when closed positions are removed from `positionsByAssetId`.
   */
  realizedPnlTotal?: number
  positionsByAssetId: Record<string, Position>
  openOrdersByClientId: Record<string, OpenOrder>
  /**
   * Open orders observed via USER ws channel, keyed by exchange orderId.
   * Optional for backwards compatibility.
   */
  wsOpenOrdersByOrderId?: Record<string, WsOpenOrder>
  ordersByClientId: Record<string, OrderSnapshot>
  recentFills: Fill[]
  /**
   * Best-effort mapping from assetId -> market (condition id).
   * Populated from fills and any order placement that includes a market.
   *
   * Useful for grouping positions across YES/NO pairs to compute merge PnL.
   */
  marketByAssetId: Record<string, string>
}

export type AccountEvent =
  | {
      kind: 'order_submitted'
      tsMs: number
      order: OpenOrder
    }
  | {
      kind: 'order_accepted'
      tsMs: number
      clientOrderId: ClientOrderId
      orderId?: ExchangeOrderId
    }
  | {
      kind: 'order_rejected'
      tsMs: number
      clientOrderId: ClientOrderId
      reason: string
    }
  | {
      kind: 'order_open'
      tsMs: number
      clientOrderId?: ClientOrderId
      orderId?: ExchangeOrderId
    }
  | {
      kind: 'order_done'
      tsMs: number
      clientOrderId?: ClientOrderId
      orderId?: ExchangeOrderId
      reason: 'filled' | 'canceled' | 'expired' | 'killed'
    }
  | {
      kind: 'fill'
      fill: Fill
    }
  | {
      kind: 'account_stream_status'
      tsMs: number
      source: 'user_ws' | 'rest_poll'
      status: 'connected' | 'disconnected'
      info?: string
    }
  | {
      // Raw-but-normalized order updates from Polymarket USER ws channel.
      // Useful for tracking all account orders (including those not placed by this bot).
      kind: 'ws_order_update'
      tsMs: number
      order: WsOrderUpdate
    }
  | {
      /**
       * Merge result: indicates that `size` shares were actually merged (may be <= requested).
       * Portfolio should treat this as authoritative but still clamp for safety.
       */
      kind: 'positions_merged'
      tsMs: number
      assetIdA: string
      assetIdB: string
      size: number
      reason?: string
    }
  | {
      kind: 'merge_failed'
      tsMs: number
      assetIdA: string
      assetIdB: string
      requestedSize: number
      reason: string
    }

export type Strategy = {
  name: string
  /**
   * Optional, strategy-declared external feed requirements.
   *
   * Live-only: CLIs (like `src/cli/trading-bot.ts`) may enable these feeds.
   * Backtests should ignore them (no external data).
   */
  requiredFeeds?: {
    rtdsCryptoPrices?: {
      /** Binance RTDS symbols, e.g. ["btcusdt"] */
      binanceSymbols?: string[]
      /** Chainlink RTDS symbols, e.g. ["btc/usd"] */
      chainlinkSymbols?: string[]
    }
    /**
     * Direct Binance Spot websocket price feed (aggTrade last price).
     *
     * Docs:
     * - Base: wss://stream.binance.com:9443/ws/<symbol>@aggTrade
     * - All symbols are lowercase.
     */
    binanceWsSpotPrice?: {
      /** e.g. "btcusdt" */
      symbol?: string
    }
    /**
     * Polymarket price-to-beat for Up/Down markets (open price for the interval).
     *
     * Live-only: `trading-bot` polls Polymarket public endpoint until `openPrice` is available,
     * then freezes it for the rest of the market.
     */
    polymarketPriceToBeat?: {
      enabled?: boolean
    }
  }
  onMarketTick: (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ) => Intent[] | Promise<Intent[]>
  onAccountEvent: (
    ev: AccountEvent,
    portfolio: PortfolioSnapshot,
    lastMarket?: MarketOrderBooksSnapshot,
    ctx?: StrategyContext,
  ) => Intent[] | Promise<Intent[]>
}
