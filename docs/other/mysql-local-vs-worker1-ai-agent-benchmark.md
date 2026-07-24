---
title: MySQL Local vs Worker1 Benchmark
description: Measured latency and query-design guidance for AI research agents accessing MySQL on Worker1.
---

# MySQL Local vs Worker1 Benchmark for AI Agents

This document records the 2026-07-23 benchmark used to decide whether AI
research agents should query MySQL on the main MacBook or on the always-on
Worker1 Mac mini.

## Decision

Use **Worker1 as the MySQL host**.

From the main MacBook on the home network, Worker1 adds about **6 ms** to a
small query and about **2 ms** to a moderate aggregate. In exchange, the M4 Mac
mini executes the tested million-row analytical queries **44–46% faster** than
the local M1 Pro MacBook.

The meaningful downside is bulk transfer: returning a measured 9.98 MiB result
to the MacBook took a median **454 ms** from Worker1 versus **90 ms** locally.
Agents should therefore push filtering and aggregation into MySQL and return
compact results.

## Test environment

| Component | Main MacBook | Worker1 |
| --- | --- | --- |
| Hardware | MacBook Pro, M1 Pro, 10 cores, 16 GB | Mac mini, M4, 10 cores, 16 GB |
| MySQL | 8.4.7 | 8.4.10 |
| Access from benchmark process | `127.0.0.1:3306` | Tailscale address, port 3306 |
| Database | `polymarket_bot` | `polymarket_bot` |

Both databases contained the same migrated history. Worker1 additionally held
the newly completed run 827 (981 market rows), a difference below 0.1% of the
million-row table. Queries scoped to run 826 used exactly 981 identical rows on
both databases.

The home test used a direct Tailscale LAN path. `tailscale ping` reported 6 ms;
ten ICMP samples ranged from 4.99 to 30.91 ms with an 11.17 ms average.

## Method

- Client: Node.js 20 with `mysql2/promise`.
- Both endpoints were queried from the same MacBook process.
- Persistent connections were used for query tests.
- Each query was warmed once on both servers before timing.
- Endpoint order alternated on every repetition to reduce ordering bias.
- Reported values are medians; p95 is included to show network/Wi-Fi jitter.
- Connection setup used 20 repetitions.
- Trivial and indexed point queries used 100 repetitions each.
- Small aggregate and top-50 queries used 20 repetitions each.
- Million-row scans and result-fetch tests used 5–7 repetitions.
- Result size is the measured UTF-8 size of the rows serialized to JSON. It is
  an application-level approximation, not the exact MySQL wire size.

## Home-network results

All durations are end-to-end from the MacBook, including MySQL execution,
network transfer, and `mysql2` result parsing.

| Query | Local median | Worker1 median | Local p95 | Worker1 p95 | Worker1 impact |
| --- | ---: | ---: | ---: | ---: | --- |
| New connection + `SELECT 1` | 5.24 ms | 27.76 ms | 20.08 ms | 121.10 ms | 22.52 ms slower |
| Persistent connection, `SELECT 1` | 0.67 ms | 6.57 ms | 1.55 ms | 16.24 ms | 5.90 ms slower |
| Indexed point lookup | 0.84 ms | 6.95 ms | 3.15 ms | 48.12 ms | 6.11 ms slower |
| Aggregate over one 981-row run | 9.04 ms | 10.77 ms | 15.47 ms | 16.29 ms | 1.73 ms slower |
| Indexed top 50 | 1.90 ms | 7.42 ms | 6.47 ms | 18.05 ms | 5.52 ms slower |
| Group by machine over about 1M rows | 1,789.10 ms | 967.41 ms | 1,798.31 ms | 1,012.62 ms | **821.69 ms faster** |
| Join and group by strategy over about 1M rows | 1,685.95 ms | 946.88 ms | 1,694.54 ms | 959.94 ms | **739.07 ms faster** |
| Fetch 5,000 rich rows (0.91 MiB) | 21.01 ms | 44.94 ms | 24.05 ms | 81.76 ms | 23.93 ms slower |
| Fetch 33,500 rich rows (9.98 MiB) | 89.90 ms | 454.19 ms | 106.18 ms | 517.26 ms | 364.29 ms slower |

The 9.98 MiB query selected `intent_meta` and `events_by_type` in addition to
ordinary scalar columns, making it representative of a research agent pulling
rich per-market records.

## Offsite observation

An earlier test from a café used a direct Tailscale internet path with 25.72 ms
average ICMP latency. It is not the primary decision baseline, but it shows what
happens when the MacBook is away from Worker1:

| Query | Worker1 median from café |
| --- | ---: |
| New connection + `SELECT 1` | 131.63 ms |
| Persistent connection, `SELECT 1` | 19.11 ms |
| Indexed point lookup | 20.58 ms |
| Aggregate over one 981-row run | 22.35 ms |
| Indexed top 50 | 21.38 ms |
| Group by machine over about 1M rows | 1,005.49 ms |
| Join and group by strategy over about 1M rows | 972.60 ms |
| Fetch 5,000 rich rows (0.91 MiB) | 201.46 ms |

Heavy server-side queries changed little offsite because Worker1's CPU remained
the dominant cost. Small queries, connection setup, and result transfer were
more sensitive to network latency.

## Query contract for AI research agents

Agents with database access should follow these rules:

1. **Use a bounded connection pool.** Do not open a new MySQL connection for
   every tool call or query. At home, connection setup added 22.52 ms at the
   median and showed substantially more p95 jitter than a reused connection.
2. **Avoid N+1 query patterns.** One hundred sequential indexed lookups would
   accumulate roughly 695 ms at Worker1's median versus about 84 ms locally.
   Fetch the required rows with one set-based query instead.
3. **Push computation to MySQL.** Prefer `WHERE`, `JOIN`, `GROUP BY`, `COUNT`,
   `SUM`, and `AVG` on Worker1 over downloading raw rows and computing locally.
   This is where Worker1 produced the largest performance gain.
4. **Keep ordinary responses below about 1 MiB.** The measured 0.91 MiB result
   added only about 24 ms at home. A 9.98 MiB response added about 364 ms and
   had a 517 ms p95.
5. **Use indexed, cursor-based pagination for bulk exploration.** Require an
   explicit `LIMIT`; continue by indexed ID or timestamp rather than using
   large offsets or returning an entire table.
6. **Move truly bulk analysis to the data.** For repeated 10–100 MiB scans,
   execute the analysis process on Worker1 or produce one intentional export
   instead of repeatedly transferring raw rows to the MacBook.
7. **Expect occasional network outliers.** Median home latency was low, but
   Wi-Fi/Tailscale spikes raised p95 for some tiny queries. Retries must be
   idempotent and should target transient connection failures, not slow SQL.

LLM inference normally takes far longer than the approximately 6 ms added to a
small home-network query. For agent workflows, query shape and result size are
more important than the physical database location.

## Limitations

- This was a warm-cache benchmark, representative of a long-running database.
- It did not measure many agents issuing concurrent queries under backtest load.
- The two servers intentionally use different hardware, so this measures the
  real deployment decision rather than isolating network latency alone.
- MySQL patch versions differed (`8.4.7` and `8.4.10`).
- Home Wi-Fi conditions can change; p95 values should be treated as a snapshot.
- The test measured read queries only. Write latency and transaction contention
  were outside its scope.

Repeat the benchmark after major schema/index changes, significant database
growth, changes to the home network, or before raising the number of concurrent
research agents.
