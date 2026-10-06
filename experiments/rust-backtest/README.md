> Current result: [complete local-path benchmark — 5.59x median](REPORT-JUNE-1000-FULL.md), with the [expanded local-engine parity contract](PARITY-SCOPE.md). Use `full-benchmark.py` for full-output parity and original-file batch timings. The sections below document earlier prototype measurements and their original limitations; they do not describe the expanded engine.

# Rust backtest experiment

An isolated, local experiment for `overnight-opus55-lagsnipe.v15` on Telonex
`delta-typed` BTC 15-minute market files. The reference is the frozen strategy
artifact `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8`
and the parameters from backtest run **9657**.

This is a prototype for evaluating a migration. The production live and backtest
entry points continue to use the same TypeScript engine. The experiment is not
registered as a strategy or connected to the execution fleet. A production Rust
migration must provide one shared core for live and replay before activation.

## Expanded local engine

The native replay now includes the general local order manager, BUY/SELL
FOK/GTC/GTD execution and cancellation, complete portfolio/event accounting,
full cached snapshots, position/orderbook metrics, normal diagnostic calculations,
market statistics, and batch/calendar/tail aggregation. The scope and independent
correctness gates are documented in [PARITY-SCOPE.md](PARITY-SCOPE.md).

For a fresh complete local-path measurement with the existing private sample:

```sh
cargo build --release --locked --manifest-path experiments/rust-backtest/Cargo.toml
python3 experiments/rust-backtest/core-parity.py --node /absolute/path/to/node20
python3 experiments/rust-backtest/full-benchmark.py \
  --manifest experiments/rust-backtest/fixtures/june-1000/raw-manifest.json \
  --node /absolute/path/to/node20 --workers 8 --rounds 3
```

The full benchmark generates production TypeScript and native traces, compares
complete output structures and statistics, then times three alternating runs
per engine using the original input files. Each timed output is checked against
the verified reference. Final results are accepted only after the source, input
and binary hashes remain unchanged. The portable differential fixtures do not
require private market data or the frozen strategy artifact.

The remaining sections describe the historical prototype and its original
benchmark commands. Their omitted work is not the current parity contract.

## Historical prototype path

- Original Parquet row order, without timestamp re-sorting or tick sampling.
- Full depth for both outcome books, including level insertion/deletion.
- Binance and Chainlink visibility clocks, high-water clamp, price-to-beat delay.
- Synthetic feed ticks: old book until the next real tick, strict interleaving,
  deterministic cross-feed ties and tail flush. Pending execution advances only
  on real ticks; zero-delay submissions can execute immediately on any decision tick.
- Frozen v15 market/account behavior, all its validated parameters.
- BUY FOK placement, shared risk defaults, capital reservation, delayed execution,
  per-level taker fills, fee rounding, terminal lifecycle, and portfolio updates.
- Per-market stats, including markets with zero trades.
- Independent simulation state for every market and worker.

The initial prototype accepted only the pinned artifact and fixture
format. It did not support other strategies, input modes, SELL/GTC/GTD orders,
market rotation within one simulation, user-WebSocket reconciliation, or live
execution. Passing sample parity does not certify those unimplemented paths.

## Prepare the exact sample

Requirements: Node 20, existing project dependencies, Rust 1.89 or newer, Python 3,
and the original dataset and frozen strategy artifact. The preparation command
reads the configured database and local files. It performs no database writes,
queue submissions, downloads, or live requests. Credentials remain in the data
checkout's `.env`; no environment file is copied into the experiment.

From the **isolated checkout's repository root**:

```sh
NODE20=/absolute/path/to/node-20
DATA_CHECKOUT=/absolute/path/to/the/existing/polymarket-bot

"$NODE20" --import tsx experiments/rust-backtest/prepare.mts \
  "$DATA_CHECKOUT" 9657 24 experiments/rust-backtest/sample-plan.json

cargo build --release --locked --manifest-path experiments/rust-backtest/Cargo.toml
cargo test --locked --manifest-path experiments/rust-backtest/Cargo.toml
"$NODE20" node_modules/typescript/bin/tsc -p experiments/rust-backtest/tsconfig.json
```

