---
title: Recorder v3 storage optimization
description: Lossless Parquet compaction, replay CPU optimization, typed format benchmarks, and WebSocket reliability measurements.
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

This is evidence about the tested nested layout and JavaScript adapter, not a claim that every typed Parquet design is slower. A different column layout, conversion API, projection strategy, or decoder could perform differently and needs its own measurements. This nested-layout experiment did not establish a production implementation that combines the measured storage saving with a replay speed improvement. The later flat-layout follow-up below evaluates a different candidate.

Follow-up controls retained both the optimized JSON file and the existing reader, changing only the engine's handoff of messages that had already been decoded and validated. Common-feed replay took 9.18 seconds (9.10–9.21), approximately 23% less time than the 11.90-second baseline. All-feed replay took 15.38 seconds (15.30–15.43), approximately 15% less than 18.05 seconds. These controls were a separate subsequent batch with the same warm-up/repetition procedure. They were scratch experiments during the format study; the replay CPU optimization below implements the validated handoff without rewriting archives.

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

At this stage of the study, keep the compatible optimized JSON Parquet format. The tested nested typed design reduces archive bytes by about 26–27%, but increases all-feed replay time by about 30–32% and peak benchmark memory by roughly 40%. It does not deliver the hoped-for speed improvement or a 10–20-fold storage reduction.

Optimize the replay CPU path before considering a format migration. The follow-up below removes redundant decoding and simplifies defensive snapshot copying; the opening-reference preflight remains intact. Any production change must preserve the same live/replay ordering, immutable tick-scoped feed visibility, gap rejection, and exact decimal values. Revisit typed storage when a concrete reader/layout demonstrates an acceptable combined storage, speed, memory, and migration tradeoff. The format study changed documentation only. The compatible replay change below is a separate follow-up; it does not deploy worker-2 or rewrite R2 objects.


## Replay CPU optimization

The roughly 11.9-second recorder result versus 5.4 seconds for the August historical market implied about 2.2 times the elapsed time, or 54% less throughput, for the lightweight observer used here. It was a real replay overhead, not evidence that accurate receipt ordering necessarily requires that cost. It was also not a timing prediction for every strategy: strategies with substantial computation or execution simulation have additional costs in both modes.

### Where the time went

Node 20 CPU profiles found substantial work in repeated JSON conversion, frame inspection, and feed snapshot capture. Sampled Parquet/compression work was similar between the common-feed recorder and historical cases. The profile includes imports and native work may be attributed to the calling JavaScript function; sampled categories are diagnostic evidence, not an exact additive wall-time breakdown.

A separate instrumented replay counted 1,045,692 `JSON.parse` calls, 634,289 `JSON.stringify` calls, and 645,514 `structuredClone` calls for the 321,831-callback 15m common-feed case. After the runtime change the counts fall to 411,447 parses, 44 serializations, and 1,852 general-purpose clones. The two per-tick defensive copies still occur through the specialized copier. Wrapping these functions perturbs performance, so these counts must not be treated as timings from the uninstrumented benchmark.

The recorder previously parsed a market frame for validation, serialized the validated messages for `MarketEngine`, parsed that frame again, and serialized/parsed each child once more. Historical typed replay already constructs messages directly. The dispatcher and external-feed plugin also each detached a snapshot for every strategy callback using the general-purpose structured-clone serializer.

The compatible optimization:

- Adds `MarketEngine.handleDecoded` for frames the caller has already validated. Raw and decoded frames use the same queue, book application loop, bootstrap suppression, and callback ordering. The raw decoder also filters parsed children directly instead of serializing and parsing them again.
- Copies the recorder's known plain feed objects directly, including every nested opening-reference and RTDS price object. Both defensive copies remain: dispatcher snapshots and plugin snapshots retain independent ownership. No mutable snapshot is shared between strategy ticks.
- Lets a runtime supply that copier to `ExternalFeedsRequestPlugin.fulfill`. Other providers retain the existing general-purpose `structuredClone` default, including support for non-DTO snapshots. Strategy artifacts use the running checkout's shared plugin implementation.

Frame validation, strict receive sequence checks, file SHA-256 checks, market/token filtering, gap admission, and the full opening-reference preflight remain enabled. There is no schema change, event removal, precision reduction, new CLI flag, or archive conversion.

### Repeated measurements

