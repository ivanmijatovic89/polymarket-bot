---
title: Datasets
description: An overview of the three dataset sources the backtest engine supports — Live Recording, Telonex, and PMXT.
---

# Datasets

The backtest engine is data-source agnostic. It runs the same strategy code and the same `MarketEngine` regardless of where the data comes from. What changes between dataset sources is how the data was collected, what format it arrives in, and how you prepare it for replay.

Three dataset sources are currently supported:

| Source | Format | Historical reach | Setup effort | Replay speed |
| --- | --- | --- | --- | --- |
| [Live Recording](/datasets/recording/overview) | Raw WS events (Parquet) | From the moment you start recording | Run the recorder yourself | Baseline |
| [Telonex](/datasets/telonex/overview) | Delta (book/price_change) or paired snapshots (Parquet) | Pre-collected historical data | Pipeline-managed: sync + download + convert | Same as baseline (delta) or ~3× slower (paired) |
| [PMXT](/datasets/pmxt/overview) | _(coming soon)_ | — | — | — |

## Live Recording

The recorder subscribes to Polymarket's WebSocket and writes every valid market event to a Parquet file in real time. This is the highest-fidelity source — it captures the exact event stream the live trading engine sees, including disconnect markers when connectivity is lost.

The tradeoff is that you can only record from the moment you start. There is no historical backfill — if you want data from last week, you needed to be recording last week.

→ [Live Recording docs](/datasets/recording/overview)

## Telonex

Telonex is a market data platform that has continuously recorded Polymarket's WebSocket feed. The bot ingests it through a three-stage pipeline managed by dedicated CLIs:

1. **Sync** the Telonex catalogue into `telonex_markets` (MySQL).
2. **Download** each market's `book_snapshot_full` files to Cloudflare R2, recording uploads in `telonex_market_files`.
3. **Convert** raw files into either a paired `orderbook_pair` parquet or a delta-format `book`/`price_change` parquet, recording the result in `telonex_market_conversions`.

Two converters are available:

- **Delta** — produces live-format `book`/`price_change` output. Replays at the same speed as a live-recorded file. No special `--input-mode` flag needed. Recommended for new work.
- **Paired** — produces `orderbook_pair` output. Requires `--input-mode telonex-paired-parquet`. Approximately three times slower to replay, but every row carries both sides synchronously.

→ [Telonex docs](/datasets/telonex/overview)

## PMXT

Documentation coming soon.

→ [PMXT docs](/datasets/pmxt/overview)

## Choosing a source

- **You need data from before you started recording** → use Telonex or PMXT.
- **You need the highest possible event fidelity for a specific window you were recording** → use Live Recording. Telonex's `book_snapshot_full` is also event-driven (a row per tick), but it is a separate WebSocket session — the two sessions may have had different reconnect windows or transient disconnects, so per-event coverage can diverge for that window.
- **You are running many backtests over the same market window and replay speed matters** → use the delta converter (`--converter delta`). It replays at the same speed as a live-recorded file. The paired converter is ~3× slower.
- **You want to validate a strategy against your own recorded data** → use Live Recording, then cross-check with Telonex diagnostics to understand coverage differences.

## From dataset to backtest: the full workflow

Regardless of source, the path from raw data to a runnable backtest follows the same steps.

### Live Recording

```
1. Record         npm run record:live:btc
2. Scan           npm run scan:disconnect-events -- data/events/btc
3. Verify         npm run verify:parquet -- <file.parquet>
4. Seed database  npm run db:insert-parquet
5. Backtest       npm run backtest -- --strategy <id> --symbol btc
```

- **Record** — capture the live WebSocket stream to Parquet files. One file per 15-minute market window.
- **Scan** — inspect files for WebSocket disconnect gaps and remove files that would degrade backtest quality.
- **Verify** — confirm a file is fully readable and its schema looks correct before running a backtest.
- **Seed database** — index the files on disk into the `markets` table so the backtest CLI can query them by symbol, slug, or date range.
- **Backtest** — replay the files through your strategy.

→ [Scan Disconnect Events](/datasets/recording/scan-disconnect-events) · [Verify Parquet File](/datasets/tools/verify-parquet) · [Seed Database from Parquet](/datasets/recording/insert-parquet-to-db) · [Running Backtests](/backtest/running-backtests)

### Telonex (pipeline)

```
1. Sync           npm run telonex:sync
2. Download       npm run telonex:download
3. Convert        npm run telonex:convert -- --converter delta --converter paired --output local
4. Verify         npm run verify:parquet -- data/events/telonex/delta/btc/15m/<slug>.parquet
5. Backtest       npm run backtest -- --strategy <id> data/events/telonex/delta/btc/15m/<slug>.parquet
```

- **Sync** — populate `telonex_markets` by filtering the Telonex catalogue with DuckDB.
- **Download** — per-market worker pulls `book_snapshot_full` files into R2, recording each in `telonex_market_files`.
- **Convert** — dispatcher runs the requested converters; `--converter` can be repeated to run both in one pass, downloading raw files once per market.
- **Verify** — confirm the converted file is intact before running a backtest.
- **Backtest** — replay the file. Delta files use standard `recorded` mode; paired files use `--input-mode telonex-paired-parquet`.

→ [Sync Markets](/datasets/telonex/sync-markets) · [Download Raw Files](/datasets/telonex/download-raw-files) · [Convert](/datasets/telonex/convert) · [Run a Backtest](/datasets/telonex/backtest) · [Verify Parquet File](/datasets/tools/verify-parquet)
