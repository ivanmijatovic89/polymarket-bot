---
title: Running Backtests
description: How to replay recorded Parquet files through strategy logic to evaluate performance offline.
---

# Running Backtests

The backtest CLI replays recorded WebSocket events from Parquet files through the exact same `MarketEngine` and `StrategyRunner` code used for live trading. Each 15-minute market episode is replayed sequentially; the strategy receives identical tick-by-tick snapshots to what it would see in production.

After a run, per-market statistics, batch-level aggregates, and chunked batch statistics are written to the database automatically.

## Prerequisites

- Node.js v20
- A populated `markets` table (run `npm run db:insert-parquet` to seed from existing Parquet filenames)
- At least one Parquet file under `data/events/<symbol>/`

## File Selection Modes

The CLI supports four mutually exclusive ways to specify which markets to replay.

### 1. Direct file paths

Pass one or more `.parquet` file paths as positional arguments.

```bash
npm run backtest -- --strategy <id> data/events/btc/btc-updown-15m-1700000000.parquet
```

Multiple files are de-duplicated, sorted, and replayed in order.

### 2. Directory scan (`--dir`)

Scan one or more directories for all `.parquet` files (non-recursive). Repeatable.

```bash
npm run backtest -- --strategy <id> --dir data/events/btc --dir data/events/eth
```

::: tip
`--dir` and `--symbol` are mutually exclusive. `--dir` and `--slug` are also mutually exclusive.
:::

### 3. Symbol query (`--symbol`)

Query the database for markets matching the given symbol. Requires `--limit` when used with `--random` or `--latest`.

```bash
npm run backtest -- --strategy <id> --symbol btc --limit 100
```

Accepted values: `btc`, `eth`, `sol`, `xrp`.

### 4. Slug query (`--slug`)

Query the database for one or more specific market slugs. Multiple slugs are comma-separated.

```bash
npm run backtest -- --strategy <id> --slug btc-updown-15m-1700000000,btc-updown-15m-1700000900
```

::: warning
`--slug` and `--symbol` are mutually exclusive.
:::

## CLI Flags Reference

### Strategy selection

| Flag                | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `--strategy <id>`   | **Required.** Strategy identifier as registered in `strategyRegistry`.                                |
| `--param key=value` | Override a strategy parameter. Repeatable. JSON strings are accepted: `--param assetIds='["a","b"]'`. |

### File / market selection

| Flag             | Description                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `--symbol <sym>` | Load markets from the database for the given symbol.                                            |
| `--slug <slugs>` | Comma-separated list of market slugs to load from the database.                                 |
| `--dir <path>`   | Scan a directory for `.parquet` files. Repeatable.                                              |
| `--limit <N>`    | Maximum number of markets to fetch (required with `--random` or `--latest`).                    |
| `--random`       | Draw `--limit` markets at random from the database. Takes precedence over `--latest`.           |
| `--latest`       | Fetch the `--limit` most recently recorded markets. Takes precedence when `--random` is absent. |

### Replay options

| Flag                              | Description                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--order recorded\|exchange_time` | Event ordering key. `recorded` (default) uses `ingest_seq`; `exchange_time` uses `ts_exchange_ms`, falling back to `ts_local_ms`.                               |
| `--time-driven`                   | Introduce real-time delays proportional to the recorded timestamps (max 10 seconds per gap). Useful for visual inspection; not needed for automated evaluation. |

### Metadata / tracking

| Flag                | Description                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `--comment <text>`  | Free-text annotation stored with the run record in the database.                                 |
| `--batchUid <uuid>` | Override the auto-generated batch UUID. Useful when grouping multiple runs under one identifier. |
| `--baselineId <id>` | Reference a prior run for comparison purposes.                                                   |

## Environment Variables

| Variable                                 | Default | Description                                                                                                                     |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BACKTEST_LATENCY_DELAY`                 | `0`     | Simulated round-trip latency in milliseconds applied to every order action (place, cancel).                                     |
| `BACKTEST_LATENCY_JITTER`                | `20`    | Symmetric random jitter in milliseconds added to each latency delay. Only applied when `BACKTEST_LATENCY_DELAY > 0`.            |
| `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS` | —       | Set to `1` when using the `TechnicalIndicators` plugin. Allows the plugin's warmup period to complete before the strategy acts. |
| `INITIAL_CAPITAL`                        | `1000`  | Starting capital in USDC used as the baseline for batch-level P&L calculations.                                                 |

::: warning Dry-run note
The backtest engine always runs with `dryRun: false` internally — the `BacktestExecution` simulator handles order fills without touching real funds. The live `DRY_RUN` environment variable has no effect on backtests.
:::

## Latency Simulation

When `BACKTEST_LATENCY_DELAY` is set, order intents are delayed before they become visible to the simulated order book. This means a cancel intent may "arrive" after a fill has already occurred, accurately reflecting production round-trip characteristics.

```bash
BACKTEST_LATENCY_DELAY=140 BACKTEST_LATENCY_JITTER=20 \
  npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 50
```

Maker fills use the "worst-queue" model: a resting BUY order at price `P` fills only when `bestAsk < P`.

## Common Workflows

### Quick smoke test against recent markets

```bash
npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 10 --latest
```

### Random sample for unbiased evaluation

```bash
npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 200 --random
```

### Replay a specific set of slugs

```bash
npm run backtest -- --strategy MyStrategy.v1 \
  --slug btc-updown-15m-1700000000,btc-updown-15m-1700000900
```

### Replay all files in a directory with exchange-time ordering

```bash
npm run backtest -- --strategy MyStrategy.v1 \
  --dir data/events/btc --order exchange_time
```

### Full evaluation with latency and a comment

```bash
BACKTEST_LATENCY_DELAY=140 \
  npm run backtest -- --strategy MyStrategy.v1 \
  --symbol btc --limit 500 \
  --comment "baseline v1 with 140ms latency"
```

### Pass strategy parameters

```bash
npm run backtest -- --strategy SplitSellRedeem.v1 \
  --param splitShares=100 \
  --param triggerBidBelow=0.20 \
  --param sellPrice=0.21 \
  --symbol btc --limit 100
```

## Output

Each completed run produces three levels of output:

1. **Per-market stats** — printed in green (positive P&L) or red (negative P&L) during replay.
2. **Batch stats** — aggregated metrics printed at the end and stored in the database.
3. **Chunked batch stats** — computed for window sizes `[96, 200, 300]` and stored alongside the batch record.

See [Market Statistics](./market-stats.md), [Batch Statistics](./batch-stats.md), and [Chunked Batch Statistics](./chunked-batch-stats-new.md) for full field definitions.

::: details Progress and ETA output
After each market completes, the CLI prints:

```
[backtest][12/200] finished in 0min 3 sec | elapsed 0min 42 sec | eta 12min 18 sec
```

This is based on the rolling average time per market and does not account for market-to-market variance.
:::
