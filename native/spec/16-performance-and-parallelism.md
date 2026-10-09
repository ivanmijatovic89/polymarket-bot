# 16 — Performance and parallelism

Speed is the top priority of the native engine (01 §1 item 6, §2; R8). This document designs the fastest architecture for backtest throughput on
the fleet and for minimum live decision latency. All of it sits inside the
determinism rule R7 and the gates. It owns the performance model, the
executor's thread and scheduling model, shared caches and the memory budget,
the choice of input decode path (including the derived native tape of §7.5)
and order-book layout, candidate-group layout and parallelism, the tick
interest filter (§9.4), the Apple P-core/E-core and QoS policy, the published
build-profile rule, allocator and profiling tools, the live runtime's
async-runtime and wake strategy, the latency budget breakdown and report
format, the per-run fixed-cost plan (§13.9), and the benchmark protocol with
its host, windows and profiling milestones. It also records which choices are
decided now and which wait for measurement (§15). All engine builds, parity
runs and benchmarks before M6 run on worker-1 (D36). Process contracts
(`serve` framing) are in 20-binary-protocol.md. Shim, admission and host
configuration are in
40-fleet-integration.md. Decode semantics are in 15-inputs.md, feed-cache
semantics in 14-feeds-and-plugins.md, group semantics in
41-candidate-groups.md, and live thread roles and latency targets in
50-live-runtime.md. This document references those and does not restate them.

## 1. Ownership

