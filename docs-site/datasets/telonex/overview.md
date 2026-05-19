---
title: Telonex Overview
description: How the bot ingests, converts, verifies, and replays Telonex historical data through a MySQL and Cloudflare R2 backed pipeline.
---

# Telonex Overview

Telonex is a third-party platform that continuously records the Polymarket WebSocket feed and exposes the result as daily Parquet files via a REST API. The bot uses Telonex as a backfill source: instead of waiting for the live recorder to accumulate weeks of data, you can pull pre-collected snapshots for any past market window and replay them through the same backtest engine.

This page explains how the integration is structured. For step-by-step instructions see the linked pages at the bottom.

## The production pipeline and verification gate

Ingesting Telonex data is split into three production stages plus an explicit verification gate. The production stages have dedicated CLIs and write their state to MySQL, so any stage can be re-run or resumed without touching the others. Verification is intentionally local and temporary: it rebuilds converter output for one slug and proves that backtest replay reconstructs the original raw Telonex orderbook state.

```mermaid
flowchart LR
    A[Telonex catalogue<br/>parquet over HTTPS] -- npm run telonex:sync --> B[(telonex_markets)]
    B -- npm run telonex:download --> C[(telonex_market_files)<br/>R2 telonex/raw/...]
    C -- npm run telonex:convert --> D[(telonex_market_conversions)<br/>R2 telonex/converted/...<br/>local data/events/telonex/...]
    C -- npm run telonex:verify --> E[Temp paired/delta/delta-typed files<br/>tick-by-tick replay comparison]
```

| Stage | CLI | Purpose | State table |
| --- | --- | --- | --- |
| 1. Sync | [`telonex:sync`](/datasets/telonex/sync-markets) | Filter the Telonex markets catalogue (~660 MB Parquet) with DuckDB; upsert matching rows. | `telonex_markets` |
| 2. Download | [`telonex:download`](/datasets/telonex/download-raw-files) | Per-market worker. Downloads raw `book_snapshot_full` files from Telonex, validates MD5, uploads to Cloudflare R2. | `telonex_market_files` |
| 3. Convert | [`telonex:convert`](/datasets/telonex/convert) | Dispatcher. Reads raw files from R2, runs the chosen converter (`paired`, `delta`, or `delta-typed`), writes the result locally and/or to R2. | `telonex_market_conversions` |
| Verification gate | [`telonex:verify`](/datasets/telonex/verify) | Rebuilds temp converter output for one slug, replays it through the backtest orderbook path, and compares every strategy tick against raw Telonex state. | No persistent table |

