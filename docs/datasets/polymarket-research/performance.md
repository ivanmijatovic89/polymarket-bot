---
title: Research Download Performance
description: Measured throughput, API budgets and future market-family capacity.
---

# Download performance

## Current limits

Checked against the [official rate-limit documentation](https://docs.polymarket.com/api-reference/rate-limits)
on October 6, 2026:

| Request family | Published limit per 10 seconds | Downloader cap per second |
| --- | --- | --- |
| All Data API v2 endpoints | 800 | 60 shared |
| Trades | 300 | 27 |
| Activity | 200 | 18 |
| Positions | 200 | 18 |
| Status | 100 | 9 |
| Gamma market listings | 300 | 27 |

The endpoint limits matter more than the shared ceiling for this workload.
Activity and positions made up 94.4% of September requests. Multiple market
families on the same IP share these budgets; separate processes do not create
additional allowance. Reports record request totals, retries, HTTP 429 responses,
server errors, network/response failures and downloaded bytes.

## Existing full-day measurements

Thirty fresh September days averaged **267.3 seconds (4.46 minutes)** and 7,743
requests per day at 16 workers and a shared 60 requests/second ceiling.
September 24–30 took **30.93 minutes combined**, with 53,657 requests. These are
saved independent-day runs, not a guarantee for every future week.

A four-run live comparison on October 6 used the same 512 wallet batches from
September 30. It issued 4,128 requests, all successful, with identical returned
rows. Sixteen workers took 33.369 and 30.058 seconds; 24 workers took 30.088 and
29.874 seconds. The later 16-worker run essentially matched 24 workers. The
busiest observed endpoint window had 179 requests in ten seconds, below 200.
Increasing workers alone did not establish a meaningful repeatable improvement,
so the normal setting remains 16.

Evidence: `logs/throughput-review-20261006/summary.json` and `conclusions.json`.

## Shared wallet batching

The saved September 24–30 workload had 24,674 daily wallet batches. Grouping each
wallet's conditions across the week produces 16,234 batches at the same
20-condition maximum: **34.2% fewer batches**. Pagination, response size, network
latency, local disk work and verification mean that this percentage is not itself
a running-time reduction.

The implementation bounds its in-memory cache, saves cursor pages on disk and
filters each combined result back into its original daily market cohort.
Unseen wallets/conditions fall back to ordinary fetching. Repeated genuine
activity rows remain repeated; raw source facts are not deduplicated.

A live comparison selected 200 wallets across the same seven historical days,
covering 707 daily wallet jobs. Both methods used 16 workers and the same endpoint
limits. Four runs in daily/combined/combined/daily order returned identical raw
fields and occurrence counts. Independent requests took 63.348 and 49.912 seconds;
combined requests took 50.831 and 43.767 seconds. Requests fell from 1,442 to 908
(**37.0% fewer**), with no retries, HTTP 429 responses or server errors. This is
a wallet-phase sample; API latency varied between runs, and the first run also
overlapped local dependency installation. It does not establish a fixed full-job
speedup. Evidence: `logs/nightly-finish-20261006/queue-comparison/summary.json`.

The full nightly-refresh measurement is recorded separately when validation
completes under `logs/nightly-finish-20261006/`.

## Future workload

BTC 15-minute has 96 scheduled markets per day. BTC 5-minute and ETH 5-minute each
have 288; ETH 15-minute has 96. All four together are **768 markets/day**, eight
times the present window count. Wallet overlap, trading volume and batching mean
neither an eightfold nor a fourfold runtime can be assumed. Enable and benchmark
additional families separately, using one shared limiter and separate data roots.

## Read measurements correctly

`research:benchmark` measures local queries and projects fresh independent-day
reports. It excludes resumed attempts and days using a shared update queue,
because a day's requests can also retrieve another day's wallet facts. Use the
whole update report for shared-queue timing.

`request_ms` sums request time across concurrent workers; it is not elapsed
wall-clock time. Retry counts include more than rate-limit responses. A resumed
attempt's duration does not include earlier attempts. OS disk caches are not
flushed by local query benchmarks.
