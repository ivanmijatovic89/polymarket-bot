---
title: Recorder v3 storage optimization
description: Lossless Parquet compaction, direct typed replay benchmarks, and WebSocket reliability measurements.
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

A simultaneous six-minute comparison at 23:51:00–23:57:00 UTC used minimal count/discard clients on the control Mac. One socket subscribed to current/next 5m and 15m markets; two other sockets split the same target market set by duration. Discovery refreshed every 15 seconds and application PINGs were sent every 10 seconds.

| Connection | Peer closes | Received payload | Largest one-second payload sample |
| --- | ---: | ---: | ---: |
| Combined 5m + 15m | 5 | 241.98 MB | 1.97 MB |
| Separate 5m | 1 | 138.37 MB | 1.35 MB |
| Separate 15m | 0 | 111.00 MB | 1.01 MB |

All six peer closes were code 1013 with `slow consumer: send buffer full`. The separate 5m socket's close occurred during initial subscription. Process-wide event-loop delay was 14.6 ms at p99 and 50.4 ms maximum. Payload counts differ because subscriptions and reconnect snapshots arrive independently and gaps lose observations; these are not duplicate-delivery parity measurements.

Splitting sockets is therefore a promising candidate, not an established reliability fix. The short test added duplicate inbound traffic and shared the same host, router, and internet path; it does not identify the root cause or estimate a long-term failure rate. No production topology change was made. A production implementation must scope reconnect/invalid-book gaps to the affected socket's markets, preserve one global receipt sequence, validate both bootstrap/rotation paths, and retain conservative ordinary-backtest rejection. The diagnostic sockets were all stopped at the deadline.

## Typed-column experiment (not a recorder format change)

The follow-up experiment uses the same two archived recordings. It separates the six high-volume message shapes into nullable Parquet structs/lists in one mixed-feed file: Polymarket `price_change`, `book`, `best_bid_ask`, and `last_trade_price`, plus Binance `aggTrade` and `bookTicker`. Prices and quantities retain their exact decimal strings, safe integer fields use BIGINT, flags use BOOLEAN, and all receipt/sequence/identity fields remain. Unknown shapes, arrays, Chainlink messages, metadata, bootstrap, and control messages remain exact raw strings. A strict shape check prevents unknown fields from being discarded.

This covers 239,892 of 240,595 rows in the 5m sample and 407,566 of 409,674 rows in the 15m sample. The remaining 703 and 2,108 rows use the raw fallback. The experiment preserves parsed fields and values, array/frame boundaries, and ordering; it does **not** promise preservation of JSON whitespace or object-key ordering for typed rows.

The comparison below uses DuckDB for every variant, 8,192-row groups, bloom filters disabled, one thread, and Zstandard level 9 where applicable. Thus JSON-versus-typed differences do not include a switch of writer or row-group settings. These are sample sizes in decimal MB, not average future market sizes.

| Layout | 5m | 15m |
| --- | ---: | ---: |
| Existing JSON payload, GZIP | 16.37 | 28.04 |
| Typed payload, GZIP | 14.42 | 25.08 |
| Typed payload + binary price-change hashes, GZIP | 13.34 | 23.14 |
| Existing JSON payload, Zstandard | 13.48 | 24.24 |
| Typed payload, Zstandard | 12.89 | 22.52 |
| Typed payload + binary price-change hashes, Zstandard | 11.98 | 20.88 |

Typed columns alone save approximately 12%/11% with GZIP and 4%/7% with Zstandard. Adding reversible binary hashes increases those savings to approximately 18%/17% with GZIP and 11%/14% with Zstandard. The best experimental layout saves approximately 27%/26% against the compatible production-builder GZIP files (16.42/28.04 MB), or 46%/47% against the original pre-optimization archives (22.24/39.34 MB). It is not a 10–20× reduction against compressed Parquet.

Price-change hashes dominate the remaining data: even after binary encoding and Zstandard they occupy 6.83 MB and 12.46 MB, approximately 57% and 60% of each resulting file. They are retained rather than discarded. Merely removing repeated JSON key text cannot remove that payload; compression already handles much of the repeated syntax.

