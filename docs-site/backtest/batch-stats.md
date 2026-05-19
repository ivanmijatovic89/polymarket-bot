---
title: Batch Statistics
description: Reference for all fields produced by computeBatchStats — aggregated performance metrics across a full backtest run.
---

# Batch Statistics

`BatchStats` is the top-level summary produced by `computeBatchStats` in `src/backtest/stats/batchStats.ts`. It aggregates the results of all `MarketStats` records from a single backtest run into a single performance snapshot.

Batch stats are computed once after all market episodes have been replayed, then stored in the database alongside the individual market records.

## Relationship to Market Statistics

`computeBatchStats` takes:

- `results: MarketStats[]` — the array of per-market stats produced by `computeMarketStats`.
- `initialCapital: number` — starting USDC balance (controlled by the `INITIAL_CAPITAL` environment variable; default `1000`).

A market with `pnl === 0` is classified as **skipped** (no trades placed). Markets with `pnl > 0` are **won**; markets with `pnl < 0` are **lost**.

## Output Fields

### Capital

| Field            | Type     | Description                                               |
| ---------------- | -------- | --------------------------------------------------------- |
| `capitalInitial` | `number` | The `initialCapital` value passed to the function (USDC). |
| `capitalFinal`   | `number` | `capitalInitial + pnlTotal`, rounded to 2 decimal places. |

### P&L

| Field               | Type     | Description                                                                                                                                               |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnlTotal`          | `number` | Sum of `pnl` across all market records (USDC), rounded to 2 decimal places.                                                                               |
| `totalFeesPaid`     | `number` | Sum of `feesPaid` across all market records (USDC), rounded to 2 decimal places.                                                                          |
| `evPerMarketPlayed` | `number` | `pnlTotal / marketsPlayed` — empirical expected value per market where the strategy acted, rounded to 2 decimal places. Zero when no markets were played. |
| `evPerMarketTotal`  | `number` | `pnlTotal / marketsTotal` — empirical expected value over the full market set including skipped episodes, rounded to 2 decimal places.                    |

### Quality Scores

Both quality metrics are Sharpe-like signal-to-noise ratios computed as `mean(pnls) / std(pnls)`. They return `null` when fewer than one P&L value is available or when standard deviation is zero.

| Field           | Type             | Description                                                                                                                                                                                      |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `qualitySystem` | `number \| null` | `avg(pnl) / std(pnl)` computed over **all** markets including skipped ones (where `pnl = 0`). Measures consistency of the strategy across the full opportunity set. Rounded to 4 decimal places. |
| `qualityTrade`  | `number \| null` | `avg(pnl) / std(pnl)` computed only over markets where the strategy traded (`pnl ≠ 0`). Measures consistency of individual trade outcomes. Rounded to 4 decimal places.                          |

::: tip Interpreting quality scores
A higher score indicates a more consistent edge. A score near or below zero suggests the P&L is dominated by variance rather than a repeatable signal. `qualitySystem` is generally more conservative because it penalises excessive selectivity (many skipped markets drag the mean toward zero).
:::

### Market Counts

| Field            | Type     | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `marketsTotal`   | `number` | Total number of market episodes in the batch.                      |
| `marketsSkipped` | `number` | Episodes where the strategy placed no trades (`pnl === 0`).        |
| `marketsPlayed`  | `number` | Episodes where the strategy placed at least one trade (`pnl ≠ 0`). |
| `marketsWon`     | `number` | Episodes with `pnl > 0`.                                           |
| `marketsLost`    | `number` | Episodes with `pnl < 0`.                                           |

### Win Rate

| Field           | Type     | Description                                                                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `winRate`       | `number` | `marketsWon / (marketsWon + marketsLost)`, in the range `[0, 1]`. Zero when no decisive markets exist. Rounded to 4 decimal places. |
| `winRatePct`    | `number` | `winRate * 100`, rounded to 2 decimal places.                                                                                       |
| `winRatePctStr` | `string` | `winRate * 100` formatted to exactly 2 decimal places as a string (e.g. `"63.50"`).                                                 |

### Trade Counts

| Field         | Type     | Description                               |
| ------------- | -------- | ----------------------------------------- |
| `tradesTotal` | `number` | Sum of `tradeCount` across all markets.   |
| `tradesMaker` | `number` | Sum of `tradeAsMaker` across all markets. |
| `tradesTaker` | `number` | Sum of `tradeAsTaker` across all markets. |

### Per-Market P&L Distribution

| Field        | Type     | Description                                                                      |
| ------------ | -------- | -------------------------------------------------------------------------------- |
| `pnlAvgWin`  | `number` | Average P&L across winning markets (USDC), rounded to 2 decimal places.          |
| `pnlAvgLose` | `number` | Average P&L across losing markets (USDC), rounded to 2 decimal places. Negative. |
| `pnlMaxWin`  | `number` | Largest single-market profit (USDC), rounded to 2 decimal places.                |
| `pnlMaxLose` | `number` | Largest single-market loss (USDC), rounded to 2 decimal places. Negative.        |

### Streak Analysis

Streaks are computed sequentially in the order markets appear in the `results` array.

| Field              | Type     | Description                                                                                           |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `streakMaxWin`     | `number` | Longest consecutive run of winning markets.                                                           |
| `streakMaxLose`    | `number` | Longest consecutive run of losing markets.                                                            |
| `streakMaxWinPnl`  | `number` | Total P&L accumulated during the longest winning streak (USDC), rounded to 2 decimal places.          |
| `streakMaxLosePnl` | `number` | Total P&L accumulated during the longest losing streak (USDC), rounded to 2 decimal places. Negative. |
| `streakMaxSkipped` | `number` | Longest consecutive run of skipped (zero-trade) markets.                                              |

## Example

```json
{
  "capitalInitial": 1000,
  "capitalFinal": 1084.3,
  "pnlTotal": 84.3,
  "totalFeesPaid": 12.5,
  "qualitySystem": 0.1823,
  "qualityTrade": 0.3411,
  "evPerMarketPlayed": 0.56,
  "evPerMarketTotal": 0.42,
  "marketsTotal": 200,
  "marketsSkipped": 50,
  "marketsPlayed": 150,
  "marketsWon": 98,
  "marketsLost": 52,
  "winRate": 0.6533,
  "winRatePct": 65.33,
  "winRatePctStr": "65.33",
  "tradesTotal": 450,
  "tradesMaker": 210,
  "tradesTaker": 240,
  "pnlAvgWin": 1.82,
  "pnlAvgLose": -0.91,
  "pnlMaxWin": 6.4,
  "pnlMaxLose": -3.2,
  "streakMaxWin": 8,
  "streakMaxLose": 4,
  "streakMaxWinPnl": 14.56,
  "streakMaxLosePnl": -3.64,
  "streakMaxSkipped": 12
}
```
