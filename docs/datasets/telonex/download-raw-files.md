---
title: Download Raw Files
description: How to run the per-market worker that downloads Telonex book_snapshot_full files into Cloudflare R2 and records every upload in telonex_market_files.
---

# Download Raw Files

The `telonex:download` CLI is Stage 2 of the pipeline. It iterates over markets that the sync step has placed in `telonex_markets`, downloads each market's `book_snapshot_full` files from the Telonex download endpoint, validates them, uploads them to Cloudflare R2, and records the result in `telonex_market_files`.

## Prerequisites

- `telonex:sync` has been run at least once, so `telonex_markets` contains rows with `upload_status='pending'` or `'partial'`.
- `TELONEX_API_KEY` is set.
- R2 credentials are set: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## Basic usage

`--slug-pattern` is **required** — it selects which markets to download (same comma-separated LIKE patterns as `telonex:sync`). Markets are drained in pattern order (all of the first pattern, then the second, …) and chronologically within each pattern.

```bash
npm run telonex:download -- --slug-pattern 'btc-updown-15m-%'
```

Output looks like this:

```
[telonex:download] slug-patterns=btc-updown-15m-% concurrency=1 channel=book_snapshot_full limit=none bucket=polymarket-telonex
[telonex:download] queue size=2719 (pending+partial matching slug-patterns, capped by --limit)
[telonex:download] w1 btc-updown-15m-1778715900 2026-04-13/40031974 -> OK 283572B
[telonex:download] w1 btc-updown-15m-1778715900 2026-04-13/10846279 -> OK 283598B
[telonex:download] w1 btc-updown-15m-1778715900 done ok=2 no_file=0 failed=0 elapsed=2.2s [1/2719 rate=0.45/s eta=1h40m]
...
[telonex:download] done markets_processed=2719 elapsed=25m
```

To download all eight crypto combos in order, pass the same pattern list as the sync shortcut:

```bash
npm run telonex:download -- --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%,sol-updown-15m-%,xrp-updown-15m-%,btc-updown-5m-%,eth-updown-5m-%,sol-updown-5m-%,xrp-updown-5m-%'
```

## Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--slug-pattern <like>` | **required** | Comma-separated SQL LIKE pattern(s) for `slug`. Only matching markets are processed; they are drained in pattern order, then chronologically within each pattern. |
| `--concurrency <N>` | `1` | Number of markets processed in parallel. |
| `--channel <name>` | `book_snapshot_full` | Telonex channel name appended to the download URL and the R2 key prefix. |
| `--limit <N>` | unlimited | Stop after this many markets have been processed. Useful for smoke tests. |

## What one worker does per market

For each claimed market, the worker:

1. Expands `book_snapshot_full_from` ↔ `book_snapshot_full_to` into `(date, asset_id)` candidates (one per UTC day per outcome).
2. Skips any candidate already present in `telonex_market_files` with `status='uploaded'` (idempotent resume).
3. For each remaining candidate:
   - Issues `GET /v1/downloads/polymarket/<channel>/<date>?asset_id=<id>` with `Authorization: Bearer <TELONEX_API_KEY>`.
   - Follows the 302 redirect to Telonex's S3 presigned URL and reads the body into a buffer.
   - Computes MD5 of the buffer; logs a warning if the buffer's MD5 differs from the source ETag.
   - PUTs the buffer to R2 with `Content-MD5` set, so R2 server-side rejects any in-flight corruption.
   - Writes a `telonex_market_files` row with `status='uploaded'`, the R2 key, the response ETag, and the file size.
4. After all candidates are attempted, updates the parent `telonex_markets.upload_status` to `done` (all succeeded or were `no_file`) or `partial` (at least one failed).

## R2 key format

```
telonex/raw/<symbol>/<timeframe>/<epoch>/<channel>/<asset_id>_<date>_<channel>.parquet
```

Examples:

```
telonex/raw/btc/15m/1760140800/book_snapshot_full/40031974677622756146...053_2025-10-11_book_snapshot_full.parquet
telonex/raw/btc/15m/1760140800/book_snapshot_full/10846279311187608242...443_2025-10-11_book_snapshot_full.parquet
```

The filename is exactly what Telonex returns in `Content-Disposition` — it is never renamed.

## Resume and retry semantics

Markets in `pending` and `partial` are both eligible for claim, with `partial` ordered first. This means a market that previously failed for one of its candidate files is retried on the next run before any fresh `pending` market.

For an individual candidate, the worker performs in-process retries with exponential backoff:

