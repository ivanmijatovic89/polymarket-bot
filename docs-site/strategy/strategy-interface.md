---
title: Strategy Interface
description: Complete reference for the Strategy interface, all Intent types, PortfolioSnapshot, and AccountEvent variants.
---

# Strategy Interface

The `Strategy` interface is the core extensibility contract of the trading engine. Every strategy must implement this interface. Strategies are called synchronously (or asynchronously) by `StrategyRunner` and return `Intent[]` — declarative instructions that `OrderManager` validates and dispatches.

## Strategy

```typescript
type Strategy = {
  name: string
  requiredFeeds?: RequiredFeeds
  onMarketTick(
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] | Promise<Intent[]>
  onAccountEvent(
    ev: AccountEvent,
    portfolio: PortfolioSnapshot,
    lastMarket?: MarketOrderBooksSnapshot,
    ctx?: StrategyContext,
  ): Intent[] | Promise<Intent[]>
}
```

### `name`

A human-readable identifier for log output. Conventionally matches the strategy's `id` in the registry.

### `requiredFeeds`

Optional. Declares which external data feeds the strategy needs at runtime. Only consulted during live trading — backtests receive no external feed data. See [External Feeds](#external-feeds) for the full field reference.

### `onMarketTick`

Called on every `EngineTick` of type `book` or `price_change`. Both live trading and backtesting invoke this handler through the shared `MarketEngine`.

| Parameter   | Type                         | Description                                                     |
| ----------- | ---------------------------- | --------------------------------------------------------------- |
| `tick`      | `MarketTick`                 | The current tick, including the full orderbook snapshot.        |
| `portfolio` | `PortfolioSnapshot`          | Current positions, open orders, fills, and derived order state. |
| `ctx`       | `StrategyContext` (optional) | Market metadata, plugin snapshots, balance, and warmup status.  |

Return an `Intent[]`. An empty array is valid and means "do nothing this tick."

### `onAccountEvent`

Called when an account event arrives — order submissions, acceptances, rejections, fills, splits, merges. Also used for cascading logic: after a fill arrives, this handler can immediately place a follow-up order within the same logical tick.

| Parameter    | Type                                  | Description                                                   |
| ------------ | ------------------------------------- | ------------------------------------------------------------- |
| `ev`         | `AccountEvent`                        | The event that fired.                                         |
| `portfolio`  | `PortfolioSnapshot`                   | Portfolio state at the time of the event.                     |
| `lastMarket` | `MarketOrderBooksSnapshot` (optional) | The most recent orderbook snapshot from the last market tick. |
| `ctx`        | `StrategyContext` (optional)          | Same context snapshot as the associated market tick.          |

::: tip Cascading fills
`StrategyRunner` caches the tick-scoped `PluginsSnapshot` and reuses it for every `onAccountEvent` call that follows within the same logical tick. Intents returned here are processed by `OrderManager` identically to those from `onMarketTick`.
:::

---

## Intent Types

An `Intent` is a discriminated union. `OrderManager` validates, de-duplicates, and dispatches each intent.

### `place_limit`

Place a single limit order on the CLOB.

```typescript
type PlaceLimitIntent = {
  kind: 'place_limit'
  clientOrderId: string // Stable ID your strategy assigns; used to track the order lifecycle.
  assetId: string // Token (outcome) to trade.
  side: 'BUY' | 'SELL'
  price: number // Probability price in [0, 1].
  size: number // Order size in shares (1 share == $1 face value).
  orderType: 'FOK' | 'GTC' | 'GTD'
  expireAtMs?: number // Required for GTD. Epoch milliseconds. OrderManager enforces the minimum threshold.
  meta?: Record<string, unknown> // Arbitrary metadata attached to this order for tracking.
  reason?: string // Free-text label logged with the order.
}
```

### `place_batch`

Place up to 15 orders in a single CLOB batch request.

```typescript
type PlaceBatchIntent = {
  kind: 'place_batch'
  orders: Array<{
    clientOrderId: string
    assetId: string
    side: 'BUY' | 'SELL'
    price: number
    size: number
    orderType: 'FOK' | 'GTC' | 'GTD'
    expireAtMs?: number
    meta?: Record<string, unknown>
    reason?: string
  }>
  reason?: string
}
```

::: warning Batch size limit
Polymarket's CLOB accepts a maximum of 15 orders per batch request. `OrderManager` will reject batches that exceed this limit.
:::

### `cancel_order`

Cancel a single order by `clientOrderId` or exchange `orderId`. At least one must be provided.

```typescript
type CancelOrderIntent = {
  kind: 'cancel_order'
  clientOrderId?: string // Preferred: matches orders tracked by this bot.
  orderId?: string // Exchange-assigned order ID.
  reason?: string
}
```

### `cancel_all`

Cancel all open orders for the current market.

```typescript
type CancelAllIntent = {
  kind: 'cancel_all'
  reason?: string
}
```

### `split_positions`

Call the Conditional Token Framework (CTF) `splitPosition` to convert USDC collateral into a full set of outcome shares. Splitting `N` shares costs `N` USDC and yields `N` UP shares plus `N` DOWN shares.

```typescript
type SplitPositionsIntent = {
  kind: 'split_positions'
  assetIdA: string // First outcome token (e.g. UP).
  assetIdB: string // Second outcome token (e.g. DOWN).
  size: number // Number of full sets to split (1 set == $1 USDC).
  costPerShare?: number // Accounting price per share for cost-basis tracking. Default 0.5.
  reason?: string
}
```

### `merge_positions`

Call the CTF `mergePosition` to collapse a complementary pair of outcome shares back into USDC. Requires holding both UP and DOWN shares.

```typescript
type MergePositionsIntent = {
  kind: 'merge_positions'
  assetIdA: string // First outcome token.
  assetIdB: string // Second outcome token.
  size: number // Requested merge size in shares. Execution may return a smaller actual size.
  reason?: string
}
```

::: danger Wait for MINED before merging
You must wait for a fill's trade status to reach `MINED` before merging positions from that fill. Attempting to merge with only `MATCHED` status will fail. See the [fill-status semantics note](../other/architecture.md) in the architecture docs.
:::

---

## Supporting Types

### `OrderSide`

```typescript
type OrderSide = 'BUY' | 'SELL'
```

### `OrderType`

```typescript
type OrderType = 'FOK' | 'GTC' | 'GTD'
```

| Value | Meaning                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------- |
| `FOK` | Fill-or-kill: fills entirely in one shot or cancels.                                           |
| `GTC` | Good-till-cancelled: rests on the book until filled or cancelled.                              |
| `GTD` | Good-till-date: rests until `expireAtMs`. `OrderManager` enforces Polymarket's minimum expiry. |

### `MarketTick`

```typescript
type MarketTick = EngineTick & {
  snapshot: MarketOrderBooksSnapshot
}
```

`EngineTick` carries the raw event type and sequence metadata from `MarketEngine`. `snapshot` is the full per-asset orderbook state at the moment the tick was emitted.

---

## PortfolioSnapshot

`PortfolioSnapshot` is the read-only view of portfolio state passed into both strategy hooks on every call.

```typescript
type PortfolioSnapshot = {
  nowMs: number
  realizedPnlTotal?: number
  positionsByAssetId: Record<string, Position>
  openOrdersByClientId: Record<string, OpenOrder>
  wsOpenOrdersByOrderId?: Record<string, WsOpenOrder>
  ordersByClientId: Record<string, OrderSnapshot>
  recentFills: Fill[]
  recentSplits?: PositionsSplit[]
  marketByAssetId: Record<string, string>
}
```

| Field                   | Type                                     | Description                                                                                                              |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `nowMs`                 | `number`                                 | Current epoch milliseconds (live clock or replay clock).                                                                 |
| `realizedPnlTotal`      | `number` (optional)                      | Cumulative realized PnL across all assets, including closed positions.                                                   |
| `positionsByAssetId`    | `Record<string, Position>`               | Current open positions keyed by `assetId`.                                                                               |
| `openOrdersByClientId`  | `Record<string, OpenOrder>`              | Orders currently considered open, keyed by `clientOrderId`.                                                              |
| `wsOpenOrdersByOrderId` | `Record<string, WsOpenOrder>` (optional) | Raw open-order view from the USER websocket channel, keyed by exchange order ID. Includes orders not placed by this bot. |
| `ordersByClientId`      | `Record<string, OrderSnapshot>`          | Full order lifecycle view keyed by `clientOrderId`. More reliable than `openOrdersByClientId` for checking status.       |
| `recentFills`           | `Fill[]`                                 | Fills received since the last snapshot reset.                                                                            |
| `recentSplits`          | `PositionsSplit[]` (optional)            | Recent CTF split events for accounting purposes. Not counted as fills.                                                   |
| `marketByAssetId`       | `Record<string, string>`                 | Best-effort mapping from `assetId` to condition ID. Useful for grouping YES/NO pairs.                                    |

### `Position`

```typescript
type Position = {
  assetId: string
  qty: number
  avgEntryPrice: number | null
  costBasis: number
}
```

| Field           | Description                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `qty`           | Current share quantity.                                                                                                         |
| `avgEntryPrice` | Average price paid per share, or `null` if unknown.                                                                             |
| `costBasis`     | Average-cost cost basis of remaining shares. Accurately reflects what you paid for current inventory without FIFO lot tracking. |

### `OpenOrder`

```typescript
type OpenOrder = {
  clientOrderId: string
  orderId?: string
  market?: string
  assetId: string
  side: OrderSide
  price: number
  size: number
  remaining: number
  filled: number
  orderType: OrderType
  meta?: Record<string, unknown>
  expireAtMs?: number
  state: OrderLifecycleState
  createdAtMs: number
  updatedAtMs: number
  lastError?: string
}
```

### `OrderLifecycleState`

```typescript
type OrderLifecycleState =
  | 'requested'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'expired'
  | 'killed'
```

### `OrderSnapshot`

A simplified, strategy-friendly order view that correlates websocket events back to `clientOrderId`.

```typescript
type OrderSnapshot = {
  clientOrderId: string
  orderId?: string
  assetId: string
  side: OrderSide
  price?: number
  originalSize?: number
  sizeMatched?: number
  remaining?: number
  lifecycleState?: OrderLifecycleState
  tradeStatusRaw?: string
  tradeStatusRank: TradeStatusRank // 0 = unknown, 1 = MATCHED, 2 = MINED, 3 = CONFIRMED
  updatedAtMs: number
  meta?: Record<string, unknown>
}
```

### `Fill`

```typescript
type Fill = {
  id: string
  tsMs: number
  market?: string
  assetId: string
  side: OrderSide
  price: number
  size: number
  feeRateBps?: number
  clientOrderId?: string
  orderId?: string
  liquidity?: 'MAKER' | 'TAKER'
  intentMeta?: Record<string, unknown>
}
```

### `PositionsSplit`

Records a CTF `splitPosition` execution. Not a trade and not counted toward fill metrics.

```typescript
type PositionsSplit = {
  id: string
  tsMs: number
  market?: string
  assetIdA: string
  assetIdB: string
  size: number // Full-set count: split N => +N shares on both assetIdA and assetIdB.
  splitCost: number // USDC collateral spent.
  reason?: string
}
```

### `Metrics`

Derived, strategy-friendly metrics attached to `StrategyContext`. Computed once per tick and passed via `ctx.metrics`.

```typescript
type Metrics = {
  position?: PositionMetrics
  orderbook?: OrderbookMetrics
}
```

#### `PositionMetrics`

Computed for 2-outcome UP/DOWN markets.

| Field              | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `shares_mergeable` | Number of full sets that can be merged (min of UP and DOWN quantities).          |
| `pair_avg`         | Average cost of one merge pair (UP avg + DOWN avg). `null` if either is unknown. |
| `total_cost`       | Total cost basis across UP and DOWN positions.                                   |
| `pnl_merge`        | Estimated PnL if all mergeable shares are merged now.                            |
| `pnl_if_up_wins`   | Estimated PnL at market resolution if UP outcome wins.                           |
| `pnl_if_down_wins` | Estimated PnL at market resolution if DOWN outcome wins.                         |
| `imbalance`        | Signed quantity difference between UP and DOWN positions.                        |

#### `OrderbookMetrics`

| Field                 | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `depthLevels`         | Number of computed depth levels (bounded by the shallower side).             |
| `weakBidSideByLevel`  | Which side (`UP`, `DOWN`, or `NONE`) has the weaker bid at each depth level. |
| `weakBidRatioByLevel` | Ratio of weak-to-strong bid size at each depth level.                        |
| `weakAskSideByLevel`  | Which side has the weaker ask at each depth level.                           |
| `weakAskRatioByLevel` | Ratio of weak-to-strong ask size at each depth level.                        |

---

## AccountEvent

`AccountEvent` is a discriminated union. Each variant carries a `kind` field.

| `kind`                  | Description                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_submitted`       | An order intent was accepted by `OrderManager` and submitted to the exchange.                                                                              |
| `order_accepted`        | The exchange accepted the order (pre-open confirmation).                                                                                                   |
| `order_rejected`        | The exchange rejected the order. `reason` is provided.                                                                                                     |
| `order_open`            | The order is now resting on the book.                                                                                                                      |
| `order_done`            | The order lifecycle is complete. `reason` is one of `filled`, `canceled`, `expired`, `killed`.                                                             |
| `fill`                  | A trade fill occurred. Contains a `Fill` record.                                                                                                           |
| `positions_split`       | A CTF split completed. Contains a `PositionsSplit` record.                                                                                                 |
| `positions_merged`      | A CTF merge completed. `size` is the number of pairs actually merged (may be less than requested).                                                         |
| `merge_failed`          | A merge intent failed.                                                                                                                                     |
| `split_failed`          | A split intent failed.                                                                                                                                     |
| `ws_order_update`       | A raw, normalized order update from the Polymarket USER websocket channel. Useful for tracking all account orders, including those not placed by this bot. |
| `account_stream_status` | The account event stream connected or disconnected. `source` is `user_ws` or `rest_poll`.                                                                  |

### Full `AccountEvent` type

```typescript
type AccountEvent =
  | { kind: 'order_submitted'; tsMs: number; order: OpenOrder }
  | { kind: 'order_accepted'; tsMs: number; clientOrderId: string; orderId?: string }
  | { kind: 'order_rejected'; tsMs: number; clientOrderId: string; reason: string }
  | { kind: 'order_open'; tsMs: number; clientOrderId?: string; orderId?: string }
  | {
      kind: 'order_done'
      tsMs: number
      clientOrderId?: string
      orderId?: string
      reason: 'filled' | 'canceled' | 'expired' | 'killed'
    }
  | { kind: 'fill'; fill: Fill }
  | { kind: 'positions_split'; split: PositionsSplit }
  | {
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
  | { kind: 'ws_order_update'; tsMs: number; order: WsOrderUpdate }
  | {
      kind: 'account_stream_status'
      tsMs: number
      source: 'user_ws' | 'rest_poll'
      status: 'connected' | 'disconnected'
      info?: string
    }
```

---

## External Feeds

The `requiredFeeds` property on `Strategy` declares which live data feeds to start. These fields are only consulted by `trading-bot.ts` — backtests ignore them entirely.

```typescript
requiredFeeds?: {
  rtdsCryptoPrices?: {
    binanceSymbols?: string[]    // e.g. ["btcusdt"]
    chainlinkSymbols?: string[]  // e.g. ["btc/usd"]
  }
  binanceWsSpotPrice?: {
    symbol?: string              // e.g. "btcusdt" — connects to Binance aggTrade stream
  }
  polymarketPriceToBeat?: {
    enabled?: boolean            // Polls Polymarket for the interval's open price
  }
}
```

Feed data is available inside `onMarketTick` via `ctx.plugins?.['externalFeeds']` as an `ExternalFeedsSnapshot`. See [Strategy Context](./strategy-context.md) for details.