### Validation and migration implications

- Every experimental file was read back completely and compared in receive order across all 650,269 rows. Canonical hashes cover the envelope and every decoded payload field, including exact price/quantity strings and raw fallbacks. Both compression codecs and binary-hash variants matched.
- A scratch decoder reconstructed the typed Zstandard files into temporary compatible v3 packages, then the real `runSingleMarket` path replayed original and reconstructed packages with all six feed requests. The 5m sample matched 183,027 callbacks in ordinary mode; the already-incomplete 15m sample matched 321,831 callbacks in explicit outage mode. Tick order, book snapshots, and tick-scoped external-feed snapshots matched the original hashes reported above. Network calls, environment-file reads, and live-execution imports were blocked during replay. The observer emitted no orders; this validates replay parity, not fill-model behavior or a production typed reader.
- Lowercase 40-character hexadecimal price-change hashes were explicitly validated before binary conversion, and decoding restores the exact original string. Unsupported forms would require raw fallback in any future design.
- Binance uses case-sensitive field pairs (`b`/`B`, `a`/`A`, and `m`/`M`). DuckDB's case-insensitive struct naming initially renamed fields. Explicit reversible field-name mapping corrected this, and the full round-trip check then passed. A future schema should use unambiguous names such as `bid_price` and `bid_quantity` with an explicit provider-field mapping.
- This remains an isolated experiment. The recorder still writes its existing raw-JSON envelope schema; its CLI and readers have no typed-format mode. Zstandard support, typed decoding, unknown-field compatibility, schema versioning, crash recovery, resource limits, and archive/backtest integration would all need implementation and validation before adopting it.

The typed canonical SHA-256 values are `6173b5dfdd95c813ec6bd65c339730e2a6719b79186b66e155238d58bc89a0e1` (5m) and `8e8458c51d2e548c331fc0fa7dfda13d99b383530a8104366825b297a19dbee9` (15m). They are semantic hashes, not hashes of the original wire formatting or physical Parquet bytes.

## Implemented socket isolation and full-recorder follow-up

The recorder now owns one persistent Polymarket connection per configured timeframe. Each callback carries an immutable snapshot of that connection's market scope. Disconnects invalidate only those books; malformed frames reconnect only their originating connection. Recorder-wide clock failures still affect both sockets. Capture and replay share the scope predicate, and shutdown tail verification cannot use traffic from the other timeframe. One global capture sequence and the existing per-market Parquet schema remain unchanged. Dashboard health aggregates both sockets without hiding an outage behind traffic on the healthy socket.

Validation includes 187 recorder tests, TypeScript/ESLint, and the repository's CI checks. Regression tests cover scoped and global reconnects, subscription rotation/removal, malformed-frame capture and replay, pre-boundary bootstrap invalidation, shutdown-tail evidence, and dashboard health/reconnect accounting. The existing PONG watchdog test uses a controlled clock so host load cannot turn socket delivery into a 40 ms test race.

A local Node 20 full-recorder run started at 00:20:53 UTC on October 5, stopped capture at its configured 00:46:00 deadline, and finished draining at 00:46:15. It used the real six feeds and ordinary journal/Parquet conversion. Upload and dashboard publishing were disabled; worker-2's service continued unchanged on the shared internet connection. Closed journals were removed only after complete Parquet checksum/row/replay verification to bound the temporary no-upload spool; Parquet and metadata were retained for subsequent checks.

| Polymarket connection | Captured frames | Captured payload | Peer closes |
| --- | ---: | ---: | ---: |
| 5m | 754,062 | 495.26 MB | 4 |
| 15m | 562,936 | 354.65 MB | 1 |

