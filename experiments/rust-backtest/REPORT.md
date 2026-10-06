# Rust backtest benchmark report

Measured on 2026-10-06 using an isolated checkout based on engine commit
`42bcc992`, on an Apple M1 Pro with 10 CPU cores and 16 GiB RAM.

The experiment uses Node 20.11.0 and Rust 1.89.0, with a release build and tracing
disabled for timing. The fixed 24-market sample comes from run 9657, using its
frozen `overnight-opus55-lagsnipe.v15` artifact, validated parameters, 100 USDC
per-market capital, and 500 +/- 20 ms execution latency. Jitter is generated from
the same deterministic per-market sequence in both implementations.

## Correctness

All 24 sample markets passed parity: 3,793,987 replay events, 101 order
decisions and 612 account events. Verification includes SHA-256 tick and feed
digests, normalized order
and fill lifecycle events, capital and positions after each account event, final
portfolio, and per-market statistics. Prices, sizes, timestamps, IDs, event order and
states compare exactly; derived floating-point outputs use absolute tolerance
`1e-10`. Tick digests cover strategy-visible ticks; replay counts also include
pre-window and post-window market events.

The prepared TypeScript reference also matches the unmodified production replay
on the first trading market's trace. Every production timing run additionally
checks all market stats and event counts against the verified reference.

Eight focused Rust tests pass, including synthetic/real tick boundaries,
visibility ties, fee rounding, depth updates, deterministic jitter, delayed FOK
execution, all-or-nothing FOK rejection, risk rejection, and prevention of
repeated fills on later ticks.

The final release build was rechecked against all 24 TypeScript traces. Two
additional first-market traces also passed with a different jitter seed:
immediate execution (0 ms, no jitter) and the prior run's 300 +/- 20 ms delay.
These variants are correctness checks, not additional timing samples.

## Timing

Medians of three measured repetitions after one warm-up per scenario. Wall time
includes process startup and output writing. Engine order alternates between
repetitions; tracing is disabled. Both engines load the same prepared feed
series and independently decode the original market Parquet files.

| Workload                       | TypeScript |    Rust | Speedup |
| ------------------------------ | ---------: | ------: | ------: |
| One market                     |    3.572 s | 0.404 s |   8.84x |
| 24 markets, one process        |   69.445 s | 9.635 s |   7.21x |
| 24 markets, four local workers |   20.707 s | 2.710 s |   7.64x |

Serial batch wall-time ranges were 69.104–70.035 s for TypeScript and
9.462–9.686 s for Rust. Four-worker ranges were 20.649–22.528 s and
2.703–2.729 s, respectively. The one-market TypeScript measurement had a slower
4.757 s repetition, reinforcing why the batch comparison matters more.

For the serial batch, median CPU time was 85.263 s for TypeScript and 9.544 s
for Rust. Median peak RSS was 663 MiB versus 46 MiB. With four workers, the sum
of worker peak RSS was 1,811 MiB versus 110 MiB; this is not a measurement of
simultaneous peak memory.

The unmodified production TypeScript replay, including its daily-feed loaders,
took 64.380 s for the serial batch (range 63.418–64.514 s). Against Rust's
prepared-feed batch this is a contextual 6.68x difference, **not** a complete
replacement benchmark: native daily-feed loading is still missing. The prepared
reference is somewhat slower than production, so 7.21x must not be presented as
the production fleet speedup.

The final rebuilt source also passed a separate untimed-for-comparison batch
check in 9.378 s after lint refactoring. It is excluded from the repeated
medians above; its source and release binary hashes are saved with the results.

Raw timing samples, CPU/RSS summaries, runtime versions, input settings and
host load are retained in [measurements.json](measurements.json). The machine
had concurrent load and the experiment ran at niceness 10. These warm-cache,
three-repetition measurements establish a promising local prototype result;
they do not predict throughput for another Mac or 10,000–100,000-market batches.

## Interpretation and remaining scope

This is a local, warm-cache compute comparison of the selected backtest path.
Prepared external feed series are shared inputs, while original market Parquet
files are decoded independently by each implementation. The production
TypeScript baseline also includes daily-feed loading. Native daily-feed loading,
network downloads, database persistence, queue scheduling, aggregate/segment
statistics and four-machine fleet execution are not ported or timed in Rust.

The native core specializes to the frozen BUY/FOK v15 strategy and uses numeric
levels and sorted vectors rather than the generic TypeScript runner and snapshot
structures. The measured gain combines implementation/algorithm improvements
and native execution; it is not a universal Rust-versus-TypeScript multiplier.

The supported trading behavior matches this sample. It remains an experiment,
with no live adapter or production registry entry. A production migration must
share one Rust strategy/market core between live and backtest and verify wider
boundary cases, other execution types, feeds, and input modes before activation.

## Recommended next experiment

Keep the current fleet architecture and batch interface. First validate this
native path on a larger, out-of-sample batch with the same trace gates, then add
native daily-feed loading and measure a complete worker job including aggregate
results. Four local workers already benefit, but this experiment has not run on
the four-device fleet. Test on an existing Mac mini before buying more machines
on the assumption that these speed and memory ratios transfer.

A deployment requires one strategy core shared by live and replay. Maintaining
independent TypeScript and Rust trading implementations in production would
violate the repository's parity rule.

## Retention

The experiment remains local in the isolated `codex/rust-backtest-benchmark`
worktree. Its strategy source and sample parameters originated in a private
protocol repository, while the engine GitHub repository is public. Publishing
this complete experiment would disclose them and requires an explicit decision
about publication scope. No branch has been pushed and no PR has been opened.
