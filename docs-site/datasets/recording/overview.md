---
title: Live Recording Overview
description: How the live recorder captures Polymarket WebSocket events to Parquet files and when to use self-recorded data over third-party sources.
---

# Live Recording Overview

Live recording is the process of subscribing to Polymarket's WebSocket feed in real time and writing every incoming market event directly to disk as Parquet files. These files become the input for the backtest engine, which replays them through the exact same `MarketEngine` and strategy code used in live trading.

## How it works

The recorder subscribes to Polymarket's market WebSocket channel and passes every incoming message through the `rawEventIndexer`. The indexer extracts the market ID, exchange timestamp, and event type from the raw JSON. Messages that do not carry a recognisable market ID, contain malformed JSON, or have an unknown event type are silently dropped and counted in the stats output (`dropped_no_market`, `dropped_bad_json`, `dropped_unknown_type`). Everything else is written to disk as a row, preserving the original JSON payload alongside a local ingestion timestamp and a monotonic per-market sequence number.

If the number of in-flight disk writes reaches `RECORD_MAX_INFLIGHT_APPENDS`, the recorder disconnects and schedules a reconnect rather than letting pending writes grow unbounded in memory.

Markets run in 15-minute windows. At each window boundary the recorder stops the WebSocket, drains all in-flight writes, closes the current Parquet file, re-resolves the new window's slug and token IDs from the Gamma API, and reconnects. Files are named after the market slug:

```
data/events/<symbol>/<slug>.parquet
```

For example:

```
data/events/btc/btc-updown-15m-1766523600.parquet
```

Each file contains the complete raw event stream for one 15-minute market window on one symbol.

## When to use live recording

Live recording gives you the highest-fidelity dataset available — the exact event stream the live trading engine sees, at the exact frequency Polymarket broadcasts it, including disconnect markers when connectivity is lost.

The tradeoff is that you can only record from the moment you start. There is no historical backfill. If you want data from a past market window, you either needed to be recording at the time or you need a third-party source like [Telonex](/datasets/telonex/overview).

Use live recording when:

- You want to validate a strategy against your own data before going live.
- You need the full event stream, not just periodic snapshots.
- You are building a dataset from today forward.

Use Telonex or PMXT when:

- You need historical data from before you started recording.
- You are running many backtests and want faster replay.

## File integrity

While a file is being written it carries a `.parquet.tmp` extension. Only files that closed cleanly after a full 15-minute window carry the final `.parquet` extension. Files closed by `Ctrl+C` or `SIGTERM` are renamed to `*-terminated.parquet` — they are valid and usable but represent a partial window.

::: danger
Never kill the recorder with `SIGKILL`. It bypasses the shutdown handler and leaves `.parquet.tmp` files on disk with missing footers. These files are unreadable and must be deleted.
:::

## Pages in this section

- [Recording Live Events](/datasets/recording/recording-live-events) — how to start the recorder, configure rotation, and tune environment variables.
- [Scan Disconnect Events](/datasets/recording/scan-disconnect-events) — inspect files for WebSocket gaps and remove files that would degrade backtest quality.

The following tools apply to all dataset sources and are documented in the [Dataset Tools](/datasets/tools/verify-parquet) section:

- [Verify Parquet File](/datasets/tools/verify-parquet) — validate that any Parquet file is fully readable before backtesting.
- [List Backtest Files](/datasets/recording/list-backtest-files) — enumerate available files for a symbol and pipe them into the backtest runner.
- [Seed Database from Parquet](/datasets/recording/insert-parquet-to-db) — sync the markets database with the files currently on disk.
