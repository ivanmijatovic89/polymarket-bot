import type { EngineTick } from '../market/MarketEngine.js'
import type { AnyMarketMessage, MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type { SyntheticFeedTickMessage } from '../market/syntheticTick.js'
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

export type IntentMeta = Record<string, unknown>

export type MarketTick = Omit<EngineTick, 'msg'> & {
  // MarketEngine emits ticks only for book + price_change. Strategies may
  // additionally receive opt-in synthetic feed ticks (tickOnTrade/tickOnRound)
  // whose msg type is deliberately outside AnyMarketMessage so it can never
  // reach the orderbook engine — see src/market/syntheticTick.ts.
  msg: AnyMarketMessage | SyntheticFeedTickMessage
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
  meta?: IntentMeta
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

export type SplitPositionsIntent = {
  kind: 'split_positions'
  /**
   * The two outcome token assetIds to receive (e.g. UP/DOWN).
   *
   * Split N "full sets" => receive N shares of assetIdA and N shares of assetIdB.
   */
  assetIdA: string
  assetIdB: string
  /**
   * Split size in "shares" (1 share == $1 collateral).
   */
  size: number
  /**
   * Optional accounting price per share (used by backtest/live simulation to book cost basis).
   * Default 0.5 (so total cost == size, since you receive 2*size shares).
   */
  costPerShare?: number
  reason?: string
}

export type PlaceBatchIntent = {
  kind: 'place_batch'
  /**
   * Array of orders to place in a single batch request.
   * Polymarket supports up to 15 orders per batch.
   */
  orders: Array<{
    clientOrderId: ClientOrderId
    assetId: string
    side: OrderSide
    price: number
    size: number
    orderType: OrderType
    meta?: IntentMeta
    /**
     * Required for GTD. Epoch ms.
     * Note: Polymarket has a minimum expiry threshold; we'll enforce in OrderManager.
     */
    expireAtMs?: number
    reason?: string
  }>
  reason?: string
}

export type Intent =
  | PlaceLimitIntent
  | PlaceBatchIntent
  | CancelOrderIntent
  | CancelAllIntent
  | MergePositionsIntent
  | SplitPositionsIntent

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
  meta?: IntentMeta
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
  intentMeta?: IntentMeta
}

export type PositionsSplit = {
  id: string
  tsMs: number
  market?: string
  assetIdA: string
  assetIdB: string
  /** Full-set size in shares (split N => +N on both sides) */
  size: number
  /** Collateral spent to split (USDC). For Polymarket binary full-sets, this is typically == size. */
  splitCost: number
  reason?: string
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
  meta?: IntentMeta
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

export type OrderbookWeakSide = 'UP' | 'DOWN' | 'NONE'

export type OrderbookMetrics = {
  /**
   * Computed levels (array index 0 == L1).
   * Typically equals min(up.depthLevels, down.depthLevels) and also bounded by array lengths.
   */
  depthLevels: number

  weakBidSideByLevel: OrderbookWeakSide[]
  weakBidRatioByLevel: number[]

  weakAskSideByLevel: OrderbookWeakSide[]
  weakAskRatioByLevel: number[]
}

/**
 * Container for derived, strategy/UI-friendly metrics.
 *
 * This keeps StrategyContext stable as we add more metrics (orderbook, execution, etc.)
 * without adding more top-level fields.
 */
export type Metrics = {
  position?: PositionMetrics
  orderbook?: OrderbookMetrics
}

export type PortfolioSnapshot = {
  nowMs: number
  /**
   * Cumulative realized PnL across all assets, including positions that are now closed.
   * This avoids losing realized PnL when closed positions are removed from `positionsByAssetId`.
   */
  realizedPnlTotal?: number
  positionsByAssetId: Readonly<Record<string, Position>>
  openOrdersByClientId: Readonly<Record<string, OpenOrder>>
  /**
   * Open orders observed via USER ws channel, keyed by exchange orderId.
   * Optional for backwards compatibility.
   */
  wsOpenOrdersByOrderId?: Readonly<Record<string, WsOpenOrder>>
  ordersByClientId: Readonly<Record<string, OrderSnapshot>>
  recentFills: readonly Fill[]
  /**
   * Recent position split events (CTF splitPosition) for backtest stats/accounting.
   *
   * These are NOT trades and should not be counted as fills/tradeCount.
   */
  recentSplits?: readonly PositionsSplit[]
  /**
   * Best-effort mapping from assetId -> market (condition id).
   * Populated from fills and any order placement that includes a market.
   *
   * Useful for grouping positions across YES/NO pairs to compute merge PnL.
   */
  marketByAssetId: Readonly<Record<string, string>>
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
      kind: 'positions_split'
      split: PositionsSplit
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
  | {
      kind: 'split_failed'
      tsMs: number
      assetIdA: string
      assetIdB: string
      requestedSize: number
      reason: string
    }

export type Strategy = {
  name: string
  /**
   * Optional, strategy-declared external feed requirements (LEGACY seam —
   * prefer registering `ExternalFeedsRequestPlugin`).
   *
   * Runtime coverage differs: live `trading-bot.ts` falls back to this when
   * no request plugin is registered, but backtest fulfillment
   * (`wireBacktestExternalFeeds`) reads ONLY the plugin. Features that must
   * stay live==replay (like synthetic ticks' `tickOnTrade`) are therefore
   * deliberately NOT part of this legacy shape — they exist only on
   * `ExternalFeedsRequestConfig`.
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
