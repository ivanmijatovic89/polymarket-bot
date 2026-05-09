---
title: List Backtest Files
description: How to enumerate and filter the recorded Parquet files available for backtesting a given symbol.
---

# List Backtest Files

The `list:backtest-files` tool scans the `data/events/<symbol>/` directory, filters for `.parquet` files, sorts them chronologically by window epoch, and prints their relative paths to stdout on a single line. The output is formatted so it can be pasted directly into a `backtest` command or used in shell pipelines.

## Running the tool

```bash
npm run list:backtest-files -- --symbol <symbol>
```

::: code-group

```bash [BTC — all files]
npm run list:backtest-files -- --symbol btc
```

```bash [ETH — first 10 files]
npm run list:backtest-files -- --symbol eth --limit 10
```

```bash [custom root directory]
npm run list:backtest-files -- --symbol sol --root /mnt/recordings/events
```

:::

## CLI flags

| Flag       | Short | Argument                         | Description                                                                 |
| ---------- | ----- | -------------------------------- | --------------------------------------------------------------------------- |
| `--symbol` | `-s`  | `btc` \| `eth` \| `sol` \| `xrp` | Symbol whose directory to scan. **Required.**                               |
| `--root`   | —     | `<path>`                         | Root directory containing symbol subdirectories. Defaults to `data/events`. |
| `--limit`  | `-l`  | `N`                              | Return only the first `N` files after sorting. Must be a positive integer.  |
| `--help`   | `-h`  | —                                | Print usage and exit.                                                       |

The symbol can also be provided as the first positional argument without a flag:

```bash
npm run list:backtest-files -- btc
```

## Understanding the output

The tool writes a single space-separated line of relative paths to stdout:

```
data/events/btc/btc-updown-15m-1766520000.parquet data/events/btc/btc-updown-15m-1766520900.parquet data/events/btc/btc-updown-15m-1766521800.parquet
```

Files are sorted in ascending order by the epoch timestamp embedded in the filename (`<symbol>-updown-15m-<epochStart>.parquet`). Files whose names do not match the expected pattern are sorted lexicographically after those that do.

::: tip Piping directly into the backtest runner
Because the output is a single line of space-separated paths, you can pass it directly to the backtest command using a subshell:

```bash
npm run backtest -- --strategy myStrat $(npm run -s list:backtest-files -- --symbol btc --limit 50)
```

The `-s` / `--silent` npm flag suppresses npm's own log lines so only the file paths are captured by the subshell.
:::

## Filtering by slug or date range

The tool itself does not offer slug or date-range filtering beyond `--limit`. To narrow the selection further, pipe the output through standard shell tools:

```bash
# Keep only files whose slug contains a specific epoch prefix
npm run -s list:backtest-files -- --symbol btc | tr ' ' '\n' | grep '17665'

# Pass a subset of files to the backtest runner
files=$(npm run -s list:backtest-files -- --symbol btc | tr ' ' '\n' | grep '17665' | tr '\n' ' ')
npm run backtest -- --strategy myStrat $files
```

## Error conditions

| Error                                | Cause                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `failed to read "<dir>": ENOENT`     | The symbol directory does not exist. Verify the symbol name and that the recorder has written at least one file.                   |
| `no .parquet files found in "<dir>"` | The directory exists but contains no `.parquet` files. Files still being written have a `.parquet.tmp` extension and are excluded. |
| Invalid `--limit` value              | Non-integer, zero, or negative values cause the tool to print usage and exit with code `2`.                                        |

::: warning Temporary files are excluded
Files currently being written by the recorder carry a `.parquet.tmp` extension and are not listed. Wait for the 15-minute window to rotate (or for a graceful shutdown) before listing files if you want to include the most recent window.
:::
