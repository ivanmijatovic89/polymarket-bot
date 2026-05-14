---
title: Convert Telonex Dataset to Live Format
description: How to convert raw Telonex UP/DOWN snapshot files into a live-format Parquet file (book + price_change events) for fast replay with the standard backtest engine.
---

# Convert Telonex Dataset to Live Format

This converter transforms raw Telonex snapshot files into the same Parquet format produced by the live recorder — a stream of `book` and `price_change` events. The output file can be replayed by the backtest engine directly, with no special `--input-mode` flag required.

This is the recommended path when replay speed matters. Because the output uses delta events instead of full snapshots, it replays at approximately the same speed as a live-recorded file.

## Prerequisites

- One or more `book_snapshot_full_Up_*.parquet` files for the market.
- One or more `book_snapshot_full_Down_*.parquet` files for the same market.
- All files for a single market placed in the same directory.

## Running the converter

```bash
npx tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts <input-directory>
```

By default, the output file is written into the input directory and named after the market slug found in the source data:

```bash
npx tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts \
  data/telonex/btc-updown-15m-1766364300
```

This produces:

```
data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300.parquet
```

### Custom output path

Use `--out` to write the result to a different location:

```bash
npx tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts \
  data/telonex/btc-updown-15m-1766364300 \
  --out data/backtest-ready/btc-1766364300.parquet
```

### Book interval

The converter emits a full `book` snapshot for each asset on the first tick and then at regular intervals, with `price_change` delta rows in between. The default interval is 500 ticks; use `--book-interval` to change it:

```bash
npx tsx src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts \
  data/telonex/btc-updown-15m-1766364300 \
  --book-interval 250
```

Smaller values produce more `book` rows (less sensitive to a corrupted state mid-replay but slightly larger output file). Larger values produce fewer `book` rows (slightly smaller output, longer recovery window if something goes wrong).

## Understanding the output

The converter prints a per-file load line for each input file, then a summary:

```
[convert-telonex] file=book_snapshot_full_Up_2025-12-21.parquet side=up loaded=46770 dropped=0
[convert-telonex] file=book_snapshot_full_Down_2025-12-21.parquet side=down loaded=46770 dropped=0

[convert-telonex] input_dir=data/telonex/btc-updown-15m-1766364300
[convert-telonex] files=2 parsed_ticks=93540 book_interval=500
[convert-telonex] empty_delta_ticks=8548
[convert-telonex] rows_written=89453 book=376 price_change=89077
[convert-telonex] output=data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300.parquet
```

| Field                | Meaning                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `loaded`             | Rows successfully parsed from a file.                                                                                      |
| `dropped`            | Rows skipped due to missing required fields (market ID, asset ID, or timestamp).                                           |
| `parsed_ticks`       | Total rows loaded across all input files.                                                                                  |
| `empty_delta_ticks`  | Ticks where the book did not change relative to the previous snapshot — no delta was emitted for these.                    |
| `rows_written`       | Total rows in the output file.                                                                                             |
| `book`               | Number of full `book` rows written (one per asset at the first tick and every `book_interval` ticks thereafter).           |
| `price_change`       | Number of delta `price_change` rows written.                                                                               |

### Why `empty_delta_ticks` is non-zero

Telonex writes a full snapshot on every WebSocket event, including events where Polymarket sent the same book state twice (e.g. a server-side retransmission). When the converter computes a delta for such a tick and finds no changed levels, it skips the row entirely rather than emitting an empty delta. This is the correct behaviour — the equivalent live-recorded event would also produce no orderbook change.

## Output format

The output file uses `rawMarketEventParquetSchema` — the same schema as a live-recorded file:

| Column           | Type  | Description                                                         |
| ---------------- | ----- | ------------------------------------------------------------------- |
| `ingest_seq`     | INT64 | Monotonically increasing row number, starting at 1.                 |
| `ts_local_ms`    | INT64 | Telonex local ingestion timestamp, in milliseconds.                 |
| `ts_exchange_ms` | INT64 | Exchange timestamp, in milliseconds.                                |
| `event_type`     | UTF8  | `book` or `price_change`.                                           |
| `raw_json`       | UTF8  | JSON payload matching the live WebSocket event format.              |

### `book` row payload

```json
{
  "event_type": "book",
  "asset_id": "<token-id>",
  "market": "<market-id>",
  "timestamp": "<exchange-ts-ms>",
  "hash": "",
  "bids": [{ "price": "0.55", "size": "100" }, ...],
  "asks": [{ "price": "0.56", "size": "200" }, ...]
}
```

### `price_change` row payload

```json
{
  "event_type": "price_change",
  "market": "<market-id>",
  "timestamp": "<exchange-ts-ms>",
  "price_changes": [
    { "asset_id": "<token-id>", "price": "0.55", "size": "120", "side": "BUY", "hash": "", "best_bid": "", "best_ask": "" },
    { "asset_id": "<token-id>", "price": "0.97", "size": "0",   "side": "SELL", "hash": "", "best_bid": "", "best_ask": "" }
  ]
}
```

A `size` of `"0"` means the level was removed from the book.

## How conversion works

After loading all ticks from all input files, the converter:

1. **Sorts** all ticks by exchange timestamp.
2. **Groups** ticks that share the same timestamp, then splits them into UP and DOWN.
3. **Pairs** UP[k] with DOWN[k] positionally within each timestamp group.
4. For each pair, processes each tick independently:
   - If no state exists yet for the asset, or if `book_interval` ticks have elapsed since the last `book` row, a full `book` row is emitted and the state is reset.
   - Otherwise, the converter computes a delta against the stored state. Any changed or removed levels are collected.
5. If the combined delta from both sides in the pair is non-empty, a single `price_change` row is emitted containing changes from both assets.
6. Empty deltas (no changed levels) are silently skipped.

The state tracker uses numeric price keys (`Map<number, LevelEntry>`) rather than raw strings. This avoids spurious changes when Telonex writes `"1.0"` in one snapshot and `"1"` in the next for the same price level.

## Running a backtest with the converted file

The output file is compatible with the default backtest mode — no `--input-mode` flag is needed:

```bash
npx tsx src/cli/backtest.ts \
  --strategy <strategy-id> \
  data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300.parquet
```

Or with `npm run backtest`:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300.parquet
```

## Comparison with the paired format

The [Convert Telonex Dataset to Paired Format](/datasets/telonex/merge) tool produces a different output format (`orderbook_pair` rows) that requires `--input-mode telonex-paired-parquet`. That format applies full book replacements on every row, making it approximately three times slower to replay than either live-recorded files or the live-format output produced by this tool.

| | Live Recording | Convert Telonex Dataset to Live Format (this page) | Convert Telonex Dataset to Paired Format |
| --- | --- | --- | --- |
| Output format | `book` + `price_change` | `book` + `price_change` | `orderbook_pair` |
| Replay speed | Baseline | Same as live-recorded | ~3× slower |
| `--input-mode` required | No | No | Yes (`telonex-paired-parquet`) |
| Use when | — | Telonex data, speed matters | Legacy compatibility |
