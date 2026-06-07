---
title: Telonex Sync Design
description: Authoritative design for the Telonex dataset ingestion pipeline.
---

# Telonex Sync Design (v1)

Authoritative design for the Telonex dataset ingestion pipeline.
Implementation must follow this document; deviations require an update here first.

- **Status:** approved 2026-05-16
- **Scope (v1):** `btc-updown-15m` only, `book_snapshot_full` channel only
- **Extensibility:** all scope is CLI-parametrised — no symbol / timeframe / channel hardcoded

## Pipeline overview

```
Telonex catalog (parquet @ api.telonex.io)
        ↓ (DuckDB filter, Bearer auth)
   sync-markets        →  telonex_markets (MySQL)
        ↓
Telonex per-market raw parquets
        ↓ (per-market worker, Content-MD5 validated)
   download-raw-files  →  R2: telonex/raw/...
                      →  telonex_market_files (MySQL)
        ↓
   convert (dispatcher: paired | delta | ...)
        ↓
R2: telonex/converted/<converter>/...   (and/or local data/events/telonex/...)
                      →  telonex_market_conversions (MySQL)
        ↓
Backtest (reads local first, R2 fallback — already in src/cli/helpers/openParquetReader.ts)
```

## Catalog filter

The Telonex `markets` parquet is filtered with:

```sql
WHERE slug LIKE 'btc-updown-15m-%'
  AND book_snapshot_full_from <> ''
```

Verified counts at v1 cut: 20,809 markets total for `btc-updown-15m`, of which **19,223 have `book_snapshot_full` data**.

`event_slug` is NOT a useful group key — for these markets `event_slug == slug` (each 15m market is its own event).

Telonex data prior to **2026-01-19** may contain gaps (per Telonex docs). Gaps are detected at download time via 404.

## Database schema (Drizzle / MySQL)

Three new tables. All keys, indexes, and defaults below are normative.

### `telonex_markets`

Mirrors the full Telonex catalog row plus local pipeline state.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK auto_increment | |
| `slug` | VARCHAR(100) UNIQUE | Telonex slug |
| `symbol` | VARCHAR(10) NOT NULL | Derived from slug at sync time (`btc`, `eth`, …). Indexed. |
| `timeframe` | VARCHAR(16) NOT NULL | Derived from slug at sync time (`15m`, `5m`). Indexed. |
| `market_start_ms` | BIGINT NOT NULL | Slug epoch × 1000. Ground truth for market window start; indexed via `(symbol, timeframe, market_start_ms)` and `(timeframe, market_start_ms)`. Always use this — **never order/filter by `start_date_us`** (verified empirically that 100% of rows differ from the slug epoch, avg ~22h earlier; `start_date_us` represents creation/announcement, not trading-window open). |
| _(all Telonex catalog columns)_ | matching types | `*_us` → BIGINT, `*_from/_to` → DATE (empty string → NULL), `tags` → JSON, `description` → TEXT |
| `upload_status` | ENUM(`pending`,`processing`,`done`,`partial`,`failed`) DEFAULT `pending` | Step 1 outcome |
| `files_uploaded` | INT DEFAULT 0 | Count of `uploaded` children |
| `last_error` | TEXT NULL | Last Step 1 error message |
| `synced_at` | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | When sync wrote this row |
| `processed_at` | TIMESTAMP NULL | When Step 1 finished |

### `telonex_market_files`

One row per (slug, channel, date, asset_id). **Created lazily by Step 1 worker, not by sync.**

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK auto_increment | |
| `slug` | VARCHAR(100) | FK-style to `telonex_markets.slug` |
| `channel` | VARCHAR(40) | e.g. `book_snapshot_full` |
| `date` | DATE | UTC day |
| `asset_id` | VARCHAR(80) | the downloaded outcome's token id |
| `r2_key` | VARCHAR(255) | full R2 object key |
| `r2_etag` | VARCHAR(64) NULL | from R2 PUT response |
| `size_bytes` | BIGINT NULL | |
| `status` | ENUM(`uploaded`,`no_file`,`failed`) | `no_file` = 404 gap, audited |
| `attempts` | INT DEFAULT 0 | |
| `last_error` | TEXT NULL | |
| `started_at` | TIMESTAMP NULL | |
| `uploaded_at` | TIMESTAMP NULL | |
| _unique_ | `(slug, channel, date, asset_id)` | idempotency anchor |

