---
title: Seed the Database from Local Parquet Files
description: How to populate the markets database from parquet recording files on disk, including cleaning up stale records.
---

# Seed the Database from Local Parquet Files

This guide explains how to sync the markets database with the parquet files currently on disk. Run this tool after recording new market data, after moving or deleting parquet files, or when setting up a fresh database.

## Why the database needs to know about parquet files

The bot stores market metadata — slug, symbol, resolution, timestamps — in the database. This metadata is used when selecting files for backtests, filtering by symbol, and tracking which markets have been recorded. The parquet files themselves contain the raw event stream, but the database is the index.

When the two fall out of sync — files on disk that are not in the database, or database records pointing to files that no longer exist — backtest queries return incomplete or incorrect results.

## When to run this

- After recording new parquet files with `npm run record:live:*`
- After manually moving or deleting parquet files from `data/events/`
- After setting up a fresh database (first run)
- Periodically to keep the index consistent with what is on disk

## Run the tool

```bash
npm run db:insert-parquet
```

No flags required. The tool reads `data/events/` automatically and processes all symbols it finds there.

## Cleanup phase: removing stale records

Before inserting anything, the tool checks every record currently in the database against the disk. For each market in the database, it looks for the corresponding file at:

```
data/events/<symbol>/<slug>.parquet
```

If the file is missing, the record is considered stale. Stale records accumulate when parquet files are deleted or moved — the database still holds metadata for markets that can no longer be replayed.

If any stale records are found, the tool lists them and prompts:

```
Files in database but not on HDD:
  - data/events/btc/btc-updown-15m-1714000000.parquet
  - data/events/btc/btc-updown-15m-1714900000.parquet

Do you want to delete these records from the database? (Y/n):
```

| Answer       | Effect                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| `Y` or Enter | Deletes all listed records from the database.                             |
| `n`          | Skips deletion and continues to the seed phase with stale records intact. |

::: tip
Answer `Y` in most cases. Stale records do not cause errors, but they appear in backtest file listings and can be confusing — they point to files that no longer exist.
:::

::: warning
If you intentionally moved your parquet files to a different location and plan to move them back, answer `n` to preserve the database records.
:::

## Seed phase: inserting new files

After cleanup, the tool scans every symbol directory under `data/events/` and processes each `.parquet` file it finds.

For each file:

1. **Slug extraction** — the slug is the filename without the `.parquet` extension (e.g. `btc-updown-15m-1714000000`).
2. **Duplicate check** — if a record with that slug already exists in the database, the file is skipped silently.
3. **Gamma API fetch** — for new slugs, the tool calls the Gamma API to retrieve market metadata: question, resolution date, category, and other fields required by the markets table schema.
4. **Insert** — the mapped record is written to the database.

A 50ms delay is applied between Gamma API calls to stay within the rate limit of 300 requests per 10 seconds.

::: warning
The Gamma API must be reachable during this phase. If a fetch fails for a slug, that file is counted as an error and skipped — it will not be retried automatically. Re-run the tool to retry failed slugs.
:::

## Reading the summary

When all files have been processed, the tool prints a summary:

```
[insert-local-parquet] Summary:
  Inserted: 42
  Skipped:  310
  Errors:   2
```

| Field      | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `Inserted` | New records successfully added to the database.                             |
| `Skipped`  | Files already present in the database — no action taken.                    |
| `Errors`   | Files that could not be processed (Gamma API failure or DB insert failure). |

If `Errors` is greater than zero, re-run the tool. Existing records are skipped automatically, so only the failed slugs will be retried.