| Topic | Owner |
|---|---|
| Performance model, default architecture, decision register | this document |
| Executor thread pool, scheduling, nested group parallelism, determinism under parallelism | this document |
| `serve` invocation, NDJSON framing, `--threads`/`--cache-mb`/`--qos`/`--tape-dir` flags, crash attribution | 20-binary-protocol.md §6 (this document defines the `--qos` values and mechanism, §10.2, and the tape lookup behind `--tape-dir`, §7.5) |
| Shim process model, admission weights, per-host thread budget, `native_memory_mb`, `overheadFraction` | 40-fleet-integration.md §5, §7 (this document's `T` is 40's CPU token count `C`; this document's `C` is per-candidate cost, §3) |
| Telonex / V4 decode semantics, format versions | 15-inputs.md (this document chooses the decode *implementation path*) |
| Derived native tape: encoding, tool, validation, disk plan | this document (§7.5); equality with the 15 §4.2 reader is the acceptance rule |
| Feed day-cache semantics and slicing | 14-feeds-and-plugins.md §14 (this document sets the budget and the measurements) |
| Hot-loop allocation rules on domain types and the core loop | 10-domain-model.md §11, 12-engine-core.md §14, 30-strategy-sdk.md §16 |
| Order-book representation | this document (10 §11 P6 delegates it here) |
| Group isolation and equivalence | 41-candidate-groups.md §2, §5 (this document chooses layout and fan-out) |
| Tick interest filter | this document owns the design (§9.4, D41); the API is 30 §4.1, the loop step 12 §5.3 |
| Live thread roles, QoS per role, latency targets, required techniques | 50-live-runtime.md §4.2, §18 |
| Live async runtime, wake strategy, latency budget breakdown, report format | this document |
| Engine-owned platform crate (the only `unsafe` in the workspace) | this document (§10.2); its live uses are 50 §4.3–§4.4 |
| Build profile definition | 31-artifacts-build-publish.md §4.1–§4.2 (this document owns the adoption rule and runs the measurement, §11.2) |
| Per-run fixed costs: measurement and reduction plan | this document (§13.9); the code belongs to 40 (producer, shim) and 42 (aggregator, persistence) |
| Benchmark protocol, benchmark host and windows, profiling milestones | this document (host per D36); acceptance of parity is 60-verification.md |

## 2. Evidence

### 2.1 Today and the Codex prototype

| Fact | Evidence |
|---|---|
| TS runs one Node child per slot because Node is single-threaded; slot count = `cores_for_backtest`, else cores−2 | `src/cli/backtestWorker.ts:132-158`, `scripts/run-worker.sh:29-50` |
| TS averages 1.2–2.6 s per market per process | requirements-sweep `cpu-slots-and-job-granularity` |
| TS re-opens Binance and Chainlink day files through DuckDB for every market and every candidate | approach-audit market-data audit (`binanceAggTradesSource.ts:70-86`, `chainlinkCryptoPricesSource.ts:106-125`) |
| TS rebuilds full level arrays and cumulative depth for both assets on every tick; books are float-keyed Maps re-sorted on insert | approach-audit (`OrderBookEngine.ts:50-70,116-117,184-189`) |
| The current native path spawns one process per job with no timeout and verifies the hash once per Node process | `src/strategy/artifacts/native.ts:46-55,88-121`, `src/backtest/marketProcessor.ts:49-62` |
| Codex prototype: 1,000 June BTC 15m markets, lagsnipe.v15, 8 processes, one Rust process per market: TS 617 s, Rust 99.6 s (6.19×). 198,227,628 replay events (≈198 k per market). Both ran at nice 10 with uncontrolled background load | research/early-audits.md:51; Codex `REPORT-END-TO-END.md:7,58,64` |
| Codex per-run fixed phases (medians, both engines alike): producer launch → first market 1.33 s; aggregation, MySQL commit and Redis child cleanup 0.79 s | Codex `REPORT-END-TO-END.md`, phase table |
| The prototype read Parquet through the row API (`get_row_iter`, `Field`), and 50.6% of its profile was row reconstruction, 16.1% decode/validation, 8.7% book, 3.6% feeds | Codex `src/main.rs:15,452` (market file, all columns), `src/raw_feeds.rs:9,176`; `SHARED-PARAMETER-REPLAY-CONTINUATION.md:32` |
| Prototype shared replay on `btc-updown-15m-1780925400` (449,314 rows): 1.666 s standalone; 100 candidates 3.98× faster than sequential; peak RSS 34.6 MiB | `SHARED-PARAMETER-REPLAY-CONTINUATION.md:9,21-30` |
| Arrow IPC storage: 1.34× faster replay, 25× larger files (rejected) | `SHARED-PARAMETER-REPLAY-CONTINUATION.md:34` |
| Telonex `delta-typed` files: written by parquetjs, GZIP, PLAIN encoding, no dictionary, 4,096-row groups. Prices and sizes are **decimal strings** in repeated UTF8 columns. `market`, `asset0_id`, `asset1_id` (a 66-character condition id and two ~77-digit token ids) are repeated as strings on every row | `src/parquet/io/eventSchema.ts:53-69`; `node_modules/@dsnp/parquetjs/dist/lib/writer.js:61`; `parquet_metadata()` of `btc-updown-15m-1789076700` (243,912 rows, 60 row groups) |
| Local dataset: 31,186 BTC 15m files, 52 GB (1.67 MB average); BTC 5m: 6 files. worker-1 holds all 31,186 files plus the Binance day files and has 77 GB free; m1-ivan has 2.6 GB free and does no engine work. No new Telonex data arrives until the subscription is renewed | `du`/`ls` of `data/events/telonex/delta-typed/btc/`, `df -h` (2026-10-09); D36, D38 |
| GR screens and coordinate passes re-run the same `--latest --limit 1000` market set, one run per value | 41 §1 (`strategy-research-protocol/tools/runBacktest.md:62-80`) |
| WIP reader is already column-wise (`read_records`, buffer reuse, row-group pruning), but it allocates a `Vec` per event (`MarketEvent::Book{bids,asks}`, `PriceChange{changes}`), books are `BTreeMap`, and the GZIP backend is miniz_oxide (`flate2-rust_backened`) | `native/crates/pmb-replay/src/pq.rs:36-121,140-169`; `telonex.rs:245-318`; `pmb-core/src/market.rs:18-30,80-90`; `native/Cargo.toml:15` |

### 2.2 Micro-measurements on m1-ivan (2026-10-09, this document)

These come from throwaway scratch programs, not the WIP crates (the WIP does
not compile). Setup: parquet 56.2 with the WIP features (miniz_oxide GZIP),
zstd 0.13.3, thin LTO, codegen-units 1, on m1-ivan (M1 Pro 8P+2E). Load
average was about 3–4 from interactive apps, and the page cache was warm. The
programs read the file into memory, decode columns with `read_records`, parse
the decimals into 1e6 fixed point and build a struct-of-arrays tape or apply
the events to a book. The numbers are indicative. The M1 step 7 harness on
worker-1 (§13) replaces them.

| Phase (one thread) | Mean of 21 markets spread over the dataset (132,813 rows, 318,738 levels) | Heavy market `btc-updown-15m-1780925400` (449,314 rows, 1,075,793 levels) |
|---|---|---|
| v1 file size | 1.84 MB | 6.44 MB |
| open + footer | 2.0 ms | 1.2–2.2 ms |
| page decompression only (GZIP) | 33.4 ms | 103–110 ms |
| column decode incl. decompression, all 16 columns | 62.6 ms (471 ns/row) | 214 ms |
| decimal parse + book apply, `BTreeMap` book | 14.1 ms (106 ns/row) | 49 ms |
| decimal parse + book apply, dense ladder (0.001 grid, 1,001 slots) + bitset | 10.5 ms (79 ns/row) | 36 ms |
| v1 → SoA tape, all 16 columns (decode + parse + tape build) | 68.9 ms | 231 ms |
| v1 → SoA tape, 12 columns (without `ingest_seq`, `market`, `asset0_id`, `asset1_id`) | 45.2 ms (−34%) | 154 ms |
| uncompressed SoA tape (20 B per event + 14 B per level) | 7.1 MB | 24.0 MB |
| **derived tape, raw SoA + zstd level 3: size / decode to tape** | **0.82 MB / 5.2 ms** | **2.92 MB / 17.4 ms** |
| derived tape, flat Parquet INT64/INT32 + ZSTD level 3, 64 k-row groups: size / decode | 0.99 MB / 7.3 ms | 3.46 MB / 25.4 ms |
| encode an in-memory tape (raw / Parquet) | 12.1 / 20.6 ms | 44.7 / 70.8 ms |
| Codex prototype, same market | — | ≈1.25 s of 1.666 s in decode phases |

Both derived encodings were decoded back and asserted equal to the tape built
from v1 on all 22 files. zstd level 1 gave the same size and decode time as
level 3. The prototype tape holds the event stream only (no `ingest_seq`, no
per-row id index), so the lossless tape of §7.5 NT-2 will be somewhat larger;
M1 step 7 measures it.

| Threads (80 markets, own book per market) | 1 | 2 | 4 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|
| markets/s | 13.3–14.0 | 24.4 | 44.8 | 60.9 | 73.8 | 77.4 |

| Other measurement | Result |
|---|---|
| BTCUSDT aggTrades day (945,839 rows, 8 row groups, ZSTD), 4 columns | whole day 27 ms; one row group 3.8 ms |
| Chainlink `crypto_prices` day (85,070 rows, 1 row group, SNAPPY, string prices) incl. f64 parse | 9 ms (no pruning is possible: one row group) |
| Process spawn of a Rust binary with parquet linked, from a shell | 4.5 ms per spawn (`/usr/bin/true`: 2.0 ms) |
| Ticks that change any of the 4 best prices (21 markets, 2,789,073 events) | 1.2% |
| Ticks that change a best price or the size at a best price | 16.3% |
| Default `target-cpu` of `aarch64-apple-darwin` vs `apple-m1` | identical feature set (28 features); `apple-m4` adds `bf16`, `bti`, `i8mm` |

Findings:

1. A plain column-wise reader is already about 5× faster than the
   prototype's row API on the same market. In this format, GZIP
   decompression is about half of the column-read time.
2. On the M1 Pro, decode scales 5.3× from 1 to 8 threads. Adding the two
   E-cores gains about 5%.
3. Per-market feed decoding without a cache costs about 13–17 ms (one Binance
   row group plus the whole Chainlink day). That is about 20% of the market
   decode, and a shared cache brings it to near zero.
4. Book layout matters less than decode: the dense ladder saves about 25% of
   the parse-and-apply loop and about 5% of total decode.
5. Process spawn plus re-decoding feeds and footers adds about 15–30 ms per
   market. That is the same order as an optimized market.
6. Column projection alone cuts v1 decode by a third. Most of it is the three
   repeated id strings (about 220 bytes per row before compression).
7. **The v1 format itself is the largest remaining single-market cost.** A
   derived native tape decodes 13× faster than full v1 and 8.7× faster than
   projected v1, at 45% of the v1 size. Building it costs about 86 ms of CPU
   per market (v1 decode 69 + encode 12 + verify 5), so encoding all 31,186
   BTC 15m files takes about 45 CPU-minutes, about 8–9 minutes on the M1
   Pro's 8 threads, and about 23–26 GB of disk.

### 2.3 Hardware and host facts

| Host | Chip | Cores | L2 | RAM | `cores_for_backtest` | Role for this goal |
|---|---|---|---|---|---|---|
| worker-1 | M4 | 4P + 6E | to record via sysctl in M1 step 7 | 16 GB | 8 (`machines.json:34`); 6 TS slots (40 §2) | **engine host** (D36): goal session in its own checkout, builds, parity runs, every benchmark before M6; also a fleet worker (markets + aggregate), Redis, MySQL and Global Runtime sessions; 77 GB free |
| worker-2 | M4 | 4P + 6E | as worker-1 | 16 GB | 8 (`machines.json:52`); 3 TS slots | M6 fleet host with about 3 native slots; Recorder V4 kept clean |
| m1-milan (inventory alias `milan-m1`, D55) | M1 Pro | 6P + 2E | — | 16 GB | 4 (`machines.json:87`) | M6 fleet host if available |
| m1-ivan | M1 Pro | 8P + 2E (`hw.perflevel0/1.physicalcpu`) | 2 × 12 MB P clusters (4 cores each), 4 MB E cluster; L1d 128 KB P / 64 KB E; 128-byte lines | 16 GB | 4 (`dashboard/src/data/machines.json:16`) | producer only; no engine work or benchmarks (2.6 GB free); host of §2.2 |
| m5-milan | M5 Pro | 6 "Super" + 12 "Performance" | — | 64 GB | 12 (`machines.json:69`) | not in the M6 fleet |

- `geekbench6Multi`: M4 14,724 vs M1 Pro 12,359 (`machines.json`). With only
  4 P-cores, the M4's lead suggests that its 6 E-cores carry a large share of
  multi-core throughput: an estimate of about 40%, or about half a P-core
  each. 40 §7.3 estimates a third. M1 step 7 and M5a measure it on worker-1
  (§10.3).
- The worker-1/2 backtest services run as launchd `ProcessType Background`
  (`ops/macos/worker-1/com.polymarket.backtest-worker.plist:37-38`), and
  `run-worker.sh:52-59` lifts the resulting QoS clamp with `taskpolicy -a`.
  A process left clamped can be confined to E-cores.

## 3. Performance model

Per market job, for N candidates:

```
cost(job) = F + D + V + N · C
  F  fixed per-job overhead: spawn (if any), IPC, JSON, footer parse, job setup
  D  shared market work: read, decompress, decode, tape build, book apply
  V  feed work: Binance/Chainlink decode (≈0 with a warm shared cache)
  C  per-candidate work: engine loop, plugins, strategy, simulator, stats, output
```

Per run of M markets on a fleet with aggregate throughput Θ:

```
wall(run) = L + M · cost(job) / Θ + A
  L  launch: producer start → first market job active (Codex: 1.33 s)
  A  tail:   last market job done → run committed in MySQL (Codex: 0.79 s)
```

- TS sweeps pay `N · (F + D + V + C)` because every grid cell is a separate run
  (41 §1). The prototype paid a large `F` (process per market), a large `D`
  (row API) and an uncached `V`.
- **Single runs** gain from cutting `D` (decoder §7, derived tape §7.5) and
  `F + V` (long-lived executor and caches, §5–§6). **Sweeps** gain from groups
  (§9), and once `D` is optimized, `C` dominates. Optimizing the decoder
  therefore *lowers* the relative group speedup, `(D + C)/C`, while it lowers
  absolute times. After M5a the per-candidate cost `C` is the main lever for
  sweeps, and the tick interest filter (§9.4) is the largest known cut in it.
- Planning estimate (a projection, not a measurement or target; the Codex
  report warns against multiplying ratios, `SHARED-…CONTINUATION.md:46`),
  assuming `C` ≈ 30 ms for a single lagsnipe-like candidate:

| Input path | D per average market | cost(job) | M1 Pro, 8 threads (§2.2 basis) | 1,000 markets, one host |
|---|---|---|---|---|
| v1, all columns (§2.2) | ≈ 75 ms | ≈ 105 ms | ≈ 50 markets/s | ≈ 20 s |
| v1 after DC-1–DC-5 | ≈ 40 ms | ≈ 70–80 ms | ≈ 70 markets/s | ≈ 15 s |
| derived tape (§7.5) | ≈ 5 ms decode + 5–10 ms reader and book | ≈ 45 ms | ≈ 120 markets/s | ≈ 8–9 s |

  M1 step 7 replaces these with worker-1 numbers (4P+6E; §2.3).
  For comparison: Codex Rust 99.6 s, TS 617 s. Spread over the fleet, the
  compute of a 1,000-market single-candidate run falls to a few seconds, the
  same order as `L + A` ≈ 2.1 s. **Per-run fixed costs then decide agents'
  iteration latency** and get their own deliverable (§13.9).

## 4. Default architecture (recommendation)

```
fleet host
└─ TS worker supervisor (one Node process)                     [40 §5]
   ├─ BullMQ Worker on the native queue, concurrency T + P    (locks, retries, stalled, heartbeats stay TS)
   ├─ per active artifact sha: one `serve` executor process    [20 §6]
   │    ├─ IPC reader thread  (NDJSON stdin → job queue)
   │    ├─ IPC writer thread  (results → stdout)
   │    ├─ engine pool: T threads, work-stealing (rayon), QoS from --qos
   │    │    job = read tape (or v1) → tape (Arc) → session(s) → result
   │    │    group job: tick-major over the shared book; candidate chunks fan out to idle threads
   │    └─ shared immutable caches (Arc, single-flight, LRU by bytes within --cache-mb)
   │         feed days (Binance, Chainlink), footers, rules tables
   └─ derived native tapes on disk (read-only for executors; written only by pmb-tape)  [§7.5]
live host
└─ live runtime                                                 [50 §4.2]
   core thread (plain, deterministic loop) ⇄ bounded rings ⇄ ingress / egress threads
   (each runs a tokio current_thread runtime); journal and telemetry at UTILITY
```

1. No per-market process spawn on the fleet path. One long-lived executor per
   artifact per host (20 §6, 40 §5.1).
2. Rust never talks to Redis. TS keeps BullMQ (§5.2).
3. One work-stealing pool per executor, sized `T` threads. There is no async
   runtime in backtests.
4. Whole-file read into memory, direct column decode into a compact,
   allocation-free struct-of-arrays tape, shared by `Arc` (§7).
5. **Derived native tape files as the primary market input when present**
   (§7.5; built on worker-1 within a 40 GB cap before G2; final yes at G2
   with measured numbers, M-20). v1 stays the canonical dataset and the
   fallback, is never re-converted, and both paths give byte-identical output.
6. Dense price-ladder books with occupancy bitsets (§8).
7. Groups replay tick-major over one shared book. Plugins with identical
   configs are computed once. Large groups fan out to idle threads (§9).
   New Rust strategies MAY opt into the tick interest filter (§9.4).
8. QoS-steered threads; `T` and QoS per host decided by measurement (§10).
9. Published, fleet and live binaries use the fastest-running reproducible
   `artifact` profile chosen by §11.2; the fast-compile `iterate` profile
   (D18) serves local checks only.
10. Live: a plain core thread plus dedicated I/O threads with current-thread
    runtimes, spin-then-park hand-off, preallocated buffers (§12).
11. Per-run fixed costs (producer launch, flow creation, aggregation) are
    measured per phase and reduced as a deliverable (§13.9).

## 5. Executor and fleet process model (requirement a)

### 5.1 Options

| Option | F per market | Shared caches | BullMQ semantics | Isolation | Verdict |
|---|---|---|---|---|---|
| Process per market (prototype, `run`) | spawn 4.5 ms + JSON + footers + feed re-decode ≈ 15–30 ms | none across markets | unchanged | strongest | Debug, parity tooling and the benchmark baseline only (40 §5.1.4) |
| **Long-lived executor per artifact per host, thread pool (`serve`)** | JSON + IPC ≈ 0.1 ms | feeds, footers, rules across markets and candidates | unchanged (TS shim) | per process; crash attribution (20 §6.3 S5) | **Default** |
| Rust consumes Redis directly | lowest | same as `serve` | must re-implement BullMQ's Lua command set, lock renewal, stalled handling, flow parent updates, and track BullMQ upgrades | needs Redis credentials and network inside agent-written binaries, which conflicts with the env allowlist and deny-network sandbox (40 §6.2) | **Rejected for v1** |
| Engine embedded in Node (N-API) | lowest | yes | unchanged | none (a crash kills the supervisor) | Rejected (40 §5.1.2) |

### 5.2 Requirements

| # | Requirement |
|---|---|
| EX-1 | The fleet path MUST use `serve` (20 §6). One executor process hosts one artifact (20 §6.3 S9). |
| EX-2 | BullMQ stays entirely in TS. The shim's event loop does only I/O, so per-job lock renewal (`lockDuration` 3 min, `src/backtest/queue.ts:116-120`), stalled detection, `attempts: 3` with backoff (`queue.ts:85-90`) and the worker heartbeats keep working unchanged. Hung jobs are bounded by the cooperative deadline and the TS backstop (20 §6.3 S4). |
| EX-3 | Redis round trips are hidden by prefetch, not amortized by bigger jobs: BullMQ concurrency `T + P` (40 §5.1.5), one market (× K candidates) per job (40 §7.5). Moving to multi-market jobs is allowed only on the measured rule of 40 §7.5.3. |
| EX-4 | The executor MUST NOT read the wall clock, env or network for behavior (R7). Pool size, cache budget, tape root and QoS are process configuration, not job behavior, and MUST NOT change outputs. |
| EX-5 | Engine entry points are library functions: `run_job(&EngineJob, &SharedCaches, &CancelToken) -> EngineResult`. They have no globals, no process-wide mutable state and no stdout writes (01 §2 S1). `run` and `serve` call the same function, which keeps results byte-identical (20 §6.3 S1). |
| EX-6 | Pool threads MUST have an 8 MiB stack (the size of the main-thread stack in the `run` path), so a strategy that runs under `run` also runs under `serve`. A stack overflow aborts the process and is handled by crash attribution (20 §6.3 S5). |
| EX-7 | Cooperative cancel and deadline checks run at least every 4,096 events (20 §6.3 S4), as one relaxed atomic load per batch, never per event. |
| EX-8 | A job MUST NOT block a pool thread on I/O beyond its own file reads. Reads are whole-file `read` calls (§7). Executor-side read-ahead is added only if the measured I/O wait exceeds 2% of job time (§15). Remote inputs are fetched by the shim (40 §6.1). |
| EX-9 | Idle pool threads park. An idle executor MUST use < 1% of one core (measured). That way several executors per host (≤ `maxExecutors`, 40 §5.1.3), each with `T` threads, never oversubscribe: admitted weight ≤ `T` across all of them (40 §7.2). |

### 5.3 Scheduler

- The pool is a dedicated `rayon::ThreadPool` (not the global pool), built
  with `num_threads(T)`, `stack_size(8 MiB)`, thread names `pmb-engine-<i>`
  and a `start_handler` that sets thread QoS (§10.2).
- The IPC reader thread hands each admitted job to the pool with
  `ThreadPool::spawn`. Jobs injected from outside the pool are taken FIFO, so
  the oldest admitted job starts first.
- Group jobs use nested data parallelism (`par_chunks` over candidate chunks,
  §9.3). Idle threads steal chunks. A thread that waits on a nested join keeps
  executing other work (rayon semantics), so nesting cannot deadlock the pool.
- A plain thread-per-slot model pulling from a channel is the measured
  alternative for single-candidate jobs (§15). It cannot fan out groups.
- The executor uses no tokio and no async: backtest work is CPU-bound, and
  IPC needs only two blocking threads.

### 5.4 Determinism under parallelism

| # | Requirement |
|---|---|
| DP-1 | A job's deterministic output is a pure function of (binary, job). It MUST be byte-identical for every `T`, every admission order, every co-scheduled job, every cache state (cold, warm, evicted and rebuilt), tape present or absent (§7.5), and every group layout (R7, 41 §2.2). |
| DP-2 | Shared state is immutable once published. A cache entry is built completely, then published with single-flight semantics (one builder per key, the others wait). Its contents depend only on the source bytes (20 §6.3 S3). |
| DP-3 | Hash maps are used only for lookups (cache index, cid map with a fixed-seed hasher). No iteration over a `HashMap` affects output (10 §12 D-1). |
| DP-4 | No thread-local RNG. Draws are stateless functions of the run seed, the slug, the stream tag and the entity (10 §6.1). |
| DP-5 | Timings, cache hit counts, the input path taken (tape or v1), thread ids and RSS go only into non-deterministic sections and frames (20 §6.2 `progress`/`pong`, the diagnostics section of 21), never into the deterministic result. |
| DP-6 | Every optimization commit runs the determinism suite on worker-1: the `smoke-50` set at `T = 1` and `T = max`, cold and warm cache, tape and v1 path, shuffled job order, with hashes of the deterministic sections compared (§13.7). GitHub CI has no macOS runner per PR; it runs the fixture-market subset (60 CI-1). |

## 6. Shared caches and memory (requirement b)

### 6.1 Cache catalog

All in-memory caches are per executor process, immutable, `Arc`-shared across
jobs, candidates and threads, single-flight, and evicted LRU by bytes within
`--cache-mb` (default 1024, 20 §6.1). An entry in use is never evicted.

| Cache | Key | Unit and size | Hit pattern | Semantics owner |
|---|---|---|---|---|
| Binance aggTrades day | (path, size, mtime_ns, sha256 when given) | decoded day, ≈23 MB (`ts_ms`, `agg_trade_id`, `price`, `qty` as SoA) | one day serves 96 BTC 15m or 288 BTC 5m markets | 14 PF-1/PF-2 |
| Chainlink `crypto_prices` day | same | decoded day, ≈2 MB (prices parsed once from strings) | as above; no row-group pruning possible (1 group/day) | 14 |
| TechnicalIndicators candles | (pair, interval, date), built from the Binance day entry | KB–MB per day | every TA strategy market of the day, incl. the extended lookback days (D19 as amended: local aggTrades, no network) | 14 PF-5, §12.5 |
| Parquet footers of feed files | file identity | KB | every market of the day | this document |
| Rules tables | rules version | KB | all jobs | 11 |
| **Derived native tape (disk, §7.5)** | (tape format version, v1 identity) | ≈0.8 MB per average market on disk; the OS page cache keeps hot tapes | every run after the one-time build, on every host | this document; equality with 15 |
| Decoded market tape in RAM (optional) | market file identity | ≈9 MB per average market, ≈31 MB heavy (§7.3) | the same slug again within minutes | this document; only without §7.5 (M-11) |

- File identity MUST include size and mtime, and the job's sha256 when it
  carries one, so a file rewritten by the self-healing download
  (`binance:download-aggtrades --sync`, `.repair-backups/` exists in
  `data/binance/aggTrades/BTCUSDT/`) is never served stale.
- The whole-day unit (14 PF-1) is the default. It costs 27 ms per day and is
  amortized over every market of that day in the run. A run whose day span
  does not fit the budget (about 40 days at 1 GB) thrashes. The executor
  reports day-cache hits and misses (14 PF-7). If a measured thrash rate is
  material, 14 PF-3's row-group path (3.8 ms per row group) is used for misses
  under memory pressure (§15).
- Dispatch order affects hit rate, never results. The producer SHOULD enqueue
  native market jobs in `market_start_ms` order even for `--random` selections
  (`idx` keeps the selection order for the aggregator), so consecutive jobs
  share days. 40 owns the producer change.
- Cross-process sharing (shared memory or mmap'd caches between executors) is
  not used in v1: it needs `unsafe` and adds failure modes. Duplication is
  bounded by `maxExecutors = 3` (40 §5.1.3).
- A RAM LRU of decoded tapes cannot hold a 1,000-market screen (≈9 GB), and
  BullMQ spreads repeat runs over the fleet hosts. With the disk tape a decode costs
  ~5 ms, so the RAM LRU saves little. It is measured only if §7.5 is not
  adopted (M-11).

### 6.2 Memory budget on 16 GB hosts

| Consumer | Estimate | Basis |
|---|---|---|
| macOS, WindowServer, agents and GR sessions | 4–6 GB | to measure on worker-1 in M1 step 7, other hosts in M6 |
| Redis (worker-1) | peak 1.15 GB | requirements-sweep `sweep-result-volume-redis-db` |
| MySQL (worker-1, `ops/macos/worker-1/com.polymarket.mysql84.plist`) | 1–2 GB | to measure |
| TS supervisor and shim | ≈0.2 GB | to measure |
| Goal session and cargo builds (worker-1, during this goal) | 1–4 GB peak (LTO links) | to measure in M1 step 7; builds cap jobs per 31 §4.5 |
| All native executors of the host | ≤ `native_memory_mb` (default 3,072, 40 §7.4) | — |

Per executor at `T = 8`:

| Item | Estimate |
|---|---|
| In-flight tapes | T × 9–31 MB ≈ 75–250 MB |
| In-flight file buffers | v1: T × 1.7 MB average, 6.4 MB heavy ≈ 15–50 MB; derived tape: T × 0.8–2.9 MB ≈ 7–25 MB |
| Feed day caches | ≈25 MB per day; 30 days ≈ 750 MB (inside `--cache-mb`) |
| Candidate state | ≤ 0.35 MB per candidate (prototype: 100 candidates, 34.6 MiB peak RSS) |
| Code, IPC buffers, stacks | 8 × 8 MiB stack reservation (touched pages only) + ≈20 MB |

The TS path today runs up to 8 Node children (6 on worker-1) of ~200–400 MB each. The executor
SHOULD stay well under that. Peak RSS per executor is reported by every
benchmark row (§13.5).

## 7. Input decode and the hot loop (requirement c)

### 7.1 Where the time goes

For an average market (§2.2), v1 decode costs ~70–75 ms on one thread: ~33 ms
GZIP, ~30 ms building typed column values (one `ByteArray` per decimal
string), ~10–14 ms decimal parse and book apply, ~2 ms footer. A third of it
is spent on columns the engine does not need per row. TS spends 1.2–2.6 s on
the whole market, so decode is about 3–6% of today's TS time, but it is the
largest single item left once the engine is allocation-free. The derived tape
(§7.5) removes ~90% of it.

### 7.2 Requirements

| # | Requirement |
|---|---|
| DC-1 | Read each market file with one whole-file `read` into an owned `Bytes` buffer and parse Parquet from it (`SerializedFileReader<Bytes>`), so page buffers are slices of that buffer with no per-page syscalls. `mmap` is not used (it needs `unsafe`, `native/Cargo.toml:24`). |
| DC-2 | Project only the columns the reader needs (15). `market`, `asset0_id` and `asset1_id` MAY be skipped when the row-group statistics prove them constant and equal to the expected value (min = max = expected, non-null). That requires an audit of statistics on 1,000 files, and the decoded path stays as the fallback. Measured gain of skipping these three plus `ingest_seq`: 34% of v1 decode (§2.2); `ingest_seq` stays decoded while 15 §8 counts `ingestSeqBackwards`. Adopted on the measured rule (M-3). |
| DC-3 | Decimal strings are parsed straight into fixed point (or a ladder index, §8) in one pass over the column values. The intermediate `Vec<ByteArray>` is removed by a direct PLAIN-page decoder over decompressed page bytes (`[u32 len][bytes]…` plus RLE/bit-packed levels). The decoder MUST refuse any page encoding or layout it does not implement and then use the generic `ColumnReader` path. Both paths are covered by an equality test on the bench sets (M-2). |
| DC-4 | The decoder output is a struct-of-arrays tape (§7.3) built per row group. Engine batches are row-group sized (`Session::run(&[Envelope])`, 12 §14 P10). No `Vec` per event, no `Arc<str>` comparisons per row (the WIP does both, `telonex.rs:245-318`, `market.rs:155-157`). Token ids map to `Outcome` once per file or row group (10 §11 P4). |
| DC-5 | The GZIP backend is chosen by measurement (15 IP-3): miniz_oxide (WIP), zlib-rs (parquet's default feature `flate2-zlib-rs`) and, through the direct page decoder, libdeflate (C). Pure-Rust backends are preferred unless a C backend is ≥ 1.3× faster on total decode. C dependencies MUST also pass the reproducible-build rule of D17 / 31 (`zstd-sys` is already one). |
| DC-6 | A single market MAY decode its row groups in parallel (order-preserving concatenation) only when the executor has idle threads, at the end of a run or for single-market runs. Adopted only if the tail is ≥ 10% of run wall time (§15). |
| DC-7 | Pre-window rows are not skipped in v1 (15 IP-4). |
| DC-8 | V4 decode follows 15 IP-5. V4 and live journals use the same tape layout, so the session code path is identical. |
| DC-9 | The structural fix for v1 decode cost is the **derived native tape (§7.5)**, a first-class option prototyped in M1 step 7 and decided at G2 with its numbers. It is not a last resort behind DC-1–DC-5: those still matter for the v1 fallback path and for building tapes, but with tapes adopted, DC-2 and DC-3 are kept only if they are cheap (M-2, M-3). The canonical v1 files are never re-converted (gate 1), so a canonical version 2 (15 §4.4) is not pursued for speed. |

### 7.3 Tape layout

```
Tape (immutable, Arc, one per market read)
  events:  Vec<EventRec>      // 32 B: ts_exchange_ms i64, ts_local_ms i64, kind u8,
                              //       outcome u8, flags u8, first u32, count u16
  levels:  Vec<LevelRec>      // 16 B: ladder index u16/u32, side u8, outcome u8, size i64 (1e6)
  meta:    rows read, rows skipped by reason, anomaly counters, file identity, outcome map
```

- Size: measured 2.4 levels per event (§2.2), so about 70 bytes per event in
  this padded layout: ~9 MB for an average market and ~31 MB for the heavy
  one (the packed SoA form of §2.2 is 7.1 MB and 24 MB). The working set of
  a 4,096-event batch is ~290 KB, which fits the L2 of both core types.
- Off-grid prices (not a multiple of the ladder unit) are stored in an
  overflow side table and handled per 15's data-anomaly policy. The layout
  never changes semantics (§8).

### 7.4 Allocation-free hot loop

The rules are in 10 §11, 12 §14 and 30 §16 (reused intent sink, borrowed
views, integer ids, lazy per-tick metrics). This document adds the
verification:

| # | Requirement |
|---|---|
| HL-1 | A test-only counting global allocator MUST assert zero heap allocations per tick in steady state for ticks that produce no intents and no account events (on `heavy-1`, after warm-up). Allocations are allowed only for new orders beyond the reserved capacity and at output. |
| HL-2 | `TraceSink` and the per-phase timers compile to nothing when disabled (12 §14 P12, 22). The benchmark always runs with them off. |
| HL-3 | `#[inline]` on small hot functions of the engine crates (book ops, fixed-point ops, view accessors), so cross-crate inlining works without LTO under the 31 §4.2 profile. |

### 7.5 Derived native tape (NT)

The canonical v1 files cost GZIP, decimal strings and three repeated id
strings on every read (§2.2 finding 7). A derived, engine-owned, lossless
re-encoding removes that cost without changing the canonical dataset, the TS
converter, R2 or main. Repeat reads are the common case: GR screens and
coordinate passes re-run the same `--latest --limit 1000` set (41 §1), and
every grid cell re-reads every market until groups exist.

| # | Requirement |
|---|---|
| NT-1 | **Identity.** A tape file is a derived artifact keyed by (tape format version, v1 identity = bytes, mtime_ns and the sha256 computed during conversion). It never replaces, rewrites or re-converts the v1 file (gate 1). Deleting all tapes only makes runs slower. |
| NT-2 | **Content.** A complete typed encoding of everything the 15 §4.2 reader consumes from each v1 row, in file order: `ingest_seq`, `ts_local_ms`, `ts_exchange_ms` (with nulls), event-type code, asset index, book levels and changes as fixed-point i64 (1e6) with the per-value flags that 15 §8 counts (for example `inexact_decimal`). The market and token ids are stored once in a per-file dictionary, with a per-row index. The reader's skip and anomaly logic runs on these typed rows exactly as on v1 rows. A change of reader semantics therefore does not invalidate tapes; only a change of the typed-row layer bumps the tape format version. A file with a value the encoding cannot represent as the reader would see it (unparseable decimal, unknown event type, more distinct ids than the dictionary allows) is not converted and stays on the v1 path. |
| NT-3 | **Encoding.** Column-wise little-endian arrays, delta-coded timestamps and sequence numbers, one zstd frame per column per ~64 k-row block with zstd frame checksums on, and a header (magic, format version, v1 identity, row and level counts, tool binary sha, block offsets). Flat Parquet INT64 + ZSTD is the measured alternative (M-19). In the prototype it was 40% slower to decode and 20% larger, but DuckDB can read it. |
| NT-4 | **Writer.** Only the trusted, engine-owned `pmb-tape` tool writes tapes. It is built canonically from the engine workspace (on fleet hosts per host during provisioning, with its sha checked against the release, 40 §6.3) and is never a strategy artifact. It writes atomically (tmp → rename) and skips files whose tape is valid. Every conversion decodes its own output and compares it with the typed rows parsed from v1 before the rename. Strategy executors only read tapes: an artifact binary contains strategy code (agent-written once protocols author Rust strategies after M6, D39) and MUST NOT be able to write data that other binaries read. |
| NT-5 | **Lookup and validation.** The executor derives the tape path from the job's input (format, symbol, timeframe, slug) under a tape root given as process configuration (`--tape-dir`, 20 §6.1). It uses the tape only if its engine supports the tape format version, the v1 identity in the header matches the v1 file's `stat` (bytes, mtime_ns) and the job's sha256 when the job carries one, and every frame checksum passes. Otherwise it reads v1. A bad or stale tape is never an error. The input path taken is reported in diagnostics only (DP-5). |
| NT-6 | **Equality proof.** The tape path and the v1 path MUST give byte-identical deterministic output (DP-1). Evidence: (a) the per-file round trip of NT-4; (b) the engine event stream (kind, outcome, levels, both timestamps, skip and anomaly counters) from the tape equals the v1 stream on `smoke-50`, `heavy-1` and every bench set, and in CI on the fixture markets; (c) a one-time digest sweep over every converted file before any fleet use (≈ 31k files, ≈ 10 min on worker-1, estimated); (d) the determinism suite runs both paths (DP-6). |
| NT-7 | **Disk.** About 45% of the v1 bytes (prototype: 0.82 MB vs 1.84 MB per average market), so about 23–26 GB for today's 31,186 BTC 15m files before NT-2's extra columns. `pmb-tape` reports bytes per host and enforces a per-host cap, converting the newest markets first. The cap on worker-1 is **40 GB** (gate 1). `pmb-tape` also stops before the host's free disk falls below 10 GB, so fleet data sync and builds keep room. |
| NT-8 | **Rollout.** Before G2, `pmb-tape` runs only on worker-1. It reads the v1 files through the native checkout's read-only data symlinks and writes only under that checkout's gitignored tape root (for example `data/native-tapes/`, a real directory), never inside the fleet working copy (D36). Bench sets come first (`smoke-50` ≈ 45 MB, `heavy-1`, `recent-1k` ≈ 0.9 GB); the remaining BTC 15m files MAY follow within the cap, so M-20 and NT-6 (c) can use the full set. None of this changes main, the TS converter, R2 or the fleet. The final yes for tapes as the primary input, and the caps on the other fleet hosts, are decided at G2 with the measured numbers (M-20). After that, a fleet build step in M6 builds tapes per host from its local v1 files: a `data:sync:worker` stage, or a worker-start backfill at `background` QoS. 40 owns the step. Tapes are not uploaded to R2, because rebuilding locally (~86 ms CPU per market) is cheaper than distributing them. |
| NT-9 | **Scope.** telonex-delta only. V4 compact files are already typed (15 IP-5); M7 measures V4 decode before any tape is considered for V4. Live journals are read once and need none. |

Schedule: M1 step 7 builds `pmb-tape` (encoder, decoder, round trip) on
worker-1, runs NT-6 (b) on `smoke-50` and `heavy-1`, and records the decode
ms (v1 vs tape), tape bytes and compression ratio in STATUS.md. The disk need
of the other hosts is sized from that measured ratio. The final decision is
taken at G2 with these numbers (M-20). The executor path ships in M5a, and
the fleet build step in M6.

## 8. Order-book layout (requirement c)

| Option | Apply | Best level | Ordered iteration | Measured (§2.2) | Notes |
|---|---|---|---|---|---|
| `BTreeMap<Price, Qty>` per side (WIP) | O(log n) plus node allocation | O(log n) | yes | 106 ns/row (parse + apply + best) | pointer chasing; allocator churn on level insert and remove |
| Sorted `Vec` per side | O(log n) search plus memmove (n ≈ 100) | O(1) | yes | not measured | good for small books; memmove on top-of-book churn |
| **Dense ladder + occupancy bitset** | O(1) | O(words) with `clz`/`ctz`; O(1) with a two-level bitset | yes (bit scan) | 79 ns/row (−25%) | prices are integers on a 0.0001 grid in (0, 1) (10 §11 P6) |

| # | Requirement |
|---|---|
| BK-1 | The default book is a dense ladder per (outcome, side) indexed by `price / 100` (0.0001 units, 10,001 slots, 80 KB of `i64` sizes), plus a two-level occupancy bitset (157 words plus a 3-word summary). It covers every valid tick (`0.1`, `0.01`, `0.001`, `0.0001`, `node_modules/@polymarket/clob-client/dist/types.d.ts:306`). |
| BK-2 | A `book` replace clears only the occupied slots (bit iteration), never a full `memset`. At ~1,000 snapshots per market, a full clear would cost more than the apply itself. |
| BK-3 | Only touched cache lines are hot (≈100 active levels near the touch), so the 320 KB footprint per market does not spill L1 in practice. A 0.001-unit ladder (1,001 slots) plus overflow is the measured alternative (§15). |
| BK-4 | The representation sits behind a `BookSide` API (apply, best, iterate best-first, depth to N, size at price). A property test MUST show that ladder and `BTreeMap` reference produce identical views on random streams (incl. tick changes and off-grid overflow) and on the `smoke-50` markets. |
| BK-5 | Cumulative depth and derived metrics are computed lazily and cached per tick (12 §14 P3). Strategy views borrow the book (30 §16 S1, S3). |
| BK-6 | In groups the recorded book is shared. Each candidate's own orders, consumed liquidity and queue positions are a sparse overlay (41 §5.3, 13). The overlay costs O(own orders affected) per event (12 §14 P7). |
| BK-7 | The apply reports whether the event changed the best price or the size at the best price of either outcome (it already knows whether the touched slot is or becomes the best). That bit feeds the tick interest filter (§9.4) at no extra cost. |

## 9. Candidate groups (requirement d)

### 9.1 Why groups are the largest multiplier for sweeps

Sweeps (coordinate passes, grids) are the dominant fleet load: about 80% of
markets come from GR protocol runs (requirements-sweep
`fair-scheduling-heavy-jobs`), and every cell re-decodes every market today
(41 §1). A group pays `F + D + V` once and `C` N times. With the prototype's
split (D ≈ 75% of a standalone market) the ceiling was ~4×, and it measured
3.98× at 100 candidates. With the faster decoder the ceiling is
`(D + C)/C`, so per-candidate cost decides sweep throughput (§3).

### 9.2 Layout

| Layout | Description | Pros | Cons |
|---|---|---|---|
| **Tick-major (default)** | For each event: apply it to the shared book once, then step every candidate of the chunk | book applied once; shared plugin values computed once per tick | working set = chunk × hot candidate state, which must fit L2 |
| Candidate-major per batch | For each 4,096-event batch, each candidate replays it against its own book replica | candidate state stays in L1 | book applied N times (cheap from the tape) |

| # | Requirement |
|---|---|
| CG-1 | Default layout: tick-major within a chunk. Candidate-major is the measured alternative, and output MUST be identical for both (41 §5.5). |
| CG-2 | Candidates of a group are one concrete strategy type in one contiguous `Vec<T>` (30 §16 S9), with static dispatch. |
| CG-3 | Plugin instances are deduplicated by canonical config within a chunk and computed once per tick (41 §5.2, 30 §16 S4). Shared and unshared results MUST be identical. |
| CG-4 | Per-candidate fast paths: no fill matching when the candidate has no resting orders or pending actions; no metric computation unless read; O(1) window-gate check; no strategy call on ticks filtered by §9.4. |
| CG-5 | No SIMD across candidates. Strategies are arbitrary branchy code, and their state is not a numeric vector. A vectorized "parameter-sweep kernel" API would be an SDK change and is out of scope. SIMD MAY be used inside kernels (decimal parsing, bitset scans, plugin math) where a micro benchmark shows a gain. |

### 9.3 Fan-out across threads

- A group job of N candidates is split into chunks of `k` candidates. Each
  chunk has its own book replica fed from the shared tape (`Arc`). Book
  replay from the tape costs a few ms per market, against `k · C` of
  candidate work.
- `k` is chosen so a chunk is ≥ ~50 ms and ≤ ~250 ms of work. That keeps
  stealing effective and keeps a chunk on a slow E-core from dominating the
  job tail. The job's thread allowance comes from the shim (40 §7.2,
  weight `min(N, T)`).
- Chunk boundaries never affect results (41 §2.2, DP-1). The milestone M4
  proof runs `T = 1` vs `T = max` and shuffled candidates (41 §10.2).

### 9.4 Tick interest filter (D41)

Only 1.2% of ticks change a best price, and 16.3% change a best price or the
size at a best price (§2.2). A strategy that reacts only to such changes
still pays one `on_tick` call per event today. Skipping the calls that cannot
matter is the largest known cut in `C`, and it is free for parity: counting
happens before the gate (21 §15, 12 §5.2), and books, matching, plugins and
feed clocks still see every event. The filter is an opt-in declaration with
the same contract as the existing callback interests (30 §4.1).

| # | Requirement |
|---|---|
| TF-1 | **Declaration.** `Interests` gains a tick interest: `All` (default), `TopOfBook` (best bid or ask price of either outcome changed) or `TopOfBookAndSize` (price or size at a best level changed). It is off by default. The in-repo ts-compat ports (`engine-exerciser.rs`, `overnight-opus55-lagsnipe.v15.rs`, 30 §18) MUST NOT declare it. |
| TF-2 | **Wake rule.** For each real strategy tick that passes the window gate, the engine calls `on_tick` of a declaring candidate only if at least one holds: (a) it is the candidate's first in-window tick of the market; (b) this event changed the declared top-of-book values of the recorded book (BK-7; because every such change is delivered, "changed by this event" equals "changed since the last call"); (c) an account event was delivered to this candidate since its last `on_tick`; (d) a requested feed's visible value changed since then; (e) a requested plugin's output changed since then (the change generations of 14 P-13). Ticks the strategy explicitly opted into (synthetic feed ticks, 14 §8) are always delivered; trade prints never produce strategy ticks in v1 (12 §5.2). |
| TF-3 | **Only the callback is skipped.** Counting (`eventsProcessed`, `eventsByType`), book apply, execution and matching, feed advance, plugin `on_tick` and the tick's trace records run on every event exactly as without the filter. The plugin snapshot and feed view for the callback are built lazily, so a skipped call also skips them. |
| TF-4 | **Same everywhere.** The rule is evaluated in the core loop (12), so backtest, paper and live behave identically. |
| TF-5 | **Contract and proof.** A declaring strategy MUST behave exactly as if `on_tick` on every skipped tick had returned no intents and changed no state (as 30 §4.1 requires for omitted callbacks). `strategy:check` runs every fixture with the declared interest and with `All` and requires identical outputs (31 §7.1 gate 7). A strategy whose logic depends on time between book changes therefore cannot declare it. |
| TF-6 | **Reporting.** Skipped calls are counted as `strategyTicksSkipped` in diagnostics (21 owns the placement), never in `eventsProcessed`. |
| TF-7 | **Cost.** The top-change bit is computed once per event on the shared book (BK-7). A skipped tick costs a candidate a few compares. In groups, the per-candidate part of (c)–(e) is one dirty flag. |

Gate 1 (lead, 2026-10-09) adopted the filter as an opt-in for new Rust
strategies. The SDK shape ships in M1 with the other `Interests` flags
(30 §4.1), off by default; its gain is measured in M5b (M-21).

## 10. Apple Silicon: P-cores, E-cores and QoS (requirement e)

### 10.1 Facts and rules

- macOS on Apple Silicon has no thread affinity API; placement follows QoS.
  BACKGROUND is confined to E-cores. USER_INTERACTIVE, USER_INITIATED and
  DEFAULT prefer P-cores and spill to E-cores. UTILITY favors efficiency
  (40 §7.3). The executor MUST NOT rely on any finer behavior without
  measuring it (Instruments "CPU Counters" / thread state per core type).
- Work stealing absorbs uneven core speed at job and chunk granularity
  (40 §7.3.3). Group chunks follow §9.3 so the tail stays short.
- Thread count `T` is the host's native thread budget (40 §7.2). Before
  measurement it equals `cores_for_backtest` (`run-worker.sh:29-50`
  precedence). IPC, I/O and executor-internal threads are not counted; they
  are mostly asleep.
- Core counts are read at startup from `hw.nperflevels`,
  `hw.perflevelN.physicalcpu` and `hw.perflevelN.name` and reported, never
  hardcoded. M5 Pro names its levels "Super" and "Performance" and has no
  E-cores.

### 10.2 `--qos` values and mechanism

| `--qos` | macOS class | Use |
|---|---|---|
| `user-initiated` | `QOS_CLASS_USER_INITIATED` | measured candidate for dedicated workers |
| `default` | `QOS_CLASS_DEFAULT` | default for worker hosts (40 §7.3.2) |
| `utility` | `QOS_CLASS_UTILITY` | hosts with latency-sensitive neighbors (worker-2 recorder, 40 §7.3.2; the paper/live host while a session runs) |
| `background` | `QOS_CLASS_BACKGROUND` | E-cores only; MAY be used during calibration instead of stopping backtests (50 §4.3); used for the tape backfill (NT-8) and for cargo builds on hosts that run backtests (31 §4.5) |

- Each pool thread sets its class in the rayon `start_handler` with
  `pthread_set_qos_class_self_np`. It then reads back its effective class
  (`qos_class_self`) and the process role. The executor MUST report both, so
  a clamped process (launchd `ProcessType Background`, §2.3) is visible
  instead of silently running on E-cores. 20 owns the field in `ready`.
- The executor inherits the supervisor's `taskpolicy -a` role (40 §6.2.4).
- This FFI needs `unsafe`. It MUST live in one small engine-owned platform
  crate (`pmb-platform`), the only workspace member that overrides the
  workspace lint `unsafe_code = "forbid"` (`native/Cargo.toml:23-24`). Every
  block in it carries a `// SAFETY:` note and a test. It also hosts the live
  power assertion and the platform trait of 50 §4.3–§4.4. It MAY wrap a
  third-party crate instead of its own FFI only if that crate passes the
  dependency rules of 31 §3. All other engine crates and all strategy crates
  keep `unsafe_code = "forbid"` (31 §2.2, 30 §11).

### 10.3 What is measured per host type (M5a on worker-1, M6 on the other fleet hosts)

| Host type | `T` sweep | QoS sweep | Expectation to confirm or refute |
|---|---|---|---|
| M4 4P+6E (worker-1 in M5a; worker-2 in M6 under its recorder constraint, 40 §7.3.2) | 4, 6, 8, 10 | default, user-initiated, utility | E-cores carry ~40% of throughput (geekbench estimate; 40 says ~1/3), so `T = P` would waste a large share |
| M1 Pro 6P+2E (m1-milan in M6, if available) | 4, 6, 8 | same | knee near 6–8; E-cores add little (+~5% on m1-ivan's 8P+2E, §2.2) |

m5-milan (M5 Pro, no E-cores) and m1-ivan are not measured: neither consumes
native jobs in M6. The chosen `T` and QoS per host are written to the
inventory (40 §7.3.4) and the report (§13). On the paper/live host, backtest
threads run at `utility` or `background` while paper or live runs, and are
stopped or capped during real orders (50 §4.3).

## 11. Build profile, allocator, tooling (requirement f)

### 11.1 Rules

| # | Requirement |
|---|---|
| BP-1 | `target-cpu` stays the target default, which equals `apple-m1` (§2.2). `native` and `apple-m4` are forbidden: M1 hosts could fault, and reproducibility breaks (31 §4.2). |
| BP-2 | `panic = "unwind"` stays (`catch_unwind` per candidate, 41 §5.6). Overflow checks follow 31 §4.2. |
| BP-3 | Allocator: the system allocator by default. mimalloc behind a cargo feature is measured and adopted only for a ≥ 5% end-to-end gain on `recent-1k` that also passes D17 reproducibility (it is a C dependency). |
| BP-4 | A `profiling` profile inherits the artifact profile with `debug = "line-tables-only"` and `strip = false`. It is never published and is used only for flamegraphs. |
| BP-5 | Tools: `criterion` micro benchmarks (§13.2 L0); `samply` for sampling profiles (no sudo); Instruments Time Profiler and CPU Counters for P/E residency; `/usr/bin/time -l` and `getrusage` for peak RSS; the always-on counters of 12 §14 P12 and the `phase-timers` feature for per-phase breakdowns. |

### 11.2 Published profile (D18 as amended at gate 1)

Gate 1 (lead) amended D18: the fast-compile profile (`iterate`, 31 §4.1) is
for local checks and iteration only, and every published, fleet and live
binary uses the fastest-running reproducible `artifact` profile. A warm-cache
replay is CPU-bound (local reads of 1–7 MB take ~1–3 ms, §2.2), so runtime
decides. M5a measures the candidates of 31 §4.6 on worker-1, each on top of
the previous best:

| Candidate (31 §4.6) | Runtime on `recent-1k` (L1, host default `T`); `C` on a group bench once M4 exists | `artifact` build at `background` QoS: cold, and warm after a one-line strategy change |
|---|---|---|
| D18 for all crates (= `iterate`; baseline) | measure | measure (D18: warm 0.84 s) |
| thin LTO, cgu 1 (initial `artifact`) | measure | measure (sweep: warm 7.3 s) |
| fat LTO, cgu 1 | measure | measure |
| best so far, third-party crates without overflow checks | measure | measure |
| best so far plus an engine-owned PGO profile | MAY measure | measure |

Rule (31 §4.6 item 4): adopt the fastest candidate that passes the
profile-independence check (31 §7.6) and D17 byte reproducibility (two clean
builds on worker-1 give identical bytes; the cross-host comparison follows in
M6) and whose gain over the next cheaper candidate exceeds the measured
run-to-run spread (§13.5). `artifact` build time is reported, never gated.
`iterate` stays D18 literally; its warm rebuild is reported with M-23. Fat
LTO tends to win only when hot code crosses crate boundaries without
generics; HL-3 and monomorphization narrow that gap.

## 12. Live latency (requirement g)

### 12.1 Runtime choice

| # | Requirement |
|---|---|
| LL-1 | The core (deterministic loop) is a plain OS thread with no async (50 §4.2). It consumes bounded, preallocated SPSC/MPSC rings. |
| LL-2 | Ingress (per socket group) and egress each run a **tokio `current_thread` runtime on their own dedicated OS thread** at USER_INTERACTIVE. A multi-thread runtime is the measured alternative. It is not the default because work-stealing migration of hot futures between threads adds wake-up latency and jitter, and I/O roles stay isolated (an ingress burst cannot delay egress). |
| LL-3 | Hand-off wake strategy: spin, then park. The consumer spins for a bounded window, then parks. The window (0, 20, 100 µs) is chosen by measurement of the hop p99 and the CPU cost (§15). Spinning is always bounded. |
| LL-4 | No heap allocation per envelope on core and egress in steady state (50 §18.3). Decoding borrows from the frame buffer (`&str` fields), and decimals parse straight to fixed point. Order templates are preallocated per (asset, side), and the request body is written into a reused buffer. |
| LL-5 | Signing: the EIP-712 domain separators (per exchange contract) and type hashes are precomputed per session. Per order: struct hash, digest and ECDSA (RFC 6979). `k256` (pure Rust) vs `secp256k1` (libsecp256k1, C) is chosen by micro benchmark, with pure Rust preferred unless the C library saves ≥ 50 µs at p99. Precomputed-nonce tricks are forbidden: they break the deterministic golden vectors (50 §8.2.2) and risk key exposure. |
| LL-6 | WS decode: `serde_json` with borrowed fields vs a SIMD decoder (sonic-rs or simd-json, both NEON-capable). It is measured on a golden corpus of recorded raw frames (worker-2 V4 packages). The faster one wins only if its decoded events are identical on the whole corpus (50 §18.3). |
| LL-7 | HTTP: hyper over rustls, pre-warmed keep-alive pool, `TCP_NODELAY`. HTTP/1.1 pool vs one HTTP/2 connection is decided by measurement (50 §18.3, 51). |
| LL-8 | "Pinning" means USER_INTERACTIVE QoS on core, ingress and egress, free P-cores (backtests capped, 50 §4.3), `ProcessType Interactive`. No thread affinity is available. Core dequeue lag p99 is measured to detect descheduling. |
| LL-9 | A strategy that declares the tick interest filter (§9.4) skips its callback live exactly as in backtest (TF-4); the core still applies every event. |

### 12.2 Latency budget

Targets are owned by 50 §18.2. The expected breakdown below guides
implementation. It is an estimate to confirm.

| Segment | Expected median | p99 target (50 §18.2) |
|---|---|---|
| socket read → typed event (TLS decrypt, WS unmask, JSON → fixed point) | 3–10 µs (`price_change`); 20–50 µs (full `book`) | ≤ 50 µs incl. dequeue |
| ingress → core dequeue (ring hop) | < 1 µs spinning; 5–30 µs parked | inside the line above |
| core: book apply, feeds, plugins, validation (excl. strategy) | 1–5 µs | ≤ 20 µs |
| core → egress hop | < 1 µs spinning; 5–30 µs parked | inside the line below |
| egress: build order, keccak (~1 µs), ECDSA (tens of µs), HMAC, body, TLS write | 30–100 µs | ≤ 200 µs |
| **tick-to-wire, excl. strategy** | 40–150 µs | ≤ 300 µs |
| network plus exchange (outside code) | place 71–379 ms, cancel 65–210 ms (`docs/other/MeasureLatency.md:90-91`); taker delay 150 ms (11) | — |

The local path is < 0.5% of the end-to-end order latency. The biggest live
gains are architectural: the core never awaits REST, while TS's serial funnel
queues every later tick behind an order round trip (requirements-sweep
`single-serial-event-loop`). After that comes hosting (the live host is a
gate-4 question, 01 §12.1 item 3).
Local optimization mainly removes jitter.

### 12.3 Measurement method and report format

- Stamps use `std::time::Instant` (monotonic; the Apple Silicon timebase is
  24 MHz, 41.7 ns resolution). They are taken at the points listed in
  50 §18.1, and the cost of one stamp is measured and reported.
- Stamps go into the journal's execution sidecar (22), never into decisions.
  Histograms use HdrHistogram, 1 µs to 60 s, 3 significant digits.
- `latency-report --journal <dir> [--json]` prints, per segment and per order
  type: count, p50, p90, p99, p99.9, max (µs). It also prints the core dequeue
  lag, the lateness histogram of OS-fired timers (13 §2.3 TS2), ring
  high-water marks, dropped-input count, host load percentiles (50 §4.3),
  binary sha, profile, host, macOS version and journal window. The JSON form
  is what 51 consumes.
- Coverage by milestone: paper mode (M8) measures ingress and core segments.
  Shadow signing (M9, throwaway key, never sent) measures egress up to "bytes
  ready". Real orders (M10, user-launched) add network and exchange.

## 13. Benchmark protocol (requirement h)

### 13.1 Bench sets

Manifests live under `native/bench/sets/<name>.json`: slugs, source file
sha256 and size, strategy and params, ModelConfig. They are frozen once
committed. A changed source sha invalidates comparisons and is reported.
Market selection uses `listEligibleTelonexSlugs` (CLAUDE.md eligibility rule).

| Set | Content | Purpose |
|---|---|---|
| `smoke-50` | 50 BTC 15m markets stratified by row count | per-commit A/B and determinism suite; ≤ 1 min |
| `june-1k` | the Codex selection (first `btc-updown-15m-1780272000`, last `btc-updown-15m-1781288100`; Codex `selection-june-1000.json`) | continuity with the 6.19× baseline |
| `recent-1k` | the 1,000 most recent eligible BTC 15m markets at a pinned cutoff | current market density; the headline set |
| `btc5m-1k` | 1,000 BTC 5m markets, once BTC 5m data exists (6 files on 2026-10-09; waits for the Telonex renewal, D38) | D06; not in any report before that |
| `heavy-1` | `btc-updown-15m-1780925400` (449,314 rows) | per-market phase profile; same market as the Codex profile |
| `v4-50` | 50 worker-2 Recorder V4 packages, downloaded from R2 to worker-1 | V4 decode cost (M7) |

Workloads: `engine-exerciser` (feature stress) and
`overnight-opus55-lagsnipe.v15.rs` (ported from the built artifact, D40)
against TS artifact `304eceb3…` (01 §4.1).
TS-vs-Rust rows use the parity matrix settings (latency 0 and one fixed
delay, jitter 0; 01 M2).

### 13.2 Harness levels

| Level | What | Tooling |
|---|---|---|
| L0 micro | page decode, decimal parse, tape encode/decode, book apply/best, session step with a no-op strategy, plugin step, group step per candidate, keccak/ECDSA, WS frame decode, journal append | `criterion` benches in the engine crates |
| L1 engine-only | a driver feeds prebuilt `EngineJob` files to `run` or `serve` with no Redis or MySQL; reports wall time, throughput, CPU, RSS, phases | a small driver; built in M1 step 7 (01) |
| L2 production path | producer → BullMQ (isolated queue names) → shim → `serve` → aggregator → MySQL (isolated tables), from producer launch to aggregate completion | Codex method (`REPORT-END-TO-END.md`, "Isolation and fidelity") |
| L3 fleet | L2 on the M6 fleet: worker-1, worker-2 (about 3 native slots), m1-milan if available; m1-ivan only as producer | M6 |

### 13.3 Configuration matrix

Every M5 report contains these rows on `recent-1k` (and `june-1k` for TS
continuity), on worker-1:

| # | Configuration |
|---|---|
| 1 | TS, 8 Node processes, lagsnipe TS artifact (L2) |
| 2 | Rust process-per-job (`run`), 8 concurrent (L1 and L2) |
| 3 | Rust `serve`, `T` ∈ {1, 2, 4, 6, 8, 10}, caches disabled (L1) |
| 4 | row 3 at host default `T` + shared feed caches |
| 5 | each decoder option of §15 as an A/B on row 4 (L1), **including v1 vs derived tape (M-20) and the tape encodings (M-19)** |
| 6 | groups of 10 and 100 candidates; both layouts; fan-out on and off; tick interest filter on and off (M-21) (L1, market-candidates/s) |
| 7 | build profiles of §11.2 |
| 8 | allocator system vs mimalloc |
| 9 | QoS values of §10.2, and `T = P` vs `P + E` |
| 10 | best configuration end to end (L2) |
| 11 | end-to-end wall time of a 1,000-market single-candidate native run with the fixed-cost breakdown of §13.9, before and after each FX item (L2 at M6 on one host, L3 on the fleet) |

### 13.4 Metrics

| Metric | Definition |
|---|---|
| wall time | per level: driver start → last result (L1); producer launch → aggregate committed (L2/L3) |
| throughput | markets/s and market-candidates/s; fleet: market-candidates per hour (40 §14) |
| CPU utilization | (user + sys) / (wall × logical cores); per core type where Instruments data exists |
| peak RSS | per executor (`getrusage`), per TS process for row 1 |
| phase profile | open, decompress, decode, book, feeds, plugins, strategy, simulator, output (`phase-timers` build, `heavy-1` and a 50-market sample) |
| fixed overheads | the phases of FX-1 (§13.9); per-job IPC + JSON; `overheadFraction` (40 §7.5) |
| cache | day-cache hits and misses, bytes decoded, tape path share (tape vs v1), tape bytes on disk |
| engine vs strategy share | from `phase-timers` and `testkit::bench` (30 §16 S11); `strategyTicksSkipped` when the filter is used |
| Redis | CPU% and memory of the Redis host during L2/L3 (BullMQ Lua cost grows with job rate) |

### 13.5 Conditions

- **Host.** Every benchmark before M6 runs on worker-1 (D36), from the native
  checkout, with canonical binaries only (01 §6). Other host types and fleet
  rows run in M6 (§10.3).
- **Quiet host.** Before a measured row: pause every Global Runtime run on
  worker-1 and wait until no session is in flight (never stop the runtime
  daemon while a session runs; `fleet:runtime:stop` kills it), then drain and
  stop worker-1's fleet worker. Resume both afterwards. No other backtests,
  builds or tests run during the row (`ps` check recorded). Redis and MySQL
  keep serving the other hosts; their CPU share is recorded. 1-minute load
  average < 1.0 for 60 s before start; load is recorded during the run.
  AC power and Low Power Mode off (MacBooks: lid open).
- Warm page cache: one discarded warm-up run per configuration. A cold-read
  note gives the bytes read and the elapsed read time, and is not a separate
  row.
- 3 repetitions, interleaved ABBA across configurations. Report median, min
  and max. Never select the fastest run.
- Recorded per row: host, chip, macOS, rustc, profile, binary sha, set
  manifest sha, ModelConfig, `T`, QoS, effective QoS, cache budget, input path
  (tape or v1).
- **Window (gate 1).** Unattended benchmarks run on worker-1 only between
  01:00 and 07:00 local time, only with the fleet worker and Global Runtime
  paused as above, and never while a live or paper session runs. Each window,
  with its pause and resume times, is logged in STATUS.md.
- **`non-idle`.** Short runs (`smoke-50`, `heavy-1`, the DP-6 suite; each a
  few minutes) MAY run at any time alongside the fleet worker and Global
  Runtime, at `utility` QoS. Their timings, and any number measured outside
  the window or these conditions, are recorded with the load average and
  marked `non-idle`. They serve only as interleaved before/after pairs within
  one sitting (§13.8), never for regression comparisons (01 §2 S5) or as gate
  evidence of speed.
- Dev builds on worker-1 MAY run alongside the fleet worker and Global
  Runtime outside measured rows, with capped jobs at `background` QoS
  (31 §4.5).

### 13.6 Fleet prediction

Predicted fleet rate = Σ over hosts of (L1 rate at the host's `T`) ×
(1 − `overheadFraction`). M6 compares it with the measured L3 rate. A gap
> 10% is analyzed (Redis, shim, stragglers, cache misses) in the report.

### 13.7 Determinism inside every benchmark

All Rust rows of a report MUST produce identical sha256 hashes of the
deterministic result sections, sorted by `(idx, candidate)`. A difference is
a determinism bug and blocks the optimization that caused it (S6, DP-6).
TS-vs-Rust agreement is checked by the parity tooling (60), not here.

### 13.8 Reports and per-optimization rule

- Reports: `native/reports/bench-<milestone>-<yyyymmdd>-<host>.md` plus a
  `.json` with every row, its conditions and raw repetitions.
- STATUS.md "Benchmark (fixed set)" records `smoke-50` markets/s at the host
  default `T` and the input path, `recent-1k` wall time when it was run, and
  from M6 the two fixed-cost rows of FX-8. A regression > 10% against the
  previous idle measurement is explained (01 §2 S5).
- Every optimization commit records before/after on `smoke-50` (and a
  `heavy-1` profile when it targets decode or the loop) and passes DP-6 and
  the parity subset of 60.

### 13.9 Per-run fixed costs (FX)

Once the engine is about 10× faster, `L + A` (§3) is about as large as the
fleet compute of the most common run type, a single-candidate
`--latest --limit 1000` screen. Agents' iteration latency improves in line
with engine speed only if these costs fall too. The code belongs to the TS
producer, shim and aggregator (40, 42). This section defines the measurement
and the reduction deliverable. Every change MUST keep persisted rows
byte-identical (same `idx` order, same stats code) and keep BullMQ semantics
(parent waits for all children, `ignoreDependencyOnFailure`, retries).

| # | Requirement |
|---|---|
| FX-1 | **Phase timestamps.** The producer and aggregator log monotonic timestamps for: process start; module load done; catalog and eligibility queries; market metadata and resolutions; feed and file preflight; artifact `describe` and capability checks; flow creation; first market job active; last market job finished; aggregate job active (pickup); child values fetched; batch stats and segments computed; MySQL commit; child cleanup done; producer exit. The benchmark reports each phase (row 11). |
| FX-2 | **Cached describe.** The producer reuses the on-disk per-sha capability cache that the shim already keeps (40 §4.2 step 3), so no run spawns `describe` for a known sha. |
| FX-3 | **Batched preflight.** Market metadata and resolutions for all selected slugs come from one batched query, file and feed-day checks run with bounded concurrency, and each feed day is checked once per run, not once per market. |
| FX-4 | **Flow creation.** Its time for 1,000 children is measured. Batching changes are adopted only if this phase exceeds 10% of `L`. |
| FX-5 | **Commit before cleanup.** The aggregator commits the run and completes, so the producer sees completion, before child cleanup. Cleanup stays best-effort, as today (`src/backtest/aggregateProcessor.ts:202-217`), and runs off the critical path. |
| FX-6 | **Incremental aggregation.** Completed child results are fetched and validated while the run is in flight (from the parent's processed-children hash, or from the completion events the producer already receives). At the last child only the remainder, batch stats, segments and the MySQL commit are left. This also applies to group aggregates (41 §7). Adopted only if it shortens `A` by ≥ 20%. |
| FX-7 | **Producer start.** If module load exceeds 20% of `L`, a prebuilt JS bundle of the producer CLI, or reuse of a long-lived process (the GR daemon), is measured. |
| FX-8 | **Deliverable (M6).** The M6 report gives the end-to-end wall time of a 1,000-market single-candidate native run on the fleet with the FX-1 breakdown, before and after each FX item. STATUS.md records "producer launch → first job active" and "last job done → run committed" next to markets/s. |

FX-1's producer-side phases (up to flow creation) are measured in M5a on
worker-1 with an isolated queue and no consumer. The full row 11 needs M6's
shim.

## 14. Profiling milestones

Milestone names follow 01 §6 (M5a after G2, M5b after M3b and M4).

| Milestone | Performance deliverable |
|---|---|
| M1 | Architecture that is hard to retrofit (01 §2 S1): column-wise decode into the tape, `Arc` shared inputs, `Send` session state, library entry point (EX-5), allocation test HL-1, ladder apply with the top-change bit (BK-7), the tick interest flag in `Interests` (off by default, §9.4). Step 7, on worker-1: bench sets `smoke-50` and `heavy-1`, L0/L1 harness, first `run` numbers and the `heavy-1` phase profile in STATUS.md (`non-idle` unless measured in the window, §13.5), worker-1's core and cache facts (§2.3), the dispatch-boundary measurement M-23, and the `pmb-tape` prototype with NT-6 (b) and decode ms of v1 vs tape (§7.5) |
| M2 | No performance work required. Numbers recorded at each parity cycle; regressions explained |
| G2 | The final yes for derived tapes as the primary input, and the tape caps of hosts other than worker-1, with the M1 step 7 numbers (M-20) |
| M5a | `serve` with pool and caches, decoder options and the tape path (if approved at G2), book alternative, published profile (§11.2), allocator, `T` and QoS on worker-1; rows 1–5 and 7–9 of §13.3; FX-1 producer-side phases; M5a items of §15 resolved; report `bench-M5a-<date>-worker-1` |
| M5b | Cost of the realistic profile vs ts-compat (overlay, queue model) on `smoke-50`; group scaling at 1/10/100 candidates, both layouts, plugin dedupe A/B (41 §10.5); tick interest filter A/B (M-21); rows 6 and 10; register resolved for every M5 item |
| M6 | Per-host `T`/QoS knees (worker-2, m1-milan if available); L3 fleet throughput vs prediction; `overheadFraction`; Redis load; FX deliverable and row 11 (FX-8); the fleet tape build step (NT-8) if approved at G2; the throughput cost of capped `background` builds on fleet hosts (31 §4.5), measured before AI protocols author Rust strategies (D39) |
| M7 | V4 decode cost per market on `v4-50` |
| M8 | Live latency report from paper journals (ingress and core segments); WS decoder choice (LL-6); spin window (LL-3) |
| M9 | Signing and egress micro benchmarks; shadow-mode egress report; HTTP/1.1 vs HTTP/2 inputs |
| M10 | Latency components fitted by calibration (51) next to the local budget |

## 15. Decision register

### 15.1 Decided by this document

| # | Decision | Basis |
|---|---|---|
| 1 | Fleet path = long-lived `serve` executor per artifact per host; process-per-job only for debug, parity and baseline | §2.2 findings 3 and 5; 20 §6; 40 §5 |
| 2 | Rust never consumes Redis in v1 | §5.1 (sandbox, BullMQ re-implementation risk) |
| 3 | Dedicated work-stealing pool sized `T`; no async runtime in backtests | §5.3 |
| 4 | Whole-file read, no mmap; struct-of-arrays tape; row-group batches; zero allocation per tick (HL-1) | §7 |
| 5 | Dense ladder + bitset book behind a `BookSide` API with a `BTreeMap` equivalence test | §2.2 (−25% in the apply loop); §8 |
| 6 | Group default layout tick-major, chunked fan-out, plugin dedupe, no cross-candidate SIMD | §9 |
| 7 | `target-cpu` default only | §2.2; 31 §4.2 |
| 8 | Timings, cache statistics and the input path never in deterministic output; determinism suite on every optimization | §5.4 |
| 9 | Live core = plain thread; ingress and egress = current-thread runtimes on dedicated threads | §12.1 |
| 10 | Derived tapes are written only by the trusted `pmb-tape` tool, never by strategy executors; v1 always remains the canonical dataset and the fallback and is never re-converted; worker-1 cap 40 GB before G2 | NT-1, NT-4, NT-5, NT-7 (gate 1) |
| 11 | The tick interest filter (D41, opt-in for new Rust strategies) skips only the strategy callback; counting, books, matching, plugins and feeds run on every event | TF-1, TF-3 |
| 12 | `unsafe` only in the engine-owned `pmb-platform` crate; strategy crates and all other engine crates keep `forbid` | §10.2 (decided by this document at gate 1; the lead may change it) |
| 13 | Benchmarks before M6 on worker-1 only, in the 01:00–07:00 window with the fleet worker and Global Runtime paused | §13.5 (D36, gate 1) |

### 15.2 Decided by measurement

| # | Choice | Options | Metric | Rule | When |
|---|---|---|---|---|---|
| M-1 | GZIP backend | miniz_oxide / zlib-rs / libdeflate | decode ms per market (`smoke-50`) | fastest pure-Rust unless C ≥ 1.3× on total decode and D17 holds | M1 step 7 (cheap) or M5a |
| M-2 | Direct PLAIN-page decoder | on / off | decode ms; equality on all bench sets | adopt at ≥ 1.2× decode; with tapes adopted, only if the v1 fallback share stays material | M5a |
| M-3 | Constant-column skip via statistics | on / off | decode ms (prototype: −34% incl. `ingest_seq`); statistics audit on 1,000 files | adopt at ≥ 5% decode and a clean audit | M5a |
| M-4 | Ladder unit | 0.0001 uniform / 0.001 + overflow | loop ns per event; RSS | faster one; ties → 0.0001 | M5a |
| M-5 | Group layout and chunk size `k` | tick-major / candidate-major; `k` | market-candidates/s at N = 10, 100 | fastest; identical output | M4–M5b |
| M-6 | Pool type | rayon / thread per slot | markets/s, single-candidate jobs | rayon unless the other is ≥ 5% faster (groups need rayon) | M5a |
| M-7 | Host `T` and QoS | §10.3 | market-candidates/h | knee of the curve | M5a (worker-1), M6 (worker-2, m1-milan) |
| M-8 | Published build profile | 31 §4.6 candidates | §11.2 | §11.2 rule | M5a |
| M-9 | Allocator | system / mimalloc | end to end on `recent-1k` | ≥ 5% and D17 holds | M5a |
| M-10 | Feed cache unit under pressure | day / day + row-group fallback | miss cost on a `--random` 5,000-market run | add fallback if misses cost ≥ 5% of run CPU | M5a |
| M-11 | RAM tape LRU across jobs | off / on | repeat-slug hit rate per host over a week of fleet logs | only if §7.5 is not adopted; on if hit rate ≥ 20% within the cache budget | M6 |
| M-12 | Executor read-ahead | off / on (protocol hint in 20) | I/O wait share of job time | add if ≥ 2% | M5a |
| M-13 | Parallel row-group decode at the tail | off / on | tail share of run wall time | adopt if tail ≥ 10% | M5a |
| M-14 | Live hand-off spin window | 0 / 20 / 100 µs | hop p99, CPU % | smallest window meeting the 50 §18.2 targets | M8 |
| M-15 | Live I/O runtime | current-thread per role / multi-thread | tick-to-wire p99 in paper and shadow modes | current-thread unless the other is ≥ 10% better at p99 | M8–M9 |
| M-16 | WS JSON decoder | serde_json / sonic-rs / simd-json | µs per frame on the golden corpus; identical output | fastest identical | M8 |
| M-17 | Signer | k256 / libsecp256k1 | sign µs p99 | LL-5 rule | M9 |
| M-18 | Shim prefetch `P` | 1 / 2 / 4 | `overheadFraction` | smallest `P` with `overheadFraction` < 5% | M6 |
| M-19 | Tape encoding | raw SoA + zstd / flat Parquet INT64 + ZSTD | decode ms and bytes on `smoke-50` and `heavy-1` (prototype: 5.2 vs 7.3 ms, 0.82 vs 0.99 MB) | fastest decode; Parquet if within 10% (tool readability) | M1 step 7 |
| M-20 | Derived tape as the primary input | v1 only / tape when present | decode ms per market, single-candidate job time on `smoke-50`, `heavy-1`, `recent-1k`; bytes on disk | adopt if job time falls ≥ 20%; final yes at G2 with these numbers (worker-1 cap 40 GB, NT-7) | numbers M1 step 7, decision G2, implementation M5a and M6 |
| M-21 | Tick interest filter gain | off / `TopOfBook` / `TopOfBookAndSize` | `on_tick` calls skipped, `C` per candidate, market-candidates/s on a top-of-book test strategy, groups of 1, 10 and 100 | reported (D41; no threshold) | M5b |
| M-22 | Each FX item | before / after | its FX-1 phase and the row 11 wall time | per FX-4, FX-6, FX-7; others adopted when they shorten their phase with identical rows | M5a (producer side), M6 |
| M-23 | Dispatch boundary (12 §14 P6, "M-DSP") | engine generic over the strategy (monomorphized in the bin crate) / engine compiled once, one `&mut dyn` call per callback | `smoke-50` throughput for one candidate and a 20-candidate group (`artifact` profile); warm `iterate` and `artifact` rebuild after a one-line strategy change, on worker-1 | higher throughput is the default (12 §14 P6, §11.2); rebuild times are reported | M1 step 7 |

## Open questions

None. Gate 1 (2026-10-09, delegated to the lead) settled this document's
former questions: the tick interest filter is adopted as an opt-in (§9.4,
D41); derived tapes are allowed on worker-1 within 40 GB, with the final yes
at G2 (§7.5, M-20, D46); benchmarks run on worker-1 in the 01:00–07:00 window
(§13.5, D47); published binaries use the fastest-running reproducible profile
(§11.2, D18). The `unsafe` platform crate (§10.2) is decided by this
document; the lead may change it.

### Gate-4 questions

1. **Calibration and live host** (01 §12.1 item 3). It decides where the
   §12.3 latency reports of M8–M10 are measured, which host's backtest
   threads run at `utility` or `background` or stop during sessions
   (§10.2–§10.3, 50 §4.3), and the hosting term of §12.2.

### Requirements on other documents

None open: every item was applied in the gate-1 consolidation.