Preparation uses the production feed loaders to extract identical, window-scoped
series for both engines. Their pre-window seeds and post-window tails are
preserved. Market Parquet files are read directly from the data checkout. Input
SHA-256 hashes are checked before and after the benchmark.

## Compare and measure

```sh
BENCHMARK_DATA_ROOT="$DATA_CHECKOUT" python3 -u experiments/rust-backtest/benchmark.py \
  --node "$NODE20" --rounds 3 --workers 4 --production
```

The runner first verifies trace parity, then times runs with tracing disabled.
Each scenario has one warm-up and at least three measured repetitions, with
engine order reversed on alternate rounds. Every timed result is checked against
the verified reference. The experiment runs at niceness 10 to reduce interference
with interactive work.

Outputs under ignored `results/` include individual runs, worker chunks, logs,
and `benchmark.json`. Prepared inputs and build outputs are also ignored. The
committed `sample-plan.json` fixes sample selection independently of subsequent
run history.

Scenarios are one market, 24 markets in one process, and the same 24 markets
split across four independent processes. Each worker processes its chunk in
sequence, approximating persistent market workers. This is a local compute
comparison; fleet scheduling and BullMQ/Redis/MySQL/network overhead are excluded.

The prepared-feed comparison includes market Parquet decoding, real and synthetic
ticks, strategy decisions, FOK execution, portfolio state, per-market statistics,
and loading the prepared feed JSON. Raw daily-feed extraction is outside that
comparison. `--production` adds a baseline using unmodified `runSingleMarket`,
including its production feed loaders. The newer original daily-feed benchmark
below includes native loading of those same files inside its timed path.

Single-process wall time includes executable/module startup and output writing;
`replayMs` records the internal batch duration separately. CPU and peak RSS come
from the operating system's child-process accounting. For parallel batches,
CPU is summed across workers; reported memory is the **sum of worker peak RSS**,
not a simultaneously sampled fleet peak. No cold-disk or four-machine fleet claim
is made by these warm-cache measurements.

## Historical prototype parity contract

The TypeScript reference imports production market replay, strategy artifact,
strategy runner, order manager, execution adapter, portfolio, feed provider, and
statistics modules. No engine source is modified for the experiment. Its prepared
feed wiring is compared with the production loader baseline.

Verification checks event-type counts; binary tick digests over tick kind, time,
source sequence/receipt clock, both books and depth; binary feed digests over the
values and visibility times seen by the strategy; normalized order decisions;
normalized account events and portfolio state after every account event; final
portfolio; and per-market stats. Binary streams use little-endian f64, fixed
UP/DOWN order, and a canonical NaN for absent values. SHA-256 plus an additional
FNV-1a checksum are emitted. Diagnostic intent `meta` and human-readable strategy
`reason` strings are excluded; they do not change trading decisions.

Comparator tolerance is an absolute `1e-10` for floating-point outputs. Tick and
feed digests, event order, IDs, prices, sizes, counters, and discrete states must
match exactly. Cross-language logarithm/exponential implementations can differ
at the last bit; parity on this sample does not prove arbitrary future threshold
cases are identical.

The source runs used execution jitter from `Math.random()`, so their exact random
realizations cannot be recovered from saved aggregate results. Both experimental
engines use the same per-market xorshift32 sequence (seed 123456789) for the saved
500 +/- 20 ms latency model. Production modules are unmodified: only the isolated
reference process temporarily replaces `Math.random` for the replay. Original
saved PnL is provenance, not the expected result for a new random realization.

The Rust path uses sorted vectors and operates directly on numeric levels. It
avoids the TypeScript numeric-to-string-to-number round trip, generic runner
metrics, and per-tick snapshot copies. Measured acceleration therefore combines
language/runtime, reader implementation, and specialization/algorithm changes.
It must not be presented as a pure language benchmark or as evidence that
optimized TypeScript could not recover part of the gain.

See [REPORT.md](REPORT.md) for the measured results and remaining migration work.

## Historical June 1,000-market scaling test

The larger local experiment keeps the strategy artifact and parameters from run
9657, but selects resolved, locally available BTC 15-minute markets in
chronological order from June 1, 2026 UTC. Missing strike/resolution metadata is
ineligible. Windows rejected by the production Chainlink gap check are recorded
and excluded; the checker remains enabled. Selection continues until exactly
1,000 valid markets have been prepared. Other feed errors remain fatal.

