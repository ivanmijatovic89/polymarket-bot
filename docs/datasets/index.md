---
title: Datasets
description: An overview of the three dataset sources the backtest engine supports — Live Recording, Telonex, and PMXT.
---

# Datasets

The backtest engine is data-source agnostic. It runs the same strategy code and the same `MarketEngine` regardless of where the data comes from. What changes between dataset sources is how the data was collected, what format it arrives in, and how you prepare it for replay.

Three dataset sources are currently supported:

| Source | Format | Historical reach | Setup effort | Replay speed |
| --- | --- | --- | --- | --- |
| [Recorder V4](/datasets/recording/overview) | Compact mixed-feed Parquet + manifest/resolution sidecars | From the moment you start recording | Run the isolated recorder | See [measured validation](/datasets/recording/recorder-v4-validation) |
| [Telonex](/datasets/telonex/overview) | Delta (book/price_change) or paired snapshots (Parquet) | Pre-collected historical data | Pipeline-managed: sync + download + convert | Same as baseline (delta) or ~3× slower (paired) |
| [PMXT](/datasets/pmxt/overview) | Hourly orderbook archive (Parquet), converted to native format | Pre-collected historical data (v1: Feb–Apr 2026, v2: Apr 2026 onward) | Pipeline-managed: sync catalogue + download & convert (v1) or build master (v2) | Same as baseline (converted to native format) |

## Live Recording

Recorder V4 captures BTC 5m and 15m markets with Polymarket, Binance aggregate trades and quotes, Chainlink spot/TWAP, and website price-to-beat observations. One receipt sequence preserves their arrival order in each self-contained market package. Durable journals support recovery; verified R2 upload precedes local event-file cleanup. Coverage and resolution evidence travel with the package.

This records what the recorder process received. Another host or WebSocket session can observe different timing or gaps.

The tradeoff is that you can only record from the moment you start. There is no historical backfill — if you want data from last week, you needed to be recording last week.

→ [Live Recording docs](/datasets/recording/overview)

## Telonex

Telonex is a market data platform that has continuously recorded Polymarket's WebSocket feed. The bot ingests it through a three-stage pipeline managed by dedicated CLIs:

1. **Sync** the Telonex catalogue into `telonex_markets` (MySQL).
2. **Download** each market's `book_snapshot_full` files to Cloudflare R2, recording uploads in `telonex_market_files`.
3. **Convert** raw files into either a paired `orderbook_pair` parquet or a delta-format `book`/`price_change` parquet, recording the result in `telonex_market_conversions`.

Two converters are available:

- **Delta** — produces live-format `book`/`price_change` output. Replays at the same speed as a live-recorded file. No special `--input-mode` flag needed. Recommended for new work.
- **Paired** — produces `orderbook_pair` output. Requires `--input-mode telonex-paired --read-from local|r2|local-or-download-from-r2-to-local`. Approximately three times slower to replay, but every row carries both sides synchronously.
- **Delta-typed** — produces typed `book`/`price_change` output (no `raw_json`). Requires `--input-mode telonex-delta --read-from local|r2|local-or-download-from-r2-to-local`. Recommended for new work alongside the delta-typed DB join in the backtest CLI.

→ [Telonex docs](/datasets/telonex/overview)

## PMXT

[PMXT](https://archive.pmxt.dev) publishes free hourly Parquet snapshots of Polymarket orderbook data in two archive versions (v1 and v2). The bot ingests it by syncing the archive catalogue into `pmxt_dataset_catalogue`, then either converting v1 hourly files to native parquet windows (`pmxt:download-and-convert:v1`) or assembling a v2 master parquet (`pmxt:resolve-slugs:v2` + `pmxt:build-master:v2`).

→ [PMXT docs](/datasets/pmxt/overview)

## Choosing a source

- **You need data from before you started recording** → use Telonex or PMXT.
- **You need the highest possible event fidelity for a specific window you were recording** → use Live Recording. Telonex's `book_snapshot_full` is also event-driven (a row per tick), but it is a separate WebSocket session — the two sessions may have had different reconnect windows or transient disconnects, so per-event coverage can diverge for that window.
- **You are running many backtests over the same market window and replay speed matters** → use the delta converter (`--converter delta`). It replays at the same speed as a live-recorded file. The paired converter is ~3× slower.
- **You want to validate a strategy against your own recorded data** → use Live Recording, then cross-check with Telonex diagnostics to understand coverage differences.

## From dataset to backtest: the full workflow

Preparation depends on the source. V4 uses verified packages; historical pipelines use their catalogues and conversions.

### Recorder V4

```bash
# Capture with a dedicated configuration (both BTC durations by default).
npm run record:v4 -- --env-file /absolute/path/to/.env.recorder-v4

# After downloading a selected package from R2:
npm run record:v4:verify -- /absolute/path/to/downloaded-package
npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v4 --dir /absolute/path/to/recorder-cache \
  --timeframe 15m --sequential
```

Use [V4 list/download](/datasets/recording/recorder-v4#r2-object-layout) to select archives. V4 supplies its own market metadata; it does not use the raw-file database seeding or disconnect-deletion workflow. Ordinary replay skips markets with gaps in required feeds, retaining the data for explicit outage experiments.

→ [V4 capture, archive, and replay diagrams](/datasets/recording/recorder-v4) · [Worker-2 operations](/datasets/recording/recorder-v4-worker-2)

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
- **Backtest** — replay the file. Delta files use standard `recorded` mode; delta-typed files use `--input-mode telonex-delta --read-from local|r2|local-or-download-from-r2-to-local`; paired files use `--input-mode telonex-paired --read-from local|r2|local-or-download-from-r2-to-local`.

→ [Sync Markets](/datasets/telonex/sync-markets) · [Download Raw Files](/datasets/telonex/download-raw-files) · [Convert](/datasets/telonex/convert) · [Run a Backtest](/datasets/telonex/backtest) · [Verify Parquet File](/datasets/tools/verify-parquet)
