---
title: Telonex Overview
description: What Telonex is, how its event-driven snapshot format works, and why the bot converts it to a paired Parquet format before backtesting.
---

# Telonex Overview

Telonex is a market data platform that collects and distributes historical data from prediction markets. It records order book activity from Polymarket's WebSocket feed and makes it available for download as daily Parquet files via a REST API. Instead of running your own live recorder to build a dataset, you can obtain pre-collected data from Telonex and use it as backtest input.

## How data is organised

Telonex organises data by **exchange → channel → date**. For each market side (UP and DOWN), you download one file per calendar day. A 15-minute BTC market that runs overnight would therefore span two days and produce four files:

```
book_snapshot_full_Up_2025-12-21.parquet
book_snapshot_full_Down_2025-12-21.parquet
book_snapshot_full_Up_2025-12-22.parquet
book_snapshot_full_Down_2025-12-22.parquet
```

You download each file from the Telonex API:

```bash
# Up side, 21 Dec
curl -L "https://api.telonex.io/v1/downloads/polymarket/book_snapshot_full/2025-12-21?slug=btc-updown-15m-1766364300&outcome=Up" \
  -H "Authorization: Bearer $TELONEX_API_KEY" \
  -o book_snapshot_full_Up_2025-12-21.parquet

# Down side, 21 Dec
curl -L "https://api.telonex.io/v1/downloads/polymarket/book_snapshot_full/2025-12-21?slug=btc-updown-15m-1766364300&outcome=Down" \
  -H "Authorization: Bearer $TELONEX_API_KEY" \
  -o book_snapshot_full_Down_2025-12-21.parquet
```

Repeat for each day in the market's date range. Place all downloaded files for one market into the same directory before merging.

::: tip Checking the available date range
Use the Telonex availability endpoint to find the `from_date` and `to_date` for a given market before downloading:

```bash
curl "https://api.telonex.io/v1/availability/polymarket?slug=btc-updown-15m-1766364300&outcome=Up"
```
:::

## How Telonex captures data

Telonex operates by listening to Polymarket's WebSocket feed and writing a full order book snapshot every time the exchange emits a `book` or `price_change` event. This means the snapshot frequency exactly matches the live WebSocket event frequency — there is one row in the Parquet file for each event Polymarket broadcast.

From the [Telonex documentation](https://telonex.io/docs/exchanges/polymarket):

> The Telonex collector maintains a local order book by subscribing to Polymarket's websocket 'market' channel and processing 'book' and 'price_change' events. All off-chain channels are event-driven rather than interval-sampled, ensuring that every change is captured. The 'book_snapshot_full' channel captures every tick.

Because UP and DOWN are two separate assets on Polymarket, each WebSocket event targets only one side. An event that updates the UP order book produces a snapshot row in the UP file; an event that updates the DOWN order book produces a row in the DOWN file. The two sides are never combined in a single event.

The key columns in each file are:

| Column              | Type  | Description                                                    |
| ------------------- | ----- | -------------------------------------------------------------- |
| `timestamp_us`      | INT64 | Exchange timestamp in microseconds since Unix epoch.           |
| `local_timestamp_us`| INT64 | Telonex collector receipt time in microseconds.                |
| `market_id`         | UTF8  | Polymarket market identifier (hex string).                     |
| `slug`              | UTF8  | Human-readable market slug (e.g. `btc-updown-15m-1766364300`). |
| `asset_id`          | UTF8  | Token ID for this side (UP or DOWN).                           |
| `bids`              | LIST  | All bid levels at snapshot time, each as `{ price, size }`.    |
| `asks`              | LIST  | All ask levels at snapshot time, each as `{ price, size }`.    |

::: tip
The side is encoded in the filename (`_Up_` or `_Down_`). The merge tool relies on this — do not rename the files.
:::

## Why the bot converts Telonex data before backtesting

The separate UP and DOWN files cannot be fed directly to the backtest engine without a conversion step. The reason is tick semantics.

In the raw Telonex files, UP events and DOWN events are interleaved by time but stored separately. Replaying them as-is would fire one strategy tick per side-event: an UP tick, then a DOWN tick, then an UP tick again. This produces **double the number of ticks** compared to the actual number of moments in the market, and more importantly, the strategy would never see both books synchronised — each tick only has fresh data for one side while the other side remains at its previous state.

Two conversion tools are available. They produce different output formats with different replay speed characteristics:

### Convert Telonex Dataset to Live Format (recommended)

```bash
npx tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts <input-directory>
```

This tool converts the raw Telonex snapshots into the same `book` / `price_change` format used by the live recorder. It computes delta updates between consecutive snapshots and emits full `book` rows only at the first tick and periodically as checkpoints. The output file can be replayed with the standard backtest engine — no special `--input-mode` flag is needed.

Replay speed is approximately the same as a live-recorded file because the vast majority of rows are lightweight delta events rather than full snapshots.

### Convert Telonex Dataset to Paired Format (legacy)

```bash
npx tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts <input-directory>
```

This tool pre-combines the UP and DOWN files into a single `orderbook_pair` file where each row holds a full snapshot of both sides. Backtesting this format requires `--input-mode telonex-paired-parquet`. Because every row is a full book replacement, replay is approximately **three times slower** than a live-recorded file.

::: tip
Use **Convert Telonex Dataset to Live Format** for new work. **Convert Telonex Dataset to Paired Format** is retained for compatibility.
:::

## Carry-forward pairing

Telonex snapshots do not always have perfectly matching timestamps for UP and DOWN — a `book` event can arrive for UP without a corresponding DOWN event at the exact same microsecond. When the merge step encounters a timestamp where only one side has a snapshot, it carries forward the most recent known snapshot from the missing side.

::: warning
A carry-forward frame means one side of the pair is slightly stale. In practice this is rare and the age difference is small (typically one snapshot interval), but strategies that are sensitive to fine-grained price movement should be aware of it.
:::

## Resources

- [Telonex](https://telonex.io) — platform website
- [Telonex Documentation](https://telonex.io/docs) — API reference, schemas, and exchange-specific guides

## Next steps

- [Convert Telonex Dataset to Live Format](/datasets/telonex/convert) — recommended path: produces `book`/`price_change` output for fast replay.
- [Convert Telonex Dataset to Paired Format](/datasets/telonex/merge) — legacy path: produces `orderbook_pair` output for use with `--input-mode telonex-paired-parquet`.
- [Run a Backtest with Telonex Data](/datasets/telonex/backtest) — backtest workflow for both formats.
- [Telonex Diagnostics](/datasets/telonex/diagnostics) — check conversion quality and compare Telonex coverage against a live recording.
