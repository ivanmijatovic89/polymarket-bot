---
title: Live Execution
description: Reference for LiveExecution — market warmup, order submission, batch placement, fill tracking, and on-chain split/merge operations.
---

# Live Execution

`LiveExecution` implements the `ExecutionAdapter` interface for live trading. It wraps the `@polymarket/clob-client` for CLOB operations and invokes on-chain helpers for ConditionalTokens split/merge. Unlike `BacktestExecution`, it contacts the Polymarket API and Polygon blockchain for every operation.

## Construction

```typescript
new LiveExecution(opts?: {
  config?: PolymarketConfig        // Loaded from env if not provided
  overrides?: {
    host?: string
    chainId?: number
    privateKey?: string
    creds?: PolymarketConfig['creds']
    signatureType?: number
    funder?: string
  }
  orderCreateOptions?: {
    tickSize?: string
    negRisk?: boolean
  }
  onSplitSuccess?: (info: {
    conditionId: string
    txHash: string
    splitShares: number
  }) => void
})
```

If neither `config` nor `overrides` is provided, configuration is loaded entirely from environment variables via `loadPolymarketConfigFromEnv()`.

## warmupMarket

```typescript
async warmupMarket(args: { assetIds: string[]; slug?: string }): Promise<void>
```

`@polymarket/clob-client` fetches token metadata lazily on the first order for each token ID: tick size, negRisk flag, and fee rate in basis points. This cold-start fetch adds latency to the first order submitted for each token.

`warmupMarket` pre-fetches all three metadata values for each provided asset ID in parallel:

```typescript
await Promise.all([
  this.client.getTickSize(tokenID),
  this.client.getNegRisk(tokenID),
  this.client.getFeeRateBps(tokenID),
])
```

Already-warmed token IDs (tracked in `warmedTokenIds`) are skipped. The `trading-bot.ts` entry point calls `warmupMarket` on startup and on each 15-minute market window rotation. Strategies can check warm state via `isWarmed(ctx)` from `strategyToolkit`.

::: tip
In backtests, `ctx.warmup` is absent and `isWarmed` always returns `true`. Warmup is a live-only concept.
:::

## placeLimit

Submits a single limit order to the Polymarket CLOB.

1. `client.createOrder()` — builds and signs the order (EIP-712 or SAFE signature, depending on `signatureType`).
2. `client.postOrder(signed, orderType)` — submits to the REST API.

The response is checked for two failure modes:

- An `error` field in the HTTP response (set by the client library's error handler).
- `success: false` with an `errorMsg` in the API response body.

On success, only `order_accepted` is emitted (with the exchange `orderId` when present). `order_open` and subsequent lifecycle events are **not** emitted here — they arrive via the user WebSocket channel and are applied to the portfolio by the WS feed handler.

On failure, `order_rejected` is emitted with the error string as `reason`.

## placeBatch

Submits up to 15 orders in a single batch API call.

```
Maximum batch size: 15 orders
```

Orders beyond 15 are all rejected with `reason: 'batch_too_large(max_15_orders)'` before any API call is made.

The flow:

1. All orders are signed in parallel via `client.createOrder()`.
2. The batch is submitted via `client.postOrders(batchOrders)`.
3. The response array is iterated in index order. Each entry may indicate success (emits `order_accepted`) or failure (emits `order_rejected`).
4. If the response array is shorter than the orders array, remaining orders are rejected with `reason: 'missing_batch_response'`.
5. If the response is not an array, all orders are rejected with `reason: 'invalid_batch_response'`.

## cancelOrder

```typescript
async cancelOrder(intent: CancelOrderIntent, ctx: OrderManagerContext): Promise<...>
```

Requires `intent.orderId` (the exchange order ID). If `orderId` is present, calls `client.cancelOrder({ orderID })` and emits `order_done(reason='canceled')` if `clientOrderId` is also known.

If only `clientOrderId` is available (no `orderId`), the method is a no-op — the CLOB API requires an exchange order ID to cancel. This case is handled upstream by the portfolio's `orderId → clientOrderId` mapping.

Cancel errors from the API are silently swallowed (`catch(() => undefined)`). The intent is that the cancel reaches the exchange on a best-effort basis; the actual order state is eventually reconciled via the user WS channel.

## cancelAll

Calls `client.cancelAll()` with error silently swallowed. Returns no events — the actual cancellations are reflected via the user WS channel.

## onMarketTick

```typescript
async onMarketTick(ctx: OrderManagerContext): Promise<{ events: AccountEvent[] }>
```

Returns an empty event list. In live mode, fills arrive from the user WebSocket channel, not from market ticks. This method exists to satisfy the `ExecutionAdapter` interface.

## splitPositions

Splits USDC collateral into equal YES and NO shares via the ConditionalTokens contract on Polygon.

**Mode selection** (via `POLYMARKET_TX_MODE_SPLIT` env var):

| Mode               | Mechanism                                                               |
| ------------------ | ----------------------------------------------------------------------- |
| `direct` (default) | Signs and submits the on-chain transaction directly using `PRIVATE_KEY` |
| `relayer`          | Delegates to the Polymarket builder relayer (`splitViaRelayer`)         |

**Retry behavior**: Up to `SPLIT_MAX_RETRY` attempts (default 2) with `SPLIT_RETRY_DELAY_MS` ms between retries (default 3000 ms).

On success, emits `positions_split` with the transaction hash embedded in the reason field. The optional `onSplitSuccess` callback is invoked after a successful transaction.

On all-retry failure, emits `split_failed` with the last error message.

**Required preconditions**:

- `ctx.lastMarket.market` must be set (used as the `conditionId`).
- `config.privateKey` must be present for direct mode.

## mergePositions

Burns equal quantities of YES and NO shares and redeems USDC collateral via the ConditionalTokens contract.

**Mode selection** (via `POLYMARKET_TX_MODE_MERGE` env var): same `direct` / `relayer` options as split.

**Retry behavior**: Up to `MERGE_MAX_RETRY` attempts (default 2) with `MERGE_RETRY_DELAY_MS` ms between retries (default 3000 ms).

On success, emits `positions_merged`. On all-retry failure, emits `merge_failed`.

::: danger
Merge requires the shares being merged to have reached `MINED` status on-chain. Attempting to merge shares that are only `MATCHED` will fail with a contract error. See [Portfolio](./portfolio.md) for the MATCHED vs. MINED distinction.
:::

## Gas Configuration

Direct-mode transactions use `POLYMARKET_EOA_GAS_MULTIPLIER` (default `2`) as a gas price multiplier to reduce the risk of transactions being stuck at low gas prices. The `POLYGON_RPC_URL` environment variable overrides the default public RPC endpoint (`https://polygon-bor-rpc.publicnode.com`).
