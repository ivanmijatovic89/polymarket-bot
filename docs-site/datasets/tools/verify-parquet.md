---
title: Verify Parquet File
description: How to inspect and validate any Parquet file — live-recorded, Telonex paired, or PMXT — to confirm it is readable before backtesting.
---

# Verify Parquet File

The `verify:parquet` tool opens a Parquet file, reads its schema and compression metadata, and iterates every row from start to finish. A successful run confirms that the file's footer, row-group pages, and column encodings are all intact — making it safe to use in backtesting.

This tool works on any Parquet file regardless of source: live-recorded files, Telonex paired files, or PMXT files.

Use it whenever you receive an unexpected backtest error, suspect disk corruption, or want to inspect the contents of a file before committing it to a backtest run.

## Running the tool

```bash
npm run verify:parquet -- <file.parquet>
```

::: code-group

```bash [basic]
npm run verify:parquet -- data/events/btc/btc-updown-15m-1766523600.parquet
```

```bash [with row limit]
npm run verify:parquet -- data/events/btc/btc-updown-15m-1766523600.parquet --limit 1000
```

```bash [print first 5 rows]
npm run verify:parquet -- data/events/btc/btc-updown-15m-1766523600.parquet --print 5
```

```bash [metadata only]
npm run verify:parquet -- data/events/btc/btc-updown-15m-1766523600.parquet --metadata-only
```

:::

## CLI flags

| Flag                              | Argument         | Description                                                                                        |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| _(positional)_                    | `<file.parquet>` | Path to the Parquet file to inspect. Required.                                                     |
| `--limit`                         | `N`              | Stop after reading `N` rows. Useful for quick sanity-checks on large files. Omit to read all rows. |
| `--print`                         | `N`              | Print the first `N` rows to stdout in a structured format. Omit to suppress row output.            |
| `--metadata-only` / `--meta-only` | —                | Read and print the schema and compression metadata, then exit without iterating rows.              |

## Understanding the output

A typical successful run for a live-recorded file:

```
[verify-parquet] file=data/events/btc/btc-updown-15m-1766523600.parquet
[verify-parquet] size_bytes=4821903
[verify-parquet] schema= ParquetSchema { ... }
[verify-parquet] codecs_by_column= {
  ingest_seq: [ 'GZIP' ],
  ts_local_ms: [ 'GZIP' ],
  ts_exchange_ms: [ 'GZIP' ],
  event_type: [ 'GZIP' ],
  raw_json: [ 'GZIP' ]
}
[verify-parquet] rows_read=18432
[verify-parquet] ok
```

For a Telonex paired file the schema will show columns `market`, `up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks` instead of `raw_json`.

| Output line        | What it tells you                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `size_bytes`       | Raw file size. Files well below 1 KB are likely empty or corrupt.                                 |
| `schema`           | Column names and types. Use this to confirm the file matches the expected format.                 |
| `codecs_by_column` | Compression codec per column. All standard files use `GZIP` for all columns.                     |
| `rows_read`        | Total number of rows successfully deserialised.                                                   |
| `ok`               | Final confirmation that the file is fully readable.                                               |

### Printed row output

When `--print N` is supplied, the first N rows are printed in a structured format:

```
[verify-parquet] row= {
  n: 1,
  ingest_seq: 1n,
  ts_local_ms: 1766523601234n,
  ts_exchange_ms: 1766523601200n,
  event_type: 'book',
  json_market: '0xabc...',
  json_asset_id: '0xdef...',
  json_timestamp: '1766523601200'
}
```

`ts_local_ms` and `ts_exchange_ms` are BigInt values (printed with an `n` suffix). `json_market`, `json_asset_id`, and `json_timestamp` are extracted from the `raw_json` column for convenience.

## Detecting problems

| Symptom                                            | Likely cause                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool exits with an error before printing `ok`      | File footer is missing or corrupt. The file was likely left as `*.parquet.tmp` and never properly closed. Delete it and re-record.                                              |
| `size_bytes` is very small (under a few kilobytes) | File was opened but no rows were written before the recorder was killed. Treat it as empty.                                                                                     |
| `codecs_by_column` shows `UNCOMPRESSED`            | File was written by a different tool or an older schema version. It is still readable but will not compress as efficiently.                                                     |
| `rows_read` is far lower than expected             | The file may be truncated. Cross-reference with `--print` output to check the final `event_type` — a `disconnect` row at the end is normal; an abrupt stop mid-sequence is not. |

::: tip Checking terminated files
Files named `*-terminated.parquet` were closed by a `SIGINT`/`SIGTERM` shutdown rather than a normal 15-minute rotation. They are valid Parquet files and can be verified and used in backtesting, but they represent a partial window of data.
:::

## When to skip metadata-only mode

`--metadata-only` exits after printing schema and codec information without reading any row data. Use it when you only need to confirm the file structure is parseable or to quickly check compression settings. It does **not** validate that row-group pages are uncorrupted — only a full read (or `--limit` read) can confirm the row data is intact.
