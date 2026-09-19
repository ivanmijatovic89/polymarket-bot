---
title: Backtest Execution
description: Reference for BacktestExecution — fill simulation models, latency simulation parameters, GTD expiry handling, and the pending-action queue.
---

# Backtest Execution

`BacktestExecution` implements the `ExecutionAdapter` interface for the backtest mode. It simulates order acceptance, fill generation, and cancellation deterministically from the replayed orderbook state, without contacting the Polymarket API.

## Constructor Options

```typescript
new BacktestExecution(opts?: {
  latencyMs?: number      // Base latency in ms. Default: 0
  jitterMs?: number       // Symmetric random jitter in ms. Default: 0
  cancelLatency?: boolean // Apply latency to cancel operations. Default: true
  makerFillMode?: 'touch_or_better' | 'worst_queue'  // Default: 'worst_queue'
})
```

## Latency Simulation

When `latencyMs` or `jitterMs` are non-zero, the execution layer defers operations by placing them on a `pending` queue. The effective execution timestamp is computed as:

```typescript
executeAtMs = nowMs + latencyMs + jitter
// jitter ∈ [−jitterMs, +jitterMs] (uniform, symmetric)
```

Operations whose `executeAtMs <= nowMs` are executed immediately (zero-latency path). Otherwise they are pushed to `pending` and executed at the start of the first `onMarketTick` call where `nowMs >= executeAtMs`.

The following operations are subject to latency:

| Operation        | Delayed by default               |
| ---------------- | -------------------------------- |
| `placeLimit`     | Yes                              |
| `placeBatch`     | Yes                              |
| `cancelOrder`    | Yes (when `cancelLatency: true`) |
| `cancelBatch` | Yes (when `cancelLatency: true`) |
| `cancelMarket` | Yes (when `cancelLatency: true`) |
| `cancelAll`      | Yes (when `cancelLatency: true`) |
| `mergePositions` | No (applied immediately)         |
| `splitPositions` | No (applied immediately)         |

::: tip
Set `BACKTEST_LATENCY_DELAY` (ms) and `BACKTEST_LATENCY_JITTER` (ms) as environment variables. The `backtest.ts` entry point reads these and passes them to `BacktestExecution`. A latency of 140 ms with 30 ms jitter is a reasonable approximation of Polymarket CLOB round-trip for initial calibration.
:::

::: warning
When latency is non-zero, a cancel can arrive "after" a fill. If the market moves through a resting order's price level before the cancel's `executeAtMs`, the order will fill and the cancel becomes a no-op. This is the correct real-world behavior.
:::

The pending queue is sorted by `executeAtMs` and then by insertion `seq` (monotonic integer) to ensure deterministic ordering when multiple operations share the same effective timestamp.

## Selected and Scoped Cancellation

`cancel_batch` cancels only the selected simulated open remainders. `cancel_market` selects by condition ID and/or outcome token at execution time, so it includes matching orders that became open during the delay. Both filters must match when supplied. Unknown or already completed simulator orders are no-ops, and repeated requests do not emit duplicate terminal events.

The existing queue order remains unchanged: due actions execute by time and sequence before that tick's maker-fill checks. Fills on earlier ticks, including partially filled taker orders, remain in positions, costs, fees, and PnL. Cancellation removes only the remainder. With `cancelLatency: false`, cancellation skips adapter latency but still respects the manager's queued/immediate mode.

Shared validation rejects missing exchange acknowledgements for client-targeted batch cancellation before dispatch. A strategy can wait for `order_accepted` and retry, or use a scoped cancellation whose selection happens at execution time.

## Fill Simulation Models

### Taker Fills (FOK and immediate GTC/GTD)

When an order is placed and the current book can satisfy it, taker fills are computed by `buildFillsFromBook`. The function walks the opposite side of the book level by level, filling at each level's price until either the order is complete or there is no more liquidity at or better than the limit price:

- BUY order: consumes `asks` in ascending price order, stopping when `ask.price > limitPrice`
- SELL order: consumes `bids` in descending price order, stopping when `bid.price < limitPrice`

