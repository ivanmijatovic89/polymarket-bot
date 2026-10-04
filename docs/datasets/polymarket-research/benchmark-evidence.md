---
title: Research Dataset Benchmark Evidence
description: Measured ingestion, storage, query latency and coverage for the API v2 dataset.
---

# Benchmark evidence

These measurements were taken on 2026-10-04 with Node 20.19.6 on the local Mac.
They describe the stated sample and downloader configuration, not a guarantee for
all historical markets. No blockchain source was downloaded or used for verification.

## June 1 baseline: one complete UTC day

The cohort is `2026-06-01 <= market_start < 2026-06-02`. All 96 scheduled BTC
15-minute markets were present. Activity was bounded at `2026-10-04T16:02:56Z`;
other source snapshots were observed during the download.

| Measurement | Result |
| --- | ---: |
| All-side trade rows | 469,728 |
| Activity rows | 506,900 |
| Position rows, including overlapping source views | 72,229 |
| Trading wallets | 5,232 |
| Wallet/market pairs | 58,980 |
| Wallet-condition request batches | 6,743 |
| Fresh download time, including Parquet publication | 1,877.259 seconds (31.29 minutes) |
| HTTP requests / retries | 21,141 / 5 |
| Response body bytes | 969,235,436 |
| Final Parquet, after local accounting rebuild | 88,052,503 bytes (83.97 MiB) |
| Compressed API staging | 109,804,103 bytes |
| Observed peak working disk | 1,045,940,575 bytes (0.974 GiB) |

This baseline used **6 workers, 12 requests/second and wallet-scoped OPEN
positions**. Subsequent code uses market-scoped OPEN snapshots and independent
endpoint rate budgets. The baseline is retained so that improvements have a
measured comparison.

## Local query performance

A fresh DuckDB connection opened the dataset in 18.73 ms. The operating-system
cache was not flushed; verification queries were also reading this small dataset.
These are local query timings, not cold-disk or isolated-machine measurements.

| Query | First execution | Two repeats |
| --- | ---: | ---: |
| Trade count and distinct wallets | 13.61 ms | 9.14 / 8.39 ms |
| Top 100 complete wallet cohorts | 8.06 ms | 5.17 / 5.08 ms |
| 1,000-row activity timeline | 18.83 ms | 15.96 / 18.24 ms |

Run `research:benchmark` to reproduce these query shapes against the active
snapshots. A whole-month or four-month dataset must be measured separately.

## Validation and exclusions

All SHA-256 checks and independent SQL checks passed after local accounting
rebuild, including market/window counts, participant coverage, cash identities,
complete-row trade/activity multisets and saved taker-volume comparisons.

Accounting version 4 classified **58,215 wallet/market pairs as complete** and
**765 as unresolved**. The strict one-day leaderboard excludes **225 entire
wallet cohorts**, retaining 5,007 eligible wallets. It does not discard only the
problematic markets from those wallets.

| Unresolved issue | Affected wallet/market pairs |
| --- | ---: |
| Native API PnL still unexplained | 430 |
| Position balance mismatch | 260 |
| Missing position snapshot | 136 |
| Missing native position economics | 76 |
| Unexplained token outflow | 71 |

These categories overlap. File/SQL verification success does not imply that every
wallet has complete accounting. Source activity is not a general token-transfer
ledger, and unexplained native economics remain visible rather than being forced
to agree with local cash.

As a functional query example, the highest eligible one-day wallet was
`0xb55fa1296e6ec55d0ce53d93b9237389f11764d4`, with 91 markets, 2,350 trades and
`3026.876036` economic PnL. This is a result among eligible wallets for one day,
not a complete population ranking or a monthly strategy conclusion.

## Other-month probes and improvements

Four markets at six-hour intervals were sampled on each of July 1, August 1 and
September 1. The probe selected the two most active wallets and three points
across the remaining activity distribution, for 57 wallet/market histories in
total. With the documented merge-aware WAC diagnostic, 56 passed accounting;
one August history remained unresolved. These are targeted regression samples,
not random population estimates or complete-day benchmarks.

Market-scoped OPEN positions matched all 5,829 available wallet-scoped OPEN rows
checked across the June day: balances, realized/unrealized/total PnL and fees.
Market-scoped CLOSED still omits fully exited traders and is not used as a
replacement for wallet-scoped CLOSED requests.

The July full-day trial exposed an empty-feed case: event `650153`, market
`btc-updown-15m-1782880200`, has no all-side or taker trade rows and no condition
entry in `/v2/live-volume`. A single-event request explicitly reports total
volume zero. The sync now accepts this combination only with the individual
zero-event response saved as evidence. Missing volume for a non-empty market
still stops publication.

## Preliminary full-range projection

June through September contains 122 UTC days and 11,712 scheduled windows.
Scaling only the original June baseline gives **63.6 hours and 10.0 GiB of
Parquet**, plus temporary workspace and retained generations. This is a deliberately
labeled baseline extrapolation, not the estimate for the optimized downloader.

The subsequent fresh August result below supplies the optimized estimate.
July 1 resumed after the empty-market investigation, so its elapsed time must
not be presented as an uninterrupted fresh benchmark.

## Accounting version 5 follow-up

Both published days were rebuilt offline and again passed file/SQL verification.
The new classification distinguishes the narrowly verified fee-exclusive native
OPEN basis and an untraded losing token omitted by legacy combined redemption.
It does not change the locally calculated cash amounts.

| Day | Complete wallet/market pairs | Unresolved pairs | Parquet bytes |
| --- | ---: | ---: | ---: |
| June 1 | 58,248 | 732 | 88,053,108 |
| July 1 | 49,868 | 492 | 67,022,595 |

The version 5 strict daily rankings exclude 221 of 5,232 June wallets and 134
of 4,222 July wallets.

The initial June measurements and version 4 counts above remain as the historical
baseline. July used saved trade pages on resume: its completed wallet phase took
495 seconds and its resumed process made 11,151 requests with two retries.
August 1 measured the optimized path with 16 workers and a 60-rps shared ceiling;
separate endpoint ceilings still apply.

## Fresh optimized August benchmark and backfill start

August 1 completed in **409.844 seconds (6.83 minutes)** with 9,325 requests,
13 retries, 275,291 trades, 302,757 activities and 3,335 wallets. Its Parquet size
is **49,952,243 bytes (47.64 MiB)**; observed peak working disk is 612,477,618 bytes.
All 96 windows and independent file/SQL checks passed. Accounting version 5 has
38,179 complete and 347 unresolved wallet/market pairs. First-query latencies
were 9.42 ms for the trade scan, 5.47 ms for ranking and 18.69 ms for the timeline;
dataset open took 22.52 ms, again without flushing the OS cache.

The fresh August timing extrapolates to 13.9 hours for 122 equal-volume days.
June's observed wallet-batch count was 6,743 versus August's 4,341 (1.55 times as
many). Scaling for that higher workload gives a planning upper value near 21.6
hours. Use **14–22 hours** as the initial planning range, not a confidence interval
or a promise. The compressed-size samples imply **6–10 GiB**, plus up to about
1 GiB observed temporary working space and retained generations. June's original
31-minute result used a different downloader configuration and a larger dataset.

Free disk before launch was 26,111,242,240 bytes (24.3 GiB), sufficient for the
sample-based high estimate plus the 5 GiB reserve. The full June–September sync
started on 2026-10-04 using 16 workers and the 60-rps shared ceiling. Existing
June 1, July 1 and August 1 snapshots are reused. The disk guard remains active.
The full backfill and full-month research demonstrations are not complete yet.
