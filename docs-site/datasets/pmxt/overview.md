---
title: PMXT Overview
description: Overview of the PMXT Polymarket orderbook archive, covering v1 and v2 dataset versions, their date ranges, schema differences, and the overlap period.
---

# PMXT Overview

[PMXT](https://archive.pmxt.dev) publishes free hourly Parquet snapshots of Polymarket orderbook data, updated every hour. The archive is split into two versions — **v1** and **v2** — which differ in schema design, market coverage, and the CDN they are served from.

## Timeline

```
Feb 2026                    Apr 13          Apr 16         May 2026
    |                           |               |               |
v1  ├───────────────────────────┼───────────────┤
    |                           |   overlap     |
v2                              ├───────────────┼───────────────►  (ongoing)
    |                           |               |
    |← ─ ─ ~54 days (v1) ─ ─ ─►|               |
                                |← ~58h overlap►|
                                |← ─ ─ ─ ─ ─ v2 ongoing ─ ─ ─ ─►
```

## v1

| Property | Value |
|---|---|
| CDN | `r2.pmxt.dev` |
| Start | `2026-02-21T16` |
| End | `2026-04-16T05` |
| Duration | ~54 days |
| Files | 1 285 |

v1 recorded the Polymarket WebSocket market channel using a verbose string-based schema. The dataset ends on April 16, 2026, when PMXT migrated to v2.

## v2

| Property | Value |
|---|---|
| CDN | `r2v2.pmxt.dev` |
| Start | `2026-04-13T19` |
| End | ongoing |
| Duration | ~30 days at launch |
| Files | 736 (as of 2026-05-14, grows hourly) |

v2 was introduced because **Polymarket changed their WebSocket message format**, requiring a new ingestion pipeline. PMXT took the opportunity to redesign the schema and infrastructure:

- **Tighter schema** — fixed-size binary and decimal types instead of verbose string columns, reducing file size significantly.
- **Redundant exporters** — multiple ingestion nodes prevent data gaps from single-exporter failures.
- **Better compression** — ZSTD(9) with delta-encoding on monotonic integer columns and dictionary encoding on low-cardinality fields. Files range from 100–400 MB per hour.

Each file contains 16 columns. The first five are always populated; the remaining columns are event-type-specific.

## Overlap period

Both versions cover the window **`2026-04-13T19` → `2026-04-16T05`** (~58 hours / ~2.4 days). During this period the same Polymarket market events appear in both archives, but encoded in different schemas. If you are working near the boundary, use v2 — it has better coverage and the newer format.

::: tip Which version to use?
Use **v2** for any new work. v1 is only needed if you require data before `2026-04-13T19`.
:::

## File naming

Both versions use the same filename pattern:

```
polymarket_orderbook_YYYY-MM-DDTHH.parquet
```

Each file covers one UTC hour of orderbook events.

## Related

- [Sync Catalogue](/datasets/pmxt/sync-catalog) — populate the database with the full file list for v1 or v2.
- [Download & Convert v1](/datasets/pmxt/download-and-convert-v1) — run the conversion pipeline to produce native parquet files for backtesting.
- [Datasets Overview](/datasets/index) — comparison of all supported dataset sources.
- [Telonex Overview](/datasets/telonex/overview) — another third-party dataset source.
