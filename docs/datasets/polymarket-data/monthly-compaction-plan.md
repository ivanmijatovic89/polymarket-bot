# Monthly Parquet Compaction Plan

Status: **accepted design, intentionally deferred**. The staging layout is now
implemented and validated; the compaction command itself has not been built.

The sync pipeline writes trades and positions into human-readable,
Hive-partitioned staging paths as one atomic Parquet snapshot per market:

```text
data/polymarket/staging/trades/symbol=btc/timeframe=15m/month=2026-06/<slug>.parquet
data/polymarket/staging/positions/symbol=btc/timeframe=15m/month=2026-06/<slug>.parquet
```

The filename is the validated market slug, not the local MySQL ID. The market
ID, condition ID, and slug remain present in the catalog/data.

## Deferred final layout

After a complete symbol/timeframe/month has been downloaded and independently
validated, a future compaction command will publish:

```text
data/polymarket/facts/trades/symbol=btc/timeframe=15m/month=2026-06/data.parquet
data/polymarket/facts/positions/symbol=btc/timeframe=15m/month=2026-06/data.parquet
```

Per-market files are synchronization staging, not the intended permanent
analytics layout. Final compaction granularity is one file per:

```text
fact type × symbol × timeframe × month
```

Trades and positions remain separate because they have different schemas and
query patterns.

## Why compaction is deferred

Do not implement or run monthly compaction until the staging architecture has
been exercised on a complete month. We want to validate sync, resume, repair,
per-market verification, DuckDB queries, and storage estimates against the
layout that produces the source files before adding another storage state.

The first compaction target should be a complete, closed June 2026 scope. BTC
1d may be used as a small functional rehearsal, but the command is not accepted
for general use until a full high-cardinality timeframe has also passed the
checks below.

## Trigger to implement the command

Implement monthly compaction only after all of the following are true:

1. The hierarchical staging layout is implemented and existing accepted files
   are migrated without redownloading.
2. Writers, post-write verification, independent verification, and DuckDB can
   read the staging layout correctly.
3. One complete June symbol/timeframe scope is downloaded with every market in
   `done` and zero failed, partial, pending, or processing markets.
4. Representative AI/DuckDB queries return correct results from staging.
5. Disk usage and elapsed-time measurements for the complete scope are recorded.

## Current progress (2026-07-16)

- The hierarchical staging layout is implemented. All 36 accepted trade files
  and all 36 accepted position files were migrated by rename, with identical
  aggregate SHA-256 fingerprints before and after. A second migration run moved
  zero files.
- Writers, post-write readers, offline verification, live API resampling, resume
  checks, recursive discovery, and Hive-aware DuckDB queries all pass on the
  accepted BTC 1d plus six-market BTC 5m dataset.
- BTC 1d is a complete June scope, but the full high-cardinality BTC 5m month is
  still pending. Keep compaction deferred until that larger scope and its disk /
  elapsed-time measurements are complete.

## Compaction correctness contract

The future command must:

1. Refuse to compact an incomplete scope unless an explicit test-only mode is
   used; production output must never look complete when the catalog is partial.
2. Read all staged market files for exactly one symbol/timeframe/month.
3. Preserve every row, including genuinely identical fills.
4. Sort trades by `market_id`, `ts_ms`, and `tx_hash`; keep useful Parquet row
   groups rather than producing one monolithic row group.
5. Write ZSTD Parquet to a temporary path and publish it by atomic rename.
6. Recheck row count, wallet count, per-market `SUM(size) / 2` against Gamma,
   and position-participant coverage from the published monthly file.
7. Rebuild the DuckDB catalog and run representative queries before deleting
   staging files.
8. Delete staged files only after every verification succeeds.
9. Support a later market repair by rebuilding the affected monthly file with
   that market's staged replacement, never by appending duplicate rows.

Until this command exists and passes the contract, the staging files remain the
authoritative Parquet facts.
