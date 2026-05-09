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

## Fill Simulation Models

### Taker Fills (FOK and immediate GTC/GTD)

When an order is placed and the current book can satisfy it, taker fills are computed by `buildFillsFromBook`. The function walks the opposite side of the book level by level, filling at each level's price until either the order is complete or there is no more liquidity at or better than the limit price:

- BUY order: consumes `asks` in ascending price order, stopping when `ask.price > limitPrice`
- SELL order: consumes `bids` in descending price order, stopping when `bid.price < limitPrice`

Taker fills carry `liquidity: 'TAKER'` and include the `feeRateBps` from `getBacktestTakerFeeBps()` (read from the `BACKTEST_TAKER_FEE_BPS` environment variable, or a default).

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

On placement, a GTC or GTD order first attempts an immediate taker fill against the current book. Any unfilled remainder becomes a resting order stored in `openByClientId`.

If the order fills completely on placement:

```
order_accepted → ws_order_update(status=MATCHED) → fill(s) → order_done(reason=filled)
```

If a remainder rests:

```
order_accepted → ws_order_update(status=MATCHED) → fill(s, if any) → order_open
```

The resting order is then subject to maker fill checks on each subsequent tick.

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