The baseline is `53f58d1e806086c9d1cc3a1504222e3aa4caac70`, whose `src/` tree matches the earlier format-study revision. The candidate uses the runtime changes described above. Both read the same optimized GZIP files with the existing Parquet reader, with no experimental typed reader. This is a new benchmark batch: compare before and after within this table, rather than mixing timings from earlier batches.

The host, Node version, observer, feed configurations, and timed interval match the direct replay experiment above. Each of seven cases has one discarded warm-up and three measured fresh processes, run sequentially with alternating order: 28 backtests, of which 21 contribute to the medians. Correctness hashing and profiling are separate runs. No tests, builds, or other benchmark subprocesses run concurrently with the timed cases. Normal desktop activity is not disabled; the 5m cases show more wall-time variation.

Times are median seconds (minimum–maximum); memory is median lifetime peak process RSS.

| Workload | Before | After | Elapsed-time reduction | Peak RSS before → after |
| --- | ---: | ---: | ---: | ---: |
| 15m, common feeds | 11.43 (11.41–11.49) | 6.73 (6.70–6.83) | 41.2% | 342 → 360 MiB |
| 15m, all recorder feeds | 17.39 (17.36–17.94) | 9.67 (9.53–9.90) | 44.4% | 355 → 386 MiB |
| 5m, all recorder feeds | 10.36 (10.25–12.08) | 5.69 (5.65–6.41) | 45.0% | 348 → 356 MiB |

The August 25 historical common-feed control in this batch takes 5.50 seconds (5.50–5.58), with 338,887 callbacks versus the recorder's 321,831. The optimized recorder's 6.73 seconds is approximately 22% longer, or 18% less throughput, in this comparison. It is still not a format-only comparison: the actual markets, book activity, and visibility models differ. On a per-callback basis the figures are approximately 2.09 seconds versus 1.62 seconds per 100,000 callbacks.

A separate historical regression control alternates the old and updated runtimes on the same August file (one warm-up and three measured runs each). Median time is 5.56 → 5.57 seconds, a 0.3% increase, with ranges 5.50–5.72 and 5.57–5.96. This shows no material median regression in that workload, while the ranges retain the desktop-run variability. These eight runs are separate from the 28-run recorder comparison.

Median process CPU time also falls: 13.19 → 8.39 seconds for 15m common, 20.99 → 12.58 for 15m all, and 12.56 → 7.55 for 5m all. CPU time can exceed elapsed time because decompression uses background threads. The measured speed gain is therefore not merely a change in waiting time. Peak memory is slightly higher, including a roughly 31 MiB increase for the 15m all-feed case; this is a speed optimization, not a memory optimization.

All-feed replay still pays for the opening-reference preflight and larger feed snapshots. That preflight is absent from the common-feed 11.43 → 6.73 comparison, so it cannot explain that case's original slowdown. Further preflight or reader optimization remains possible, but must retain admission evidence and must never expose a final opening price to earlier ticks.

The archive sizes remain 16.423 MB for this 5m sample and 28.038 MB for this 15m sample. This runtime change does not deliver additional storage savings, and the historical market-only file size remains an invalid comparison to a self-contained package containing all feeds.


### Correctness and operational scope

Separate baseline/candidate runs hash every strategy tick, complete book snapshot, receipt sequence/time, and tick-scoped feed snapshot. Only the input path and object-key ordering are normalized. The counts and hashes match in all three configurations:

| Workload | Callbacks | Matching SHA-256 |
| --- | ---: | --- |
| 15m-common | 321,831 | `7227bede41e360d68ad4c43aaa836d50c6a360deb48e5d9501fc9f06f2b04650` |
| 15m-all | 321,831 | `d6d21f0d044e9b319ea30afc66bf186f9deffc6e179b5457b14adc5f27d4fe99` |
| 5m-all | 183,027 | `fc015c3d28f22c70b18ba07c100fea87c76402776fa6dcb0f091602386600027` |

The 15m sample still requires explicit outage replay; ordinary admission is used for 5m. The observer places no orders, so these hashes establish input-stream equivalence rather than fill-model performance. Replay runs block network connections, `.env` reads, and live-execution imports.

Local validation passes 193 recorder tests, 260 trading tests, four plugin tests, and 34 strategy-artifact tests, plus TypeScript and ESLint. New tests cover mixed raw/decoded frame queues, synchronous frame contiguity, bootstrap suppression, preserved message fields and child indices, and mutation isolation for every nested feed object. The complete feed fixture requires every optional schema field, so future snapshot additions must update its isolation coverage. The default plugin copier is also checked with `Map` and `Date` values.