All five closes were code 1013, `slow consumer: send buffer full`. Event-loop delay was 15.8 ms at p99 and 171.6 ms maximum. These are process scheduling measurements and decoded message payload sizes, not TCP throughput or end-to-end latency. Two public handshakes requesting `permessage-deflate` (default settings and client context takeover disabled) negotiated no extensions. No compression option was changed in production; negotiation is necessary for the [`ws` compression extension](https://github.com/websockets/ws#websocket-compression) to take effect.

The four fully observed 5m windows included one with three Polymarket gaps and three with zero gaps. The fully observed 15m window had one Polymarket gap. Startup and interrupted final windows were correctly incomplete. In particular, `btc-updown-5m-1791160200` remained complete while its overlapping 15m socket disconnected at 00:33:15. Independent sockets therefore preserved usable 5m coverage that an all-market reset would have invalidated.

The complete 5m file entered ordinary `runSingleMarket` replay with all feed requests and produced 171,653 observer callbacks. Its official outcome was initially pending, then the recorder observed **Down**; repeating replay with that later resolution retained the identical tick/feed hash. The observer submitted no orders. Outcome availability changes terminal statistics, not recorded tick visibility.

All nine finalized packages passed checksum, row/sequence, feed, scoped-control, and replay verification across 1,654,763 rows. The gapped full 15m file was rejected in ordinary mode before any strategy callback (`incomplete_capture`); explicit outage replay processed 261,311 callbacks with all feed snapshots. Its official outcome was still pending at that check, so terminal outcome statistics were withheld. This verifies conservative admission as well as the ability to inspect a captured outage.

This run does not establish a reduction in long-term disconnect frequency or identify a root cause. The late overlap with worker-2 was quiet on both configurations, and the hosts share a router/ISP; the older service and new recorder were also running on different hosts with different workloads. The implemented benefit is failure isolation. A controlled comparison on an independent network remains necessary to separate network-path effects from upstream buffering. The test exited with `duration_complete`; worker-2's pinned release and R2 objects were not changed.

## Direct replay speed experiment

The earlier typed round-trip established correctness but did **not** measure typed-reader speed: it reconstructed the old schema before running a backtest. This follow-up reads the experimental typed files directly. It does not add a production format, reader, or CLI mode.

The benchmark uses source revision `8076b55ff4849f10e3f844e73695c360648f8aef`, Node 20.19.6, and a 10-core Apple M1 Pro with 16 GiB RAM, running macOS 27.0.1. Results are local measurements on the control Mac, not worker-2 M4 timings. Each case has one discarded warm-up and three measured fresh Node processes, run sequentially with alternating case order. Files are already local and the operating-system cache is warm. The timed interval is the complete `runSingleMarket` call, including normal file integrity checks, feed loading, admission checks, replay, and terminal statistics. Process startup, downloads, conversion, and the separate expensive parity hashing pass are excluded.

A no-order observer strategy requests the feeds, reads their tick-scoped snapshots, and counts callbacks through the actual `StrategyRunner`/backtest pipeline. It does not estimate the runtime of a particular trading strategy or exercise fill performance. `no_activity` is the expected terminal result because the observer places no orders; every timed run must produce callbacks and observe Binance prices, Chainlink spot, and price-to-beat. All-feed cases additionally require observed Binance quotes and Chainlink TWAP. Replay blocks network connections, environment-file reads, and live-execution imports.

Two feed configurations distinguish costs:

- **Common feeds:** Binance aggregate trades, Chainlink spot, and website price-to-beat. Binance and Chainlink updates generate synthetic strategy ticks in both historical and recorder modes.
- **All recorder feeds:** also request Binance best bid/ask and Chainlink TWAP, and select the captured opening TWAP as price-to-beat. This invokes the existing full-file opening-reference preflight before replay. The same six captured sources remain in the file in either configuration; common mode does not remove stored events.

An isolated source copy replaces only the recorder reader and the handoff of decoded payloads. The typed reader uses DuckDB with one thread, a 512 MiB database memory limit, and preserved insertion order. It decodes the reversible field names and safe integers, and restores binary hashes exactly. Validated market messages pass directly to the unchanged engine application loop, retaining frame ordering, bootstrap behavior, snapshots, and strategy dispatch. This avoids a typed-to-JSON-to-object round trip. JSON controls use the same DuckDB reader with and without that decoded handoff; additional controls keep the existing Parquet reader. The experimental database memory limit is not a process RSS cap.

Separate full replay checks compared every strategy tick, book snapshot, receipt sequence/time, and feed snapshot, normalizing only the input file path and JSON object-key order. The 15m native JSON, direct typed Zstandard, binary-hash typed Zstandard, and existing-reader decoded-handoff control all matched `d6d21f0d044e9b319ea30afc66bf186f9deffc6e179b5457b14adc5f27d4fe99` across 321,831 callbacks. The 5m native JSON and direct typed/binary-hash Zstandard pair matched `fc015c3d28f22c70b18ba07c100fea87c76402776fa6dcb0f091602386600027` across 183,027 callbacks. These differ from the earlier hashes because the new check canonicalizes object keys. Full row-level semantic checks also passed again for every generated codec/hash variant. The known-gapped 15m sample still requires explicit outage replay; the 5m sample uses ordinary admission.

### Identical recordings, all feeds

Times are median seconds, with the three-run minimum–maximum in parentheses. The JSON baseline is the compatible production builder's optimized GZIP output, not the older worker-2 physical layout. The typed candidate includes Zstandard level 9, binary price-change hashes, and direct decoded-message handoff.

| Recording | Strategy callbacks | Optimized JSON replay | Typed replay | Typed elapsed-time increase | JSON → typed size |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5m | 183,027 | 10.55 (10.51–10.70) | 13.88 (13.83–13.94) | 31.5% | 16.42 → 11.98 MB |
| 15m | 321,831 | 18.05 (18.01–18.16) | 23.48 (23.45–23.61) | 30.1% | 28.04 → 20.88 MB |

The candidate saves 27.0%/25.5% of bytes but increases runtime in this workload. Median lifetime peak RSS rises from approximately 326 to 461 MiB for 5m and 351 to 499 MiB for 15m. These are benchmark-process peaks, including imports, not recorder-service memory measurements.

The instrumented reader accounts for approximately 1.91 versus 7.30 seconds in the 5m case and 3.23 versus 11.94 seconds in the 15m case, summed across opening-reference preflight and replay. That interval includes decompression, conversion to JavaScript values, envelope/payload construction, and iteration; it is not pure disk I/O. Avoiding redundant market-message JSON conversion recovers some time downstream, but does not offset the typed reader's extra cost here.

### Reader, codec, and decoder controls

The following cases replay the same 15m file's 321,831 callbacks with the common-feed configuration. DuckDB-written files all use the same 8,192-row grouping and codec settings as the size experiment.

| Layout and reader | Decoded-message handoff | Median seconds | Three-run range |
| --- | --- | ---: | ---: |
| Optimized JSON/GZIP, existing reader | No | 11.90 | 11.78–12.06 |
| JSON/GZIP, DuckDB reader | No | 12.55 | 12.42–13.17 |
| JSON/Zstandard, DuckDB reader | No | 12.62 | 12.36–13.06 |
| JSON/Zstandard, DuckDB reader | Yes | 9.67 | 9.65–9.82 |
| Typed/Zstandard, DuckDB reader | Yes | 12.94 | 12.93–13.08 |
| Typed + binary hashes/Zstandard, DuckDB reader | Yes | 12.90 | 12.83–13.00 |

The typed/binary candidate takes 8.4% longer than the optimized JSON baseline in common-feed mode. Comparing the same DuckDB reader, Zstandard codec, and decoded handoff, typed columns take approximately 34% longer than JSON in this prototype. The faster JSON control demonstrates that decoder changes and file-format changes must be evaluated separately. Merely replacing the reader or compression codec did not improve replay speed in these runs.

This is evidence about the tested nested layout and JavaScript adapter, not a claim that every typed Parquet design is slower. A different column layout, conversion API, projection strategy, or decoder could perform differently and needs its own measurements. The experiment has not established a production implementation that combines the measured storage saving with a replay speed improvement.

Follow-up controls retained both the optimized JSON file and the existing reader, changing only the engine's handoff of messages that had already been decoded and validated. Common-feed replay took 9.18 seconds (9.10–9.21), approximately 23% less time than the 11.90-second baseline. All-feed replay took 15.38 seconds (15.30–15.43), approximately 15% less than 18.05 seconds. These controls were a separate subsequent batch with the same warm-up/repetition procedure. They remain experiments, not shipped replay changes. They identify useful work that does not require rewriting archives.

The original pre-compaction 15m archive was also replayed with all feeds: 18.47 seconds (18.38–18.57). Thus the compatible writer optimization has a substantial storage benefit, but its wall-time improvement in this particular workload is only about 2%. Comparing the typed candidate to that older physical file still shows a runtime regression.

### Historical markets from April 3–September 10, 2026

Selection inspected footers from 1,189 local BTC 15m files distributed across the requested interval, then counted in-window Polymarket rows for 27 candidates with 315,796–650,000 total rows. Matching on whole-file row counts alone is misleading: some historical files contain substantial pre-window history. Selected markets had local Binance and Chainlink day files, backfilled website price-to-beat, and usable Binance/Chainlink coverage flags in the catalog. Catalog retrieval used a read-only transaction; the benchmark processes used saved metadata and performed no database reads or writes.

Both historical cases use the normal `telonex-delta` path, its strategy-window gate, modeled feed latencies, and synthetic feed ticks. All cases below request the same common-feed configuration. The first historical market closely matches in-window Polymarket tick count; the second is closer in total strategy callbacks after feed ticks are added.

| Input | In-window Polymarket ticks | Strategy callbacks including feed ticks | Median seconds | Seconds per 100,000 callbacks |
| --- | ---: | ---: | ---: | ---: |
| Historical June 4, `btc-updown-15m-1780533000` | 312,571 | 375,246 | 5.61 | 1.49 |
| Historical August 25, `btc-updown-15m-1787672700` | 324,880 | 338,887 | 5.43 | 1.60 |
| Recorder v3 optimized JSON, `btc-updown-15m-1791153900` | 315,796 | 321,831 | 11.90 | 3.70 |
| Same recorder data, typed/binary Zstandard prototype | 315,796 | 321,831 | 12.90 | 4.01 |

Historical three-run ranges were 5.59–5.65 seconds and 5.42–5.46 seconds. Every run observed actual Binance prices, Chainlink spot points, and price-to-beat at strategy callbacks. The August sample has approximately 2.9% more in-window Polymarket ticks and 5.3% more total callbacks than the recorder sample. It nevertheless replays faster. On a per-callback basis, optimized recorder replay takes approximately 2.3–2.5 times as long as these historical examples.

This is a workload comparison, not a controlled format-only comparison: the markets, book depths/change-array sizes, feed activity, and replay machinery differ. Historical delta files already have a compact typed market-event representation, load the common feeds separately, and model their visibility times. Recorder v3 processes additional captured message types, validates envelopes/frames, preserves observed receipt order and connection evidence, and binds captured feed state to ticks. Older data cannot supply the requested Binance best bid/ask and new Chainlink TWAP streams, so silently substituting those would invalidate the comparison. The historical files' market-only byte sizes are also not comparable to a self-contained recorder package.

### Recommendation

Keep the compatible optimized JSON Parquet format for now. The tested typed design reduces archive bytes by about 26–27%, but increases all-feed replay time by about 30–32% and peak benchmark memory by roughly 40%. It does not deliver the hoped-for speed improvement or a 10–20-fold storage reduction.

Prioritize profiling and removing redundant decoding in the shared engine path, and investigate the cost of the opening-reference preflight while retaining its checks. Any production change must preserve the same live/replay ordering, immutable tick-scoped feed visibility, gap rejection, and exact decimal values. Revisit typed storage when a concrete reader/layout demonstrates an acceptable combined storage, speed, memory, and migration tradeoff. This study changes documentation only; worker-2, R2 objects, the recorder schema, and production replay remain unchanged.