### `telonex_market_conversions`

One row per (market_id, converter). Created by Step 2 worker.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK auto_increment | |
| `market_id` | BIGINT | FK telonex_markets.id |
| `converter` | VARCHAR(40) | `paired` / `delta` / (future) |
| `status` | ENUM(`pending`,`in_progress`,`done`,`failed`) | |
| `r2_url` | VARCHAR(255) NULL | R2 location of the converted parquet, populated by `--output r2|both` |
| `local_path` | VARCHAR(255) NULL | local location of the converted parquet, populated by `--output local|both` |
| `size_bytes` | BIGINT NULL | |
| `etag` | VARCHAR(64) NULL | |
| `attempts` | INT DEFAULT 0 | |
| `last_error` | TEXT NULL | |
| `started_at` | TIMESTAMP NULL | |
| `completed_at` | TIMESTAMP NULL | |
| _unique_ | `(market_id, converter)` | |

## Sync (manual)

Single script. Full scan + `INSERT IGNORE`. Telonex has no "data-ready" timestamp column, so cursor-based incremental sync is **not** used — the slug epoch tracks market start, not data readiness. Full scan of 20k rows through DuckDB is sub-second.

- Catalog fetch: one HTTP GET to `https://api.telonex.io/v1/datasets/polymarket/markets` with `Authorization: Bearer ${TELONEX_API_KEY}`. Cache locally then DuckDB filters.
- Insert: `INSERT IGNORE INTO telonex_markets (...) VALUES (...)`. Existing rows are not refreshed (simplest model; manual delete + re-sync if a row truly needs refresh).
- No `ON DUPLICATE KEY UPDATE` in v1.

## Step 1 — Download raw files

**Per-market worker.** One worker processes one `telonex_markets` row from claim to completion.

```
SELECT * FROM telonex_markets
WHERE upload_status IN ('pending','partial')
FOR UPDATE SKIP LOCKED LIMIT 1;

UPDATE telonex_markets SET upload_status='processing' WHERE id=?;

candidates = expand((book_snapshot_full_from .. book_snapshot_full_to-1) × (asset_id_0, asset_id_1))

for c in candidates:
  if (slug,channel,date,asset_id) already in telonex_market_files with status='uploaded' → skip (resume)
  GET https://api.telonex.io/v1/downloads/polymarket/book_snapshot_full/<date>?asset_id=<id>
      Authorization: Bearer <TELONEX_API_KEY>
  case 302 → follow → buffer in RAM
       md5 = md5(buffer)
       PUT r2://<bucket>/<key>  with  Content-MD5: base64(md5)
       INSERT INTO telonex_market_files (..., status='uploaded', r2_etag=<resp etag>, ...)
  case 404 → INSERT (..., status='no_file', ...)
  case 5xx/network → in-process retry up to 3× with exp backoff (1s/2s/4s)
                     if still failing → INSERT (..., status='failed', attempts=3, last_error=...)
  case 429 → exp backoff using Retry-After; after 3 consecutive 429s
              halve global concurrency (4→2→1); restore +1 after 50 consecutive successes

if all children uploaded/no_file → upload_status='done', processed_at=NOW()
elif any failed → upload_status='partial'  (auto-resume next run)
elif hard auth/403 error → upload_status='failed' (manual intervention)
```

- `--concurrency=4` default (parallel markets); CLI override allowed.
- Verification: **only** Content-MD5 on PUT to R2. R2 server-side rejects on mismatch. Telonex source ETag cross-check is unnecessary belt-and-suspenders.
- Failure history is preserved in `telonex_market_files` (Model 2 audit).

## Step 2 — Convert (dispatcher)