| Failure type | Behaviour |
| --- | --- |
| HTTP 404 | Recorded as `status='no_file'`. Treated as a Telonex coverage gap, not an error. |
| HTTP 429 | Retried up to 10 times, honouring `Retry-After`. Does not count against the 3-retry budget. |
| HTTP 5xx or network error | Retried up to 3 times with 1 s / 2 s / 4 s backoff. After exhaustion, the candidate is recorded as `status='failed'` with `attempts=3` and `last_error`. |
| Any other HTTP error (e.g. 4xx) | Recorded as `status='failed'` immediately, the market goes to `partial`. |

Each 429 and each transient retry prints a `WARN` line so you can see backoff behaviour live:

```
[telonex:download] WARN 429 rate-limited 2025-12-07/40031974 retry 1/10 after 4.0s
[telonex:download] WARN 500 2025-12-07/40031974 attempt 1/3 retry in 1.0s: HTTP 500 Internal Server Error
```

## Concurrency and worker pool

Each worker runs `(claim market) → (process all its candidates sequentially) → (finalise) → (claim next)`. The default is a single worker (`--concurrency 1`), which is the safest with respect to Telonex's rate limiter.

You can push concurrency higher (`--concurrency 8`) if you are not seeing rate-limit warnings, or keep it at 1 if you are. Concurrency does not change the drain order across patterns meaningfully — workers still claim in pattern order — but with many workers a later pattern's first markets may begin before the previous pattern's last few finish.

## MD5 verification

The script computes MD5 of the downloaded buffer and:

- Cross-checks it against the Telonex source ETag (single-part S3 uploads have ETag = content MD5). A mismatch logs a warning but does not abort the upload.
- Sends it as the `Content-MD5` header on the PUT to your R2 bucket. R2 rejects the upload if the body's MD5 does not match — this is the authoritative integrity check.

The R2 PUT response ETag is stored on `telonex_market_files.r2_etag` for audit.

::: warning AWS SDK v3 checksum quirk
AWS SDK v3 ≥ 3.729 auto-adds a SHA-256 / CRC-32 request checksum that conflicts with `Content-MD5` on Cloudflare R2 ("You can only specify one non-default checksum at a time"). The R2 client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'` to disable that behaviour — required if you customise the client elsewhere in the codebase.
:::

## Progress line

Every market completion logs a structured progress line:

```
[telonex:download] w2 btc-updown-15m-1763523900 done ok=4 no_file=0 failed=0 elapsed=6.0s [3/19223 rate=0.49/s eta=10h54m]
```

| Field | Meaning |
| --- | --- |
| `wN` | Worker ID. |
| `ok` | Files successfully uploaded this market. |
| `no_file` | Candidates that returned HTTP 404. |
| `failed` | Candidates that exhausted retries. |
| `elapsed` | Wall-clock time for this market. |
| `[X/Y]` | Total markets completed so far / total eligible at run start. |
| `rate=X/s` | Average market completion rate over the run. |
| `eta=...` | Estimated time to finish, based on current rate. |

## Graceful shutdown

Two `SIGINT` (`Ctrl+C`) levels:

1. **First `Ctrl+C`** — the process prints `draining`, aborts in-flight HTTP, finalises any market that already has all its candidates attempted, and reverts every market that is still mid-flight from `processing` back to `pending`. Then exits with code 0.
2. **Second `Ctrl+C`** — hard exit (`process.exit(1)`).

Resuming after a clean shutdown is exactly the same as resuming after any other interruption: re-run `npm run telonex:download -- --slug-pattern '<same patterns>'` and the same workers pick up the reverted markets first.

## Checking results

```sql
-- Overall pipeline state
SELECT upload_status, COUNT(*) FROM telonex_markets GROUP BY upload_status;

-- Per-file status distribution
SELECT status, COUNT(*) FROM telonex_market_files GROUP BY status;

-- Markets that ended in partial state and what their error was
SELECT slug, files_uploaded, last_error
FROM telonex_markets
WHERE upload_status = 'partial';

-- Files that failed for a given market
SELECT date, asset_id, attempts, last_error
FROM telonex_market_files
WHERE slug = 'btc-updown-15m-1760140800' AND status = 'failed';
```

## Performance reference

Observed on a fresh BTC 15m run with default settings:

| Metric | Value |
| --- | --- |
| Concurrency | 4 |
| Sustained rate | ~1.8 markets/s |
| Average files per market | ~3.3 (mix of 1-day and 2-day windows) |
| Total wall-clock for ~19k markets | ~2 h 45 min |
| 429 occurrences | 0 |
| Failed candidates | 0 |

## Next steps

- [Convert](/datasets/telonex/convert) — once your markets are `upload_status='done'`, run the paired, delta, or delta-typed converter through the dispatcher.
- [Sync Markets](/datasets/telonex/sync-markets) — the upstream stage that fills `telonex_markets`.
