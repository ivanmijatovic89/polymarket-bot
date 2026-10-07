# Final production-path audit

Audited on October 7, 2026 (Europe/Belgrade) against current production checkout commit `07245602d6ff9bca0dcdf772134cba3dd227526c`. The native binary and local engine sources are unchanged from the expanded benchmark implementation `a40f99848bdbaebc048f89cebfef66e1b4a4af81`.

The additional timing run started at `2026-10-07T03:09:45Z` (UTC); raw provenance retains UTC timestamps.

## Finding

No additional heavyweight calculation was identified as missing from the frozen v15, resolved BTC 15-minute, local Telonex delta replay path. The observed **5.59x** three-run median remains a valid measurement of that local batch workload. The new offline worker-boundary check below confirms that the benefit survives a concrete Node-to-Rust integration.

This does **not** certify a 5.59x submission-to-persisted-result improvement for the deployed queue/database/fleet. Those stages are real, identifiable work outside the measured local engine, and have not been timed here. The earlier conversational assurance should be read as local-engine confidence, not a promise of an exact production completion ratio.

## Additional executed check

The check calls the **actual current production `makeMarketProcessor`**, including its commit gate, hash-verified cached artifact loader, producer-field mapping and worker identity. TypeScript calls the current production `runSingleMarket`. The native branch uses the processor's existing `runMarket` injection seam and starts one release Rust process for each market, writes the request, waits for completion, parses its result and returns the full production job result envelope.

Orderbook depth is fixed at 10, matching the inspected local `.env`; the optional technical-indicator wait is disabled and absent from that local configuration. The job payload carries the original 500 ± 20 ms execution latency and original feed settings. The local ambient execution defaults are 140/0 ms; the benchmark uses the explicit job values, which the real processor forwards unchanged. Jobs with different settings or feed requests are a different workload.

The complete tick loop, strategy, external feeds and accounting remain inside Rust. There is no per-tick cross-language transport. Each job uses fresh simulation state. The same current production batch/segment functions process both branches' returned market results, preserving global job indices and input order.

These are **offline job envelopes**: no BullMQ Worker or Queue is constructed, and Redis/MySQL are not contacted. This exercises processor wiring and process handoff; it is not a deployed BullMQ transport or database persistence test.

| Check                                     | Current production TypeScript | Rust through current processor |
| ----------------------------------------- | ----------------------------- | ------------------------------ |
| 1,000 markets, eight worker processes     | 524.993 s                     | 95.162 s                       |
| Observed ratio in this single timing pair |                               | **5.52x**                      |

This is one additional timing pair, not a replacement repeated-run median. Original raw input files, parameters and reproducible per-market jitter are unchanged. Filesystem cache is warm, both run at nice 10, and background activity is uncontrolled. Load averages: start `[2.7470703125, 2.66650390625, 2.931640625]`, finish `[16.88427734375, 14.3505859375, 9.4775390625]`. Workers are processes rather than CPU-affinity limits.

- All **1,000** market statistics and event counters matched the previously hash-verified full production reference. Both new branches' complete job return values matched, including indices and skip reasons, with only elapsed-time fields normalized.
- Current batch and calendar/tail segment statistics matched. Derived floats use `1e-10` absolute tolerance, with the same exact execution-value rules as the full comparator.
- Current production source/artifact, experiment source, original inputs and binary hashes remained unchanged throughout the check. Sources and samples are retained in [measurements-worker-boundary-final.json](measurements-worker-boundary-final.json).
- The adapter's median per-job elapsed difference beyond the native batch timer was **6.642 ms**, including process launch, request/response file and JSON work, initialization and scheduling. The sum was 7.561 seconds across all eight concurrent workers; this is **not** the batch wall-clock overhead or an isolated CPU measurement.
- The initial two-market wiring check also passed, covering a no-fill case and the index-50 multi-fill/PnL regression case. The new TypeScript harness typechecked and the Python runner compiled.

## Call-path audit