```
# single converter
npm run telonex:convert -- --converter paired   [--output local|r2|both] [--concurrency 4]
npm run telonex:convert -- --converter delta    ...
npm run telonex:convert -- --converter delta-typed ...

# multiple converters in one pass — raw files downloaded once per market
npm run telonex:convert -- --converter delta --converter delta-typed --converter paired --output local
```

`--converter` can be repeated. When multiple converters are specified, the worker downloads the raw files once and runs each converter sequentially, writing a separate `telonex_market_conversions` row per converter.

Worker picks one market via:
```sql
SELECT m.* FROM telonex_markets m
WHERE m.upload_status = 'done'
  AND (
    SELECT COUNT(*) FROM telonex_market_conversions c
    WHERE c.market_id = m.id
      AND c.converter IN ('delta', 'delta-typed', 'paired')
      AND c.status = 'done'
      AND <requested output destination is present>
  ) < <number of requested converters>
FOR UPDATE SKIP LOCKED LIMIT 1;
```

Per market:
1. `INSERT INTO telonex_market_conversions (status='in_progress', started_at=NOW(), ...) ON DUPLICATE KEY UPDATE status='in_progress', attempts=attempts+1`
2. Fetch all `telonex_market_files` rows for that slug with `status='uploaded'` → for each, `GET r2://<bucket>/<key>` into a Buffer (RAM).
3. Call the converter's exported pure function with `inputs: Buffer[]` → returns local temp path (writer needs a file path).
4. Output handling per `--output`:
   - `r2`: temp path → `PUT r2://...converted/...` → delete temp
   - `local`: write to `data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet` → keep
   - `both`: write to local final path → PUT to R2 → keep local
5. `UPDATE telonex_market_conversions SET status='done', completed_at=NOW(), size_bytes=?, ...requested destination columns...`
6. On error: `UPDATE ... status='failed', last_error=?`

The conversion row is unique on `(market_id, converter)`, not on output target. Local and R2 are destination fields on the same row. A local-only run fills `local_path` and preserves any existing `r2_url`; an R2-only run fills `r2_url` and preserves any existing `local_path`; `both` fills both.

The dispatcher imports converter functions from `src/telonex/converters/*.ts` and builds a `Map<ConverterName, ConverterFn>` for all requested converters. The converter modules expose a pure function (no DB, no R2, no CLI scaffolding). `in_progress` is only upserted for converters that actually need work — converters already marked `done` are skipped in the claim transaction.

## R2 layout

```
telonex/raw/<symbol>/<timeframe>/<epochStart>/<channel>/<original-telonex-filename>
  e.g. telonex/raw/btc/15m/1765123200/book_snapshot_full/1049346...502_2025-12-07_book_snapshot_full.parquet

telonex/converted/<converter>/<symbol>/<timeframe>/<epochStart>/<slug>.parquet
  e.g. telonex/converted/paired/btc/15m/1765123200/btc-updown-15m-1765123200.parquet
```

Original Telonex filename (`<asset_id>_<date>_<channel>.parquet`, from `Content-Disposition`) is preserved in the raw layer.

## Local converted layout

```
data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet
  e.g. data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1765123200.parquet
```

(Backtest reader already supports both local paths and `r2://` URLs via `src/cli/helpers/openParquetReader.ts`; no backtest changes required.)

## File organization

```
src/telonex/
  sync-markets.ts          # CLI: catalog → MySQL
  download-raw-files.ts    # CLI: Step 1 worker
  convert.ts               # CLI: Step 2 dispatcher
  converters/
    paired.ts              # moved from src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts, refactored to export pure fn
    delta.ts               # moved from src/parquet/cli/telonex/convert-telonex-to-live-parquet.ts, refactored
  check/
    merge-by-timestamp.ts  # moved from check-telonex-merge-by-timestamp.ts (kept as standalone diagnostic)
    omitted-events.ts      # moved from check-telonex-omitted-events.ts
```

