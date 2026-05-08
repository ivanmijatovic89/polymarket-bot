---
title: Scan and Clean Parquet Disconnect Events
description: How to inspect parquet recording files for WebSocket disconnect events and remove files that would degrade backtest quality.
---

# Scan and Clean Parquet Disconnect Events

This guide explains how to use the `scan-disconnect-events` CLI to inspect your parquet recording files for WebSocket disconnect events, interpret the output, and selectively delete files that would produce unreliable backtest results.

## Why disconnects matter

When the bot records live market data, it writes every incoming WebSocket message to a parquet file. If the connection drops, a synthetic `disconnect` row is written — marking the moment the bot lost visibility into the order book.

During backtest replay, those gaps become blind spots: the engine replays the recorded sequence as-is, which means the strategy operates on a stale order book for however long the connection was down. Two metrics determine how much this affects a file:

- **`gap_ms`** — the time between a `disconnect` row and the next incoming event. A 200 ms gap is usually harmless; a 30-second gap can corrupt position sizing and fill simulation.
- **`last_event_disconnect`** — if the recording ended while disconnected, the final state of the order book is unknown. These files are often safe to discard entirely.

## Scan a directory

Run the tool against any directory containing `.parquet` files. By default it recurses into subdirectories.

```bash
npm run scan:disconnect-events -- data/events
```

For each file that contains at least one disconnect, the tool prints a per-file line:

```
14/87 btc/btc-updown-15m-1714000000.parquet
  -> disconnects=3 last_event_disconnect=false gaps=3 gap_ms_avg=412.33 gap_ms_min=180 gap_ms_max=890 (rows_scanned=14502)
```

| Field                       | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `disconnects`               | Total number of `disconnect` rows in the file                               |
| `last_event_disconnect`     | Whether the final row in the file is a disconnect                           |
| `gaps`                      | Number of disconnects that were followed by a reconnect (gap is measurable) |
| `gap_ms_avg`                | Average reconnection time in milliseconds                                   |
| `gap_ms_min` / `gap_ms_max` | Fastest and slowest reconnection in milliseconds                            |
| `rows_scanned`              | Total rows read (affected by `--limit-rows` if set)                         |

Files with zero disconnects are scanned silently and do not appear in the per-file output.

## Read the summary output

After all files are processed, the tool prints two blocks.

**Summary line:**

```
[scan-disconnect-events] done: files=87 files_with_disconnect=12 files_with_last_event_disconnect=3
  total_disconnects=31 total_disconnects_without_next_event=3
  gaps=28 gap_ms_avg=380.12 gap_ms_min=90 gap_ms_max=4210 files_errored=0
```

`total_disconnects_without_next_event` counts disconnects that were the last row in their file — where gap duration is unknown because no reconnect was recorded.

**Distribution table:**

```
[scan-disconnect-events] disconnects_per_file:
  level count count_ge
  ----- ----- --------
      0    75       87
      1     8       12
      2     3        4
      3     1        1
```

| Column     | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| `level`    | Number of disconnects in a file                        |
| `count`    | How many files have exactly this many disconnects      |
| `count_ge` | How many files have **at least** this many disconnects |

Use `count_ge` to decide a deletion threshold. In the example above, setting `--delete-files-where-disconnects-equal-or-greater=2` would affect 4 files.

## Speed up scanning with `--limit-rows`

For large directories, reading every row of every file can be slow. Use `--limit-rows N` to stop reading each file after `N` rows.

```bash
npm run scan:disconnect-events -- data/events --limit-rows 500
```

::: warning
`--limit-rows` only reads the first N rows of each file. Disconnects that occur later in a recording will not be counted. Use this flag for a quick overview, not for making deletion decisions.
:::

## Scan a single folder without recursion

By default the tool walks all subdirectories. Pass `--no-recursive` to limit scanning to one folder only — useful when you want to inspect a single symbol.

```bash
npm run scan:disconnect-events -- data/events/btc --no-recursive
```

## Delete files with too many disconnects

Use `--delete-files-where-disconnects-equal-or-greater=N` to remove files whose disconnect count meets or exceeds a threshold.

```bash
npm run scan:disconnect-events -- data/events/btc --delete-files-where-disconnects-equal-or-greater=2
```

The tool will not delete anything immediately. It walks the directory, collects candidates, and then starts an interactive confirmation flow:

**Step 1 — Review the list**

```
You requested to delete files where disconnects equal or greater 2,
there is 4 files to be deleted. Before we delete files please double check files:
Choose: show files | cancel
```

Type `show files` to print the full list of files that would be deleted.

**Step 2 — Confirm**

```
Please confirm you wanna delete 4 files where disconnects equal or greater 2.
Type 'delete' to confirm:
```

Type `delete` to proceed. Anything else cancels the operation.

::: danger
Deletion is permanent. There is no undo. Verify the file list in Step 1 before confirming.
:::

::: tip
Run a scan without any delete flag first to review the distribution table and choose a sensible threshold before committing to deletion.
:::

## Delete files that ended on a disconnect

Use `--delete-files-with-last-event-disconnect` to remove files where the recording ended mid-disconnect — meaning the final order book state is unknown.

```bash
npm run scan:disconnect-events -- data/events/btc --delete-files-with-last-event-disconnect
```

The confirmation flow is identical to the threshold-based deletion above.

You can combine both flags in a single run to delete files matching either condition:

```bash
npm run scan:disconnect-events -- data/events/btc \
  --delete-files-where-disconnects-equal-or-greater=3 \
  --delete-files-with-last-event-disconnect
```

## Flag reference

| Flag                                                  | Type                 | Default        | Description                                            |
| ----------------------------------------------------- | -------------------- | -------------- | ------------------------------------------------------ |
| `<dir>`                                               | positional, required | —              | Directory to scan                                      |
| `--recursive` / `--no-recursive`                      | boolean              | `--recursive`  | Whether to walk subdirectories                         |
| `--limit-rows N`                                      | integer              | `0` (no limit) | Stop reading each file after N rows                    |
| `--delete-files-where-disconnects-equal-or-greater=N` | integer              | —              | Mark files with ≥ N disconnects for deletion           |
| `--delete-files-with-last-event-disconnect`           | flag                 | —              | Mark files whose last row is a disconnect for deletion |
