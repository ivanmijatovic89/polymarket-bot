---
title: Download & Convert v1
description: How to run the PMXT v1 download and conversion pipeline, which fetches hourly archive files and converts them to the native parquet format for backtesting.
---

# Download & Convert v1

The `download-and-convert-v1` pipeline reads pending jobs from `pmxt_dataset_catalogue`, downloads each hourly PMXT file, converts it to the native parquet format (one file per 15-minute window), and removes the raw download.

::: tip Prerequisite
Run [Sync Catalogue](/datasets/pmxt/sync-catalog) first to populate the job queue.
:::

## Command

::: code-group

```bash [npm — full run]
npm run pmxt:download-and-convert:v1 -- --out data/events/btc-pmxt-v1
```

```bash [parallel (4 workers)]
npm run pmxt:download-and-convert:v1 -- --out data/events/btc-pmxt-v1 --concurrency 4
```

```bash [test with one job]
npm run pmxt:download-and-convert:v1 -- --limit 1 --out data/events/btc-pmxt-v1
```

```bash [retry failed jobs]
npm run pmxt:download-and-convert:v1 -- --out data/events/btc-pmxt-v1 --retry-failed
```

```bash [npx]
npx tsx src/pmxt/download-and-convert-v1.ts --symbol btc --out data/events/btc-pmxt-v1
```

:::

## Options

| Flag | Default | Description |
|---|---|---|
| `--out` | `data/events/btc` | Output directory for converted parquet files. |
| `--concurrency` | `1` | Number of parallel download+convert workers. |
| `--limit` | _(all pending)_ | Process at most N jobs then stop. Useful for testing. |
| `--retry-failed` | off | Reset all `failed` jobs back to `pending` before starting. Jobs stuck in `downloading`/`converting` are always reset automatically. |
| `--temp` | `temp/` | Directory for raw downloads before conversion. Deleted after each job. |
| `--symbol` | `btc` | Symbol label written to the DB job record. |
| `--window` | `15` | Window size in minutes. |

## What it does

For each pending job the pipeline executes these steps:

```
DB: pending → downloading
  ↓  download to temp/
DB: downloading → converting
  ↓  convert PMXT rows → native parquet (one file per 15m window)
  ↓  delete temp file
DB: converting → done  (slugs, windows_written, out_dir recorded)
```

On any error the job is marked `failed` with the error message stored in the DB. Use `--retry-failed` to reprocess failed jobs.

## Window quality check

After converting each 15-minute window, the pipeline checks whether the orderbook is in a usable state by the time the market opens:

- It finds the first `book` event timestamp for each token (UP and DOWN).
- It calculates how long after market open both tokens had a valid book snapshot — **both_warm**.
- If `both_warm` exceeds **15 seconds** after market open, the window is skipped and the output file is not written.

This ensures the backtester always starts with a complete orderbook. Windows too close to the start of the PMXT recording period may lack the initial book snapshot.

## Live progress

::: code-group

```text [concurrency=1 (default)]
Starting pipeline: 1283 pending jobs  symbol=btc  concurrency=1  out=data/events/btc-pmxt-v1

[1/1283] polymarket_orderbook_2026-02-21T18.parquet  downloading...
[1/1283] polymarket_orderbook_2026-02-21T18.parquet  converting...
[1/1283] polymarket_orderbook_2026-02-21T18.parquet  done (4 windows, 28.4s)  ETA: 10h 5m
[2/1283] polymarket_orderbook_2026-02-21T19.parquet  downloading...
...
```

```text [concurrency=4]
Starting pipeline: 1283 pending jobs  symbol=btc  concurrency=4  out=data/events/btc-pmxt-v1

[1/1283][w0] polymarket_orderbook_2026-02-21T18.parquet  downloading...
[2/1283][w1] polymarket_orderbook_2026-02-21T19.parquet  downloading...
[3/1283][w2] polymarket_orderbook_2026-02-21T20.parquet  downloading...
[4/1283][w3] polymarket_orderbook_2026-02-21T21.parquet  downloading...
[1/1283][w0] polymarket_orderbook_2026-02-21T18.parquet  converting...
[2/1283][w1] polymarket_orderbook_2026-02-21T19.parquet  converting...
[1/1283][w0] polymarket_orderbook_2026-02-21T18.parquet  done (4 windows, 28.4s)  ETA: 2h 34m
...
```

:::

```text [summary]
Pipeline finished in 2h 38m
  done:   1282
  failed: 1
  total:  1283

Skipped windows (4 total):
  [polymarket_orderbook_2026-02-21T19.parquet]  btc-updown-15m-1771700400  no events  no both warm  → no book for both tokens
```

## Output

Each processed hour produces up to 4 parquet files in the output directory:

```
data/events/btc-pmxt-v1/
  btc-updown-15m-1771700400.parquet
  btc-updown-15m-1771701300.parquet
  btc-updown-15m-1771702200.parquet
  btc-updown-15m-1771703100.parquet
  ...
```

Files follow the same naming convention and schema as live-recorded parquet files and can be used directly with the backtest runner:

```bash
npm run backtest -- --strategy <id> --dir data/events/btc-pmxt-v1
```

## DB job states

| Status | Meaning |
|---|---|
| `pending` | Waiting to be processed |
| `downloading` | Raw file being downloaded to `temp/` |
| `converting` | Conversion in progress |
| `done` | Successfully converted; `slugs`, `windows_written`, `out_dir` populated |
| `failed` | Error occurred; `error` column contains the message |

::: warning Long-running process
Converting all 1 283 v1 files takes approximately 10–11 hours with the default single worker. With `--concurrency 4` this drops to roughly 2.5–3 hours.

The pipeline can be safely interrupted with `Ctrl+C`. On the next run, any jobs left in `downloading` or `converting` are automatically reset to `pending` before processing starts — no flags needed.
:::