```sh
"$NODE20" --import tsx experiments/rust-backtest/prepare.mts \
  "$DATA_CHECKOUT" 9657 1000 --from-date 2026-06-01 \
  --output-dir experiments/rust-backtest/fixtures/june-1000

python3 -u experiments/rust-backtest/scaling.py \
  --manifest experiments/rust-backtest/fixtures/june-1000/manifest.json \
  --node "$NODE20" --workers 4 8 1 --trace-workers 8 --rounds 1 \
  --production-workers 4
```

The runner verifies full traces for every market using eight independent
processes for each engine, before any timings are accepted. Timed configurations
use the same worker count and fixed market chunks for both engines. Every timed
output must match the reference market statistics and event counts. Input hashes
are verified before and after the run. Worker limits refer to process counts,
not CPU affinity or background-thread counts.

`--rounds 1` is an initial large-batch measurement, not a repeated-run median.
The full trace passes warm the input files before timing; this runner does not
add separate workload warm-ups. Increase `--rounds` for repeated measurements.
A progress line is written every 25 completed markets in both implementations.
Results are checkpointed in ignored `results/june-1000/scaling.json` after each
configuration. `--production-workers 4` also checks the unmodified production
TypeScript replay, including raw daily-feed loading. Rust still consumes
prepared feeds, so this production baseline is contextual.

The TypeScript trace pass writes `typescript-trace-provenance.json`, binding the
reference input manifest, source/dependency declarations, runtime version and
trace output bytes. `--reuse-typescript-traces` reuses that reference only after
those hashes and each worker manifest header match. Rust traces are always
regenerated and compared in full before timing. Rerun the reference after any
dependency installation/change; dependency declarations cannot detect edits
inside a shared `node_modules` directory.

The completed 1,000-market measurements and migration limits are in
[REPORT-JUNE-1000.md](REPORT-JUNE-1000.md), with raw observations in
[measurements-june-1000.json](measurements-june-1000.json).

## Historical original daily-feed file benchmark

`raw-inputs.mts` adds original Binance and Chainlink daily Parquet paths, hashes
and frozen lookback/outage settings to the existing market selection. It does
not extract price series. Both timed engines read and prepare the original
feeds independently for every market. No decoded daily-feed cache is retained
between Rust markets. Parquet column projection and row-group bounds avoid
irrelevant decoding while preserving the production seed and ordering rules.

```sh
"$NODE20" --import tsx experiments/rust-backtest/raw-inputs.mts \
  experiments/rust-backtest/fixtures/june-1000/manifest.json \
  experiments/rust-backtest/fixtures/june-1000/raw-manifest.json "$DATA_CHECKOUT"

cargo build --release --locked --manifest-path experiments/rust-backtest/Cargo.toml

python3 -u experiments/rust-backtest/raw-benchmark.py \
  --manifest experiments/rust-backtest/fixtures/june-1000/raw-manifest.json \
  --reference-results experiments/rust-backtest/results/june-1000 \
  --node "$NODE20" --workers 4 8 --trace-workers 8 --rounds 1
```

This runner requires the original eight-worker TypeScript reference traces and
hash provenance from the completed prepared-feed run. It checks that reference
source, runtime, inputs and outputs remain unchanged. Rust's reconstructed raw
series must match the production-loader series exactly for every selected
market, then native raw replay full traces must match the verified reference.
Prepared feed JSON is used only during these untimed correctness gates.

Timing uses the unmodified production TypeScript replay and native raw replay,
with matching workers and fixed chunks. It includes daily-feed reads, seed/range
extraction, ordering and outage checks, market decoding, strategy/execution and
per-market statistics. Every timed output must match the reference. Compilation,
verification, fleet/network/DB/queue output and batch aggregation remain outside
timing. The runner checks original inputs, sources and the binary again at the
end and writes checkpoints to `results/june-1000-raw/raw-scaling.json`.

Completed original-file results are in
[REPORT-JUNE-1000-RAW.md](REPORT-JUNE-1000-RAW.md), with raw observations in
[measurements-june-1000-raw.json](measurements-june-1000-raw.json).
