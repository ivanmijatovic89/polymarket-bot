# Production end-to-end Rust comparison

Measured on October 7, 2026 (Europe/Belgrade), with production sources frozen from commit `07245602d6ff9bca0dcdf772134cba3dd227526c`. Raw evidence retains UTC timestamps.

## Result

For the current frozen v15 strategy on 1,000 currently eligible June markets and eight market worker processes on this Mac, median producer-launch-through-exit time was **617.119 seconds for TypeScript** and **99.627 seconds for Rust**, or **6.194x**.

The endpoint at actual aggregate completion, after the MySQL transaction and Redis child cleanup, was **617.062 seconds versus 99.538 seconds**, or **6.199x**. Producer exit additionally includes parent acknowledgement, QueueEvents shutdown and connection closure. The launcher polls process exit at 200 ms intervals; the aggregate-completion endpoint uses its recorded timestamp.

This is an observed production-path comparison for the specified workload and architecture, not an exact guaranteed multiplier for every deployment or batch size. The earlier 5.59x result measured local compute and aggregation without real Redis/MySQL transport. Its frozen market list also predates today's stricter producer eligibility.

## Measured runs

| Run               | Producer launch through exit | Through persisted aggregate completion | Aggregate/persist/cleanup phase |
| ----------------- | ---------------------------- | -------------------------------------- | ------------------------------- |
| full-1-rust       | 99.556 s                     | 99.405 s                               | 0.671 s                         |
| full-1-typescript | 626.648 s                    | 626.581 s                              | 0.797 s                         |
| full-2-typescript | 617.119 s                    | 617.062 s                              | 0.667 s                         |
| full-2-rust       | 101.279 s                    | 101.056 s                              | 0.814 s                         |
| full-3-rust       | 99.627 s                     | 99.538 s                               | 0.790 s                         |
| full-3-typescript | 575.785 s                    | 575.656 s                              | 0.870 s                         |

Three pairs alternate Rust/TypeScript, TypeScript/Rust, Rust/TypeScript. The headline is the ratio of medians, not a selected fastest run. Untimed trace gates and service preparation are excluded.

| Phase median                                           | TypeScript | Rust     |
| ------------------------------------------------------ | ---------- | -------- |
| Producer launch to first market                        | 1.357 s    | 1.328 s  |
| First market start to last market processor return     | 615.092 s  | 97.433 s |
| Aggregation, MySQL persistence and Redis child cleanup | 0.797 s    | 0.790 s  |

Phase spans are descriptive elapsed intervals; producer enqueue can overlap market processing. They are not isolated CPU measurements. Aggregation, transaction commit and cleanup are combined in one phase; no claim separates their individual costs.

## Included production work

- The actual current producer CLI: published artifact/schema/parameter resolution, catalog selection and feed eligibility, market outcome/window/strike metadata, missing-file preflight, normal producer logs, flow creation and completion listeners.
- Real BullMQ flow submission, dynamic market scheduling, fetch/locks, heartbeat and per-job counters, result JSON serialization/transport, child-result retrieval and parent acknowledgement on the configured Redis host.
- Original market, Binance and Chainlink Parquet reads and preparation; full local replay, strategy, metrics, orders, accounting, snapshots, diagnostics and market outputs. Neither branch consumes prepared JSON feeds or cached backtest results in timing.
- The actual current aggregate processor, stable input-order restoration, full batch/calendar/tail statistics, all result-row mapping and the real MySQL transaction, followed by production Redis child cleanup.
- Native request/response file and JSON work and a new Rust process per market. Full replay and strategy remain inside Rust; cross-language transport occurs at market boundaries, with normal diagnostic log messages forwarded to the same Node console formatter and file log sink.

Standing worker startup is outside submission timing, as for an already running production worker service. Worker artifact initialization inside the processor is included. Console output is retained in both engines: feed summaries, cached-file notices and all trade diagnostics are compared per market. Native execution-duration metadata includes its bridge work.

## Isolation and fidelity

The same configured Redis and MySQL hosts are used, including the actual network path from this Mac. MySQL reported version 8.4.10, `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1`. The test uses separate queue names, heartbeat/counter keys and four result tables under namespace `rbx_b5f2a8d3_`. Normal fleet workers cannot consume these queues, and normal application result tables receive no benchmark writes. Catalog and published-artifact tables are read-only.

