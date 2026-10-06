# Complete local-path 1,000-market benchmark

Measured at 2026-10-06T19:46:28Z, with implementation commit `a40f99848bdbaebc048f89cebfef66e1b4a4af81`. The previous **7.19x** was for the smaller prototype and is superseded for this workload by the expanded local-path result below.

| Workers per engine      | Production TypeScript median | Expanded Rust median | Speedup   |
| ----------------------- | ---------------------------- | -------------------- | --------- |
| 8                       | 577.960 s                    | 103.346 s            | **5.59x** |
| Range across three runs | 548.004–580.580 s            | 92.741–103.460 s     |           |

Three alternating runs per engine, after fresh full-output parity. Timing includes original market and Binance/Chainlink file loading/preparation, the full local order/accounting path, context/diagnostic calculations, per-tick fill/split harvesting, market results, worker result collection/output and final batch/calendar/tail aggregation. No trace hashing or full diagnostic observer runs inside the timed passes. Logging output is suppressed in both engines, while normal trade diagnostic fields are still calculated.

## Correctness evidence

- Fresh actual production TypeScript and native traces matched **1,000 markets**, **196,834,457 replay events**, **3,758 decisions**, and **21,272 account events**.
- Full intents and metadata/reasons; all account events and complete portfolio snapshots; tick-scoped position/orderbook metrics; feed values plus source/receipt timestamps; final context; market execution identity/counts; complete market statistics; batch and all calendar/tail segments were compared.
- Portable differential cases: **162** order/execution/accounting/context scenarios, **5** batch/calendar fixtures, and **2,077** JavaScript decimal-formatting cases. These use the production TypeScript modules and the same native modules used by measured replay. They cover BUY/SELL, FOK/GTC/GTD, maker/taker, post-only, cancel scopes/latency, queued/synthetic boundaries, pending capital, split/merge, duplicate/late events and reused IDs.
- **15 Rust unit tests**, clippy with warnings denied, TypeScript harness typecheck, Python syntax and formatting passed. **172 existing production regression tests** passed.
- Only nondeterministic clock fields are normalized: per-market duration; execution start/finish/duration; batch/segment duration totals/average/union. Duration mathematics is tested with identical deterministic interval fixtures. Derived floats use an absolute tolerance of `1e-10`; order prices/sizes, quantities, clocks, IDs, counts and digest values remain exact.
- The full production TypeScript reference was generated for this expanded comparison. After a native snapshot correction, those reference files were reused only after validating TypeScript source, artifact, input, runtime and output hashes; corrected native traces were regenerated. No old prototype traces were used.
- Source, original input and native binary hashes remained unchanged through the run. Full provenance and timing samples are in [measurements-june-1000-full.json](measurements-june-1000-full.json).

## Interpretation and limits

This is an observed complete **local-path implementation comparison for the frozen v15 strategy and Telonex delta sample**, rather than a universal property of Rust. The new engine includes context/accounting/diagnostic work that the prior prototype skipped. Typed representations, cached snapshots and synchronous ordered execution preserve behavior without reproducing JavaScript allocation/promise overhead.

The sample is the same 1,000 eligible resolved June 2026 BTC 15-minute markets: June 1 00:00 UTC through June 12 11:30 UTC. Unchanged production eligibility excludes the same 101 upstream Chainlink outage windows. No extra input rows are silently dropped to improve timing.

Hardware: one Apple M1 Pro, 10 physical cores, 16 GiB memory; Node `v20.11.0`, `rustc 1.89.0 (29483883e 2025-08-04)`. Both use eight worker processes at nice 10; this is not CPU affinity, and TypeScript/Parquet dependencies may have background threads. Filesystem cache is warm and background user activity is not controlled. Load averages: start `[4.00439453125, 10.2373046875, 11.17578125]`, finish `[12.66357421875, 16.8583984375, 16.283203125]`. RSS values in the JSON are sums of individual worker peaks, not simultaneous whole-machine peak measurements.

The strategy artifact is `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8` from run 9657; parameters and all input settings are bound by the manifest SHA in the measurement JSON. Both engines use the same per-market xorshift32 seed `123456789` for 500 ± 20 ms execution latency. This controlled jitter sequence is reproducible; the original saved run's `Math.random` sequence cannot be recovered from its aggregate results. Feed latencies are Binance 110 ms, Chainlink 320 ms and price-to-beat 2700 ms.

Batch initial capital is 1,000; each independent market retains the frozen worker starting capital of 100. These are identical for both engines and are separate accounting concepts.

Queue/database/network/fleet orchestration is outside the user-selected scope. Other strategy artifacts, other plugin families, Recorder V4 and other replay formats have not been ported or timed. They are not instantiated by production for this selected workload either. This experiment does not claim a complete production replacement or four-device fleet speedup. A production migration must share one strategy/core between live and replay.

See [PARITY-SCOPE.md](PARITY-SCOPE.md) for the functional audit and reproduction commands. Changes and private strategy-derived experiment artifacts remain local to the isolated checkout; the main checkout and live engine were not modified.
