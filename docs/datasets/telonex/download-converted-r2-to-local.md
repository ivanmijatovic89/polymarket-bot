---
title: Download Converted Files (R2 → local)
description: Pre-fetch converted Telonex parquet from Cloudflare R2 down to its canonical local path with a coordinator/worker pool, so backtests can run with --read-from local.
---

# Download Converted Files (R2 → local)

The `telonex:download-converted-r2-to-local` CLI pulls **converted** parquet (the output of [`telonex:convert`](/datasets/telonex/convert)) from Cloudflare R2 down to its canonical local path. After fetching, those markets can be backtested with `--read-from local` instead of `--read-from r2` — no per-tick R2 fetch, and the data is available offline.

It is a pre-fetch tool, not a pipeline stage: it creates no new database state. It uses the **same eligibility definition the backtest uses** (`listEligibleTelonexMarkets`, the single source of truth in `src/db/telonexMarkets.ts`) with `readFrom: 'r2'`, so the set it downloads is exactly the set a backtest would replay.

::: tip Why pre-fetch?
`--read-from r2` streams each market's parquet from R2 on every backtest run. For repeated backtests over the same universe, downloading once to local disk is faster and avoids re-fetching. Because the file lands at the exact path `telonex_market_conversions.local_path` records, the existing `--read-from local` mode finds it with no further configuration.
:::

## Prerequisites

- The markets you want have been converted ([`telonex:convert`](/datasets/telonex/convert)) with their `r2_url` populated (`status='done'`). Conversion output target does not matter — this tool reads from R2.
- R2 credentials are set (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
- Database credentials are set (the parent process runs one read-only `SELECT`).

## Basic usage

```bash
# All eligible delta-typed btc 15m markets
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m

# Specific slugs
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --slug btc-updown-15m-1760140800,btc-updown-15m-1760141700

# Dry run — print the pre-flight counts, write nothing
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m --dry-run
```

`--converter` is required (`delta-typed` or `paired`). All other filters are optional and mirror the backtest's market selection.

## The pre-flight summary

Before downloading anything, the parent prints how much work there is:

```
[telonex:dl-converted] r2 eligible: 21845   on local: 18338   to download: 3507
```

- **r2 eligible** — markets matching your filters that have a converted parquet on R2.
- **on local** — of those, how many already exist at their canonical local path (skipped).
- **to download** — the remainder that will be fetched.

With `--force`, every eligible market is re-downloaded and `on local` is reported as `0`.

## Concurrency: a coordinator/worker pool

`--concurrency N` runs a **coordinator/worker pool** modelled on the backtest worker (`src/cli/backtestWorker.ts`): one **parent** process queries the database and computes the missing set, then forks **N child processes** (real Node processes, via `tsx`). The parent hands each missing market to exactly one child over IPC — pull-based: a child finishes and asks, the parent pops the next job.

```bash
# One command, 8 worker processes
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m --concurrency 8
```

Properties:

- **No overlap** — each market is dispatched to exactly one child, so there is no DB-side claiming and no fragile sharding. You do **not** need to launch several terminals; one command with `--concurrency N` replaces them.
- **Auto load-balanced** — a fast child simply pulls more work.
- **Crash-resilient** — if a child dies mid-download, the parent re-queues that market for another child. No silent gaps. If every child exits with work left, it reports a clear error and exits non-zero.

The default is `--concurrency 1` (a single worker). Raise it to saturate your network/disk.

## Where files land

Each file is written to its canonical convert path — identical to what `telonex:convert --output local` produces, and identical to `telonex_market_conversions.local_path`:

```
data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet
```

The path is built by the shared `localOutputPath` helper (`src/telonex/localOutputPath.ts`), the single source of truth shared with the converter, so the two can never drift.

## Flags

| Flag | Description |
| --- | --- |
| `--converter delta-typed\|paired` | **Required.** Which conversion to fetch. |
| `--symbol btc\|eth\|sol\|xrp` | Restrict to one symbol (default: all). |
| `--timeframe 15m\|5m` | Restrict to one timeframe (only valid with `--symbol`). |
| `--slug a,b,c` | Restrict to an explicit comma-separated slug list. |
| `--from-ms` / `--to-ms` | Restrict to a `market_start_ms` window. |
| `--limit N` | Cap the number of markets (default: the whole eligible set). |
| `--latest` | With `--limit`, take the newest N (by `market_start_ms`). |
| `--concurrency N` | Number of worker processes (default `1`). |
| `--force` | Re-download even if the local file already exists. |
| `--dry-run` | Print the pre-flight summary only; write nothing. |

## Safety and idempotency

- **Read-only on the database.** Only the parent touches the DB, and only with the shared eligibility `SELECT` — no writes, no new tables.
- **Atomic writes.** Each child downloads to `<file>.<pid>.tmp` and renames into place, so an interrupted run never leaves a corrupt parquet.
- **Idempotent / resumable.** Files already on disk are skipped (unless `--force`); re-running picks up wherever it stopped.

## Next steps

- [Run a Backtest](/datasets/telonex/backtest) — replay the fetched files with `--read-from local`.
- [Convert](/datasets/telonex/convert) — upstream stage that produces the parquet this tool downloads.
- [Diagnostics](/datasets/telonex/diagnostics) — inspect coverage and readiness.
