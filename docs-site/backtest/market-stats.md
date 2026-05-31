---
title: Market Statistics
description: Reference for all fields produced by computeMarketStats — per-market P&L and trade breakdown for a single backtest episode.
---

# Market Statistics

`MarketStats` is the per-market output record produced by `computeMarketStats` in `src/backtest/stats/marketStats.ts`. One `MarketStats` object is emitted for each 15-minute market episode that resolved with a known outcome.

## When Stats Are Computed

After the full Parquet replay of a single file completes, `runSingleMarket` checks:

1. The slug could be parsed from the filename.
2. The market's `finalOutcome` (`UP` or `DOWN`) is known — markets that have not resolved are skipped with a warning.
3. Either the strategy placed at least one trade, **or** it holds a non-zero position, **or** neither (a stable-denominator zero-stats row is emitted).

When (1) and (2) hold:

- If the strategy traded or holds shares → `computeMarketStats` is called normally.
- If it did neither → a zero-stats row is emitted with `skipReason: 'no_in_window_activity'` so the market still counts toward batch denominators.

When (2) doesn't hold the market is skipped entirely with a console warning; no row is appended.

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

### Skip Reason (optional)

| Field        | Type                          | Description                                                                                                                                                                            |
| ------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipReason` | `'no_in_window_activity' \| undefined` | Present when the row was emitted as a stable-denominator placeholder: the market resolved cleanly but the strategy made no trades and held no positions inside the slug window. |

### Execution metadata (optional)

`execution` captures which worker processed the market, when, and how much
work it did. Populated by `runSingleMarket` and persisted inside the same
`market_stats` JSON column the producer already wrote to. The aggregator
**does not use this for math**; it exists so the dashboard can answer
"who ran this, how long did it take, how many events".

Legacy rows written before PR1 don't have this field — that's expected and
fully backward-compatible.

| Field                       | Type                     | Description                                                                                                                                                                                                            |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution.workerName`      | `string`                 | The full worker identifier — the supervisor's `--worker-name` (default `${os.hostname()}-${pid}`) plus `#<childId>` for the BullMQ child that processed the job, or `sequential-<pid>` for `--sequential` in-process runs. |
| `execution.startedAtMs`     | `number`                 | Unix ms when the worker pulled the job from the queue (or entered the in-process loop body).                                                                                                                           |
| `execution.finishedAtMs`    | `number`                 | Unix ms when the worker returned its result.                                                                                                                                                                           |
| `execution.durationMs`      | `number`                 | `finishedAtMs - startedAtMs`. Wall-clock for the replay + collection.                                                                                                                                                  |
| `execution.eventsProcessed` | `number`                 | Total replayed snapshot events for the market (book + price_change).                                                                                                                                                   |
| `execution.eventsByType`    | `Record<string, number>` | Per-event-type histogram, e.g. `{ book: 60, price_change: 14568 }`.                                                                                                                                                    |
| `execution.commitSha`       | `string`                 | The git SHA the worker was on when it processed the job. Useful for tying results to a specific code version.                                                                                                          |

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
  "intentMeta": [{ "label": "entry", "triggerPrice": 0.48 }],
  "execution": {
    "workerName": "Ivans-MacBook-Pro-2.local-12345#3",
    "startedAtMs": 1780142882515,
    "finishedAtMs": 1780142883710,
    "durationMs": 1195,
    "eventsProcessed": 14628,
    "eventsByType": { "book": 60, "price_change": 14568 },
    "commitSha": "4b0be181e18baef2142acb82dec9a46be8d24cfa"
  }
}
```

::: tip Skipped markets
A market is silently skipped (no `MarketStats` entry) only when the
resolution outcome is not yet available (a console warning is emitted) or
when the filename's slug cannot be parsed. Markets where the strategy made
no trades and held no positions are still emitted with
`skipReason: 'no_in_window_activity'` so batch denominators stay stable
across modes and reruns.
:::
