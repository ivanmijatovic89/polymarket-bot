# June 1,000-market backtest benchmark

Completed on October 6, 2026. On this 1,000-market sample, Rust took 8m 00s
with one worker, 2m 04s with four workers and 1m 07s with eight workers.
Parallel processing alone provided 3.86x and 7.18x speedups. Full trace parity,
all timed result comparisons and the final input-hash checks passed.

Raw observations, runtime versions, load averages, source hashes and the release
binary hash are saved in [measurements-june-1000.json](measurements-june-1000.json).

The follow-up [original-file benchmark](REPORT-JUNE-1000-RAW.md) includes
Binance/Chainlink daily-feed loading and preparation inside both timed engines.
Use that report for the more complete comparison of this replay workload.

## Fixed inputs and host

- Apple M1 Pro, 10 CPU cores, 16 GiB RAM; one local computer.
- Node 20.11.0, Rust 1.89.0, optimized release build, process niceness 10.
- Frozen `overnight-opus55-lagsnipe.v15` artifact and parameters from run 9657.
- Per-market capital 100 USDC; execution delay 500 +/- 20 ms; deterministic seed
  123456789 reset independently for every market.
- 1,000 distinct, resolved BTC 15-minute markets in chronological order, from
  June 1, 2026 00:00 UTC through June 12, 2026 11:30 UTC.
- 101 windows rejected by the production Chainlink outage check were excluded.
  Other missing input failures remain fatal. Exact slugs and exclusions are in
  [selection-june-1000.json](selection-june-1000.json).
- Original market Parquet files: 2.317 GiB; prepared external feed inputs:
  556 MiB. Both engines read the same fixed inputs.

## Correctness

All 1,000 markets passed full trace parity: 196,834,457 replay events, 3,758
order decisions and 21,272 account events. Tick and feed SHA-256 digests match,
as do order/fill lifecycle events, portfolio state and all per-market stats.
Trading prices, sizes, quantities, timestamps, IDs and discrete states compare
exactly. Derived floating-point values use absolute tolerance 1e-10.

The larger sample found a one-cent PnL discrepancy on a half-cent rounding
boundary. Fills, account states and tick/feed digests already matched. Rust
subtracted the two position costs separately; the shared TypeScript statistics
adds the costs before subtracting. The native statistics now preserves that
operation grouping, with a regression test. The full 1,000-market comparison
passed after rebuilding, and the original 24-market comparison still passes.
All nine Rust tests and lint checks pass.

## Observed prepared-feed timings

These are one measured pass per configuration, with tracing disabled. The full
trace passes read the sample before timing; there are no separate workload
warm-ups. Wall time includes process startup and result writing. No compilation
or trace verification time is included. The host was not isolated from other
work; background activity and recorded load averages can affect these one-pass
wall times. These are observations, not repeated-run capacity estimates.

| Workers |            TypeScript |               Rust | TypeScript / Rust |
| ------- | --------------------: | -----------------: | ----------------: |
| 1       | 3,484.511 s (58m 05s) | 480.295 s (8m 00s) |             7.25x |
| 4       |   927.350 s (15m 27s) | 124.361 s (2m 04s) |             7.46x |
| 8       |   649.260 s (10m 49s) |  66.903 s (1m 07s) |             9.70x |

Relative to one worker, TypeScript improves by 3.76x with four workers and
5.37x with eight workers. Rust improves by 3.86x and 7.18x, respectively.

Going from four to eight workers improves TypeScript wall time by 1.43x and
Rust by 1.86x. Worker counts limit independent processes; they are not CPU
affinity masks or limits on Node background threads. Each process runs its
market chunk sequentially. Results are restored to the original market order
and checked against the verified reference.

| Workers | Engine     |    CPU time | Average core equivalents | Sum of worker peak RSS |
| ------- | ---------- | ----------: | -----------------------: | ---------------------: |
| 1       | TypeScript | 4,167.969 s |                     1.20 |              677.9 MiB |
| 1       | Rust       |   476.770 s |                     0.99 |               62.3 MiB |
| 4       | TypeScript | 4,461.392 s |                     4.81 |            2,099.9 MiB |
| 4       | Rust       |   486.838 s |                     3.91 |              167.5 MiB |
| 8       | TypeScript | 5,087.887 s |                     7.84 |            3,627.5 MiB |
| 8       | Rust       |   507.536 s |                     7.59 |              299.2 MiB |

Average core equivalents are aggregate CPU time divided by wall time, not
fixed thread counts. RSS is the sum of each worker's peak, not a simultaneous
peak measurement.

## Existing production TypeScript baseline

The unmodified production replay, including raw daily-feed loading, completed
all 1,000 markets with four workers in **880.308 s (14m 40s)**. Its per-market
statistics and event counts matched the verified reference. Aggregate CPU time
was 4,319.312 s and the sum of worker peak RSS was 2,359.7 MiB.

Against four-worker Rust with prepared feeds, this is a contextual 7.08x time
difference. It is not a complete replacement benchmark: native daily-feed
loading is still missing. The prepared TypeScript reference took 927.350 s,
5.3% longer than the production baseline, so its ratio must not be described as
the measured production fleet speedup.

## Scope

This is a warm-cache local compute benchmark using prepared external feeds.
Original market Parquet decoding, real/synthetic ticks, strategy, FOK execution,
portfolio and per-market statistics are included. Native raw daily-feed
loading, batch/segment aggregation, queue/DB output, network and four-device
fleet execution are excluded from the native measurements. The separate
production TypeScript baseline above includes its raw daily-feed loading.

The Rust core specializes to the pinned BUY/FOK strategy and numeric book
structures. The gain combines language/runtime and implementation differences;
it is not a universal Rust multiplier. A production migration must share one
strategy/market core between live and replay. This experiment has no live
adapter and has not been activated in the fleet.

The result supports continuing with parallel Rust workers for the local compute
path: four workers give most of the first scaling gain, and eight nearly double
that throughput again. The next production evaluation should include native raw
feed loading, batch aggregation/output and the shared live/replay core before
measuring through the actual fleet. This sample does not establish a linear
100,000-market or multi-device speedup.

This remains a local experiment because the strategy and parameters originated
in a private protocol repository while the engine GitHub repository is public.
No branch has been pushed and no PR has been opened.
