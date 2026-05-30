---
title: Running Backtests
description: How to replay recorded Parquet files through strategy logic to evaluate performance offline.
---

# Running Backtests

The backtest CLI replays Parquet files through the exact same `MarketEngine`
and `StrategyRunner` code used for live trading. Each 15-minute market episode
runs in full isolation (fresh `Runner` / `Portfolio` / `OrderManager`) and the
strategy receives identical tick-by-tick snapshots to what it would see in
production.

By default the producer enqueues every market as a child job in a BullMQ
**FlowProducer** flow and a worker daemon processes them in parallel across
your CPU cores. The aggregate parent job sorts the results back into the
original input order before computing batch-level statistics, so any
streak/chunk math is byte-equal to the sequential baseline. See the
[Parallelization](./parallelization.md) page for the full architecture, the
worker/dashboard setup, and the bit-identical verification protocol.

After a run, per-market statistics, batch-level aggregates, and chunked batch
statistics are written to the database automatically.

## Input modes

`--input-mode` picks both the replayer and the database source:

| Input mode       | Data source                                                                 | Reference                                |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `recorded`       | `markets` table + WS-recorded parquet under `data/events/<symbol>/`         | This page                                |
| `telonex-delta`  | `telonex_markets` ⋈ `telonex_market_conversions` (`converter='delta-typed'`) | [Telonex backtest](/datasets/telonex/backtest) |
| `telonex-paired` | `telonex_markets` ⋈ `telonex_market_conversions` (`converter='paired'`)     | [Telonex backtest](/datasets/telonex/backtest) |

This page focuses on the default `recorded` mode. For telonex modes, see [Run a Backtest with Telonex Data](/datasets/telonex/backtest) — the file-selection flags (`--symbol`, `--slug`, `--dir`, `--limit`, `--random`, `--latest`) work identically; telonex modes additionally require `--read-from local|r2`.

## Prerequisites

- Node.js v20
- A populated `markets` table (run `npm run db:insert-parquet` to seed from existing Parquet filenames)
- At least one Parquet file under `data/events/<symbol>/`
- For the **default** (BullMQ) execution path:
  - Redis running locally (`brew services start redis`)
  - At least one worker daemon up (`npm run backtest:worker`)
  - Optional dashboard (`npm run backtest:dashboard` → http://127.0.0.1:3001)
- Pass `--sequential` if you'd rather skip the worker daemon and run the loop
  in-process (see [Execution modes](#execution-modes) below).

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

### Input-mode / data-source (telonex)

| Flag                            | Description                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--input-mode <mode>`           | `recorded` (default), `telonex-delta`, or `telonex-paired`. See [Telonex backtest](/datasets/telonex/backtest).   |
| `--read-from local\|r2`         | **Required** for telonex modes. Picks `local_path` vs `r2_url` from `telonex_market_conversions`. Rejected with `recorded`. |
| `--timeframe <value>`           | Symbol-filter timeframe segment (e.g. `15m`, `5m`). Default `15m`. Only valid with `--symbol`.                    |

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

### Execution mode

| Flag           | Description                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--sequential` | Bypass BullMQ and run the loop in-process. No Redis or worker daemon required. Use for quick smoke tests, bit-identical verification, or machines without Redis. See [Execution modes](#execution-modes).            |
| `--detach`     | (BullMQ default only.) Enqueue the flow, print the `batchUid`, and exit immediately. The aggregator worker finalizes the batch into MySQL on its own. Re-attach by opening the batch in the dashboard.               |

## Execution modes

The same command supports three modes; behavior is identical for math
purposes (verified bit-identical with `BACKTEST_LATENCY_JITTER=0`) — they
differ only in how the per-market work is dispatched.

### Default — BullMQ (parallel, durable)

```bash
npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 200
```

Producer pre-resolves every market, enqueues one aggregate parent + N market
children, streams progress from the queue, and blocks until the aggregator
writes the final row to MySQL. Ctrl+C **detaches** from the live view; the
batch keeps running in the queue and can be re-attached from the dashboard.

Requires the [worker daemon](./parallelization.md#worker-daemon) and Redis
to be running.

### Fire-and-forget — `--detach`

```bash
npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 3000 --detach
```

Producer enqueues the flow and exits in a couple of seconds. The aggregator
worker writes the row to MySQL when the children settle. The dashboard
(http://127.0.0.1:3001) is the canonical place to watch progress.

### Sequential — `--sequential`

```bash
npm run backtest -- --strategy MyStrategy.v1 --symbol btc --limit 10 --sequential
```

Runs the per-market loop in-process. No Redis, no worker daemon, no
parallelism. Useful for quick smoke tests, baseline runs, or
bit-identical verification against the BullMQ path.

## Environment Variables

| Variable                                 | Default                  | Description                                                                                                                     |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `BACKTEST_LATENCY_DELAY`                 | `0`                      | Simulated round-trip latency in milliseconds applied to every order action (place, cancel).                                     |
| `BACKTEST_LATENCY_JITTER`                | `20`                     | Symmetric random jitter in milliseconds added to each latency delay. Only applied when `BACKTEST_LATENCY_DELAY > 0`.            |
| `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS` | —                        | Set to `1` when using the `TechnicalIndicators` plugin. Allows the plugin's warmup period to complete before the strategy acts. |
| `INITIAL_CAPITAL`                        | `1000`                   | Starting capital in USDC used as the baseline for batch-level P&L calculations.                                                 |
| `REDIS_URL`                              | `redis://localhost:6379` | Redis connection string used by the producer, worker daemon, and dashboard.                                                     |
| `DASHBOARD_PORT`                         | `3001`                   | Port for `npm run backtest:dashboard`. Override when running alongside the webui.                                               |

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

Each completed run produces three levels of output and writes a single row
to the `backtests` table:

1. **Per-market stats** — one entry per market in the `market_stats` JSON
   column. In the BullMQ path, terminal output is a compact `[i/N] completed=… failed=…`
   progress line; in `--sequential` mode each market also prints its
   per-market summary in green/red.
2. **Batch stats** — aggregated metrics printed at the end and stored in
   `batch_stats`.
3. **Chunked batch stats** — computed for window sizes `[96, 200, 300]`
   and stored in `chunked_batch_stats`.

The row also carries:

- `execution` metadata inside each `market_stats[i]` (which worker ran it,
  duration, replayed event counts, commit SHA — see
  [MarketStats execution](./market-stats.md#execution-metadata-optional)).
- `failed_markets` — JSON array of `{ jobId?, idx, slug, reason }` for any
  children that exhausted retries (`null` for legacy / pre-BullMQ runs, `[]`
  for successful parallel runs, non-empty when partial failures happened).

See [Market Statistics](./market-stats.md),
[Batch Statistics](./batch-stats.md), and
[Chunked Batch Statistics](./chunked-batch-stats.md) for full field
definitions.

### Watching progress live

The [dashboard](./parallelization.md#dashboard) at
`http://127.0.0.1:3001` shows the active batch, per-worker stats, queue
depth, and historical batches without needing to re-attach to the producer
terminal. It also surfaces the same `failed_markets` audit so you can
inspect what went wrong without opening MySQL.

::: details Progress and ETA output
**Sequential mode** prints one line per market with the rolling average:

```
[backtest][12/200] finished in 0min 3 sec | elapsed 0min 42 sec | eta 12min 18 sec
```

**BullMQ mode** prints a compact summary every ~5% of progress:

```
[backtest][120/200] completed=118 failed=2 | elapsed 0min 42 sec | eta 0min 28 sec
```

Both estimates are rolling-average based and don't account for
market-to-market variance.
:::
