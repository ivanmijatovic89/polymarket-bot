---
title: Order Manager
description: How the OrderManager validates, deduplicates, and routes intents from strategies to the execution layer — including GTD expiry enforcement, the dry-run gate, and the queued vs. immediate execution model.
---

# Order Manager

The `OrderManager` sits between strategy intent output and the `ExecutionAdapter` (either `LiveExecution` or `BacktestExecution`). Its role is to enforce invariants that must hold regardless of which execution backend is active: deduplication, validation, GTD expiry minimums, and the dry-run gate.

## Intent Flow

Strategies return `Intent[]` from both `onMarketTick` and `onAccountEvent`. The `StrategyRunner` passes these to `OrderManager.handleIntents`, which routes them based on the current `IntentExecutionMode`.

```mermaid
flowchart TD
    S[Strategy] -->|Intent[]| HI[handleIntents]
    HI -->|queued mode| PQ[pendingIntents queue]
    HI -->|immediate mode| RL[enforceRiskLimits]
    PQ -->|next onMarketTick| RL
    RL -->|allowed| EX[executeIntentsNow]
    RL -->|rejected| RE[order_rejected events]
    EX --> V{validate}
    V -->|invalid| RJ[order_rejected]
    V -->|duplicate clientOrderId| DROP[drop silently]
    V -->|valid + dry-run| SIM[simulate accept/open]
    V -->|valid + live| EA[ExecutionAdapter]
    EA -->|AccountEvent[]| SR[StrategyRunner cascade]
```

### Queued vs. Immediate Mode

In `queued` mode (the default, used in backtests), `handleIntents` pushes intents onto `pendingIntents` and returns an empty event list immediately. These are flushed at the start of the next market tick in `onMarketTick`. This models a one-tick round-trip latency: the strategy decides on tick N, the order arrives at the exchange on tick N+1.

In `immediate` mode (used in live trading), intents bypass the queue and are executed within the same tick they are generated.

## Client Order ID Deduplication

Every `place_limit` intent must carry a `clientOrderId`. The `OrderManager` maintains `activeClientOrders`, a `Set<ClientOrderId>`, to prevent the same intent from being submitted more than once:

```typescript
if (this.activeClientOrders.has(intent.clientOrderId)) return []
this.activeClientOrders.add(intent.clientOrderId)
```

An ID is removed from the set when:

- The order is rejected (`order_rejected` event)
- The order reaches a terminal state (`order_done` event with reason `filled`, `canceled`, `expired`, or `killed`)

This mechanism protects against the common strategy pattern of emitting the same intent on every tick while an order is resting on the book. Without deduplication, the same order would be submitted repeatedly.

::: warning
Deduplication operates by `clientOrderId`, not by price/size/side. Two intents with different client IDs but identical parameters will both be submitted. Strategies are responsible for constructing deterministic, stable client IDs for resting orders.
:::

## Validation

Before submitting a `place_limit` or `place_batch` order, the manager validates the intent and returns an `order_rejected` event if any check fails:

| Check                      | Rejection reason                           |
| -------------------------- | ------------------------------------------ |
| `price <= 0` or non-finite | `invalid_price`                            |
| `size <= 0` or non-finite  | `invalid_size`                             |
| `assetId` absent           | `missing_assetId`                          |
| `postOnly: true` with a type other than GTC/GTD | `post_only_requires_gtc_or_gtd` |
| GTD without `expireAtMs`   | `gtd_requires_expireAtMs`                  |
| `expireAtMs` non-finite    | `invalid_expireAtMs`                       |
| GTD expiry too soon        | `gtd_expireAtMs_too_soon(min_offset_ms=N)` |

For batch orders, all orders in the batch are validated before any are submitted. Orders that fail validation emit individual `order_rejected` events; the remaining valid orders proceed normally.