The stages are decoupled by intent: the catalogue refreshes on a different cadence than the raw file pull, and you may want to re-run conversion many times (e.g. tweaking the delta converter's book interval) without re-pulling the source data each time. Verification stays outside persistent pipeline state because it is a correctness check for current code, not a production artifact.

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

One row per (`market_id`, `converter`) pair. A single market can be converted by multiple converters (`paired`, `delta`, `delta-typed`, future additions) independently — each leaves its own row.

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
telonex/converted/delta-typed/btc/15m/1765123200/btc-updown-15m-1765123200.parquet
```

The raw filename is the original `Content-Disposition` name returned by the Telonex download endpoint and is never altered by the bot.

## Per-market candidate expansion

Each `telonex_markets` row carries a `book_snapshot_full_from` / `book_snapshot_full_to` date range and the two outcome asset IDs (`asset_id_0` and `asset_id_1`, paired with the labels `outcome_0` and `outcome_1` — typically `"Up"` and `"Down"` for `*-updown-*` markets). At download time, the worker expands the range into candidate `(date, asset_id)` pairs:

| Range | Candidates per market |
| --- | --- |
| 1 day | 2 (one date × two outcomes) |
| 2 days | 4 |
| 3 days | 6 |

For 15-minute markets the typical case is 2 candidates (one UTC day, two outcomes) when the window stays inside a day, or 4 candidates when the window crosses midnight UTC.

Telonex sometimes returns HTTP 404 for a candidate date — most commonly for markets prior to 2026-01-19 where Telonex's coverage is known to have gaps. The worker records these as `no_file` rows in `telonex_market_files`, not as failures.

## Three output formats: paired vs delta vs delta-typed

The convert stage runs one or more converters. `--converter` can be repeated (`--converter delta --converter delta-typed --converter paired`) to run multiple formats in a single pass, downloading raw files once per market.

### Paired

Pre-combines the Up and Down books at every exchange timestamp into a single `orderbook_pair` row. Each row contains both sides of the book simultaneously, so a strategy that needs to see Up and Down together (for example, computing the spread between Up ask and Down ask) always gets a consistent snapshot.

- Output schema: `pairedOrderbookParquetSchema` (typed columns `up_asset_id`, `up_bids`, `up_asks`, `down_asset_id`, `down_bids`, `down_asks`, …).
- Requires `--input-mode telonex-paired-parquet` at backtest time.
- Replay is slower per row than a live-recorded delta file because every row is a full book replacement. Measure on the target machine before using paired files for large batch runs.

### Delta

Converts the raw snapshots into the same format the live recorder produces: a stream of `book` checkpoints interleaved with `price_change` deltas. Up and Down ticks at the same exchange timestamp are merged into a single `price_change` row.

- Output schema: `rawMarketEventParquetSchema` (the live format).
- No special `--input-mode` flag at backtest time — runs in the standard `recorded` mode.
- Replays at the same speed as a live-recorded file because most rows are lightweight deltas.

### Delta typed

Uses the same `book` / `price_change` tick cadence as the raw-json delta converter, but stores only replay-needed typed level/change columns instead of a full `raw_json` payload per event.

- Output schema: `typedDeltaMarketEventParquetSchema` (one row per strategy-visible event, with flat repeated primitive columns such as `bid_prices`, `bid_sizes`, `change_asset_indexes`, `change_side_codes`, `change_prices`, and `change_sizes`).
- Requires `--input-mode telonex-delta-parquet` at backtest time.
- Replays through the typed Telonex delta adapter and should produce the same strategy tick stream as `delta` with smaller files and less JSON parsing.

::: tip
Use **delta-typed** for new Telonex backtests when you do not need raw payload preservation. Use **delta** when you specifically want live-recorder file compatibility, and **paired** for strategies that depend on the synchronous Up+Down book view it provides on every tick.
:::

## Verification semantics

The conversion step is not considered trustworthy just because it produced a valid Parquet file. A valid file can still reconstruct the wrong orderbook.

Use [`telonex:verify`](/datasets/telonex/verify) to certify converter behavior for a slug. The verifier:

- discovers raw files and Up/Down mapping from the database;
- streams raw R2 files to local temp storage;
- rebuilds paired and/or delta outputs from current converter code;
- replays those outputs through the same orderbook path used by backtests;
- compares both assets, bids, asks, all levels, and numeric price/size equality on every emitted strategy tick.

This makes verification stricter than the legacy diagnostics. Diagnostics explain data coverage and raw alignment. Verification proves that a converter output is behaviorally equivalent to the raw Telonex orderbook stream at the strategy boundary.

## Carry-forward pairing

Telonex tracks events **per `asset_id`**, not per side of the market. Each row in a raw file references exactly one `asset_id`, and the event stream for `asset_id_0` is recorded independently from the stream for `asset_id_1`. Because the underlying Polymarket WebSocket events arrive per asset, a book update on the Up token is a distinct event from a book update on the Down token. Some timestamps appear in both raw files, and some appear in only one.

The **paired** converter has to synthesise a single output row that contains both sides simultaneously. When it reaches a timestamp where only one side has a tick, it carries forward the most recent tick from the missing side. The output row therefore has one fresh side and one previous-tick-old side.

::: warning
A carry-forward frame means one side of the pair is from the previous tick for that side rather than the current exchange timestamp. In practice the gap is small (one consecutive event apart for that asset), but strategies sensitive to fine-grained price movement should be aware that not every row is perfectly synchronous.
:::

The **delta** and **delta-typed** converters do not need to synthesise paired frames — they emit each side's update as a `price_change` (or `book` checkpoint) when it arrives — so carry-forward does not apply there.

## Channel coverage semantics

Per the [Telonex Polymarket docs](https://telonex.io/docs/exchanges/polymarket), all off-chain channels are **event-driven rather than interval-sampled**. The collector subscribes to Polymarket's WebSocket `market` channel, processes every `book` and `price_change` event, and maintains a local order book. From that local book it derives the various channels:

| Channel | When a row is written |
| --- | --- |
| `book_snapshot_full` | Every tick — every `book` and `price_change` event Telonex received. |
| `book_snapshot_25` | Only when something changes within the top 25 levels. |
| `book_snapshot_5` | Only when something changes within the top 5 levels. |
| `quotes` | Only when the best bid or ask price or size changes. |

The bot uses `book_snapshot_full` (see [Sync Markets](/datasets/telonex/sync-markets) — that's the only channel the sync filter accepts), so the input is meant to be lossless with respect to what Telonex's WebSocket session itself observed.

That said, a Telonex collector run and your own live recorder are two independent WebSocket sessions with independent reconnect windows. Events one session sees, the other might not. Use the [omitted-events diagnostic](/datasets/telonex/diagnostics#omitted-events) against a recorded file and a Telonex directory for the same window if you want to quantify the difference between the two sessions for a specific market.

## Resources

- [Telonex](https://telonex.io) — platform website
- [Telonex Documentation](https://telonex.io/docs) — API reference, schemas, exchange-specific guides

## Next steps

- [Sync Markets](/datasets/telonex/sync-markets) — populate `telonex_markets` from the Telonex catalogue.
- [Download Raw Files](/datasets/telonex/download-raw-files) — pull `book_snapshot_full` files into R2 and `telonex_market_files`.
- [Convert](/datasets/telonex/convert) — run the paired, delta, or delta-typed converter through the dispatcher.
- [Verify Conversions](/datasets/telonex/verify) — prove the converted file reconstructs raw Telonex orderbooks tick by tick.
- [Run a Backtest](/datasets/telonex/backtest) — replay converted files through the backtest engine.
- [Diagnostics](/datasets/telonex/diagnostics) — inspect coverage and merge alignment.
