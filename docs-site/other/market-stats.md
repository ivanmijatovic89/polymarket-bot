---
title: Market Statistics
description: Reference for all fields produced by computeMarketStats — per-market P&L and trade breakdown for a single backtest episode.
---

# Market Statistics

`MarketStats` is the per-market output record produced by `computeMarketStats` in `src/backtest/stats/marketStats.ts`. One `MarketStats` object is emitted for each 15-minute market episode where the strategy placed at least one trade and the market has a known resolution outcome.

## When Stats Are Computed

After the full Parquet replay of a single file completes, the backtest runner checks:

1. The slug could be parsed from the filename.
2. The market's `finalOutcome` (`UP` or `DOWN`) is known — markets that have not resolved are skipped with a warning.
3. The strategy placed at least one trade **or** holds a non-zero position for the market.

If all conditions are met, `computeMarketStats` is called with the portfolio snapshot and the accumulated fill list.

## Resolution Model

Polymarket binary UP/DOWN markets resolve at $1 for the winning outcome and $0 for the losing outcome. The stats module accounts for three value sources:

- **Merge value** — pairs of UP and DOWN shares that can be merged for $1 per pair regardless of outcome.
- **Redeem value** — remaining shares of the winning outcome, each worth $1.
- **Realized P&L** — gains and losses already locked in from limit sells executed during the episode.

```
pnl = realizedPnl + mergeValue + redeemValue - remainingCostBasis - splitCost
```

The `remainingCostBasis` is the cost basis of positions still held at the end of the episode (as tracked by `Portfolio`). `splitCost` accounts for collateral consumed by any position-split operations.

## Output Fields

### Identifiers

| Field      | Type     | Description                                                           |
| ---------- | -------- | --------------------------------------------------------------------- |
| `marketId` | `string` | Condition ID for the market (from the first decoded WebSocket event). |
| `slug`     | `string` | Gamma market slug, e.g. `btc-updown-15m-1700000000`.                  |

### Resolution

| Field          | Type             | Description                   |
| -------------- | ---------------- | ----------------------------- |
| `finalOutcome` | `'UP' \| 'DOWN'` | Which outcome resolved at $1. |

### P&L

| Field       | Type     | Description                                                                                                                       |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnl`       | `number` | Net profit or loss for the episode in USDC, rounded to 2 decimal places. Positive values indicate a profit.                       |
| `feesPaid`  | `number` | Total taker fees paid across all fills in USDC, rounded to 2 decimal places. Maker fills incur no fees.                           |
| `cost`      | `number` | Remaining cost basis of open positions at episode end (USDC), rounded to 2 decimal places.                                        |
| `splitCost` | `number` | USDC collateral consumed by position splits. For binary splits, each split of N shares costs N USDC. Rounded to 2 decimal places. |

### Trade Counts

| Field          | Type     | Description                                                                   |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `tradeCount`   | `number` | Total number of fills (buys and sells combined).                              |
| `tradeAsMaker` | `number` | Number of fills where the order rested in the book (`liquidity === 'MAKER'`). |
| `tradeAsTaker` | `number` | Number of fills where the order crossed the spread (`liquidity === 'TAKER'`). |

### Positions

| Field            | Type     | Description                                                                                                          |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `upShares`       | `number` | Final quantity of UP outcome shares held, rounded to 2 decimal places.                                               |
| `downShares`     | `number` | Final quantity of DOWN outcome shares held, rounded to 2 decimal places.                                             |
| `mergableShares` | `number` | `min(upShares, downShares)` — the number of share pairs that can be merged for $1 each, rounded to 2 decimal places. |

### Average Entry Prices

| Field               | Type             | Description                                                                                                                            |
| ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `avgEntryPriceUp`   | `number \| null` | Volume-weighted average purchase price of UP shares (USDC per share), rounded to 4 decimal places. `null` if no UP buys were made.     |
| `avgEntryPriceDown` | `number \| null` | Volume-weighted average purchase price of DOWN shares (USDC per share), rounded to 4 decimal places. `null` if no DOWN buys were made. |

### Intent Metadata

| Field        | Type                             | Description                                                                                                                                                                                                               |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intentMeta` | `Array<Record<string, unknown>>` | One entry per unique `clientOrderId`, containing the `meta` object attached to the originating strategy intent. Useful for debugging which strategy branch produced each order. Entries with no `intentMeta` are omitted. |

## Example

```json
{
  "marketId": "0xabc123...",
  "slug": "btc-updown-15m-1700000000",
  "finalOutcome": "UP",
  "pnl": 1.23,
  "tradeCount": 4,
  "tradeAsMaker": 2,
  "tradeAsTaker": 2,
  "feesPaid": 0.05,
  "avgEntryPriceUp": 0.4812,
  "avgEntryPriceDown": null,
  "upShares": 100.0,
  "downShares": 0.0,
  "mergableShares": 0.0,
  "cost": 0.0,
  "splitCost": 0.0,
  "intentMeta": [{ "label": "entry", "triggerPrice": 0.48 }]
}
```

::: tip Skipped markets
A market is silently skipped (no `MarketStats` entry) when the strategy placed no trades and holds no shares, or when the resolution outcome is not yet available. A console warning is emitted for unresolved markets.
:::
