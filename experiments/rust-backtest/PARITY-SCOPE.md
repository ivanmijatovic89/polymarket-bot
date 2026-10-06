# Local engine parity and benchmark contract

The earlier 7.19x figure measured a specialized prototype. It must not be described as a full-engine migration result. The expanded experiment replaces the shortcut order/portfolio implementation and strengthens the comparison before any new speedup is reported.

## Requested workload

The performance question is the complete local batch for the frozen `overnight-opus55-lagsnipe.v15` artifact, its existing parameters, and the same 1,000 June 2026 BTC 15-minute `telonex-delta` markets. Both engines open the same original market and daily Binance/Chainlink files inside the timed work. Market selection, eligibility and the strategy artifact are fixed inputs, as they are for a production local worker.

The queue, database, network downloads and four-device fleet are outside the user-selected scope. This executable remains an isolated offline experiment. A production migration must use one shared Rust strategy/core for live and replay; running independent production TypeScript and Rust strategy implementations would violate the repository's parity invariant.

## Functional audit

| Area             | Expanded native implementation                                                                                                                                                                                | Differential evidence                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Replay and books | Original Parquet decoding, recorded ordering, book replacement/deltas, all price levels, best prices, mid/spread, cumulative depth snapshots                                                                  | Every real and synthetic tick hashed against actual production replay                                             |
| External feeds   | Original daily files, seeding, coverage checks, arrival latency, two-clock Chainlink, monotone visibility, strike availability, synthetic ticks                                                               | Exact original series verification previously passed all 1,000; fresh source/receipt timestamp and value digests  |
| Strategy context | Position metrics and every orderbook weak-side/ratio level computed on every eligible tick and account callback                                                                                               | Tick metrics digest; full callback metrics and final context                                                      |
| Strategy         | Frozen v15 math, state, size/price, deterministic IDs, complete diagnostic metadata and reason strings                                                                                                        | Full emitted intents, including decimal formatting                                                                |
| Order manager    | Risk loss/size/open-order/position limits, validation, dedupe, pending funding, partial batches, immediate and queued modes, reconciliation                                                                   | Portable fixtures use actual production OrderManager                                                              |
| Execution        | BUY/SELL FOK/GTC/GTD; taker depth, maker price-through/touch modes, expiry, post-only validation at execution, delay/jitter, selected/batch/market/global cancellation                                        | Full event streams and portfolio after each event, including paths v15 does not use                               |
| Portfolio        | Fee/cash/cost/average/realized PnL, unresolved reservations, fills before acknowledgement, reused IDs, late terminal/status updates, idempotency, bounded histories, splits/merges, cached complete snapshots | Full snapshots; portable late/duplicate/generation cases                                                          |
| Tick dispatch    | Real ticks execute due actions before decisions; synthetic ticks retain the book and do not maker-fill, expire or drain queued execution                                                                      | Synthetic, latency and queued-mode fixtures plus actual replay                                                    |
| Diagnostics      | Full intent metadata/reasons, normal account events and callbacks, trade log fields calculated with output suppressed in both engines, execution metadata                                                     | Full trace objects; only host timing values normalized                                                            |
| Market results   | BUY averages, maker/taker counts, fees, remaining basis, sells, splits, resolution PnL, no-activity classifier and intentMeta                                                                                 | Complete market statistics comparison                                                                             |
| Batch results    | Batch quality/EV/win/streak/capital/fee/trade/duration fields; busy-interval union; all/last-N/daily/ISO-week/month segments                                                                                  | Independent fixtures including flat/degenerate/streak/calendar/tail cases; aggregation included in measured batch |

## What “complete” establishes

No calculation used by this selected local production workload may be removed merely because v15 does not read it. Derived context, full account bookkeeping, per-tick fill/split harvesting, diagnostics and batch aggregation remain in the timed native path. Rust can use typed values and synchronous ordered execution in place of JavaScript objects and promises; equivalent behavior does not require reproducing language-specific allocation overhead.

The native executable still pins one strategy artifact and one replay input format. Recorder V4, paired/legacy recordings, other strategy artifacts and other plugin families are not migration-complete and are not performance claims of this experiment. Their implementations must be ported and tested before using them in Rust. They are not secretly disabled components of the selected workload: production does not instantiate them for this run either. Live-only balance polling, warmup, WebSocket execution and market rotation in a persistent live runner are likewise not part of an isolated per-market backtest worker.

Tests establish equivalence on the listed fixtures and data, not a mathematical proof for every future strategy and input. The report must identify this scope beside the measured speedup.

## Required measurement gates

1. Rust unit tests, clippy with warnings denied, harness typecheck and formatting pass.
2. Portable full-output differential suite passes: actual TypeScript modules vs the native modules used by replay. Compare event and snapshot content, metadata, metrics, market/batch/segment results and JavaScript decimal formatting.
3. Fresh production TypeScript and native full traces pass all 1,000 markets. Do not reuse the old traces that omitted fields.
4. Compare complete output shapes. Normalize only per-market elapsed duration; execution start/finish/duration; batch/segment execution duration aggregates. Test duration mathematics separately with identical deterministic intervals. Keep machine/child/source identity, event counts and all strategy metadata.
5. Trace-free timing uses equal process counts, original input files, the full local engine and final batch/segment aggregation. Alternate engines for at least three repetitions and report medians and ranges.
6. Bind results to source, input and binary hashes before/after. State filesystem-cache and background-load conditions, worker process versus CPU affinity semantics, and fleet exclusions.

## Reproduction

```sh
cargo build --release --locked --manifest-path experiments/rust-backtest/Cargo.toml
python3 experiments/rust-backtest/core-parity.py --node /absolute/path/to/node20
python3 experiments/rust-backtest/full-benchmark.py \
  --manifest experiments/rust-backtest/fixtures/june-1000/raw-manifest.json \
  --node /absolute/path/to/node20 --workers 8 --rounds 3
```

The private strategy/data manifests and generated results stay local and ignored. Historical reports retain their original evidence and scope; their ratios are superseded for decisions about the expanded local path.
