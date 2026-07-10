# Save intent metrics

This guide shows how to attach custom intent metrics (meta) to orders and persist
those metrics in backtest results.

The example strategy lives in:

- src/strategies/templates/TemplateResearchIntentMetrics.ts

## Overview

We attach custom `meta` to order intents. The OrderManager emits `order_submitted`
with that meta, Portfolio stores it in `ordersByClientId`, and backtests read the
meta for each fill to produce `MarketStats.intentMeta`.

Flow summary:

1. Strategy returns a `place_limit` intent with `meta`.
2. OrderManager includes `meta` on the `order_submitted` event.
3. Portfolio stores `meta` in `ordersByClientId` snapshots.
4. Backtest collects `intentMeta` for each market based on fills.

## Step 1: Add meta to the intent

Inside your strategy, build a `meta` object and pass it on the intent:

```ts
const intentMeta = {
  windowsMetrics,
}

return [
  {
    kind: 'place_limit',
    clientOrderId: `${name}:${assetId}:sell:${Math.floor(nowMs / 1000)}`,
    assetId,
    side: 'SELL',
    price: sellPrice,
    size: cfg.sellSize,
    orderType: 'GTC',
    meta: intentMeta,
  },
]
```

The template strategy shows how to build `windowsMetrics` from the
`TimeWindowVolatility` plugin and attach it to the intent.

## Step 2: OrderManager + Portfolio persistence

OrderManager copies `intent.meta` into the `OpenOrder` created for
`order_submitted`. Portfolio then copies it into `ordersByClientId` snapshots.

This is already wired in:

- src/trading/OrderManager.ts
- src/trading/Portfolio.ts

## Step 3: Backtest stats

Backtests read the meta from `ordersByClientId` and attach it to each fill
so `computeMarketStats` can persist the per-market list:

```ts
const orderMeta = fill.clientOrderId
  ? portfolio.ordersByClientId[fill.clientOrderId]?.meta
  : undefined
currentMarketTrades.push(orderMeta ? { ...fill, intentMeta: orderMeta } : fill)
```

`computeMarketStats` then dedupes by `clientOrderId` so each order contributes
its meta only once:

```ts
const intentMeta: Array<Record<string, unknown>> = []
const seenOrderIds = new Set<string>()
for (const t of trades) {
  if (!t.intentMeta || typeof t.intentMeta !== 'object') continue
  if (t.clientOrderId) {
    if (seenOrderIds.has(t.clientOrderId)) continue
    seenOrderIds.add(t.clientOrderId)
  }
  intentMeta.push(t.intentMeta as Record<string, unknown>)
}
```

The resulting `MarketStats` has:

```ts
intentMeta: Array<Record<string, unknown>>
```

## Notes

- This flow works in both live and backtest because it uses `order_submitted`.
- You can extend this pattern to include any analysis fields in `meta`.
- If you later want meta for non-order intents (split/merge/cancel), consider
  adding a separate intent-event store. For now, meta is tied to orders only.