`src/parquet/cli/telonex/` directory is removed in the same migration. Only `docs/datasets/telonex/overview.md` references it currently — that doc is updated to point to the new locations.

`package.json` scripts:
```
"telonex:sync":     "tsx src/telonex/sync-markets.ts"
"telonex:download": "tsx src/telonex/download-raw-files.ts"
"telonex:convert":  "tsx src/telonex/convert.ts"
```

## Graceful shutdown (Step 1 and Step 2)

Both workers must handle SIGINT / SIGTERM cleanly:

- Single `AbortController` per worker, passed to all in-flight HTTP (download + upload).
- On signal: abort in-flight ops, revert `processing` / `in_progress` rows back to `pending`, close DB, `process.exit(0)`.
- Second signal in shutdown window = `process.exit(1)` (hard kill).
- Sync script does not need this — it has no transient worker state.

Skeleton:
```ts
const ac = new AbortController()
let shuttingDown = false
const handler = async (sig: string) => {
  if (shuttingDown) process.exit(1)
  shuttingDown = true
  ac.abort()
  await revertInFlightStatuses()
  await closeDb()
  process.exit(0)
}
process.on('SIGINT', () => handler('SIGINT'))
process.on('SIGTERM', () => handler('SIGTERM'))
```

## Scheduling

- v1: manual. Run sync / Step 1 / Step 2 on demand.
- Move to crontab once the pipeline is verified stable in practice (probably weeks in).

## Build order

1. Drizzle schema + `db:generate && db:migrate` — adds the 3 tables. (~30 min)
2. `sync-markets.ts` — verified by inserting 19,223 rows. (~2 h)
3. `download-raw-files.ts` — test with `LIMIT 5` first, then full run. (~4–6 h code + ~3.5 h full run for 19k markets)
4. `convert.ts` + move + refactor existing converters into exported functions. (~3–4 h)

## Backtest coverage view (PR #30 / #31)

The dashboard `/backtests/[id]` page renders a Telonex Coverage section for any backtest run with `input_mode != 'recorded'`. It compares the slugs the run actually executed (`backtest_run_markets.slug`) against the **eligible universe** for that run's `(symbol, timeframe, converter, read_from)` tuple, gated by the `TELONEX_DATASET_ELIGIBLE_FROM` env floor (ISO 8601 UTC, default `2025-12-01T00:00:00Z`).

- **Eligibility filter (source of truth)** lives in `src/db/telonexMarkets.ts:buildEligibleWhere`. The dashboard query at `dashboard/src/lib/queries/backtestCoverage.ts` mirrors the same logic against its local schema mirror — keep them in sync if you change the eligibility definition.
- **Pure compute** lives in `src/backtest/stats/coverage.ts` (workspace package `@polymarket-bot/stats/coverage`). Takes `{eligible, coveredSlugs}` and returns `{summary, buckets, missingSlugs}`. No DB access; trivially unit-testable.
- **UI**: `dashboard/src/components/coverage/` — `CoverageSummary` (chips), `CoverageHeatmap` (`react-calendar-heatmap`, daily buckets, 3 states), `MissingMarketsPanel` (filterable paginated table). Heatmap clicks filter the panel by day.
- **API route**: `dashboard/src/app/api/backtests/[id]/coverage` returns `{available: false}` for recorded-mode / legacy runs so the UI hides the section.

The summary exposes `forwardGapCount` / `backwardGapCount` / `middleGapCount` to support upcoming CLI flags (`--forward`, `--backward`, `--all`); these are computed against the newest/oldest covered `market_start_ms`.

## Future (intentionally NOT in v1)

- Additional channels (`trades`, `quotes`, `book_snapshot_5/25`, `onchain_fills`) — gated by a CLI flag, no schema change required.
- Additional converters (e.g. top-of-book) — new file in `converters/`, no schema change.
- Other symbols / timeframes — CLI parameter, no code change.
- Detection of Telonex re-prepared content (source ETag drift) — periodic `verify` command, deferred.
- Cron scheduling.
- Backtest auto-cache (download R2 → local on first read).
