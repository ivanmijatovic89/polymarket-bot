---
title: Sync Markets
description: How to populate the telonex_markets table by filtering the Telonex catalogue with DuckDB and inserting matching rows.
---

# Sync Markets

The `telonex:sync` CLI is the first stage of the pipeline. It downloads the Telonex markets catalogue (a single Parquet file, ~660 MB), filters it with DuckDB to the rows you want, and inserts those rows into the `telonex_markets` MySQL table. Subsequent stages of the pipeline read from `telonex_markets` — nothing else.

## Prerequisites

- `TELONEX_API_KEY` set in `.env`.
- MySQL is up and migrations are applied (`npm run db:migrate`).

## Basic usage

```bash
npm run telonex:sync
```

With no flags, the script:

1. Downloads the catalogue to a temporary file in the OS temp directory.
2. Runs a DuckDB query with the default filter `slug LIKE 'btc-updown-15m-%' AND book_snapshot_full_from <> ''`.
3. `INSERT IGNORE`s the matching rows into `telonex_markets`.
4. Deletes the temporary catalogue file on exit.

Expected output:

```
[telonex:sync] slug-pattern=btc-updown-15m-% limit=none dry-run=false
[telonex:sync] downloading catalog from https://api.telonex.io/v1/datasets/polymarket/markets
[telonex:sync] catalog downloaded 661.9 MB in 21.3s
[telonex:sync] querying catalog via DuckDB...
[telonex:sync] matched 19223 markets (query=1.7s)
[telonex:sync] inserted batch 500/19223 (new=500)
...
[telonex:sync] breakdown by symbol/timeframe:
[telonex:sync]   group     matched  inserted  skipped
[telonex:sync]   btc-15m     19223     19223        0
[telonex:sync]   TOTAL       19223     19223        0
[telonex:sync] done attempted=19223 inserted=19223 skipped=0
[telonex:sync] timing: download=21.3s query=1.7s insert=3.1s total=26.1s
```

When multiple patterns are passed, the breakdown lists one row per `<symbol>-<timeframe>` group so you can see, for each (e.g. `btc-15m`, `btc-5m`, `eth-15m`, …), how many markets matched, how many were newly inserted, and how many were skipped as duplicates. `--dry-run` prints the same grouping with just the `matched` column.

## Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--slug-pattern <like>` | `btc-updown-15m-%` | SQL LIKE pattern(s) for `slug`. Accepts a **comma-separated list** — the patterns are OR'd into one DuckDB query so the catalogue is downloaded only once. The data-availability filter `book_snapshot_full_from <> ''` is always applied. |
| `--limit <N>` | unlimited | Cap the number of rows returned by the DuckDB query. Useful for smoke tests. |
| `--dry-run` | off | Run the download and query, log a sample row, but skip the database writes. |

## Selecting which markets to sync

The default pattern targets BTC 15-minute up/down markets. Change it for other symbols or timeframes:

::: code-group

```bash [BTC 15m (default)]
npm run telonex:sync
```

```bash [BTC 5m]
npm run telonex:sync -- --slug-pattern 'btc-updown-5m-%'
```

```bash [ETH 15m]
npm run telonex:sync -- --slug-pattern 'eth-updown-15m-%'
```

```bash [All up/down for BTC]
npm run telonex:sync -- --slug-pattern 'btc-updown-%'
```

:::

::: tip
The catalogue contains ~20,800 BTC 15m markets at the time of writing. ~1,600 of them have empty `book_snapshot_full_from` (no historical data available) and are skipped by the always-applied filter.
:::

### Syncing many symbols and timeframes at once

`--slug-pattern` accepts a comma-separated list of patterns. They are OR'd into a single DuckDB query, so the ~660 MB catalogue is downloaded **once** regardless of how many patterns you pass — far cheaper than invoking the script per symbol/timeframe.

```bash
npm run telonex:sync -- --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%,sol-updown-15m-%,xrp-updown-15m-%,btc-updown-5m-%,eth-updown-5m-%,sol-updown-5m-%,xrp-updown-5m-%'
```

The same eight-pattern sweep (BTC/ETH/SOL/XRP × 15m/5m) is wired up as a shortcut:

```bash
npm run telonex:sync:crypto:5m-15min
```

::: warning
With multiple patterns, `--limit` caps the **combined** result set after `ORDER BY slug`, not per pattern. It is intended for smoke tests; leave it off for a full sync.
:::

## Smoke testing with `--dry-run`

`--dry-run` is the fastest way to verify the script works against the live API without touching MySQL:

```bash
npm run telonex:sync -- --limit 3 --dry-run
```

It downloads the catalogue, runs the query with `LIMIT 3`, prints one matched row as JSON, then exits. No database writes.

## Idempotency

`telonex_markets.slug` is unique. The script uses `INSERT IGNORE`, so re-running is safe — existing rows are skipped silently and counted under `skipped` in the final summary.

```
[telonex:sync] done attempted=19223 inserted=0 skipped=19223
```

::: warning
`INSERT IGNORE` only inserts new rows. If a market's metadata has changed on Telonex's side since you last synced, that change will not be reflected. If you need to refresh a row's catalogue fields, delete it from `telonex_markets` and re-run sync.
:::

## What is written to the database

Every matching row is mirrored field-for-field from the Telonex catalogue. The pipeline-local columns are initialised to their defaults:

| Column | Initial value |
| --- | --- |
| `upload_status` | `pending` |
| `files_uploaded` | `0` |
| `synced_at` | current timestamp |
| `processed_at` | `NULL` |
| `last_error` | `NULL` |

## Checking results

```sql
-- How many markets are in the queue?
SELECT upload_status, COUNT(*)
FROM telonex_markets
GROUP BY upload_status;

-- Inspect one market's catalogue fields
SELECT slug, market_id, outcome_0, outcome_1,
       book_snapshot_full_from, book_snapshot_full_to
FROM telonex_markets
WHERE slug = 'btc-updown-15m-1766364300';
```

## Performance and rate limiting

DuckDB's `httpfs` extension was tried first but reads remote Parquet via many HTTP range requests, which trips Telonex's rate limiter quickly. The script therefore downloads the catalogue in a single GET (Bearer authentication) before running the local DuckDB query.

Typical timings (BTC 15m, ~19k matching rows):

| Step | Duration |
| --- | --- |
| Catalogue download (~660 MB) | ~20 s |
| DuckDB filter + projection | ~2 s |
| MySQL batch insert (500/batch) | ~3 s |
| **Total** | **~25 s** |

## Next steps

- [Download Raw Files](/datasets/telonex/download-raw-files) — fetch the per-market `book_snapshot_full` files referenced by `telonex_markets` and stage them on R2.
- [Convert](/datasets/telonex/convert) — once raw files are on R2, run the paired, delta, or delta-typed converter.
