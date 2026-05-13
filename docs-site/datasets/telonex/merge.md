---
title: Merge Telonex Files to Backtest Parquet
description: How to convert raw Telonex UP/DOWN snapshot files into a single paired Parquet file ready for backtesting.
---

# Merge Telonex Files to Backtest Parquet

This guide explains how to combine the separate Telonex UP and DOWN snapshot files for a market into a single paired Parquet file. The merge step is a one-time preparation — once the paired file exists, it can be replayed by the backtest engine as many times as needed.

## Prerequisites

- One or more `book_snapshot_full_Up_*.parquet` files for the market.
- One or more `book_snapshot_full_Down_*.parquet` files for the same market.
- All files for a single market placed in the same directory.

::: tip
If you have multiple days of Telonex data for one market, place all UP and DOWN files for that market in the same directory. The merge tool reads all matching files in a single pass.
:::

## Input directory layout

The merge tool scans a directory for files whose names begin with `book_snapshot_full_` and end with `.parquet`. It determines the side (`up` or `down`) from the `_Up_` or `_Down_` portion of the filename.

A typical input directory looks like this:

```
data/telonex/btc-updown-15m-1766364300/
├── book_snapshot_full_Down_2025-12-21.parquet
├── book_snapshot_full_Down_2025-12-22.parquet
├── book_snapshot_full_Up_2025-12-21.parquet
└── book_snapshot_full_Up_2025-12-22.parquet
```

::: warning
Do not rename the Telonex files. The tool relies on `_Up_` and `_Down_` being present in the filename to assign each file to the correct side. Files that do not match this convention are silently ignored.
:::

## Running the merge

```bash
npx tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts <input-directory>
```

By default the output file is written into the input directory, named after the directory itself:

```bash
npx tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts \
  data/telonex/btc-updown-15m-1766364300
```

This produces:

```
data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300-merged-backtest.parquet
```

### Specifying a custom output path

Use `--out` to write the result to a different location:

```bash
npx tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts \
  data/telonex/btc-updown-15m-1766364300 \
  --out data/backtest-ready/btc-1766364300.parquet
```

## Understanding the output

The merge tool prints a progress line for each input file as it is loaded, then a final summary:

```
[merge-telonex] file=book_snapshot_full_Up_2025-12-21.parquet side=up loaded=4821 dropped=0
[merge-telonex] file=book_snapshot_full_Down_2025-12-21.parquet side=down loaded=4821 dropped=0
[merge-telonex] file=book_snapshot_full_Up_2025-12-22.parquet side=up loaded=2103 dropped=0
[merge-telonex] file=book_snapshot_full_Down_2025-12-22.parquet side=down loaded=2103 dropped=0

[merge-telonex] input_dir=data/telonex/btc-updown-15m-1766364300
[merge-telonex] files=4 parsed_ticks=13848 paired_frames=6912
[merge-telonex] output=data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300-merged-backtest.parquet rows_written=6912
```

| Field           | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `loaded`        | Rows successfully parsed from the file.                                            |
| `dropped`       | Rows skipped due to missing required fields (market ID, asset ID, or timestamp).   |
| `parsed_ticks`  | Total rows loaded across all files.                                                |
| `paired_frames` | Number of rows in the output file. Each frame pairs one UP snapshot with one DOWN. |
| `rows_written`  | Confirms how many rows were written to the output Parquet file.                    |

### Why `paired_frames` is roughly half of `parsed_ticks`

Each paired frame consumes one UP tick and one DOWN tick. When the UP and DOWN files have equal row counts and perfectly matching timestamps, `paired_frames` will be exactly half of `parsed_ticks`. Small deviations occur when a timestamp has one side missing and a carry-forward is applied.

## How pairing works

After loading all ticks, the tool groups them by exchange timestamp (`timestamp_us`). For each timestamp group:

1. UP ticks and DOWN ticks in the group are matched positionally (first UP with first DOWN, second UP with second DOWN, and so on).
2. If one side has more ticks than the other at a given timestamp, the extra ticks are paired with the most recent known snapshot from the missing side (carry-forward).
3. If a side has no prior snapshot yet (e.g. at the very start of a recording), the frame is skipped entirely rather than emitting an incomplete pair.

## Output schema

The paired Parquet file uses the `pairedOrderbookParquetSchema`. Each row represents one complete paired snapshot:

| Column          | Type  | Description                                                              |
| --------------- | ----- | ------------------------------------------------------------------------ |
| `ingest_seq`    | INT64 | Monotonically increasing row number, starting at 1.                      |
| `ts_local_ms`   | INT64 | Latest local ingestion timestamp of the two sides, in milliseconds.      |
| `ts_exchange_ms`| INT64 | Exchange timestamp of the frame, in milliseconds.                        |
| `event_type`    | UTF8  | Always `orderbook_pair`.                                                 |
| `market`        | UTF8  | Polymarket market identifier.                                            |
| `slug`          | UTF8  | Market slug, if present in the source data.                              |
| `up_asset_id`   | UTF8  | Token ID for the UP side.                                                |
| `down_asset_id` | UTF8  | Token ID for the DOWN side.                                              |
| `up_bids`       | UTF8  | UP bid levels encoded as `price@size;price@size;...`, sorted descending. |
| `up_asks`       | UTF8  | UP ask levels encoded as `price@size;price@size;...`, sorted ascending.  |
| `down_bids`     | UTF8  | DOWN bid levels encoded as `price@size;price@size;...`, sorted descending.|
| `down_asks`     | UTF8  | DOWN ask levels encoded as `price@size;price@size;...`, sorted ascending. |

Orderbook levels are pre-sorted during the merge (bids descending by price, asks ascending) so the replay engine does not need to sort them at read time.

## Next steps

Once the paired file is ready, pass it to the backtest CLI with `--input-mode telonex-paired-parquet`:

```bash
npx tsx src/cli/backtest.ts \
  --strategy mySplitStrategy \
  --input-mode telonex-paired-parquet \
  data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300-merged-backtest.parquet
```

See [Run a Backtest with Telonex Data](/datasets/telonex/backtest) for the full backtest workflow.
