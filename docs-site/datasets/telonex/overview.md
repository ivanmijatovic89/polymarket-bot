---
title: Telonex Overview
description: How the bot ingests Telonex historical data through a three-stage pipeline (sync → download → convert) backed by MySQL and Cloudflare R2.
---

# Telonex Overview

Telonex is a third-party platform that continuously records the Polymarket WebSocket feed and exposes the result as daily Parquet files via a REST API. The bot uses Telonex as a backfill source: instead of waiting for the live recorder to accumulate weeks of data, you can pull pre-collected snapshots for any past market window and replay them through the same backtest engine.

This page explains how the integration is structured. For step-by-step instructions see the linked pages at the bottom.

## The three-stage pipeline

Ingesting Telonex data is split into three independent stages. Each stage has a dedicated CLI and writes its state to MySQL, so any stage can be re-run or resumed without touching the others.

```mermaid
flowchart LR
    A[Telonex catalogue<br/>parquet over HTTPS] -- npm run telonex:sync --> B[(telonex_markets)]
    B -- npm run telonex:download --> C[(telonex_market_files)<br/>R2 telonex/raw/...]
    C -- npm run telonex:convert --> D[(telonex_market_conversions)<br/>R2 telonex/converted/...<br/>local data/events/telonex/...]
```

| Stage | CLI | Purpose | State table |
| --- | --- | --- | --- |
| 1. Sync | [`telonex:sync`](/datasets/telonex/sync-markets) | Filter the Telonex markets catalogue (~660 MB Parquet) with DuckDB; upsert matching rows. | `telonex_markets` |
| 2. Download | [`telonex:download`](/datasets/telonex/download-raw-files) | Per-market worker. Downloads raw `book_snapshot_full` files from Telonex, validates MD5, uploads to Cloudflare R2. | `telonex_market_files` |
| 3. Convert | [`telonex:convert`](/datasets/telonex/convert) | Dispatcher. Reads raw files from R2, runs the chosen converter (paired or delta), writes the result locally and/or to R2. | `telonex_market_conversions` |

