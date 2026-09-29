---
title: Portfolio
description: How the Portfolio tracks positions and orders — including fill idempotency across multiple event sources, out-of-order event buffering, and the critical MATCHED vs. MINED status distinction.
---

# Portfolio

The `Portfolio` class is the in-memory state machine that owns all position and order state. It is the single source of truth for what the bot believes about its current holdings and open orders. Every `AccountEvent` produced by the `OrderManager`, `ExecutionAdapter`, WebSocket feeds, and REST polling flows through `Portfolio.apply()`.

## Execution Capital

`new Portfolio({ startingCapital: 500 })` initializes a market allowance in USDC. The default is **500 USDC**; zero is valid, and negative or non-finite amounts are rejected. Every engine-produced snapshot exposes `capital`:

| Field             | Meaning (USDC)                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| `startingCapital` | Configured starting allowance for this market                                |
| `cash`            | Starting allowance plus actual cash flows applied so far                     |
| `reservedCash`    | Remaining BUY obligations, including matched quantities awaiting fill events |
| `availableCash`   | `cash - reservedCash`                                                        |

BUY fills debit notional plus taker fees; SELL fills credit notional minus taker fees. Maker fills have no fee. Accounting uses the existing fee function and eight-decimal cash arithmetic, independently of the two-decimal cost-basis/PnL presentation. Successful splits debit `splitCost`; successful merges credit the confirmed number of full sets. Failed operations change no cash. Fill IDs and stable split/merge operation IDs prevent duplicate cash movements and duplicate positions.

Reservations use the unexecuted quantity at the BUY limit price plus the current fee allowance. Post-only orders reserve no taker fee. A fill converts that part of the reservation into actual expenditure; it does not charge twice. Ordinary order-status updates never debit cash. A fully matched order remains reserved until its fill events have been applied.

A cancellation request or `cancel_failed` releases nothing. Confirmed closure with a final executed quantity releases only the unused portion; reported matches whose fill events are still missing stay reserved. `order_done.filledSize` provides this cumulative quantity for cancellation/expiry. A live REST cancellation acknowledgement without that quantity closes the order but keeps its unresolved cash reserved until the terminal WebSocket update arrives. If that update is lost, the engine conservatively retains the hold for the market. Late fills still debit exactly once, including after closure or reuse of a client order ID.

`StrategyRunner` adds OrderManager's still-unapplied submissions and successful splits to the cash snapshot passed to **both** strategy callbacks. Thus strategies see all current obligations, including events still queued for delivery. Custom runners must perform the same enrichment and reconcile each applied event; a bare Portfolio snapshot contains only applied account events.

Confirmed sales and merges make cash reusable in the same market, so turnover may exceed starting capital. Unrealized PnL, unfilled sales, and future settlement payouts provide no spendable cash. This is an engine allowance, distinct from live wallet data in `ctx.balance`, aggregate statistics' `INITIAL_CAPITAL`, and the realized-loss threshold `maxLossStop`. See [configuration](../backtest/running-backtests.md#per-market-execution-capital) and [market resets](./strategy-runner.md#market-capital-and-player-resets).

## Positions

Positions are stored in `positionsByAssetId`, a `Map<string, Position>` keyed by CLOB token ID. Each position carries:

- `qty` — current quantity held (rounded to 2 decimal places)
- `avgEntryPrice` — average cost per share, recomputed on each fill
- `costBasis` — total USDC paid for the current position (average-cost accounting)

On a BUY fill, the new quantity and average entry price are computed using running-average accounting:

```
newQty       = prev.qty + size
newCostBasis = prev.costBasis + price × size + takerFeeUsdc
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

Bot orders retain the requested optional `postOnly` flag in both collections, including history after rejection or completion. It records the request, not exchange acceptance or proof of a maker fill. The WebUI displays it in open orders and order history; orders observed only through the user WebSocket have an unknown flag because this feed adapter does not supply it.

## WS Open Orders (External Orders)

In addition to bot-placed orders, the portfolio tracks all orders observed on the user WS channel in `wsOpenOrdersByOrderId`. This includes orders placed outside the bot (e.g., manually via the Polymarket UI or another process). An order is removed from this map when it is observed as fully filled or canceled. This collection is primarily informational and is included in the portfolio snapshot for the web UI.

## Confirmed Cancellation

`order_done` removes the matching bot order and its WS entry; exchange-only IDs also remove external WS orders. Cancellation does not reverse fills or change positions, cost basis, fees, or realized PnL. A `cancel_failed` event leaves order state unchanged.

A bounded set of terminal exchange IDs prevents delayed WS placement/update messages from reopening confirmed canceled orders. Late trade-status updates may still advance history, and late fills continue through normal fill idempotency. Events carrying an old exchange ID cannot close a newer order that reused the same client ID.

The exchange-ID check also protects replacements that have been submitted but not yet acknowledged. Old acknowledgements, open events, and WS updates cannot overwrite the replacement's identity or history. A late fill from the old order still updates positions exactly once, but does not reduce the replacement's remaining quantity. A fill for a new, unacknowledged exchange ID is buffered for order reconciliation until that ID is linked to the replacement.

## Position Split and Merge Accounting

`positions_split` mints equal quantities of both YES and NO shares (one collateral unit per share pair). The minted shares are added to `positionsByAssetId` with `avgEntryPrice: null` and `costBasis: 0`. This means subsequent sells of split-minted shares are treated as pure proceeds unless the strategy explicitly models the split cost.

`positions_merged` reduces both positions by the merged quantity (capped at the minimum of the two holdings). The existing realized-PnL presentation is not updated on merge. Cash accounting separately credits confirmed collateral proceeds. Consequently, neither split nor merge cash can be reconstructed reliably from `realizedPnlTotal` and remaining cost basis.

## Memory Bounds

The portfolio is designed to run continuously across many market windows. Key caps:

| Structure                        | Cap                | Eviction               |
| -------------------------------- | ------------------ | ---------------------- |
| `seenFillIds`                    | 50,000             | Oldest 10% dropped     |
| `ordersByClientIdSnapshot`       | 10,000             | Oldest 10% dropped     |
| `clientOrderIdByOrderIdSnapshot` | 50,000             | Oldest 10% dropped     |
| `terminalOrderIds`               | 50,000             | Oldest entry dropped   |
| `pendingTradeStatusByOrderId`    | 10,000             | Oldest 10% dropped     |
| `recentFills`                    | 500 (configurable) | Oldest entries spliced |
| `recentSplits`                   | 500                | Oldest entries spliced |