This change is used by the backtest runtime when that checkout is updated. It leaves the running worker-2 recorder service, recorder installation, R2 objects, archive layout, and trading credentials untouched. No worker service is restarted as part of this investigation.


## Direct columnar reader and flat layout follow-up

This is a storage experiment against the runtime optimized in PR #283 (`d50421ea1e96acd730083f57bd4ad20aa2d377e6`). No application dependency, recorder writer, archive object, or deployed service changes in this follow-up.

The earlier nested typed design combined two costs: decoding Parquet and converting nested DuckDB results into JavaScript objects. The new experiment uses `hyparquet` 1.31.2 and `hyparquet-compressors` 1.1.2 installed only in a scratch directory. The reader handles one physical row group at a time, in file order, with Node's native GZIP decompressor for GZIP columns and the compressor package's Zstandard decoder. The library provides column callbacks that avoid constructing a full intermediate row object for every column; see the [Hyparquet reader documentation](https://github.com/hyparam/hyparquet#parquetread).

Initial 15m all-feed JSON probes took 9.58 seconds with the current reader, 8.22 with the direct reader on the same JSON/GZIP file, and 9.31 on JSON/Zstandard. These are single exploratory runs, not the repeated results below. Initial typed-reader results were discarded when the full equality check caught binary hashes being decoded as UTF-8. The corrected reader explicitly disables UTF-8 inference for unannotated binary columns; annotated string columns still decode as text. Row equivalence and callback equivalence are checked before repeating the timed study.

The second prototype flattens each recognized payload into scalar columns and parallel list columns. For example, price-change asset IDs, prices, quantities, sides, and hashes occupy corresponding list positions. It retains one row per captured envelope, explicit receive sequence/timestamps, exact decimal strings, message boundaries, and binary hashes. Unknown shapes and non-target messages retain their exact raw JSON fallback. Column callbacks populate a bounded row-group view, and the decoder constructs only the payload belonging to that row's kind. The shared market-frame validator, engine, feed reducers, strategy runner, and file-integrity check still run.

For the opening-reference preflight, the prototype projects only envelope and fallback-payload columns and forwards bootstrap, Chainlink, and website price observations to the unchanged tracker. All three reference sources remain in the fallback column in this layout; the reader rejects an incompatible typed reference payload. The full replay still reads every captured row and all payload columns. This avoids decoding the large order-book columns twice without injecting future reference data or bypassing the reference-admission decision.

Recognized typed messages preserve parsed fields and values, but do not preserve their original JSON whitespace, key ordering, or numeric spelling. Unknown shapes retain the original raw string. This remains a proposed versioned format, not a byte-for-byte replacement for the raw-message contract. JSON/GZIP reader-only controls preserve the original strings.

### Repeated timing and size comparison

All candidates replay the same two recorded markets with the same no-order observer. The original column uses the pre-CPU-optimization runtime (`53f58d1e`) and the original worker archive; the current column uses runtime `d50421ea` and its compatible optimized JSON/GZIP file. The prototype uses that same current runtime in an isolated source copy, changing the reader and decoded-payload handoff described above. The all-feed configuration requests both Binance streams, Chainlink spot, opening TWAP/reference data, and website PTB observations.

Each of ten cases has one discarded warm-up and three measured fresh Node 20 processes, run sequentially with alternating order. There are 40 backtests, with 30 contributing to the medians. The timed interval includes file integrity/admission, any applicable opening-reference preflight, replay, strategy callbacks, and result construction. It excludes process imports, preparation/downloads, and the expensive full-stream correctness hashing, which runs separately. No builds, tests, or other benchmark processes run concurrently with timed cases; ordinary desktop activity is not disabled. Sizes are decimal MB for the event Parquet alone; metadata sidecars are excluded consistently.

| Recording | Original archive/runtime | Current optimized JSON | Flat typed/Zstandard | Original → current → flat size | Current → flat peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5m, all feeds | 9.95 (9.89–10.13) | 5.51 (5.48–5.52) | 4.89 (4.89–4.98) | 22.24 → 16.42 → 11.84 MB | 360 → 451 MiB |
| 15m, all feeds | 17.05 (17.01–17.12) | 9.17 (9.14–9.40) | 8.13 (8.10–8.27) | 39.34 → 28.04 → 20.64 MB | 368 → 456 MiB |

Times are median seconds (three-run minimum–maximum). Memory is median lifetime peak process RSS, not a recorder-service measurement or a peak allocation limit.

| Additional 15m control | File size | Median seconds (range) | Peak RSS |
| --- | ---: | ---: | ---: |
| Same optimized JSON/GZIP, direct reader | 28.04 MB | 8.03 (7.99–8.13) | 377 MiB |
| Flat typed/GZIP, direct reader | 22.91 MB | 7.92 (7.84–7.96) | 452 MiB |
| Current JSON, common feeds | 28.04 MB | 6.35 (6.33–6.43) | 364 MiB |
| Flat typed/Zstandard, common feeds | 20.64 MB | 6.47 (6.41–6.52) | 429 MiB |

Relative to the current optimized JSON files, flat/Zstandard saves 27.9% of bytes for 5m and 26.4% for 15m, while reducing all-feed elapsed time by 11.2% and 11.3%. Compared with the original archive/runtime pair, file sizes fall by approximately 47% and elapsed time by approximately 51–52%. These are combined storage/runtime improvements, not compression-only speed gains.

The same-file reader control matters: merely reading the current JSON/GZIP file with the direct reader reduces 15m all-feed elapsed time by 12.5%, slightly outperforming flat/Zstandard without a format change. Flat/GZIP has the lowest measured median here, 7.92 seconds, but is only 0.11 seconds ahead of that reader control and its ranges nearly meet. It takes 11.0% more space than flat/Zstandard. Three desktop runs establish a candidate tradeoff, not a robust universal ranking between these close variants.

Common-feed replay does not share the full all-feed benefit. In the main batch, flat/Zstandard takes 6.47 versus 6.35 seconds for current JSON, a 1.8% increase. Its process CPU time rises from 7.93 to 8.81 seconds. All-feed CPU time falls from 12.19 to 11.14 seconds, partly because projected reference preflight avoids a second full payload decode. A claim that removing JSON speeds up every strategy would therefore be unsupported.

The historical comparison is repeated in a separate interleaved batch using the August 25 market and only the common feed configuration. Each of five cases has one discarded warm-up and three measured fresh processes (20 runs, 15 contributing to medians). Every replay observes Binance trades, Chainlink spot, and PTB. Historical feeds are read from their existing local day files; network and environment-file access remain blocked.

| Common-feed workload | Median seconds (range) | Strategy callbacks | Peak RSS |
| --- | ---: | ---: | ---: |
| Historical August market, current runtime | 5.29 (5.25–5.30) | 338,887 | 377 MiB |
| Recorder, current JSON reader | 6.42 (6.39–6.45) | 321,831 | 357 MiB |
| Recorder, same JSON file with direct reader | 5.92 (5.86–5.97) | 321,831 | 340 MiB |
| Recorder, flat/GZIP | 6.27 (6.27–6.39) | 321,831 | 437 MiB |
| Recorder, flat/Zstandard | 6.47 (6.47–6.53) | 321,831 | 432 MiB |

For this common-feed workload, the direct reader on the existing JSON file is the fastest recorder candidate, reducing elapsed time by 7.7% (6.42 → 5.92 seconds). It remains 12.0% slower than the historical market; flat/GZIP and flat/Zstandard remain 18.6% and 22.4% slower. The historical market has 338,887 callbacks versus 321,831 for the recorder. This is still a different-market workload comparison with different retained data and visibility models, not a controlled proof that one storage format costs those percentages.

### Why Telonex files are much smaller

The selected August historical market file is 4,675,167 bytes and the June file is 4,238,525 bytes. Those are market-only files; historical Binance and Chainlink data live in separate shared files, and PTB comes from metadata. They are not self-contained all-feed recorder packages.

There is also a material payload difference: historical typed replay reconstructs `hash`, `best_bid`, and `best_ask` as empty strings. The recorder retains those provider fields. In the nested binary-hash Zstandard prototype, the price-change hash column alone consumes 6,831,484 bytes for 5m and 12,462,981 bytes for 15m, approximately 57% and 60% of the respective files. Those hash bytes alone exceed the historical market file size. This explains much of the apparent storage gap without treating it as merely a JSON-formatting problem.

Omitting those fields might reduce storage further, but changes the retained data and requires a separate product decision. They are retained in every candidate here. Eliminating JSON parsing also does not eliminate decompression, Parquet decoding, validation, message construction, or strategy work.

### Equivalence and remaining work

Both flat files are checked against their original captured archives row by row, including the complete envelope and every parsed payload field. Raw fallback strings must match byte for byte. The 5m file contains 240,595 rows (239,892 typed and 703 fallback); 15m contains 409,674 rows (407,566 typed and 2,108 fallback). Neither event filtering nor downsampling contributes to the smaller files. Full opening-reference reports from the projected reader must equal the reports from the original full-file reader.

The row-stream semantic SHA-256 values are `ba42276f17400beb359cfaa42d63246fa919f509d101f8fe3002ef6c15704f5a` for 5m and `ebe45b0c90d6f1be2f9c11d2ea1d6d8e77a57a4d2bb71c94985f712ece6a076a` for 15m. These hash the envelope and canonical payload rather than the Parquet bytes. Independent full replay checks require the same callback counts and tick/feed hashes reported in the CPU-optimization section above, preserving the same path/key-order normalization. The reader-only JSON controls must also match the original 15m all-feed and common-feed hashes.

All row/envelope/fallback and opening-reference checks pass for both GZIP and Zstandard flat files. The corrected Zstandard candidate matches all three existing full tick/book/feed hashes, and the same-file JSON reader controls match the 15m all-feed and common-feed hashes. The 15m recording still uses explicit outage replay because of its captured gap; 5m uses ordinary admission. This verifies the observed samples, not every possible future message shape.

A separate instrumented 15m common-feed replay reduces `JSON.parse` calls from the optimized runtime's 411,447 to 3,881 (99.1% fewer), with 44 `JSON.stringify` and 1,852 generic `structuredClone` calls still present. Both defensive feed-snapshot copies remain. These counters come from instrumented runs, not the timing measurements. The small common-feed speed difference despite almost eliminating JSON parsing demonstrates that decompression, column decoding, object construction, and downstream work remain material.

A production implementation would need an explicit format version, strict decoding and unknown-shape fallback tests, compatibility with existing archives, crash/recovery and writer integration tests, broader market coverage, and an explicit decision about retaining parsed values rather than original JSON spelling. The scratch reader's benchmark-specific schema dispatch and generated decoders are not a production migration design. No source code or dependency change from this experiment is installed in the application, and worker-2 remains untouched.

### Recommendation after the follow-up

For speed, prioritize hardening and evaluating the direct reader with the existing JSON/GZIP archives. It improves both measured configurations without changing the retained raw-message contract, although a production reader replacement still needs compatibility, failure-handling, and broader-file tests. For archive size, flat columns plus binary hashes are a promising separate migration: Zstandard saves approximately 26–28% relative to current compact JSON and improves the all-feed workload, at the cost of more process memory and no common-feed speed improvement here. GZIP trades larger files for slightly faster replay.

These measurements do not establish a globally optimal format or justify a 10–20-fold reduction claim. For repeated strategy sweeps, a validated reusable decoded-data cache is another unmeasured option; it trades memory/local storage and invalidation complexity for avoiding repeated decoding. It would need archive-hash/version keys, isolated mutable strategy state, and the same timing/order and corruption checks. This study does not implement or claim a measured speedup for such a cache.

Keep the production format unchanged until those adoption choices are made. The evidence supports reader optimization for speed and an explicit storage/precision/raw-text contract decision for a typed migration, rather than choosing a format solely because it removes JSON parsing.

## SplitSellRedeem.v5 strategy benchmark

This follow-up replaces the no-order observer with the unchanged `src/strategies/split/SplitSellRedeem.v5.ts` strategy. Its source SHA-256 is `ede47d26753799dd535b116792dcd9856f5ada50607886c9e0ce7bc14b02bae5`, identical in the user's checkout and the benchmark worktree. The runtime is `68c952c7`, whose application source matches the preceding benchmark. Experimental readers remain confined to the isolated source copy; there is no production format or strategy change.

The strategy requests Binance spot and website PTB. It does not request Chainlink or synthetic feed-update ticks, and its trading decisions do not read external-feed prices: they use the order book, time-window gate, and dwell gate. Consequently, this is a real-strategy execution benchmark with the file's actual feed configuration, not a Binance-plus-Chainlink trading-signal benchmark.

Parameters are parsed from the strategy's defaults: split 10 shares, sell 10, bid-price dwell range 0.20–0.35 for 40 seconds, trading allowed from 240 through 600 seconds after market start. Both input modes use 500 USDC simulated starting capital, immediate intent handling, zero execution delay/jitter, and the existing `worst_queue` maker-fill model. Historical feed visibility keeps its existing modeled delays; recorder replay preserves captured arrival order. Strategy code, plugins, OrderManager, execution simulation, portfolio updates, and final-outcome valuation all run normally.

The same August Telonex market and October recorder market are used as above. The recorder sample still has a known gap and requires explicit outage replay; its results must not be treated as a clean production research sample. No settings are changed to force a trade or to bypass strategy gates.

| Input / reader | Parquet size | Median seconds (minimum–maximum) | Time versus Telonex | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Telonex reference | 4.68 MB | 5.16 (5.07–5.25) | Reference | 387 MiB |
| Recorder, current optimized JSON | 28.04 MB | 6.34 (6.31–6.40) | 22.9% longer | 351 MiB |
| Recorder, same JSON with direct reader | 28.04 MB | 5.85 (5.84–5.87) | 13.2% longer | 351 MiB |
| Recorder, flat typed/GZIP | 22.91 MB | 6.26 (6.26–6.39) | 21.3% longer | 448 MiB |
| Recorder, flat typed/Zstandard | 20.64 MB | 6.39 (6.37–6.41) | 23.9% longer | 446 MiB |

The direct reader reduces this strategy's recorder runtime by 7.8% relative to the current reader, but remains 13.2% slower than the historical example. Flat/GZIP reduces current-recorder runtime by only 1.3%; flat/Zstandard takes 0.8% longer. Their storage savings remain 18.3% and 26.4%, respectively. This actual-strategy test supports the earlier recommendation to prioritize the reader for speed; the typed layout primarily offers storage savings for this workload. Three repeats on one market per source do not establish fleet-wide throughput or isolate format cost from different market activity.

Timing uses one discarded warm-up and three measured fresh Node 20 processes per case, with five cases interleaved in alternating order. No diagnostic observer or correctness hashing runs inside the timed cases. The interval includes historical feed loading or recorder integrity/admission, replay, actual strategy and execution work, and final market statistics. Process imports, archive download/conversion, producer orchestration, and database/dashboard persistence are excluded. Correctness checks are separate from the 20 timing runs. No benchmark jobs or builds run concurrently with timed cases.

Both markets execute an initial 10-share split and one completed taker sell under the unchanged defaults. The historical case produces 324,880 strategy callbacks; the recorder produces 315,796. There are no synthetic feed-update callbacks in this strategy configuration. Binance snapshots are present at every strategy callback, and PTB is present at 323,814 historical callbacks and 315,668 recorder callbacks. No Chainlink price is requested or observed; the historical provider's empty RTDS container is not counted as Chainlink availability.

All four recorder variants produce identical strategy intents, ordered account events, fees, final positions, and final-outcome statistics. The message/source/timestamp hash is `c613b6ccb938e501453bc5ed425bae1dbe4507407b82a253d429307e047075ba`. The context, capital, decision, and account/portfolio trace hash is `e62460962195ac0f2d7c0ce3b4e32f740a643b514926b25b89bf35135a7dce55`; the final statistics hash, excluding execution timestamps, is `25b923b3126f2a06caa50ad323248521a6e65173709e972b24d1f1ee6071ed82`. These checks compare readers on the same recorder data, not outcomes across different markets. Regenerated input files also match the preceding study's byte sizes and SHA-256 values.

Final PnL is -7.73 USDC for the historical market and -7.63 for every recorder variant. Those values establish reproducibility of the tested outcomes, not profitability or economic equivalence between different markets. Every measured repetition must match its corresponding verification run's complete final statistics. Replays block network connections, environment-file reads, and live-execution imports.

The Telonex size column covers only its 4,675,167-byte Polymarket file. This strategy also reads the 12,409,568-byte Binance day file for August 25; that file is shared across the day's markets and queried for the required interval, so assigning its full size to one market would be misleading. PTB is supplied from saved market metadata. The recorder Parquet files contain all captured feeds, including those this strategy does not request. They are not equal-content storage comparisons. File sizes exclude small recorder metadata sidecars.