Taker fills carry `liquidity: 'TAKER'` and are stamped with `feeRateBps` = `POLYMARKET_CRYPTO_TAKER_FEE_BPS` (hardcoded 700 bps, matching Polymarket's documented crypto-market fee — see [Fee Computation](../reference/fee-computation.md)).

### Maker Fills (Resting GTC/GTD orders)

Resting orders are checked on every `onMarketTick` call via `buildMakerFillTouchCross`. The default mode is `worst_queue`:

**`worst_queue` (default)**

A resting BUY at price P fills only when `bestAsk < P` (the best ask goes strictly through the level). A resting SELL at price P fills only when `bestBid > P`.

This is conservative: it models the worst-case queue position (last in queue at that level), meaning the order fills only when the price moves through the level rather than just touching it.

**`touch_or_better`**

A resting BUY at price P fills when `bestAsk <= P`. A resting SELL at price P fills when `bestBid >= P`.

This is optimistic: it assumes the resting order is at the front of its queue and fills the moment the opposite side touches the level.

Maker fills carry `liquidity: 'MAKER'` and execute at the resting limit price (no slippage). Maker fills are always for the full remaining quantity of the order (no partial maker fills in the current model).

## FOK Order Handling

A Fill-or-Kill order is checked against `sumFillableSize` before any fill is attempted. If the fillable quantity (sum of all book levels at or better than the limit price) is less than the order size, the order is immediately killed:

```
order_accepted → ws_order_update(status=MATCHED) → ws_order_update(status=CANCELED) → order_done(reason=killed)
```

If sufficient liquidity exists, the order fills completely via `buildFillsFromBook`:

```
order_accepted → ws_order_update(status=MATCHED) → fill(s) → order_done(reason=filled) → ws_order_update(status=CONFIRMED)
```

## GTC / GTD Order Handling

On placement, an ordinary GTC or GTD order first attempts an immediate taker fill against the current book. Any unfilled remainder becomes a resting order stored in `openByClientId`.

If the order fills completely on placement:

```
order_accepted → ws_order_update(status=MATCHED) → fill(s) → order_done(reason=filled)
```

If a remainder rests:

```
order_accepted → ws_order_update(status=MATCHED) → fill(s, if any) → order_open
```

The resting order is then subject to maker fill checks on each subsequent tick.

### Post-only GTC / GTD

With `postOnly: true`, placement first checks the opposing best price at execution time (including any queued latency). A BUY with `price >= bestAsk` or SELL with `price <= bestBid` emits only `order_rejected(reason=post_only_would_cross)` from the execution adapter. There is no acceptance, simulated MATCHED update, fill, or resting remainder. `OrderManager` has already emitted `order_submitted` and releases the rejected order's active client ID.

Non-crossing orders rest normally, including when the opposing side or book is absent. The initial rejection check is never applied again to an already resting order: later ticks use the existing maker-fill model, cancellation, and GTD expiry. Each batch entry is checked independently. Omitted or false flags preserve the ordinary taker/resting behavior.

## GTD Expiry

On each `onMarketTick` call, resting GTD orders are checked for expiry before maker fill evaluation:

```typescript
if (o.orderType === 'GTD' && typeof o.expireAtMs === 'number' && nowMs >= o.expireAtMs) {
  // emit order_done(reason='expired')
}
```

`nowMs` is the exchange timestamp of the current tick, ensuring expiry behaves consistently with GTD minimum enforcement in `OrderManager`.

## Status Progression Simulation

`BacktestExecution` emits `ws_order_update` events with `status: 'MATCHED'` immediately on order placement, mirroring what the live user WebSocket channel delivers. This allows strategies that gate on trade status (e.g., waiting for `MINED` before selling) to be tested in backtests using the same Portfolio logic as live.

::: tip
In backtests, `MATCHED` is the only status emitted for resting and partially-filled orders. `MINED` and `CONFIRMED` are not simulated. If your strategy gates sell/merge on `tradeStatusRank >= 2` (MINED), it will never sell in a backtest unless you adjust the gating logic for backtest mode.
:::

## Split and Merge

Both `splitPositions` and `mergePositions` are simulated instantaneously (no latency). `splitPositions` always succeeds for valid inputs, minting 1 collateral per share pair. `mergePositions` succeeds for min(`qa`, `qb`, `requested`) shares. Neither operation contacts the blockchain.
