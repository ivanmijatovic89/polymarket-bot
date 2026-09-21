---
title: Risk Limits
description: Reference for the risk-limit system that gates order placement in the Polymarket Bot.
---

# Risk Limits

The risk-limit system is a deterministic, stateless gate applied to every batch of intents produced by a strategy before they reach the `OrderManager`. It operates solely on the current `PortfolioSnapshot` and the intent batch — it does not perform I/O or maintain its own state across ticks.

The enforcer is exported from `src/trading/riskLimits.ts`.

---

## Limit Parameters

Risk limits are expressed as a `RiskLimits` object. If no custom limits are provided, `DEFAULT_RISK_LIMITS` is used.

```typescript
export type RiskLimits = {
  maxOpenOrders: number
  maxOrderSize: number
  maxAbsPosition: number
  maxLossStop: number
}
```

### Default Values

| Limit            | Default | Description                                                                                  |
| ---------------- | ------- | -------------------------------------------------------------------------------------------- |
| `maxOpenOrders`  | `100`    | Maximum number of open orders (across all assets) allowed at any one time.                   |
| `maxOrderSize`   | `2000`  | Maximum size (shares) of any single order.                                                   |
| `maxAbsPosition` | `2000`  | Maximum absolute position (shares) per asset, including open order exposure.                 |
| `maxLossStop`    | `500`   | Maximum realised PnL loss (price units × shares) before new risk-taking intents are blocked. |

::: warning No runtime configuration
These defaults are hardcoded in `DEFAULT_RISK_LIMITS`. There are no environment variables that override individual limits. To use custom limits, pass a `RiskLimits` object to `enforceRiskLimits`.
:::

---

## Enforcement Function

```typescript
enforceRiskLimits(params: {
  nowMs: number
  intents: Intent[]
  portfolio?: PortfolioSnapshot
  limits?: RiskLimits
}): {
  allowed: Intent[]
  rejectedEvents: AccountEvent[]
  blocked: Blocked[]
}
```

| Parameter   | Description                                                                             |
| ----------- | --------------------------------------------------------------------------------------- |
| `nowMs`     | Current timestamp in milliseconds. Used as the timestamp on synthetic rejection events. |
| `intents`   | Full intent batch from the strategy.                                                    |
| `portfolio` | Current portfolio snapshot. When absent, all intents pass through unchecked.            |
| `limits`    | Custom limits. Defaults to `DEFAULT_RISK_LIMITS` when omitted.                          |

### Return Values

| Field            | Type             | Description                                                                                                               |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `allowed`        | `Intent[]`       | Intents that passed all checks. Forwarded to `OrderManager`.                                                              |
| `rejectedEvents` | `AccountEvent[]` | Synthetic `order_rejected` events for each blocked order or batch order. Fed back into the strategy via `onAccountEvent`. |
| `blocked`        | `Blocked[]`      | Internal log of blocked intents with their rejection reasons. Used for debugging and metrics.                             |

---

## Checked Limits and Rules

### Cancel Intents — Always Allowed

`cancel_order`, `cancel_batch`, `cancel_market`, and `cancel_all` are never blocked by risk limits (cancellation input validation still applies). Requests can fail or take effect after a delay, so they do not reduce running exposure or order counts. Capacity is released only when confirmed terminal events reach the portfolio. At a risk limit, wait for confirmation before submitting replacement orders.

If a blocked placement reuses an active client ID, the manager logs the blocked retry without emitting `order_rejected` for the existing order. This prevents a failed cancellation followed by a retry from removing an order that remains live at the exchange. Risk checks and exposure reservations still apply to the attempted replacement.

### Loss Stop (`maxLossStop`)

Evaluated once per intent batch from `portfolio.realizedPnlTotal`. When:

```
realizedPnlTotal <= -abs(maxLossStop)
```

All `place_limit` and `place_batch` intents in the batch are blocked with reason `risk_loss_stop(realized=<value>)`. The loss stop does not apply to cancels.

### Order Size (`maxOrderSize`)

Each `place_limit` or individual order within a `place_batch` is checked:

```
intent.size > maxOrderSize  →  blocked: risk_max_order_size(max=<value>)
```

### Open Order Count (`maxOpenOrders`)

The enforcer maintains a running counter initialised from `portfolio.openOrdersByClientId`. Each new `place_limit` or `place_batch` order that passes the size check increments the counter. When incrementing would exceed the limit:

```
openOrdersCount + 1 > maxOpenOrders  →  blocked: risk_max_open_orders(max=<value>)
```

### Absolute Position (`maxAbsPosition`)

Position exposure is projected conservatively using the **worst-case** model: open buy orders are assumed to fill (increasing the position) and open sell orders are assumed to fill (decreasing the position). The check is:

```
projectedQty = positionQty + openBuys + orderSize   (BUY side)
projectedQty = positionQty - (openSells + orderSize) (SELL side)

abs(projectedQty) > maxAbsPosition  →  blocked: risk_max_abs_position(max=<value>)
```

`openBuys` and `openSells` are per-asset totals accumulated from `portfolio.openOrdersByClientId`. They are updated speculatively as orders are approved within the same batch, so subsequent orders see the updated exposure.

---

## Batch Order Handling

`place_batch` intents are processed order by order. Each constituent order is evaluated against all four limits independently. Orders that pass are collected into a new `place_batch` intent with `validOrders` only. If no orders in the batch pass, the entire `place_batch` is dropped. If some orders pass, the partial batch is forwarded.

When the loss stop fires for a `place_batch`, the entire batch is blocked in one operation and a rejection event is emitted for each order's `clientOrderId`.

---

## Rejection Reason Strings

| Reason                           | Trigger                               |
| -------------------------------- | ------------------------------------- |
| `risk_loss_stop(realized=<n>)`   | `realizedPnlTotal <= -maxLossStop`    |
| `risk_max_order_size(max=<n>)`   | `order.size > maxOrderSize`           |
| `risk_max_open_orders(max=<n>)`  | `openOrdersCount + 1 > maxOpenOrders` |
| `risk_max_abs_position(max=<n>)` | `abs(projectedQty) > maxAbsPosition`  |

Rejection reasons are included verbatim in the `order_rejected` `AccountEvent` and passed to the strategy's `onAccountEvent` hook.

---

## Order Intent Types

| Intent Kind       | Risk-checked | Notes                                                      |
| ----------------- | ------------ | ---------------------------------------------------------- |
| `place_limit`     | Yes          | All four limits applied.                                   |
| `place_batch`     | Yes          | Each constituent order checked; partial batches forwarded. |
| `cancel_order`    | No           | Always allowed; retains exposure until confirmed.                  |
| `cancel_batch` | No | Always allowed; retains exposure until confirmed. |
| `cancel_market` | No | Always allowed; retains exposure until confirmed. |
| `cancel_all`      | No           | Always allowed; retains exposure until confirmed.       |
| `split_positions` | No           | Always allowed.                                            |
| `merge_positions` | No           | Always allowed.                                            |
