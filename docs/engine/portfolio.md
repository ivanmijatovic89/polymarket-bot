---
title: Portfolio
description: How the Portfolio tracks positions and orders — including fill idempotency across multiple event sources, out-of-order event buffering, and the critical MATCHED vs. MINED status distinction.
---

# Portfolio

The `Portfolio` class is the in-memory state machine that owns all position and order state. It is the single source of truth for what the bot believes about its current holdings and open orders. Every `AccountEvent` produced by the `OrderManager`, `ExecutionAdapter`, WebSocket feeds, and REST polling flows through `Portfolio.apply()`.

## Position Tracking

Positions are stored in `positionsByAssetId`, a `Map<string, Position>` keyed by CLOB token ID. Each position carries:

- `qty` — current quantity held (rounded to 2 decimal places)
- `avgEntryPrice` — average cost per share, recomputed on each fill
- `costBasis` — total USDC paid for the current position (average-cost accounting)

On a BUY fill, the new quantity and average entry price are computed using running-average accounting:

```
newQty       = prev.qty + netSize          (after subtracting base-asset maker fees)
newCostBasis = prev.costBasis + price × size
avgEntry     = newCostBasis / newQty
```

On a SELL fill, the cost basis is reduced proportionally and realized PnL is accumulated into `realizedPnlTotal`:

```
realizedDelta = netProceeds - avgCostPerShare × sellQty
```

When a position reaches zero quantity, it is deleted from the map. This keeps the portfolio bounded in memory across many market windows rather than accumulating zero-quantity entries indefinitely.

## Fill Idempotency

In live trading, fills arrive from two sources: the user WebSocket channel and the REST polling fallback. Network reconnects can cause the same fill event to be delivered more than once. The portfolio guards against duplicate application with a `seenFillIds` set:

```typescript
private fillSeenOnce(id: string, tsMs: number): boolean {
  if (this.seenFillIds.has(id)) return false
  this.seenFillIds.set(id, tsMs)
  // ...prune oldest when > maxSeenFillIds (50_000)
  return true
}
```

A fill is skipped entirely if its `id` has already been seen. The set is pruned by dropping the oldest 10% of entries when it exceeds 50,000 entries — a design chosen to bound memory while keeping recent fill history fully protected.

## Out-of-Order Fill Buffering

The WebSocket can deliver fill events (`ws_order_update` / `fill`) before the bot has processed the corresponding `order_accepted` event that establishes the `orderId → clientOrderId` mapping. When this happens, the portfolio cannot immediately associate the fill with an open order.

The buffer is `pendingFilledByOrderId: Map<string, number>`, which accumulates fill sizes by exchange `orderId`. Once `order_accepted` or `order_open` arrives and the mapping is known, `applyPendingFillsForOrderId` drains the buffered size into the open order:

```typescript
private applyPendingFillsForOrderId(orderId: string): boolean {
  const pending = this.pendingFilledByOrderId.get(orderId)
  if (pending === undefined) return false
  const cid = this.clientOrderIdByOrderId.get(orderId)
  // ...apply to open order
}
```

Similarly, `pendingTradeStatusByOrderId` buffers `MATCHED`/`MINED`/`CONFIRMED` status updates that arrive before the mapping is established.

## MATCHED vs. MINED: The Critical Status Distinction

Polymarket's fill lifecycle progresses through three states:

| Status      | `tradeStatusRank` | Meaning                                         |
| ----------- | ----------------- | ----------------------------------------------- |
| `MATCHED`   | 1                 | Order matched by the exchange; not yet on-chain |
| `MINED`     | 2                 | Transaction included in a Polygon block         |
| `CONFIRMED` | 3                 | Block finalized                                 |

::: danger Critical Gotcha
Strategies must **not** sell shares or merge positions until the status of the original buy reaches `MINED`. The `MATCHED` status indicates only that the CLOB matched the order; the shares do not exist on-chain yet. Attempting to sell or merge at `MATCHED` will fail with a balance error.

The `USER_WS_FILL_AT_STATUS` environment variable controls when the bot emits fill events to strategies. Setting it to `MATCHED` gives faster position updates but requires the strategy itself to gate any subsequent sell/merge on the `MINED` status visible in `ordersByClientId`.
:::

The portfolio tracks the highest-observed `tradeStatusRank` per order in `OrderSnapshot.tradeStatusRank`. The rank is monotonically increasing — once `MINED`, it cannot go back to `MATCHED`. Strategies read this field from `portfolio.ordersByClientId[clientOrderId].tradeStatusRank`.

## Order Snapshot vs. Open Order

The portfolio maintains two separate collections for orders:

- `openOrdersByClientId` — orders that are currently active (state is `requested`, `open`, or `partially_filled`). Entries are removed when an order is filled, canceled, expired, or killed.
- `ordersByClientIdSnapshot` — a persistent record of all orders, including closed ones, capped at 10,000 entries with LRU eviction. Used for post-hoc analysis and status reconciliation.

The `ordersByClientIdSnapshot` map also retains the persistent `orderId → clientOrderId` index (`clientOrderIdByOrderIdSnapshot`) for up to 50,000 entries, allowing late-arriving WS trade-status progressions to be correctly associated with the right order even after it has been removed from `openOrdersByClientId`.

## WS Open Orders (External Orders)

In addition to bot-placed orders, the portfolio tracks all orders observed on the user WS channel in `wsOpenOrdersByOrderId`. This includes orders placed outside the bot (e.g., manually via the Polymarket UI or another process). An order is removed from this map when it is observed as fully filled or canceled. This collection is primarily informational and is included in the portfolio snapshot for the web UI.

## Position Split and Merge Accounting

`positions_split` mints equal quantities of both YES and NO shares (one collateral unit per share pair). The minted shares are added to `positionsByAssetId` with `avgEntryPrice: null` and `costBasis: 0`. This means subsequent sells of split-minted shares are treated as pure proceeds unless the strategy explicitly models the split cost.

`positions_merged` reduces both positions by the merged quantity (capped at the minimum of the two holdings). Realized PnL is not updated on merge — the cost basis of whatever was sold earlier already captured the P&L.

## Memory Bounds

The portfolio is designed to run continuously across many market windows. Key caps:

| Structure                        | Cap                | Eviction               |
| -------------------------------- | ------------------ | ---------------------- |
| `seenFillIds`                    | 50,000             | Oldest 10% dropped     |
| `ordersByClientIdSnapshot`       | 10,000             | Oldest 10% dropped     |
| `clientOrderIdByOrderIdSnapshot` | 50,000             | Oldest 10% dropped     |
| `pendingTradeStatusByOrderId`    | 10,000             | Oldest 10% dropped     |
| `recentFills`                    | 500 (configurable) | Oldest entries spliced |
| `recentSplits`                   | 500                | Oldest entries spliced |