The stages are decoupled by intent: the catalogue refreshes on a different cadence than the raw file pull, and you may want to re-run conversion many times (e.g. tweaking the delta converter's book interval) without re-pulling the source data each time.

## The MySQL state model

Three tables capture pipeline state. They are normalised so that each stage owns one table.

### `telonex_markets`

A mirror of one row from the Telonex catalogue plus pipeline-local columns. The `slug` column is unique; `INSERT IGNORE` makes sync idempotent.

Key pipeline columns:

- `upload_status` — `pending`, `processing`, `done`, `partial`, `failed`. Tracks Stage 2 progress.
- `files_uploaded` — count of successfully uploaded raw files for this market.
- `last_error`, `synced_at`, `processed_at`.

### `telonex_market_files`

One row per uploaded raw file. Created lazily by the download worker when it actually attempts a candidate, **not** by sync. The (`slug`, `channel`, `date`, `asset_id`) tuple is unique.

- `status` — `uploaded`, `no_file` (404 gap from Telonex), or `failed` (exhausted retries).
- `r2_key`, `r2_etag`, `size_bytes`.
- `attempts`, `last_error`, `started_at`, `uploaded_at`.

### `telonex_market_conversions`

One row per (`market_id`, `converter`) pair. A single market can be converted by multiple converters (`paired`, `delta`, future additions) independently — each leaves its own row.

- `status` — `pending`, `in_progress`, `done`, `failed`.
- `r2_url`, `local_path` — populated according to the `--output` mode chosen at convert time.
- `size_bytes`, `etag`, `attempts`, `last_error`, `started_at`, `completed_at`.

## R2 layout

Cloudflare R2 stores both the raw input files and the converted outputs. Keys are fully deterministic from a market's (`slug`, `channel`, `date`, `asset_id`) so any object can be recomputed without consulting the database.

```
telonex/
├── raw/
│   └── <symbol>/<timeframe>/<epoch>/<channel>/<asset_id>_<date>_<channel>.parquet
└── converted/
    └── <converter>/<symbol>/<timeframe>/<epoch>/<slug>.parquet
```

Concrete examples:

```
telonex/raw/btc/15m/1765123200/book_snapshot_full/40031974677622756146...053_2025-10-11_book_snapshot_full.parquet
telonex/converted/paired/btc/15m/1765123200/btc-updown-15m-1765123200.parquet
telonex/converted/delta/btc/15m/1765123200/btc-updown-15m-1765123200.parquet
```

The raw filename is the original `Content-Disposition` name returned by the Telonex download endpoint and is never altered by the bot.

## Per-market candidate expansion

Each `telonex_markets` row carries a `book_snapshot_full_from` / `book_snapshot_full_to` date range and two outcome asset IDs (`asset_id_0` for Up, `asset_id_1` for Down). At download time, the worker expands the range into candidate `(date, asset_id)` pairs:

| Range | Candidates per market |
| --- | --- |
| 1 day | 2 (one date × two outcomes) |
| 2 days | 4 |
| 3 days | 6 |

For 15-minute markets the typical case is 2 candidates (one UTC day, two outcomes) when the window stays inside a day, or 4 candidates when the window crosses midnight UTC.

Telonex sometimes returns HTTP 404 for a candidate date — most commonly for markets prior to 2026-01-19 where Telonex's coverage is known to have gaps. The worker records these as `no_file` rows in `telonex_market_files`, not as failures.

## Two output formats: paired vs delta

The convert stage runs one of two converters, selected with `--converter`.

### Paired

Pre-combines the Up and Down books at every exchange timestamp into a single `orderbook_pair` row. Each row contains both sides of the book simultaneously, so a strategy that needs to see Up and Down together (for example, computing the spread between Up ask and Down ask) always gets a consistent snapshot.

- Output schema: `pairedOrderbookParquetSchema` (typed columns `up_asset_id`, `up_bids`, `up_asks`, `down_asset_id`, `down_bids`, `down_asks`, …).
- Requires `--input-mode telonex-paired-parquet` at backtest time.
- Replay is roughly three times slower than a live-recorded file because every row is a full book replacement.

### Delta

Converts the raw snapshots into the same format the live recorder produces: a stream of `book` checkpoints interleaved with `price_change` deltas. Up and Down ticks at the same exchange timestamp are merged into a single `price_change` row.

- Output schema: `rawMarketEventParquetSchema` (the live format).
- No special `--input-mode` flag at backtest time — runs in the standard `recorded` mode.
- Replays at the same speed as a live-recorded file because most rows are lightweight deltas.

::: tip
Use the **delta** converter for new work — it is faster to replay and uses the same code path as live-recorded data. The **paired** converter is retained for strategies that depend on the synchronous Up+Down book view it provides on every tick.
:::

## Carry-forward pairing

Telonex snapshots do not always have perfectly matching timestamps for Up and Down. A book event may arrive for Up without a corresponding Down event at the exact same microsecond. When the **paired** converter encounters a timestamp where only one side has a snapshot, it carries forward the most recent snapshot from the missing side. The output row therefore has one fresh side and one slightly stale side.

::: warning
A carry-forward frame means one side of the pair is up to one Telonex snapshot interval old. In practice the gap is small, but strategies sensitive to fine-grained price movement should be aware that not every row is perfectly synchronous.
:::

The **delta** converter does not need to pair sides — it just emits each side's update as it arrives — so carry-forward does not apply there.

## What Telonex omits

Telonex captures snapshots at intervals rather than on every individual WebSocket event. Events where the orderbook did not meaningfully change between two snapshots may be omitted. This is normal coverage behaviour, not data loss in the strict sense.

If you want to measure how much your live recording captured that Telonex did not, run [`check-telonex-omitted-events`](/datasets/telonex/diagnostics) against a recorded file and a Telonex directory for the same window.

## Resources

- [Telonex](https://telonex.io) — platform website
- [Telonex Documentation](https://telonex.io/docs) — API reference, schemas, exchange-specific guides

## Next steps

- [Sync Markets](/datasets/telonex/sync-markets) — populate `telonex_markets` from the Telonex catalogue.
- [Download Raw Files](/datasets/telonex/download-raw-files) — pull `book_snapshot_full` files into R2 and `telonex_market_files`.
- [Convert](/datasets/telonex/convert) — run the paired or delta converter through the dispatcher.
- [Run a Backtest](/datasets/telonex/backtest) — replay converted files through the backtest engine.
- [Diagnostics](/datasets/telonex/diagnostics) — inspect coverage and merge alignment.
