---
title: Orderbook Metrics
description: Reference for the cross-asset orderbook metrics computed by the Polymarket Bot, including weak-side detection and depth-ratio formulas.
---

# Orderbook Metrics

Orderbook metrics provide a per-tick, cross-asset view of the Up and Down outcome books for a binary market. The computation is implemented in `src/trading/orderbookMetrics.ts` and the resulting `OrderbookMetrics` object is made available to strategies via the tick context.

---

## Overview

Polymarket binary markets expose two opposing orderbooks — one for the Up outcome and one for the Down outcome. Because prices on both sides must sum to approximately 1, comparing their depth at equivalent price levels reveals which side is thinner and by how much. Strategies use this information to assess directional liquidity imbalance.

---

## Types

```typescript
type OrderbookWeakSide = 'UP' | 'DOWN' | 'NONE'

type OrderbookMetrics = {
  depthLevels: number
  weakBidSideByLevel: OrderbookWeakSide[]
  weakBidRatioByLevel: number[]
  weakAskSideByLevel: OrderbookWeakSide[]
  weakAskRatioByLevel: number[]
}
```

---

## Output Fields

| Field                 | Type                  | Description                                                                                                                                                                     |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depthLevels`         | `number`              | Number of price levels included in the comparison. Equal to the minimum of the available depth levels across both books on both the bid and ask sides.                          |
| `weakBidSideByLevel`  | `OrderbookWeakSide[]` | For each level `i`, which side (`UP` or `DOWN`) has the shallower bid depth at that level. `NONE` when both sides are equal.                                                    |
| `weakBidRatioByLevel` | `number[]`            | For each level `i`, the ratio `min(upBidDepth, downBidDepth) / max(upBidDepth, downBidDepth)`. A value close to `0` indicates extreme imbalance; `1` indicates perfect balance. |
| `weakAskSideByLevel`  | `OrderbookWeakSide[]` | Same as `weakBidSideByLevel` but for ask depth at each level.                                                                                                                   |
| `weakAskRatioByLevel` | `number[]`            | Same as `weakBidRatioByLevel` but for ask depth at each level.                                                                                                                  |

---

## Weak Side and Ratio Formula

For each price level `i` and each side (bid/ask), the weak side and ratio are computed as follows:

```
u = max(0, upDepth[i])
d = max(0, downDepth[i])

if u == d:
  side  = 'NONE'
  ratio = 1

elif u < d:
  side  = 'UP'        # Up book is thinner
  ratio = u / d

else:
  side  = 'DOWN'      # Down book is thinner
  ratio = d / u
```

`ratio` is always in the range `[0, 1]`. When both depths are zero, ratio is `0` and the side is `NONE`.

---

## Depth Level Count

The effective `depthLevels` is the minimum number of usable levels across all four arrays:

```
depthLevels = min(
  floor(upBook.depthLevels),
  floor(downBook.depthLevels),
  upBook.bidsDepthByLevel.length,
  downBook.bidsDepthByLevel.length,
  upBook.asksDepthByLevel.length,
  downBook.asksDepthByLevel.length
)
```

This ensures all arrays are indexed safely without bounds errors when books have asymmetric depth.

---

## Functions

### `computeOrderbookMetrics`

```typescript
computeOrderbookMetrics(args: {
  upBook: OrderBookSnapshot
  downBook: OrderBookSnapshot
}): OrderbookMetrics
```

Core computation. Accepts pre-resolved `OrderBookSnapshot` objects for the Up and Down asset IDs and returns the full `OrderbookMetrics` record.

---

### `computeOrderbookMetricsFromMarket`

```typescript
computeOrderbookMetricsFromMarket(args: {
  marketBooks: MarketOrderBooksSnapshot
  market?: GammaMarketMeta
}): OrderbookMetrics | undefined
```

Convenience wrapper used by strategies. Resolves `upAssetId` and `downAssetId` from the `GammaMarketMeta`, looks up the corresponding `OrderBookSnapshot` objects in `marketBooks.byAssetId`, then delegates to `computeOrderbookMetrics`.

Returns `undefined` when:

| Condition                                        | Description                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `market` is absent                               | No market metadata available for this tick.          |
| `market.upAssetId` is `null`                     | Could not detect the Up asset from outcome labels.   |
| `market.downAssetId` is `null`                   | Could not detect the Down asset from outcome labels. |
| Either book is absent in `marketBooks.byAssetId` | The book for that asset has not been received yet.   |

---

## Usage in Strategies

```typescript
import { computeOrderbookMetricsFromMarket } from '../../trading/orderbookMetrics.js'

// Inside onMarketTick:
const metrics = computeOrderbookMetricsFromMarket({
  marketBooks: snapshot.books,
  market: ctx.market,
})

if (metrics && metrics.depthLevels > 0) {
  const weakBid = metrics.weakBidSideByLevel[0] // level 0 = best bid
  const ratio = metrics.weakBidRatioByLevel[0]
  // ratio < 0.5 → strong imbalance; weakBid = 'UP' → Up bids are thin
}
```

::: tip Level indexing
Level `0` corresponds to the best bid or best ask (the innermost price level). Higher indices correspond to deeper, less competitive price levels.
:::

---

## `OrderbookWeakSide` Values

| Value    | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| `'UP'`   | The Up outcome book is thinner at this level.                |
| `'DOWN'` | The Down outcome book is thinner at this level.              |
| `'NONE'` | Both sides have equal depth at this level, or both are zero. |
