import type { EngineTick } from '../engine/MarketEngine.js'
import type { MarketOrderBooksSnapshot } from '../orderbook/OrderBookEngine.js'

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

export type Intent = PlaceLimitIntent | CancelOrderIntent | CancelAllIntent

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
  realizedPnl: number
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

export type PortfolioSnapshot = {
  nowMs: number
  positionsByAssetId: Record<string, Position>
  openOrdersByClientId: Record<string, OpenOrder>
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

export type Strategy = {
  name: string
  onMarketTick: (tick: MarketTick, portfolio: PortfolioSnapshot) => Intent[] | Promise<Intent[]>
  onAccountEvent: (
    ev: AccountEvent,
    portfolio: PortfolioSnapshot,
    lastMarket?: MarketOrderBooksSnapshot,
  ) => Intent[] | Promise<Intent[]>
}