| Production stage                                                                                      | Corresponding native work / evidence                                                                                                                                                                                      | Timing status                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Producer strategy schema, catalog/eligibility selection, resolution and strike metadata               | Inputs are pre-resolved and frozen for both engines. These remain producer work; market processors perform no per-market DB lookup.                                                                                       | Outside local benchmark and boundary timing                         |
| Worker launch/import, commit gate and artifact integrity/load cache                                   | Existing local benchmark includes runtime startup and TypeScript artifact load. New boundary check invokes current processor and artifact loader for both branches.                                                       | Boundary included; fleet service startup not measured               |
| Original market Parquet decode, book/delta ordering and full depth snapshots                          | Native decoder/book snapshots; full 1,000-market tick digests matched. Sorted numeric vectors replace JavaScript Map/string conversion overhead without sampling ticks.                                                   | Included                                                            |
| Original Binance/Chainlink loading, lookbacks, seed/order/coverage and visibility clocks              | Native projected row-group loading; original series previously matched exactly for all 1,000; full replay feed digests include source and receipt timestamps.                                                             | Included                                                            |
| Real/synthetic tick dispatch, external feed capture and context                                       | Typed immutable feed capture, full book/position metric calculations on ticks and account callbacks. Single-market synchronous dispatch preserves the awaited production order; synthetic ticks do not advance execution. | Included                                                            |
| Strategy math/state/intents/metadata/reasons                                                          | Pinned v15 Rust strategy; full decisions and metadata matched. Cached metadata and typed contexts avoid unnecessary JavaScript object/promise allocation.                                                                 | Included for this artifact                                          |
| Risk, validation, pending commitments, latency and all local orders                                   | Generic native local order engine; BUY/SELL FOK/GTC/GTD, maker/taker, cancellation, split/merge and risk cases in 162 portable full-output fixtures.                                                                      | Included                                                            |
| Account event lifecycle and portfolio                                                                 | Full ledger, reservations, fees, realized PnL, cached full snapshots, reconciliation and account callbacks. Trace-free snapshot rebuild regression passed.                                                                | Included                                                            |
| Trade diagnostics and per-tick fill/split harvesting                                                  | ISO/notional/cash/fee fields calculated; full recent-fill/split scans, dedupe and intent metadata harvest retained.                                                                                                       | Calculations included; console output disabled in both              |
| Per-market results and production job envelope                                                        | Complete market statistics/execution metadata; new adapter validates input mapping and restores actual job index and worker/commit identity. Full result envelope comparison passed.                                      | Included                                                            |
| Batch, tails and UTC daily/ISO-week/month segments                                                    | Full native aggregation in original benchmark; current production aggregate functions in new worker-boundary test. Order-sensitive streak and deterministic interval fixtures passed.                                     | Included                                                            |
| Redis job fetch/locks/return-value transport/counters/heartbeat, aggregate children retrieval/cleanup | Current supervisor, child worker and aggregator do this around the replay. `makeMarketProcessor` alone does not include it.                                                                                               | Not measured; potential production overhead                         |
| MySQL insert/transaction or extension merge                                                           | Current aggregate processor persists run/market/segment/failure rows. Extension also reads and re-aggregates existing plus new markets.                                                                                   | Not measured; extension-union work is not the new-market-only batch |
| Missing-file downloads, other device disks/CPUs and fleet load balancing                              | Existing sample files are all local. Eight fixed chunks run on one Mac.                                                                                                                                                   | Not measured                                                        |

## Current-source drift review

The current main checkout differs from the earlier reference. Relevant changes in `runSingleMarket` add Recorder V4 capture eligibility/provenance and optional result metadata. They do not introduce that processing into the `telonex-delta` branch. The market-statistics change is a type/provenance field. `MarketEngine` adds live receipt metadata and live frame handling; the Telonex replayer directly applies decoded book events and retains its existing path. The ExternalFeedsRequestPlugin changes are comments; its capture and snapshot behavior is unchanged. Core StrategyRunner, Portfolio, OrderManager, BacktestExecution, historical feed loaders, orderbook implementation, batch/segment functions and frozen artifact remain the same. Additional recorder modules may add startup/import cost, which the new current-source boundary run includes.

## What can reduce the production gain

The production claim must measure from submission through the committed result and retain a phase breakdown: producer/preflight, queue wait/dispatch, replay, transport, aggregation, persistence/cleanup. A shared fixed overhead reduces the total speedup even if the engine keeps its measured speed. For example, **30 seconds of additional non-overlapping overhead in both engines** would make `(577.960 + 30) / (103.346 + 30)` approximately **4.56x**. This is arithmetic illustration, not measured queue/database overhead.

Keep the full replay/strategy inside Rust, transport whole-market requests and summaries, and preserve one shared strategy/core between live and backtest before production activation. An implementation that retains the TypeScript strategy and calls across processes for every tick is a different architecture and is not supported by these timings. Native artifact loading is currently pinned; other strategies, plugins, Recorder V4 and other replay formats require separate implementation/parity/measurements. The general engine fixtures do not make those integrations complete.

## Reproduce this check

```sh
python3 experiments/rust-backtest/worker-boundary-check.py \
  --manifest experiments/rust-backtest/fixtures/june-1000/raw-manifest.json \
  --node /absolute/path/to/node20 \
  --production-root /absolute/path/to/current-production-checkout \
  --workers 8
```

The reference trace/source/artifact hashes are validated before reuse. The current production checkout and frozen artifact must be available locally. Generated job envelopes, native request/results and detailed provenance stay under ignored `results/`. The adapter is an isolated experiment; it has not been registered into production workers or live trading. Main checkout edits were not made.

See [REPORT-JUNE-1000-FULL.md](REPORT-JUNE-1000-FULL.md) for the original three-run medians and [PARITY-SCOPE.md](PARITY-SCOPE.md) for the local engine contract.
