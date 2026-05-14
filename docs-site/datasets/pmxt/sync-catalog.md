---
title: Sync PMXT Catalogue
description: How to populate the pmxt_dataset_catalogue database table with the full list of PMXT archive files before running the conversion pipeline.
---

# Sync PMXT Catalogue

Before downloading and converting PMXT data, you need to populate the `pmxt_dataset_catalogue` table with the list of available files. The `sync-catalog` script scrapes the PMXT archive index and inserts one row per hourly file as a pending conversion job.

## Command

::: code-group

```bash [npm]
npm run pmxt:sync-catalog:v1
```

```bash [v2]
npm run pmxt:sync-catalog:v2
```

```bash [npx]
npx tsx src/pmxt/sync-catalog.ts --version v1
npx tsx src/pmxt/sync-catalog.ts --version v2
```

:::

## Options

| Flag | Default | Description |
|---|---|---|
| `--version` | `v1` | Archive version to sync. Accepted values: `v1`, `v2`. |

## What it does

The script fetches each page of the PMXT archive index sequentially with a short delay between requests, extracts all Parquet file entries (URL, filename, size, timestamp), and inserts them into `pmxt_dataset_catalogue` with `status = 'pending'`.

Progress is printed to stderr as each page is fetched:

```
Fetching PMXT v1 catalogue...

  page 1 fetched (50 files)
  page 2 fetched (50 files, total: 100)
  ...
  page 26 fetched (35 files, total: 1285)

Fetched 1285 files (385.4 GB total). Inserting into DB...

Done.
  inserted: 1284
  skipped (already existed): 1
  total in catalogue: 1285
```

## Idempotency

The script is safe to re-run at any time. Rows are matched by filename — existing entries are skipped without modification. This means:

- Running it again after a partial insert completes the remaining rows.
- Running it on v2 periodically picks up new hourly files as the archive grows.

## Known skipped files

Some v1 files are automatically excluded and will never be processed.

**Excluded at catalogue insertion** (never inserted as pending jobs):

| File | Reason |
|---|---|
| `polymarket_orderbook_2026-02-21T16.parquet` | First archive file, only ~5.7 MB, incomplete orderbook snapshots |
| `polymarket_orderbook_2026-02-21T17.parquet` | 2 of 4 windows have no valid book data due to missing T16 context |

**Excluded at pipeline startup** (marked `done` with 0 windows if found pending):

The 21 files from `2026-04-15T09` through `2026-04-16T05` are 0 MB — the v1 archive ended and PMXT stopped recording. The `download-and-convert-v1` pipeline automatically marks these as done on startup without downloading them.

## Next step

Once the catalogue is populated, run the conversion pipeline:

```bash
npm run pmxt:download-and-convert:v1 -- --out data/events/btc-pmxt-v1
```

See [Download & Convert v1](/datasets/pmxt/download-and-convert-v1) for full details.
