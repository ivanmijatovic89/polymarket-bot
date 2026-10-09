# June 1,000-market benchmark with original daily feeds

Completed on October 6, 2026. With original Binance/Chainlink daily-feed
loading and preparation inside both timed paths, Rust was **6.08x faster with
four workers** and **7.19x faster with eight workers** on this 1,000-market sample.
Exact price-series parity, full replay trace parity, all timed result comparisons
and final input/source/binary checks passed.

Raw timings, runtime versions, load averages, original feed-file hashes, source
fingerprints and the release binary hash are saved in
[measurements-june-1000-raw.json](measurements-june-1000-raw.json).

## Inputs and included work

The market selection, strategy artifact and parameters are the same as in
[REPORT-JUNE-1000.md](REPORT-JUNE-1000.md): 1,000 valid resolved BTC 15-minute
markets from June 1, 2026 00:00 UTC through June 12, 2026 11:30 UTC; pinned
`overnight-opus55-lagsnipe.v15` artifact and run 9657 parameters. The 101
production Chainlink-gap exclusions remain unchanged. Strategy and execution
settings are fixed: 100 USDC capital per market, 500 +/- 20 ms execution delay,
110 ms Binance latency, 320 ms Chainlink latency, 2,700 ms price-to-beat delay
and deterministic per-market seed 123456789.

Both timed implementations now read the original market Parquets and the same
26 original Binance/Chainlink daily Parquets (183,772,152 bytes, about 184 MB).
Loading and preparing historical price series happens inside each timed run.
Prepared feed JSON is used only for untimed verification. Rust does not retain a
decoded daily-series cache across markets. It projects the necessary columns and
uses safe row-group bounds to avoid decoding irrelevant rows, then applies the
production seed, range, ordering and outage rules.

Included: process startup, original Parquet reads/decoding, Binance and Chainlink
seed/range extraction and sorting, outage checks, real and synthetic ticks,
strategy, delayed BUY/FOK execution, portfolio, per-market statistics and result
writing. Network, fleet scheduling, DB/queue output and batch/segment aggregation
remain outside this local comparison. Price-to-beat/catalog metadata is already
provided to both engines, as in the production worker replay contract.

## Correctness gates

The native raw-loader output matched the TypeScript production-loader series
exactly for every market: 21,509,932 Binance points and 1,174,466 Chainlink
points, including seeds and tails. Timestamps, ordering and prices matched with
no floating-point tolerance in this series comparison.

The runner validates the previous TypeScript full-trace reference's input,
source, runtime and output hashes, then compares newly generated native raw
replay traces in full. Every timed output must also match the reference market
statistics and event counts. Original market/feed inputs and the measured source
and binary are checked again at the end.

Full native raw replay trace parity passed: 196,834,457 replay events, 3,758
order decisions and 21,272 account events. Tick/feed digests, trading lifecycle
events, portfolio state and statistics matched the verified reference.

All 14 Rust tests, Rust lint and the experimental TypeScript type check pass.
New loader tests cover highest-ID seeds, same-timestamp Binance ordering,
Chainlink filtering by round time and ordering by broadcast time before
microsecond truncation, seeds across files, outage boundaries, missing inputs
and casting only relevant prices.

## Observed original-file timings

| Workers | Production TypeScript |               Rust | TypeScript / Rust |
| ------- | --------------------: | -----------------: | ----------------: |
| 4       |   847.073 s (14m 07s) | 139.323 s (2m 19s) |             6.08x |
| 8       |    523.633 s (8m 44s) |  72.781 s (1m 13s) |             7.19x |

Moving from four to eight workers improves TypeScript by 1.62x and Rust by
1.91x with raw daily-feed loading included. Every timed run matched all reference
market statistics and event counts.

| Workers | Engine     |    CPU time | Average core equivalents | Sum of worker peak RSS |
| ------- | ---------- | ----------: | -----------------------: | ---------------------: |
| 4       | TypeScript | 4,132.865 s |                     4.88 |            2,402.0 MiB |
| 4       | Rust       |   548.350 s |                     3.94 |              187.8 MiB |
| 8       | TypeScript | 4,447.542 s |                     8.49 |            3,956.9 MiB |
| 8       | Rust       |   559.304 s |                     7.68 |              360.9 MiB |

Average core equivalents are aggregate child-process CPU time divided by wall
time. RSS is the sum of individual worker peaks, not a simultaneously measured
peak. Node/DuckDB background threads are included in process CPU accounting.

These original-file results provide the more complete comparison for this
replay workload. Earlier prepared-feed measurements remain historical results
with a different input-preparation boundary; use the 6.08x/7.19x observations
when discussing the native prototype with raw daily feeds included.

## Measurement conditions

One Apple M1 Pro computer with 10 CPU cores and 16 GiB RAM; Node 20.11.0 and
Rust 1.89.0 release build. Worker counts refer to processes, not affinity masks
or fixed CPU/thread limits. Each worker processes a fixed market chunk
sequentially. Engine order alternates between worker configurations.

One measured pass per configuration, with tracing disabled. Input hashing,
series verification and native full-trace replay warm input files before timing;
no separate workload warm-ups are added. Compilation and correctness gates are
excluded. Process niceness is 10 and the host is not isolated from other work,
so these are observed timings rather than repeated-run capacity estimates.

The native strategy/book implementation remains specialized to the pinned
BUY/FOK strategy. This evaluates language/runtime and implementation differences
together; it does not establish a universal language multiplier. No production
registry/live adapter or fleet activation is included. Production migration
still requires a shared live/replay strategy and market core.

This experiment remains local because its strategy source and parameters came
from a private protocol repository while the engine repository is public. No
branch has been published or PR opened.