Result-table definitions were copied from the actual server, retaining columns, indexes, foreign keys and storage engine; only identifiers and the starting auto-increment counter differ. The isolated tables begin empty, so this does not reproduce the index population or contention of large existing result tables.

Production source files are copied once into an ignored snapshot. Snapshot changes only isolate queue/table/heartbeat names, bind the loaded commit identity and assert/save producer payloads before submission. The producer, engine, feed loaders, statistics, persistence and cleanup algorithms are unchanged. Main-checkout edits during execution do not modify this frozen runtime.

## Input and parity evidence

The current producer selected its first 1,000 eligible resolved BTC 15-minute markets from June 1, 2026. The first slug is `btc-updown-15m-1780272000` and the last is `btc-updown-15m-1781288100`. There are **972 markets in common with the prior sample and 28 replacement markets**. Today's eligibility list is frozen for both branches; every timed producer payload must match it exactly before submission.

All 28 replacements passed a fresh full trace comparison: tick/feed/context digests, strategy intents and metadata, account events and full portfolio snapshots, final state/context and market statistics. Fresh TypeScript traces from the initial preflight were reused only after runtime, input and source checks; native traces were regenerated after the optional logging addition. The 972 overlapping markets retain the previously hash-verified full trace reference. Every new timed market output also matches its complete trace reference's market statistics and event counters.

All 1,000 complete job outputs, normal per-market logs and persisted business fields matched between TypeScript and Rust in every timing pair. This includes **198,227,628 replay events** and **2,485 trades**, plus **4,485 normal per-market log calls** in the first pair. All runs persisted 1,000 successful market rows, the same segment rows, and zero failure rows. Only generated submission/run identities, worker assignments, creation/update clocks and performance-duration fields are normalized; replay timestamps, order/fill identities, parameters and business results remain checked.

Original input, frozen snapshot, harness and native-binary hashes are checked before/after execution. Native unit tests, clippy and TypeScript harness typecheck passed. A real two-market smoke gate covers a no-fill market and a multi-fill market before the timing suite.

## Conditions and remaining boundaries

This is the same Apple M1 Pro Mac with ten physical cores and 16 GiB RAM as the local benchmark. Eight workers means eight processes, not CPU affinity. Both run at nice 10 with warm filesystem cache. Background activity is uncontrolled; load averages are retained in the evidence. A quiet, repeated measurement on another device can produce different numbers.

The measured path is a fresh cached-file batch using frozen `overnight-opus55-lagsnipe.v15`, its original 32 parameters, 100 USDC per-market allowance, batch initial capital 1,000, execution latency 500 +/-20 ms, reproducible per-market jitter seed 123456789, and original feed latency/lookback/gap settings. It does not time extension union/reaggregation, missing-file downloads, cold cache, other strategies/feed plugins/input modes, 10,000/100,000-market aggregation or the four-device fleet. Those are distinct workloads, not hidden omissions in this selected replay.

A production migration must keep the whole market core and strategy in Rust, preserve this result-envelope/queue/persistence contract, and share the same strategy implementation and tick semantics with live trading. A design with per-tick Node/Rust calls is a different unmeasured architecture. This experiment has not activated Rust in production or live trading.

## Evidence and reproduction

See [measurements-end-to-end.json](measurements-end-to-end.json) for timings, source/input/binary fingerprints, selection and parity gates. Detailed private payloads, traces, per-worker logs and persisted rows are retained under ignored `results/e2e-production-final/`. After saving the evidence, the four isolated SQL tables and all owned Redis queue/worker keys were removed. Cleanup verified zero active or pending jobs; `cleanup.json` retains that evidence.

```sh
python3 experiments/rust-backtest/e2e-check.py \
  --node /absolute/path/to/node20 \
  --production-root /absolute/path/to/production-checkout \
  --manifest experiments/rust-backtest/fixtures/june-1000/raw-manifest.json \
  --workers 8 --repetitions 3 \
  --results /absolute/path/to/new-results-directory
```

The runner requires the configured authenticated services and permission to create separate result tables. It deliberately refuses existing result directories and table-name collisions. Preparation and full trace gates run before the smoke gate and measurements.
