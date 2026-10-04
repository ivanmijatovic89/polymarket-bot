---
title: Recorder v3 storage optimization
description: Lossless Parquet compaction measurements and remaining WebSocket reliability work.
---

# Recorder v3 storage optimization

Measured on 2026-10-05 using two archived worker-2 recordings. These are individual benchmark files, not new long-term averages. Production worker-2 remains pinned to its existing release until a separate deployment; existing R2 objects are unchanged.

## Findings and compatible change

The original v3 files already used Parquet with GZIP for every column except the constant `schema_version` integer. The envelope has typed receipt times, sequence numbers, and source/connection identifiers; each exact provider message remains a string in `raw_json`. It is not a fully decomposed columnar representation of order-book changes.

The original writer used 512-row groups and emitted statistics for opaque JSON strings. In `@dsnp/parquetjs`, those statistics duplicate minimum/maximum strings in data-page headers, column metadata/indexes, and the footer. They do not help the recorder's sequential replay. Small groups also repeat metadata and shorten each compression batch.

The compatible change:

- Compresses `schema_version` with GZIP.
- Disables statistics for `raw_json` and `details_json`; other column statistics remain.
- Raises the default row limit from 512 to 4096 while retaining the existing estimated 4 MiB input-byte flush threshold. A single large row can exceed that threshold, as before.
- Retains the isolated conversion process and its 512 MiB JavaScript heap limit. That heap limit is not a total RSS limit.

No rows, JSON fields, decimal digits, raw-message formatting, receipt timestamps, sequence numbers, or source identities are removed or rounded. Each market still has one self-contained Parquet. Shared-feed duplication between overlapping markets is unchanged. Existing v3 readers can read the new physical layout without a schema migration.

## Measured files

MB below means 1,000,000 bytes. The optimized sizes come from the actual production builder, including its normal metadata, after reconstructing a checksummed journal from each original file.

| Recording | Rows | Original | Optimized GZIP | Reduction |
| --- | ---: | ---: | ---: | ---: |
| `btc-updown-5m-1791151800` | 240,595 | 22.244 MB | 16.423 MB | 26.2% |
| `btc-updown-15m-1791153900` | 409,674 | 39.338 MB | 28.038 MB | 28.7% |

Original Parquet SHA-256:

- 5m: `6b5f768539d58f6b0a17ada8ba1883c61c3cf6e5c261b36942d3948d586ac4cd`
- 15m: `55a337cea5fadf4e0cee9da54fb02e666b0f4efe8978892f99a18b1797d41915`

Every decoded envelope was compared in physical file order using the unchanged recorder reader. The original and rebuilt ordered event hashes matched:

- 5m: `f4f3066f5fb21ebe993fb0d472bdaf802a34c1550f6688e1d397c0e50c21416a`
- 15m: `b694c27e5b3efb59c48782516683b9be75e130043fc603579b32fc13d331f034`

The actual `runSingleMarket` backtest runner then replayed each original and rebuilt file with all external feeds enabled. Hashes included every strategy tick, order-book snapshot, receipt sequence/time, and tick-scoped feed snapshot, excluding only the local input path. Both pairs matched:

| Recording | Admission mode | Strategy callbacks per file | Tick/feed SHA-256 |
| --- | --- | ---: | --- |
| 5m | Ordinary | 183,027 | `b4d6e724fe042964431d09b81d8335bbc42762df762fdb89cf6a07685409c79f` |
| 15m | Explicit outage replay | 321,831 | `8dbc9e1f6656a9e508d6835cbbfa8ade87284a02497057956bc7312d2be61b5e` |

The 15m source has a previously recorded gap; compaction does not make it eligible for ordinary backtests. The observer places no orders. Replay ran with network access, environment-file reads, and live execution imports blocked. All 182 recorder tests passed, including large integer/raw-string round trips, byte-bounded grouping, public close-reason capture, reconnect counter resets, and authenticated close-text exclusion. TypeScript and ESLint passed.

Build times on the control Mac were approximately 8.7 seconds and 13.2 seconds. Separate Node 20 processes capped at a 512 MiB heap reported lifetime peak RSS of about 153 MiB and 175 MiB, including journal reconstruction and read-back verification. These are bounded local measurements, not a guarantee under every market workload or a new worker-2 resource measurement.

For comparison, a DuckDB Zstandard level-9 rewrite of the same 13 columns produced 13.479 MB and 24.237 MB. SQL comparisons found no differing rows. This experiment is **not the deployed writer or a replay-compatible release**: the existing `@dsnp/parquetjs` reader does not implement Zstandard. Adopting that codec requires reader compatibility and ordering/memory validation, not just a compression flag. See [DuckDB Parquet options](https://duckdb.org/docs/stable/sql/statements/copy.html#parquet-options).

The largest payload is Polymarket data. In these files it accounts for approximately 94% and 93% of uncompressed raw JSON bytes. The 5m sample contains 174,329 `price_change` messages; the 15m sample contains 313,142. Further reductions could come from a reversible typed payload layout and better encoding, but must preserve unknown fields, exact decimal strings, message boundaries, and forward compatibility. Dropping events, downsampling, or rounding prices is not a storage optimization compatible with this recorder's contract.

## Disconnect evidence and next experiment

Both Macs used for the previous diagnostic tests share the same internet connection. Their matching `1013` / `slow consumer: send buffer full` closes do not isolate the internet path from the Polymarket service. The minimal diagnostic clients did not run the recorder's persistence or strategy code, which makes recorder processing alone an insufficient explanation.

The transport now retains the public Polymarket peer's close reason plus message-frame and payload-byte counts for that connection. Counters reset on reconnect. Payload bytes are measured at the WebSocket message callback, not as TCP/TLS wire bytes. Authenticated-provider close text is not added to these diagnostics. These additions improve evidence; they do not prevent disconnects or change gap admission.

A useful controlled comparison needs the same subscriptions and overlapping observation period on a host using an independent internet path, together with event-loop/CPU measurements. A second machine behind the same router is not that control. Additional mitigations worth testing are shorter advance subscriptions and splitting market subscriptions across sockets. Keep both current market durations, opening snapshots, lifecycle evidence, connection-scoped gap handling, and one global receipt sequence. A short period without a disconnect does not establish a fix.

A new two-minute attribution probe at 23:46:30–23:48:30 UTC on October 4 reproduced code 1013 with the same close reason. It received approximately 91.1 MB of JSON payloads; only 0.352% belonged to upcoming markets. Thus shorter advance subscriptions are unlikely to remove much traffic in that observed workload. The probe used about 6.3 CPU seconds across 120 wall-clock seconds, with event-loop delay p99 of 13.9 ms and a process-wide maximum of 99.4 ms. That process-wide maximum is not a measurement at the precise close instant. The probe was stopped and did not modify production subscriptions.
