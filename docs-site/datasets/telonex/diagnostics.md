---
title: Telonex Diagnostics
description: Reference for the two CLI tools that check Telonex merge quality and compare Telonex coverage against a live recording.
---

# Telonex Diagnostics

Two diagnostic tools are available for inspecting Telonex data quality before or after a merge. Use them when you want to understand how well the UP and DOWN files align, or when you want to measure how many events Telonex captured relative to your own live recording.

## check-telonex-merge-by-timestamp

This tool analyses the raw Telonex UP and DOWN files in a directory and reports whether they can be merged cleanly by timestamp. Run it before merging to catch alignment problems early.

### Usage

```bash
npx tsx src/parquet/cli/telonex/check-telonex-merge-by-timestamp.ts <directory>
```

Example:

```bash
npx tsx src/parquet/cli/telonex/check-telonex-merge-by-timestamp.ts \
  data/telonex/btc-updown-15m-1766364300
```

### Output

The tool prints per-file load lines, then a summary block:

```
[check-telonex-merge] directory=data/telonex/btc-updown-15m-1766364300
[check-telonex-merge] up_files=2 down_files=2
[check-telonex-merge] loaded side=up file=book_snapshot_full_Up_2025-12-21.parquet rows=4821
[check-telonex-merge] loaded side=down file=book_snapshot_full_Down_2025-12-21.parquet rows=4821
...

[check-telonex-merge] summary
total_timestamps=6924
both_sides_timestamps=6912
up_only_timestamps=6
down_only_timestamps=6
mismatched_row_counts_at_same_timestamp=0
mismatched_distinct_asset_counts_at_same_timestamp=0
total_up_rows=13848
total_down_rows=13848
timestamp_merge_safe_loose=false
timestamp_merge_safe_strict=false
```

### Output fields

| Field | Meaning |
| ----- | ------- |
| `total_timestamps` | Distinct exchange timestamps across all files. |
| `both_sides_timestamps` | Timestamps where both UP and DOWN have at least one row. |
| `up_only_timestamps` | Timestamps where only the UP file has a row. Carry-forward will be used. |
| `down_only_timestamps` | Timestamps where only the DOWN file has a row. Carry-forward will be used. |
| `mismatched_row_counts_at_same_timestamp` | Timestamps where UP and DOWN have different numbers of rows. |
| `mismatched_distinct_asset_counts_at_same_timestamp` | Timestamps where UP and DOWN reference different numbers of distinct asset IDs. |
| `timestamp_merge_safe_loose` | `true` if there are no one-sided timestamps (carry-forward will never be needed). |
| `timestamp_merge_safe_strict` | `true` if loose is true AND row counts and asset counts always match. |

### Interpreting the results

A value of `timestamp_merge_safe_loose=true` means every timestamp has data from both sides and the merge will never need to carry forward a stale snapshot. This is the best case.

If `up_only_timestamps` or `down_only_timestamps` is greater than zero, the merge tool will apply carry-forward for those frames. The count tells you how many rows in the output file will have one stale side. A small number (relative to `total_timestamps`) is usually acceptable.

---

## check-telonex-omitted-events

This tool compares a live-recorded Parquet file against a set of Telonex files for the same market window. It identifies which events in the live recording are absent from the Telonex data.

Use this tool when you want to understand the coverage gap between what the bot recorded in real time and what Telonex captured.

### Usage

```bash
npx tsx src/parquet/cli/telonex/check-telonex-omitted-events.ts \
  <original.parquet> \
  <telonex-directory> \
  [--examples N]
```

| Argument | Description |
| -------- | ----------- |
| `<original.parquet>` | Path to the live-recorded Parquet file for the market window. |
| `<telonex-directory>` | Directory containing the `book_snapshot_full_*.parquet` Telonex files for the same window. |
| `--examples N` | Print up to N examples of omitted events. Default is 20. Pass `--examples 0` to suppress examples. |

Example:

```bash
npx tsx src/parquet/cli/telonex/check-telonex-omitted-events.ts \
  data/events/btc/btc-updown-15m-1766364300.parquet \
  data/telonex/btc-updown-15m-1766364300 \
  --examples 5
```

### How it works

The tool builds a key for each event from its exchange timestamp, asset ID, best bid, and best ask. It counts how many times each key appears in the live recording and how many times the same key appears in the Telonex files within the same time window. An event is considered omitted if its occurrence count in the live recording exceeds its count in Telonex.

### Output

```
[check-telonex-omitted] original=data/events/btc/btc-updown-15m-1766364300.parquet
[check-telonex-omitted] telonex_dir=data/telonex/btc-updown-15m-1766364300
[check-telonex-omitted] telonex_files=4
[check-telonex-omitted] original_parsed_events=18432
[check-telonex-omitted] telonex_parsed_events_in_window=13848

[check-telonex-omitted] summary
omitted_total=312
omitted_book=298
omitted_price_change=14
omitted_same_top_as_prev_same_asset=241
omitted_same_hash_as_prev_same_asset=198
omitted_same_top_and_same_hash=187
```

### Summary fields

| Field | Meaning |
| ----- | ------- |
| `omitted_total` | Total events in the live recording not found in Telonex. |
| `omitted_book` | Omitted events of type `book`. |
| `omitted_price_change` | Omitted events of type `price_change`. |
| `omitted_same_top_as_prev_same_asset` | Omitted events where the best bid and ask are identical to the previous event for the same asset. These are likely redundant snapshots — the orderbook top did not change. |
| `omitted_same_hash_as_prev_same_asset` | Omitted events where the state hash matches the previous event for the same asset. The full book was unchanged. |
| `omitted_same_top_and_same_hash` | Events where both top-of-book and state hash are unchanged — the clearest case of a redundant event. |

### Interpreting the results

Telonex captures snapshots at intervals rather than on every individual WebSocket event. It is normal for it to omit events where the orderbook did not meaningfully change between two snapshots. A high ratio of `omitted_same_top_as_prev_same_asset` to `omitted_total` indicates that most omissions are no-change events — not meaningful data loss.

If a large number of omitted events have a different best bid or ask from their predecessor, those omissions represent real price movements that Telonex did not capture. This affects backtest fidelity: strategies that react to fine-grained price movement will behave differently when replayed from Telonex data versus the live recording.
