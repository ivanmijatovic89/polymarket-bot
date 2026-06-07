---
title: Backtest Run Statistics
description: Reference for the scalar performance columns stored on backtest_runs.
---

# Backtest Run Statistics

Backtest run statistics are the scalar performance columns stored on
`backtest_runs`. They describe the full run across all persisted market
episodes and are used by ranking, dashboard history, and run comparison tools.

The TypeScript computation object is still called `BatchStats` because it is
produced once per completed batch by `computeBatchStats` in
`src/backtest/stats/batchStats.ts`. It is not stored as a `batch_stats` JSON
column. Persistence expands that domain object into typed columns on
`backtest_runs`.

## Storage Scope

These columns live on `backtest_runs`, one row per terminal backtest run.

They do not include run identity or audit metadata such as `batch_uid`,
`status`, `markets_persisted`, or `failures_count`. Those fields are documented
in [Backtest Result Storage](/backtest/statistics/result-storage).

## Capital

| Column            | Type            | Source field     | Description                                               |
| ----------------- | --------------- | ---------------- | --------------------------------------------------------- |
| `capital_initial` | `DECIMAL(14,4)` | `capitalInitial` | Starting capital for the run, in USDC.                    |
| `capital_final`   | `DECIMAL(14,4)` | `capitalFinal`   | `capital_initial + pnl_total`, rounded by the stats code. |

## P&L And Fees

| Column                 | Type            | Source field          | Description                                                                                 |
| ---------------------- | --------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `pnl_total`            | `DECIMAL(14,4)` | `pnlTotal`            | Sum of market P&L across the run, in USDC. Indexed for ranking queries.                      |
| `total_fees_paid`      | `DECIMAL(14,4)` | `totalFeesPaid`       | Sum of taker fees across all market rows, in USDC.                                           |
| `ev_per_market_played` | `DECIMAL(14,4)` | `evPerMarketPlayed`   | `pnl_total / markets_played`; zero when no markets were played.                             |
| `ev_per_market_total`  | `DECIMAL(14,4)` | `evPerMarketTotal`    | `pnl_total / markets_total`, including skipped episodes in the denominator.                  |
| `pnl_avg_win`          | `DECIMAL(14,4)` | `pnlAvgWin`           | Average P&L across winning market rows, in USDC.                                             |
| `pnl_avg_lose`         | `DECIMAL(14,4)` | `pnlAvgLose`          | Average P&L across losing market rows, in USDC. Negative when there are losing markets.      |
| `pnl_max_win`          | `DECIMAL(14,4)` | `pnlMaxWin`           | Largest single-market profit, in USDC.                                                       |
| `pnl_max_lose`         | `DECIMAL(14,4)` | `pnlMaxLose`          | Largest single-market loss, in USDC. Negative when there are losing markets.                 |

## Quality Scores

Both quality metrics are Sharpe-like signal-to-noise ratios computed as
`mean(pnls) / std(pnls)`. They are nullable because a run can have no useful
variance.

| Column           | Type            | Source field    | Description                                                                                  |
| ---------------- | --------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `quality_system` | `DECIMAL(14,6)` | `qualitySystem` | Computed over all markets, including skipped rows where `pnl = 0`.                           |
| `quality_trade`  | `DECIMAL(14,6)` | `qualityTrade`  | Computed only over markets where the strategy had a decisive non-zero P&L.                   |

`quality_system` is the more conservative metric because it penalizes excessive
selectivity.

## Market Counts

| Column                          | Type  | Source field                  | Description                                                                  |
| ------------------------------- | ----- | ----------------------------- | ---------------------------------------------------------------------------- |
| `markets_total`                 | `INT` | `marketsTotal`                | Number of market stats included in the run-level denominator.                 |
| `markets_skipped`               | `INT` | `marketsSkipped`              | Market rows where the strategy placed no trades and P&L is zero.             |
| `markets_no_in_window_activity` | `INT` | `marketsNoInWindowActivity`   | Skipped rows explicitly marked with `skip_reason = 'no_in_window_activity'`. |
| `markets_flat_with_trades`      | `INT` | `marketsFlatWithTrades`       | Market rows with at least one trade but zero P&L.                             |
| `markets_played`                | `INT` | `marketsPlayed`               | Market rows where the strategy placed at least one trade.                     |
| `markets_won`                   | `INT` | `marketsWon`                  | Market rows with positive P&L.                                                |
| `markets_lost`                  | `INT` | `marketsLost`                 | Market rows with negative P&L.                                                |

## Win Rate

| Column         | Type            | Source field | Description                                                                                  |
| -------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `win_rate`     | `DECIMAL(10,6)` | `winRate`    | `markets_won / (markets_won + markets_lost)`, in the range `[0, 1]`.                         |
| `win_rate_pct` | `DECIMAL(10,4)` | `winRatePct` | `win_rate * 100`. UI code should format this at display time, for example with `toFixed(2)`. |

There is no persisted `win_rate_pct_str` column and no `winRatePctStr` field.
Formatted strings are a presentation concern.

## Trade Counts

| Column         | Type  | Source field  | Description                               |
| -------------- | ----- | ------------- | ----------------------------------------- |
| `trades_total` | `INT` | `tradesTotal` | Sum of fills across all market rows.      |
| `trades_maker` | `INT` | `tradesMaker` | Sum of maker fills across all market rows. |
| `trades_taker` | `INT` | `tradesTaker` | Sum of taker fills across all market rows. |

## Streaks

Streaks are computed in canonical market order. In the BullMQ execution path,
the aggregate worker sorts child results by producer-assigned `idx` before
calling `computeBatchStats`; the sequential path already sees the same order.

| Column                | Type            | Source field       | Description                                                                    |
| --------------------- | --------------- | ------------------ | ------------------------------------------------------------------------------ |
| `streak_max_win`      | `INT`           | `streakMaxWin`     | Longest consecutive run of winning markets.                                    |
| `streak_max_lose`     | `INT`           | `streakMaxLose`    | Longest consecutive run of losing markets.                                     |
| `streak_max_win_pnl`  | `DECIMAL(14,4)` | `streakMaxWinPnl`  | Total P&L accumulated during the longest winning streak, in USDC.              |
| `streak_max_lose_pnl` | `DECIMAL(14,4)` | `streakMaxLosePnl` | Total P&L accumulated during the longest losing streak, in USDC.               |
| `streak_max_skipped`  | `INT`           | `streakMaxSkipped` | Longest consecutive run of skipped market rows.                                |

## Internal Object

`BatchStats` is still useful inside the codebase:

- `computeBatchStats(markets, initialCapital)` returns a `BatchStats` instance.
- `insertBacktestRun` accepts that instance and calls `toRunColumns()`.
- `chunked_batch_stats.segments[].batch_stats` stores segment-level
  `BatchStats` objects because chunk segments are nested JSON, not run-level
  scalar columns.

For the persisted run schema, use the `backtest_runs` columns above as the
source of truth.
