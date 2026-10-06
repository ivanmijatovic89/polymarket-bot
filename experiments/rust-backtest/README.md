# Rust backtest experiment

An isolated, local experiment for `overnight-opus55-lagsnipe.v15` on Telonex
`delta-typed` BTC 15-minute market files. The reference is the frozen strategy
artifact `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8`
and the parameters from backtest run **9657**.

This is a prototype for evaluating a migration. The production live and backtest
entry points continue to use the same TypeScript engine. The experiment is not
registered as a strategy or connected to the execution fleet. A production Rust
migration must provide one shared core for live and replay before activation.

## Supported path

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

The native executable deliberately accepts only the pinned artifact and fixture
format. It does not support other strategies, input modes, SELL/GTC/GTD orders,
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
including its production feed loaders. A native port of those daily-file loaders
is still required to measure a complete Rust replacement.

Single-process wall time includes executable/module startup and output writing;
`replayMs` records the internal batch duration separately. CPU and peak RSS come
from the operating system's child-process accounting. For parallel batches,
CPU is summed across workers; reported memory is the **sum of worker peak RSS**,
not a simultaneously sampled fleet peak. No cold-disk or four-machine fleet claim
is made by these warm-cache measurements.

## Parity contract

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
