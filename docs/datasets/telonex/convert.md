---
title: Convert
description: How to run the telonex:convert dispatcher to turn raw R2 files into paired, delta, or typed delta backtest parquets, locally or on R2.
---

# Convert

The `telonex:convert` CLI is Stage 3 of the pipeline. It is a dispatcher: it picks markets whose raw files are already on R2 (`upload_status='done'`), downloads them into a per-worker temp directory, runs the chosen converter, and writes the result locally and/or back to R2 — recording every conversion in `telonex_market_conversions`.

Three converters are available: **paired**, **delta**, and **delta-typed**. See [Overview > Three output formats](/datasets/telonex/overview#three-output-formats-paired-vs-delta-vs-delta-typed) for the conceptual difference.

## Prerequisites

- `telonex:download` has been run for the markets you want to convert; their `upload_status` is `done`.
- R2 credentials are set (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
- The output target directory `data/events/telonex/` is writable if you use `--output local` or `both`.

## Basic usage

```bash
# Default: paired converter, R2 output
npm run telonex:convert

# Delta converter, write to local disk only (no R2 upload)
npm run telonex:convert -- --converter delta --output local

# Typed delta converter, write compact typed rows to local disk only
npm run telonex:convert -- --converter delta-typed --output local

# All converters in one pass — raw files downloaded once per market
npm run telonex:convert -- --converter delta --converter delta-typed --converter paired --output local

# Paired converter, write both locally and to R2
npm run telonex:convert -- --converter paired --output both

# Restrict to one market family with a slug pattern (optional filter)
npm run telonex:convert -- --converter delta-typed --slug-pattern 'btc-updown-15m-%'

# Multiple families at once
npm run telonex:convert -- --converter delta-typed --slug-pattern 'btc-updown-5m-%,eth-updown-5m-%'
```

`--converter` can be repeated. When multiple converters are requested, the worker downloads the raw files once per market and runs each converter sequentially, writing a separate row to `telonex_market_conversions` per converter. This halves R2 download cost compared to running two separate processes.

Sample output:

```
[telonex:convert] converters=delta,delta-typed,paired output=local concurrency=1 limit=none bucket=polymarket-telonex
[telonex:convert] queue size=19223 (capped by --limit)
[telonex:convert] w1 btc-updown-15m-1760140800 [delta] done rows=10681 elapsed=1.5s [1/19223 rate=0.66/s eta=8h05m]
[telonex:convert] w1 btc-updown-15m-1760140800 [delta-typed] done rows=10681 elapsed=2.1s [1/19223 rate=0.66/s eta=8h05m]
[telonex:convert] w1 btc-updown-15m-1760140800 [paired] done rows=10681 elapsed=2.9s [1/19223 rate=0.66/s eta=8h05m]
...
[telonex:convert] done markets_processed=19223 elapsed=8h12m
```

## Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--converter <paired\|delta\|delta-typed>` | `paired` | Converter to run. Repeat to run multiple converters in one pass (e.g. `--converter delta --converter delta-typed --converter paired`). |
| `--output <local\|r2\|both>` | `r2` | Where to write the converted Parquet. |
| `--concurrency <N>` | `1` | Number of markets converted in parallel **within one process**. Conversion is CPU-bound JavaScript on a single thread, so raising this does **not** speed up CPU work — it only overlaps I/O. For real parallelism, run multiple processes instead (see [Running long conversions](#running-long-conversions)). |
| `--limit <N>` | unlimited | Stop after this many markets. |
| `--book-interval <N>` | `500` | Delta converters only: how often to emit a full `book` snapshot row, in tick count. Lower values increase output size and reduce drift; higher values reduce output size. |
| `--slug <s1,s2,...>` | none | Restrict to this exact set of slugs (comma-separated). For a handful of markets / precise debugging. |
| `--slug-pattern <p1,p2,...>` | none | Restrict to markets whose slug matches these MySQL `LIKE` patterns (comma-separated, e.g. `btc-updown-15m-%`). **Optional** here — unlike [`telonex:download`](./sync-design) where it is required. Without it, convert processes every eligible `done` market. Drains in pattern order, chronological within each pattern. |
| `--force` | disabled | Re-run requested converters even when the conversion table already marks them as done. Use this after a converter schema or replay format changes. |

## Output locations

### `--output local`

Writes to:

```
data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet
```

Concretely for a paired BTC 15m market:

```
data/events/telonex/paired/btc/15m/btc-updown-15m-1760140800.parquet
```

For typed delta local output:

```
data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1760140800.parquet
```

The output stays on disk after the run. `telonex_market_conversions.local_path` is set to the absolute path. If this market already has an `r2_url` from an earlier `--output r2` or `--output both` run, that R2 destination is preserved.

### `--output r2`

Writes to a per-worker temp file, uploads to R2 with `Content-MD5`, then deletes the temp file. The R2 key is:

```
telonex/converted/<converter>/<symbol>/<timeframe>/<epoch>/<slug>.parquet
```

`telonex_market_conversions.r2_url` is set to `r2://<bucket>/<key>`. The R2 response ETag is stored on `etag`. If this market already has a `local_path` from an earlier `--output local` or `--output both` run, that local destination is preserved.

### `--output both`

Writes to the local path **and** uploads to R2. Both `local_path` and `r2_url` are populated in `telonex_market_conversions`.

## Choosing a converter

::: code-group

```bash [paired (default)]
npm run telonex:convert -- --converter paired
```

```bash [delta (recommended for replay speed)]
npm run telonex:convert -- --converter delta --book-interval 500
```

```bash [delta-typed (compact typed replay)]
npm run telonex:convert -- --converter delta-typed --book-interval 500 --output local
```

```bash [all in one pass]
npm run telonex:convert -- --converter delta --converter delta-typed --converter paired --output local
```

:::

The converters can be run independently on the same markets — they write to different paths and different rows in `telonex_market_conversions`. Re-running one converter does not affect data produced by the others. Within one converter, local and R2 are tracked on the same row: `--output local` fills `local_path`, `--output r2` fills `r2_url`, and `--output both` fills both.

## How candidates are claimed

The dispatcher selects a market with:

```sql
SELECT m.*
FROM telonex_markets m
WHERE m.upload_status = 'done'
  AND (
    SELECT COUNT(*) FROM telonex_market_conversions c
    WHERE c.market_id = m.id
      AND c.converter IN ('delta', 'delta-typed', 'paired')  -- whichever converters were requested
      AND c.status = 'done'
      AND <requested output destination is present>
  ) < <number of requested converters>
LIMIT 1 FOR UPDATE SKIP LOCKED;
```

A market is eligible as long as at least one of the requested converters is not fully done. The claim transaction then inspects existing rows to determine which converters still need work, and upserts only those to `in_progress` — converters already marked `done` are left untouched. Concurrent workers never pick the same market.

## Per-market lifecycle

1. **Claim** market, set conversion `status='in_progress'`.
2. **Read** the market's `telonex_market_files` rows with `status='uploaded'`.
3. **Download** each raw file from R2 into `tmp/telonex-convert-<pid>-<worker>-<id>/`.
4. **Resolve sides** — the dispatcher matches each raw file's `asset_id` against the market's `asset_id_0` / `asset_id_1` columns and tags it with the corresponding `outcome_0` / `outcome_1` label (normalised to `up` / `down`). The converter receives an explicit `{ filePath, side }` list, never inferring from filenames.
5. **Run the converter function**, which writes the output Parquet to disk.
6. **Per `--output`**: keep the file locally, upload to R2 with `Content-MD5`, or both.
7. **Record** the result on `telonex_market_conversions` (`status='done'`, paths, size, etag).
8. **Clean up** the temp directory.

If any step throws, the conversion row is updated to `status='failed'` with `last_error`, and the worker moves on. Failed rows are re-claimed automatically on the next run.

## Running long conversions

A full conversion run is tens of thousands of markets and takes hours, so it is normally run as a long-lived background job. Two things matter for it to behave well.

### Run it as a single process

Conversion is CPU-bound JavaScript on one thread. `--concurrency` only overlaps I/O within a process — it does **not** parallelise the conversion itself. To actually use multiple CPU cores, run **multiple independent processes**. The dispatcher is built for this: market claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` plus an `in_progress` guard, so any number of processes coordinate safely through the database without ever double-claiming a market.

Run each process directly with `node --import tsx` — **not** through `npm run`. Wrapping the script in `npm run`, `npx`, or `caffeinate` stacks several processes (`caffeinate → npm/npx → tsx shim → node`); on `Ctrl+C` the outer layers hard-kill the inner one before the converter can shut down cleanly, which orphans `in_progress` rows. A single `node --import tsx` process receives `Ctrl+C` directly and shuts down gracefully.

::: warning Avoid `| tee`
Piping the output through `tee` also breaks shutdown visibility: `tee` dies on the first `Ctrl+C`, so the `draining…` message never reaches your screen. Redirect to a file with `>>` and watch it with `tail -f` instead.
:::

### Recommended tmux setup

Run each process in its own [tmux](https://github.com/tmux/tmux/wiki) pane so the run survives a disconnected terminal. Pick a process count around your CPU core count.

```bash
# One pane: keep the machine awake for the whole run, then Ctrl+C it when done.
caffeinate -dimsu

# Each remaining pane: one independent converter process.
node --import tsx src/telonex/convert.ts \
  --converter delta-typed --output both --concurrency 1 \
  >> logs/convert-full.log 2>&1

# A spare pane: watch combined progress.
tail -f logs/convert-full.log
```

Every process appends to the same log file and claims its own markets. To stop the whole run, `Ctrl+C` each convert pane (see below).

## Graceful shutdown

When run as a single `node --import tsx` process (see above), `Ctrl+C` is delivered straight to the converter:

1. **First `Ctrl+C`** — drains: the worker finishes the market currently in flight (up to ~1 minute), records it, then exits 0. Wait for the `done markets=…` line — do not press again.
2. **Second `Ctrl+C`** — exits immediately, but first reverts **this process's own** `in_progress` claims back to `pending` so a later run picks them up.

Either path leaves the database consistent — no run can orphan an `in_progress` row. Cleanup is also scoped per process: a shutting-down process only reverts the claims it owns and never touches markets being converted by other concurrent processes.

If a process is hard-killed (`SIGKILL`, power loss), its claims can be left stuck in `in_progress`. Recover them before the next run with:

```sql
UPDATE telonex_market_conversions
SET status = 'pending', started_at = NULL
WHERE status = 'in_progress';
```

Run this only when no convert process is active.

## Verifying converter correctness

Use `telonex:verify` when you need to prove that converter output reconstructs the same orderbook state as the original raw Telonex snapshots:

```bash
npm run telonex:verify -- --slug btc-updown-15m-1764259200
```

The verifier rebuilds paired, delta, and delta-typed files in a temporary local directory, replays them through the backtest orderbook path, and compares both assets, bids, asks, and every level on every emitted strategy tick.

See [Verify Telonex Conversions](/datasets/telonex/verify) for the full verification model and mismatch diagnostics.

## Checking Parquet structure

```bash
npm run verify:parquet -- data/events/telonex/paired/btc/15m/btc-updown-15m-1760140800.parquet
```

`verify:parquet` only checks that a file is structurally readable. It does not prove that the orderbook state reconstructed by backtest is correct.

A healthy **paired** file has `event_type=orderbook_pair` and columns `up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks`.

A healthy **delta** file has `event_type` values of `book` and `price_change`, and the `raw_json` column carries the live-format payloads.

A healthy **delta-typed** file has `event_type` values of `book` and `price_change`, no `raw_json` column, and flat repeated typed columns for book depth and price changes.

## Backtesting the output

- **Paired** files require `--input-mode telonex-paired --read-from local|r2` — see [Run a Backtest](/datasets/telonex/backtest).
- **Delta** files are in the live format and run in standard `recorded` mode with no `--input-mode` flag.
- **Delta-typed** files require `--input-mode telonex-delta --read-from local|r2`.

## Checking conversion state

```sql
-- Per-converter completion
SELECT converter, status, COUNT(*)
FROM telonex_market_conversions
GROUP BY converter, status;

-- Latest failures
SELECT m.slug, c.converter, c.last_error
FROM telonex_market_conversions c
JOIN telonex_markets m ON m.id = c.market_id
WHERE c.status = 'failed'
ORDER BY c.completed_at DESC
LIMIT 20;

-- Where is a market's converted file?
SELECT converter, status, r2_url, local_path, size_bytes
FROM telonex_market_conversions
WHERE market_id = (SELECT id FROM telonex_markets WHERE slug = 'btc-updown-15m-1766364300');
```

## Performance reference

These are local development reference numbers only. Use them for order-of-magnitude checks, not as a portable benchmark; CPU, disk, and `--concurrency` materially change throughput.

| Converter | Input | Output rows | Per-market time |
| --- | --- | --- | --- |
| paired | 2 raw files (~280 KB each) | ~10,000 paired rows | ~1.5 s |
| paired | 4 raw files (~700 KB each, 2-day window) | ~22,000 paired rows | ~2.7 s |
| delta | 2 raw files (~280 KB each) | ~10,600 mixed rows | ~1.2 s |
| delta-typed | 2 raw files (~280 KB each) | ~10,600 mixed rows | ~1.2 s |

Conversion is CPU-bound JavaScript on a single thread, so throughput does **not** scale with `--concurrency` — raising it only interleaves several markets on one core. To go faster, run multiple processes (one per core), as described in [Running long conversions](#running-long-conversions). Throughput then scales close to linearly with the number of processes.

## Next steps

- [Verify Telonex Conversions](/datasets/telonex/verify) — certify converter correctness tick by tick.
- [Download Converted Files](/datasets/telonex/download-converted-r2-to-local) — pull the converted parquet from R2 to local disk for `--read-from local` backtests.
- [Run a Backtest](/datasets/telonex/backtest) — replay the converted files.
- [Download Raw Files](/datasets/telonex/download-raw-files) — upstream stage if `upload_status` is not yet `done` for your markets.
