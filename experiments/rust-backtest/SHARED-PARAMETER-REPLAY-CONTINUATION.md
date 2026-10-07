# Rust shared parameter replay continuation

Parquet remains the on-disk input format. Shared parameter replay is the next optimization to validate: read and decode a market once, then evaluate independent strategy candidates against the same ordered stream. The Arrow storage conversion is rejected for adoption. This handoff preserves completed experiments and a proposed continuation; it starts no benchmark or production migration.

## Authoritative production measurement

The existing [end-to-end report](REPORT-END-TO-END.md) remains authoritative for its workload: 1,000 currently eligible June markets, eight workers, three paired runs, normal logs and real Redis/MySQL. Median TypeScript time was 617.119 seconds versus 99.627 seconds for Rust, a 6.194x speedup.

The additional experiments use one older-sample market, `btc-updown-15m-1780925400`, June 8, 2026 at 13:30 UTC, one worker and warm filesystem cache. Its original Parquet contains 449,314 market rows; replay includes 482,351 events after synthetic feeds. These experiments do not establish a combined production multiplier.

## Reusable prototype and findings

Shared replay loads original market and raw Binance/Chainlink Parquet files. It shares row reading, decoding, book updates/snapshots and feed observations. Each candidate retains its own parameters, strategy state, orders, execution, RNG, capital, portfolio, context and result statistics. Input semantics and feed timing/settings must be identical within a group.

The prototype's nine core modules are byte-identical to the current benchmark: strategy, engine, portfolio, feeds, raw_feeds, context, stats, types and fixtures. The modified entry point introduces `dispatch_with_feed`, extracts the existing result finalization and calls `shared_replay.rs`. It temporarily swaps book/snapshot ownership into each callback and restores it without deep copying. An integration can replace that mechanism with immutable borrowed views while preserving the same calculations.

The reported sixteen tests and ten full standalone-versus-shared traces provide reusable checks for strict-before synthetic-feed timestamp ties, out-of-window provider behavior and candidate independence. Reversing candidate order preserved outputs. The ten candidates produced 41 decisions, 245 account events and six distinct final portfolio states.

| Candidate count | Separate sequential Rust runs | Shared replay | Measured speedup |
| ---: | ---: | ---: | ---: |
| 1 | 1.666 s | 1.711 s | 0.974x |
| 3 | 4.933 s | 2.346 s | 2.103x |
| 5 | 8.289 s | 3.022 s | 2.743x |
| 10 | 16.898 s | 5.314 s | 3.180x |
| 20 | 34.033 s | 9.553 s | 3.563x |
| 100 | 171.018 s | 43.019 s | 3.975x |

These scaling values are medians across three rounds. The separate baseline sums freshly measured standalone native-process times for each nested subset. An earlier five-pair ten-candidate experiment measured 17.094 versus 5.213 seconds, or 3.279x. Both exclude Python driver/parsing time and queue/database/batch work; they compare sequential candidate execution, not standalone candidates already running concurrently across workers.

All 100 candidates' timed market results/statistics matched standalone references at every size and repetition, including reversed candidate order. Only the original ten candidates have full per-event trace comparisons; the additional ninety have result/statistics checks. The settings are synthetic test variations, not the user's historical search configuration. Median peak RSS for 100 shared candidates was 34.56 MiB.

The separate profiling experiment found roughly 50.567% of profiled runtime in Parquet row reconstruction, 16.059% in decoding/validation, 8.663% in book updates/snapshots and 3.589% in feed loading/preparation. Instrumentation added 2.617% runtime, and original-binary CPU sampling provides independent supporting evidence. These figures motivate amortizing market work across candidates; they are not a production timing prediction.

The rejected Arrow experiment measured 1.336x full replay speedup on this market, but its data file was 25.402x larger. Conversion time was excluded and cold cache was not tested. Retain this as historical evidence only. The Arrow-named Cargo target path used for the separately named shared-replay binary is a build-cache location; shared replay reads Parquet.

## Proposed next step

Integrate grouped candidates into the isolated end-to-end harness before measuring a combined gain:

1. Define a stable candidate identity and group compatibility contract covering market/input identity, strategy artifact/core version, ordering, window and all feed timing/settings. Reject incompatible candidates from a shared group.
2. Adapt the shared dispatcher and existing finalizer into the whole-market Rust bridge. Keep candidate state independent and preserve shared live/backtest strategy logic and tick semantics. Avoid per-tick Node/Rust calls.
3. Return one identified market result per candidate, then run the existing aggregation and persistence contracts separately for each candidate. Specify shared duration accounting, failures and retry behavior without duplicating or losing results.
4. Check full per-candidate trace parity across multiple markets and the expanded candidate set, reversed candidate order, ordinary logs, aggregate statistics and saved business fields. Check group scheduling with eight workers and restart/retry handling.
5. Measure the same market/candidate workload end to end for TypeScript, independent Rust and shared Rust, with identical worker budgets and real Redis/MySQL. Start with measured candidate counts and then assess larger groups using the user's actual search parameters.

The interpolated eight-candidate estimate and earlier combined estimates around 18.6x or 24x remain projections. Do not multiply the single-market sharing ratios by 6.194x and present the product as a measured production result.

## Preserved local evidence

The private archive is under ignored `results/handoff-20261007/` in this isolated workspace:

- `shared-parameter-replay/`: both reports, measurement JSON, exact candidate parameters/manifests, traces/results, preparation/timing drivers, Cargo files and the complete prototype source.
- `profile/`: profiling measurements, original-binary CPU sample and profiling scripts/entry point.
- `rejected-arrow-evidence/`: storage and replay measurement JSON only; no converted dataset.
- `binaries/rust-backtest-shared-param-test`: the measured shared-replay binary.
- `preservation.json`: source/copy SHA-256 fingerprints for all 951 preserved files and confirmation that all nine core modules match the current benchmark.

The archive copies verified byte-for-byte. Historical scripts/manifests retain their original absolute paths and need adaptation before reuse; they were not run during preservation. Production sources remain unchanged.