The optional `postOnly` flag is retained in submitted order data. Shared validation checks its order-type combination, while execution checks marketability: the live exchange rejects crossing orders, and `BacktestExecution` evaluates the book when its queue dispatches the order. Immediate and delayed execution rejections release the active client ID. See [post-only orders](../strategy/strategy-interface.md#post-only-orders).

## Cancellation Validation and Tracking

`cancel_batch` and `cancel_market` share validation across live and backtest execution. Client references resolve from the portfolio; repeated references are deduplicated. Missing acknowledgements and invalid references produce nonterminal `cancel_failed` events. Scope requires a condition ID, a token ID, or both; malformed filters never become account-wide cancellation. See the [strategy contract](../strategy/strategy-interface.md#cancel-batch).

Sending a cancellation no longer releases an active client ID. Only terminal events do. `StrategyRunner` also reconciles the dedupe set after applying asynchronous account events, including fills. Failed and unrelated orders remain active. Risk capacity remains reserved until the portfolio reflects confirmation, so a replacement in the same intent batch can still be rejected at a risk limit; submit it after confirmation instead.

## GTD Minimum Expiry Enforcement

The repository's GTD (Good-Till-Date) validation enforces a minimum expiry offset through `minGtdOffsetMs` (default `60_000` ms):

```typescript
if (intent.expireAtMs < nowMs + this.minGtdOffsetMs)
  return `gtd_expireAtMs_too_soon(min_offset_ms=${this.minGtdOffsetMs})`
```

`nowMs` comes from the `OrderManagerContext`, which is populated from `tick.snapshot.timestamp` in `StrategyRunner`. In backtests, this is the exchange timestamp of the event being replayed, ensuring that GTD validation behaves the same way against historical data as it would in live trading.

This describes the existing engine model, not a guarantee of current exchange acceptance. Current exchange compatibility is tracked separately in [issue #249](https://github.com/ivanmijatovic89/polymarket-bot/issues/249).

## The Dry-Run Gate

When `dryRun: true`, no order is submitted to the exchange. Instead, the manager synthesizes the accept/open lifecycle events that the exchange would normally emit:

```typescript
// place_limit dry-run path
events.push({ kind: 'order_submitted', ... })
events.push({ kind: 'order_accepted', ... })
events.push({ kind: 'order_open', ... })
return events
```

For `merge_positions`, dry-run synthesizes a `positions_merged` event so that strategies wired to merge after selling can be tested end-to-end without touching the blockchain.

Dry-run cancellation emits `order_done(reason='canceled')` for matching locally known orders. `cancel_batch` resolves and deduplicates selected references, `cancel_market` applies validated filters, and `cancel_all` closes all known open account orders. No cancellation adapter is called. Unknown exchange-only batch references produce `cancel_failed` because dry-run cannot confirm their state.

Dry-run still validates `postOnly` against the order type, but it bypasses the execution adapter and synthesizes acceptance even if the order crosses. It does not simulate fills or prove exchange acceptance. Use `BacktestExecution` to test post-only crossing rejection and maker-fill behavior.

::: warning
The `OrderManager` constructor defaults to `dryRun: false`, but `trading-bot.ts` explicitly passes the parsed environment setting, which defaults to `true`. Real execution requires `DRY_RUN=false` (case-insensitive). See [Running the Live Trading Bot](../live-trading/live-trading-bot.md) for the current production compatibility blocker.
:::

## Risk Limits

Before execution, all intents pass through `enforceRiskLimits` (in `src/trading/riskLimits.ts`). Intents that violate configured limits are removed from the allowed set and produce `order_rejected` events with a `reason` string. The blocked intents are also logged.

## Order Lifecycle Events

The full set of `AccountEvent` kinds that flow through the manager and into the portfolio:

| Event             | Emitter                    | Meaning                                                   |
| ----------------- | -------------------------- | --------------------------------------------------------- |
| `order_submitted` | `OrderManager`             | Intent accepted locally, before exchange confirmation     |
| `order_accepted`  | `ExecutionAdapter`         | Exchange assigned an `orderId`                            |
| `order_open`      | `ExecutionAdapter` or WS   | Order is now resting on the book                          |
| `order_rejected`  | `OrderManager` or exchange | Order will not be filled                                  |
| `order_done`      | `ExecutionAdapter` or WS   | Terminal state: `filled`, `canceled`, `expired`, `killed` |
| `cancel_failed` | Manager or execution adapter | Cancellation did not succeed; order remains active |
| `fill`            | `ExecutionAdapter` or WS   | A partial or complete fill occurred                       |

In live mode, `order_open` and `order_done` typically arrive via the user WebSocket channel rather than from `LiveExecution` directly. `LiveExecution.placeLimit` emits only `order_accepted` (to link `clientOrderId` to `orderId`) and relies on the WS stream for subsequent lifecycle events.
