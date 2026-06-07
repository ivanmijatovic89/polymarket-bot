---
title: Backtest Run Markets
description: Reference for the per-market rows stored in backtest_run_markets.
---

# Backtest Run Markets

`backtest_run_markets` stores one row per market result inside a backtest run.
It is the persisted form of the `MarketStats` object produced after replaying
one market episode.

`MarketStats` remains the internal TypeScript computation object returned by
`computeMarketStats` in `src/backtest/stats/marketStats.ts`. It is not stored
as one large `market_stats` JSON blob. Persistence expands stable fields into
typed columns and keeps only strategy-specific debug metadata in
`intent_meta`.

## Relation To Runs

Each row belongs to exactly one `backtest_runs` row through `run_id`.

`idx` is the canonical per-run order. It preserves the producer's input order
and is used when hydrating results, verifying sequential/parallel parity, and
computing streaks. `market_start_ms` (denormalized from the slug at insert
time) is the chronological key that drives the per-segment stats — see
[Backtest Segments](/backtest/statistics/backtest-segments).

Important indexes:

| Index / Constraint          | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| unique `(run_id, idx)`      | Preserves deterministic per-run order.       |
| `(run_id, slug)`            | Finds one market result inside a run.        |
| `(run_id, pnl)`             | Supports best/worst market views.            |
| `slug`                      | Supports cross-run lookup by market slug.    |
| `(run_id, duration_ms)`     | Supports slow-market execution diagnostics.  |

## When Rows Are Written

After the full Parquet replay of a single market completes, `runSingleMarket`
emits one market result when:

1. the slug can be parsed,
2. the final outcome is known,
3. the strategy either traded, held a position, or had no in-window activity.

Markets where the strategy made no trades and held no positions are still
persisted with `skip_reason = 'no_in_window_activity'`. This keeps run
denominators stable across sequential and parallel modes.

Unresolved markets, or files whose slug cannot be parsed, are skipped before a
row is written.

## Identity And Ordering

| Column          | Type                  | Source field    | Description                                                  |
| --------------- | --------------------- | --------------- | ------------------------------------------------------------ |
| `id`            | `BIGINT`              | generated       | Surrogate primary key.                                       |
| `run_id`        | `BIGINT`              | generated       | Foreign key to `backtest_runs.id`; cascades on run deletion. |
| `idx`           | `INT`                 | producer order  | Canonical market order inside the run.                       |
| `market_id`     | `VARCHAR(255)`        | `marketId`      | Polymarket condition/market identifier.                      |
| `slug`          | `VARCHAR(255)`        | `slug`          | Gamma market slug, e.g. `btc-updown-15m-1700000000`.         |
| `final_outcome` | `ENUM('UP','DOWN')`   | `finalOutcome`  | Winning outcome for the resolved market.                     |
| `skip_reason`   | `ENUM(...) NULL`      | `skipReason`    | Currently only `no_in_window_activity`; nullable otherwise.  |

## P&L And Trades

Polymarket binary UP/DOWN markets resolve at $1 for the winning outcome and $0
for the losing outcome. Market P&L accounts for realized trading P&L, merge
value, redeem value, remaining cost basis, split cost, and taker fees.

```text
pnl = realizedPnl + mergeValue + redeemValue - remainingCostBasis - splitCost
```

| Column           | Type            | Source field   | Description                                                     |
| ---------------- | --------------- | -------------- | --------------------------------------------------------------- |
| `pnl`            | `DECIMAL(14,4)` | `pnl`          | Net market profit/loss in USDC.                                 |
| `trade_count`    | `INT`           | `tradeCount`   | Total number of fills in the market.                            |
| `trade_as_maker` | `INT`           | `tradeAsMaker` | Number of maker fills.                                          |
| `trade_as_taker` | `INT`           | `tradeAsTaker` | Number of taker fills.                                          |
| `fees_paid`      | `DECIMAL(14,4)` | `feesPaid`     | Total taker fees paid in USDC. Maker fills incur no taker fees. |

## Positions And Cost Basis

| Column                 | Type            | Source field        | Description                                                                       |
| ---------------------- | --------------- | ------------------- | --------------------------------------------------------------------------------- |
| `avg_entry_price_up`   | `DECIMAL(10,6)` | `avgEntryPriceUp`   | Volume-weighted average UP entry price; nullable when no UP buys occurred.        |
| `avg_entry_price_down` | `DECIMAL(10,6)` | `avgEntryPriceDown` | Volume-weighted average DOWN entry price; nullable when no DOWN buys occurred.    |
| `up_shares`            | `DECIMAL(18,6)` | `upShares`          | Final UP shares held at episode end.                                              |
| `down_shares`          | `DECIMAL(18,6)` | `downShares`        | Final DOWN shares held at episode end.                                            |
| `mergable_shares`      | `DECIMAL(18,6)` | `mergableShares`    | `min(up_shares, down_shares)`, mergeable for $1 per pair.                         |
| `cost`                 | `DECIMAL(14,4)` | `cost`              | Remaining cost basis of open positions at episode end.                            |
| `split_cost`           | `DECIMAL(14,4)` | `splitCost`         | USDC collateral consumed by position splits.                                      |

## Intent Metadata

| Column        | Type   | Source field | Description                                                                 |
| ------------- | ------ | ------------ | --------------------------------------------------------------------------- |
| `intent_meta` | `JSON` | `intentMeta` | One entry per unique `clientOrderId`, containing strategy intent metadata.  |

`intent_meta` intentionally remains JSON because its shape is strategy-specific
and useful primarily for debugging and research export. It should become a
separate table only if we start querying individual intent fields frequently.

## Execution Metadata

Execution fields are optional. Sequential runs and worker runs both populate
them when available, but the aggregate math does not depend on them.

| Column             | Type           | Source field                  | Description                                                    |
| ------------------ | -------------- | ----------------------------- | -------------------------------------------------------------- |
| `worker_name`      | `VARCHAR(255)` | `execution.workerName`        | Worker identifier, or sequential process identifier.           |
| `started_at_ms`    | `BIGINT`       | `execution.startedAtMs`       | Unix ms when the market replay started.                        |
| `finished_at_ms`   | `BIGINT`       | `execution.finishedAtMs`      | Unix ms when the market replay finished.                       |
| `duration_ms`      | `INT`          | `execution.durationMs`        | Wall-clock replay duration.                                    |
| `events_processed` | `INT`          | `execution.eventsProcessed`   | Count of replayed meaningful market events.                    |
| `events_by_type`   | `JSON`         | `execution.eventsByType`      | Event histogram, for example `{ "book": 60, "price_change": 14568 }`. |
| `commit_sha`       | `VARCHAR(64)`  | `execution.commitSha`         | Git commit SHA used by the worker.                             |

## Hydrated Shape

`getBacktestRunById` and `getBacktestRunByBatchUid` hydrate rows back into
`MarketStats[]` for research and diff tooling. That hydrated shape matches the
internal computation object, but the database source of truth is the table
columns above.

Example hydrated object:

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
  "upShares": 100,
  "downShares": 0,
  "mergableShares": 0,
  "cost": 0,
  "splitCost": 0,
  "intentMeta": [{ "label": "entry", "triggerPrice": 0.48 }],
  "execution": {
    "workerName": "worker-123#3",
    "startedAtMs": 1780142882515,
    "finishedAtMs": 1780142883710,
    "durationMs": 1195,
    "eventsProcessed": 14628,
    "eventsByType": { "book": 60, "price_change": 14568 },
    "commitSha": "4b0be181e18baef2142acb82dec9a46be8d24cfa"
  }
}
```
