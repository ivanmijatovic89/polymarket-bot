# 40 — Fleet integration

Purpose: define how native (Rust) market jobs travel through the existing
TypeScript BullMQ fleet: which queue they use, what gates them instead of the
producer commit SHA, how the TS worker shim supervises the executor process,
how execution metadata is stamped, how CPU and memory are shared on the Apple
Silicon Macs, how crashes, timeouts and memory blow-ups map to BullMQ retry
semantics, how the branch policy of 02-decisions.md (D03, D12, D36, D37)
constrains rollout, and which fleet-side services (pre-start rules capture,
derived tape builds, build-host provisioning) other documents rely on. The
design goal is maximum fleet throughput (market-candidates per hour) without
weakening determinism or the TS output contract.

This document owns fleet behavior only. It defers to other documents for:

| Topic | Owner |
|---|---|
| `serve` wire protocol: NDJSON framing, line cap, messages, drain, idle exit, parent death, env allowlist, exit codes, the closed error-class and cause vocabulary, supervision constants | 20-binary-protocol.md §2, §4, §6 (§6.5 for constants) |
| `MarketJobData` additions, `EngineJob`/`EngineResult`, echo checks, the `execution` field set | 21-job-and-output-contract.md §4, §5, §10, §12 |
| In-binary pool, caches, Parquet decoding, pool thread stack size, derived tape format, benchmark conditions, per-run fixed costs (FX) | 16-performance-and-parallelism.md (EX-6 stack, §7.5 tapes, §13.5 conditions, §13.9 FX) |
| Input integrity fields and the executor's memoized verification | 15-inputs.md I-8, I-9 |
| Candidate groups | 41-candidate-groups.md |
| DB columns | 42-persistence-and-stats.md |
| Rules snapshot content, origins and resolution | 11-exchange-rules.md §13 |

Terms: **shim** = the TS module inside the worker supervisor that consumes
native jobs; **executor** = a running native strategy binary process;
**token** = one unit of the host CPU budget (§7.2); **slot** = the shim's
admission index of an in-flight native job; **native checkout** = the goal
session's separate checkout on worker-1, `/Users/worker-1/Sites/polymarket-bot-native`
(D36), never the fleet working copy `/Users/worker-1/Sites/polymarket-bot`.

## 1. Evidence: what exists today

| Fact | Evidence |
|---|---|
| Native jobs pass the producer-SHA commit gate before the native branch runs | `src/backtest/marketProcessor.ts:33-45` (gate), `:49-63` (native branch) |
| Native results are returned unstamped (no machineId, slot, timing, worker SHA); only the TS path stamps them | `marketProcessor.ts:58` vs `:106-108`; `src/backtest/stats/marketStats.ts:16-25` |
| One process per market, full `process.env` inherited, no timeout, no kill, unbounded stdout, `code ?? 1` drops the signal | `src/strategy/artifacts/native.ts:88-119`, `:95`, `:114` |
| Hash verification memoized per process, not per machine; nothing evicted | `native.ts:46-84` |
| Profile flag never passed by the worker | `native.ts:156-157` vs `marketProcessor.ts:58` |
| The job's artifact ref has `sha256`, `r2Url`, optional `kind: 'native'`, no target | `src/strategy/artifacts/types.ts:38-46` |
| Market jobs: 3 attempts, exponential 5 s backoff, results kept in Redis until the aggregate | `src/backtest/queue.ts:86-91` |
| Lock 3 min, renewed while the Node event loop is free, so a hung child holds a slot forever | `queue.ts:116-120` |
| Node is single-threaded, so each machine forks N single-concurrency `tsx` children, each with an IPC channel to the supervisor | `src/cli/backtestWorker.ts:136-176` (`fork` with `'ipc'` at `:158`, `message` handler at `:166`), `src/cli/backtestWorkerChild.ts:119`, `docs/backtest/parallelization.md:150-160` |
| Self-update drain waits forever for in-flight jobs | `backtestWorker.ts:289` (`forceMarketChildrenAfterMs: null`) |
| Aggregate jobs are commit-gated too | `backtestWorker.ts:303-319` |
| A worker that cannot reach a job's commit exits 1 and stays down | `scripts/run-worker.sh:97-107` |
| Dirty producer tree blocks every BullMQ run | `src/cli/backtest.ts:1365-1388` |
| Stray detection only matches `node … backtestWorker.ts`; stop grace 120 s then SIGKILL; one host can be drained alone | `ops/ansible/lib/worker-control.sh:18-22`, `ops/ansible/stop-workers.yml:7`, `scripts/stop-worker-fleet.sh` (`--limit worker-1`) |
| Dashboard counts active children only in `backtest-markets` | `dashboard/src/lib/queries/batches.ts:65-78`, `dashboard/src/lib/queue.ts:3` |
| Siblings hold read-only R2 keys and no `DATABASE_*` | `docs/backtest/fleet/overview.md:114-131` |
| Long-running producer services run under launchd with `--watch` and `KeepAlive` | `ops/macos/recorder-v4-catalog/com.polymarket.recorder-v4-catalog.plist.template` |
| Measured TS cost 1.2-2.6 s/market; Codex Rust prototype 6.19x end-to-end with one process per market | requirements-sweep `cpu-slots-and-job-granularity`; research/early-audits.md §C |

## 2. Hosts and roles

Names and hardware from `dashboard/src/data/machines.json`; roles and TS slot
counts from the producer's local `ops/ansible/inventory.ini` (gitignored;
explicit `--market-concurrency` wins over machines.json, `run-worker.sh:29-50`).

| Host (machines.json / inventory alias) | Chip | Cores | RAM | `cores_for_backtest` | Roles today | TS slots | Native role |
|---|---|---|---|---|---|---|---|
| m1-ivan / `ivan-mbp` | M1 Pro | 8P + 2E | 16 GB | 4 | producer, dashboard, live-trading host (`DRY_RUN=false` in its env files), Binance R2 producer, GR daemon | none (`[producer]` only) | producer only: submits native runs, never consumes native jobs (D55), no engine work (2.6 GB free disk, D36) |
| worker-1 | M4 | 4P + 6E | 16 GB | 8 | markets + aggregate (concurrency 6), shared Redis, MySQL (`ops/macos/worker-1/com.polymarket.mysql84.plist`), GR daemon | 6 | engine implementation, builds, parity and benchmarks in the native checkout (D36, §13); rules capture (§16); M6 native host (D55) |
| worker-2 | M4 | 4P + 6E | 16 GB | 8 | markets, Recorder V4 pinned service, GR daemon | 3 | M6 native host with `--cpu-tokens 3` and `utility` QoS, so its Recorder V4 timing stays clean (D55, §7.3) |
| m1-milan / `milan-m1` | M1 Pro | 6P + 2E | 16 GB | 4 | markets | 4 | M6 native host if it is reachable and can stay awake on power for multi-hour runs (D55) |
| m5-milan / `milan-m5` | M5 Pro | 6 Super + 12P | 64 GB | 12 | none (commented out in the inventory) | 0 | none |

v1 target triple is `aarch64-apple-darwin` only (D12); m5-milan qualifies if
it is ever enabled. m1-ivan, the `PC` entry and any cloud burst host MUST
never consume native jobs.

## 3. Queues and routing

1. Native market jobs (single-candidate and candidate-group) MUST go to a
   dedicated queue named `backtest-markets-native-<target>`, v1:
   `backtest-markets-native-aarch64-apple-darwin`. A host whose target differs
   never fetches the job.
2. TS market jobs stay on `backtest-markets`, unchanged.
3. Aggregate jobs (TS runs, native single runs, candidate-group aggregates) stay
   on `backtest-aggregate` and keep the commit gate (D12).
4. Job ids keep today's grammar so the dashboard and aggregator parsing keep
   working: `<submissionUid>-m-<idx>` and `<submissionUid>-agg`
   (`src/backtest/jobTypes.ts:132-141`, `aggregateProcessor.ts:24-30`,
   `batches.ts:78`). Candidate groups use the group uid in the same position
   (41-candidate-groups.md §4).
5. A BullMQ flow MAY mix queues: the aggregate parent stays on
   `backtest-aggregate` while its children are on the native queue.
6. Every native job MUST carry an explicit BullMQ `priority` (§10). BullMQ runs
   jobs without a priority before all prioritized jobs, so mixing the two
   would defeat the classes.
7. The producer MUST add a run's native children in `market_start_ms` order
   (ties by slug), also for `--random` selections (`idx` keeps the selection
   order for the aggregator), and `--sequential` MUST dispatch in the same
   order, so consecutive jobs on a host hit the same per-day feed cache entries
   (16 §6.1). Dispatch order never affects results.

## 4. Gates: version and target vs the commit gate

| Job | Queue | Gate | On mismatch |
|---|---|---|---|
| TS market | `backtest-markets` | producer commit is ancestor-or-equal of worker launch SHA (`src/backtest/commitGate.ts:39-48`) | defer without consuming an attempt, self-update (exit 75) |
| Any aggregate (incl. group) | `backtest-aggregate` | same commit gate | same |
| Native market (single or group) | `backtest-markets-native-<target>` | target, shim version, binary protocol version, job schema version, blocklist, kill switch | see algorithm below |

The producer commit SHA and the producer dirty flag travel in native jobs as
provenance only (D12) and are persisted on the run row
(42-persistence-and-stats.md §3.1). The shim MUST NOT call `canRunJobCommit`
for native market jobs.

### 4.1 Gate fields

The fields are listed in 21 §4; their gate semantics are owned here:

| Field | Content |
|---|---|
| `strategyArtifact.kind`, `strategyArtifact.target` | `'native'`, target triple of the binary (31 §8 step 7) |
| `jobSchemaVersion` | the `EngineJob` version chosen at submit |
| `native.protocolVersion` | the binary's `protocolVersion` (20 §3), copied from `describe` at submit |
| `native.minShimVersion` | lowest shim version able to run this job (step 2 below) |
| `native.priorityClass` | `calibration` \| `user` \| `agent` (§10) |
| `native.producerDirty` | provenance only, never gated (D12) |

### 4.2 Algorithm

Evaluated by the shim before admitting a native job. Failures carry the class
and cause of 20 §4.1:

1. `strategyArtifact.target` MUST equal the host target. Mismatch →
   `UnrecoverableError`, `invalid_input: target_mismatch` (defensive; the queue
   name already prevents it).
2. `NATIVE_SHIM_VERSION` (a TS integer constant) MUST be
   `>= native.minShimVersion`. Otherwise → `moveToDelayed` without consuming an
   attempt and request self-update, exactly like the commit gate today. The
   producer computes `minShimVersion` from a compatibility table keyed by
   `(protocolVersion, jobSchemaVersion)`, not from its own shim version, so a
   producer upgrade does not force needless fleet restarts.
3. The binary's `describe` capabilities (cached per sha on disk and in memory;
   the producer reuses the same cache, 16 FX-2) MUST list
   `native.protocolVersion` and `jobSchemaVersion` (20 §3). Otherwise →
   `UnrecoverableError`, `invalid_input: artifact_incompatible` ("rebuild the
   artifact or update the fleet").
4. The artifact sha and its `engineVersion` MUST NOT be on the engine blocklist
   (§11). Otherwise → `UnrecoverableError`, `invalid_input: engine_blocklisted`.
5. If the fleet kill switch is off, the shim MUST pause its native consumer
   (jobs wait in the queue; nothing fails).

The producer MUST run checks 2-4 against its local shim before enqueueing,
plus the capability flag matrix (20 §5.6), so an unsupported combination fails
at submit time instead of as N failure rows.

For native runs the producer MUST NOT apply the dirty-tree block of
`src/cli/backtest.ts:1371-1388`; it records `producerDirty` instead (D12). The
aggregate job is still commit-gated, so a fleet run still needs a producer HEAD
that the workers can reach (pushed, or an ancestor of the worker checkout). GR
daemons run from worker checkouts on main and satisfy this naturally.

## 5. Worker shim

### 5.1 Process model

1. One worker supervisor per host (today's `backtestWorker.ts`, launched by
   `run-worker.sh`) MUST host the shim as an in-process BullMQ `Worker` on the
   native queue, enabled by a new `--queues …,native` value. The per-slot `tsx`
   children of the TS path are NOT copied (`backtestWorkerChild.ts:119`). The
   shim's per-job work is limited to Redis calls, small JSON, schema
   validation and `stat` calls (§6.1); whether one event loop suffices is
   measured (§14 rule E1), not assumed.
2. The shim MUST run executors as separate OS processes. Embedding the engine in
   Node (N-API) is rejected: every artifact is its own binary (engine plus
   strategy), a crash must not kill the supervisor, and the network-deny sandbox
   (§6.2) applies per process.
3. Default executor mode MUST be `serve` (20 §6): one long-lived executor per
   active artifact sha per host, many jobs in flight, warm per-day feed caches
   shared across markets (16 §6). The shim spawns an executor on first use of a
   sha with `--threads` = the host's token count (§7.2), `--max-inflight` = the
   same, `--work-dir` (§6.2), `--idle-exit-secs`, `--drain-timeout-secs` and
   the stack size from 20 §6.5, `--cache-mb` and `--max-rss-mb` from §7.4,
   `--qos` from §7.3, and `--tape-dir` when the host has tapes (§6.3). At most
   `maxExecutors` (20 §6.5) live per host; when a new sha needs an executor
   and the limit is reached, the shim sends `drain` (20 §6.2) to the least
   recently used executor that has no job in flight.
4. **Process-per-job mode** (`run` subcommand, 20 §5.4) MUST remain available
   behind `NATIVE_EXECUTOR_MODE=process-per-job` for debugging, parity tooling,
   crash isolation (§8.3) and as the benchmark baseline that justifies `serve`.
5. The shim sets the native consumer's BullMQ `concurrency` at runtime to the
   tokens it currently holds or can be granted plus a small prefetch `P`
   (default 2), so Redis round trips over Tailscale overlap with compute without
   hoarding jobs other hosts could run. A fetched job is dispatched only after
   its tokens are granted (§7.2).

### 5.2 Responsibilities (in order, per job)

1. Gate (§4).
2. Ensure the artifact: download once per machine, verify once per machine
   (§9), pin it while referenced.
3. Resolve every input to a local file and check it cheaply (§6.1).
4. Build the `EngineJob` from `MarketJobData` (21 §5) plus worker-local paths,
   with `budget.wallMs` (§8.2) and `budget.threads` = the token weight `w`
   (§7.2). Worker identity MUST NOT be passed to the binary; its output is a
   pure function of (binary, job), which is what makes the cross-machine proof
   (§12) meaningful. `idx` is never sent (21 §11).
5. Acquire tokens (§7.2), dispatch, supervise (§8).
6. Validate the `EngineResult` against the generated schema and run exactly
   the echo checks of 21 §12. A violation → `UnrecoverableError`,
   `invalid_output: schema` or `invalid_output: echo_mismatch`. The shim
   re-attaches `idx` from `MarketJobData.idx`. Validation happens here, per
   market, so one bad value becomes one failure row instead of aborting the
   whole run insert (`src/db/backtests.ts:403-501`, single transaction).
7. Stamp execution metadata and `recorderV4Capture` (§7.1); derive
   `rules_snapshot_ids` from the job's `captured[*].snapshotId` (21 §11).
8. Attach the ledger when requested (42 §7.5), compact and store the result
   (41-candidate-groups.md §6 for groups).
9. Release tokens; update the per-host Redis stats hash (§14).

## 6. Inputs and isolation

### 6.1 Inputs

1. The shim MUST turn every input into a local absolute path before dispatch:
   `local` paths as-is, `local-or-download-from-r2-to-local` via the existing
   download-if-missing helper, `r2` into a per-job temp file deleted after the
   job, Recorder V4 packages with the manifest and sha checks of
   `src/backtest/runSingleMarket.ts:392-401,427-429`. The binary rejects an
   `r2://` path as `invalid_input` (20 G3). The `[read-from]` LOCAL-hit /
   R2-download log line stays in TS.
2. **Cheap per-job checks.** On the per-job path the shim MUST NOT hash a file
   except (a) while downloading it (streaming sha256, no second read) or (b) on
   the first sight of a file whose `sha256` is known (V4 events, journals, and
   telonex files once 15 I-14 lands) and is not yet in the host verification
   index. The index (`data/native/verified-inputs.idx`, append-only, loaded at
   shim start, also held in memory) maps `(device, inode, bytes, mtime)` to the
   verified sha256; a V4 package is therefore verified once at download, not per
   job. Otherwise the shim only `stat`s the file and compares `bytes`. The
   executor's memoized check (15 I-8, I-9) is the per-job integrity gate.
3. **Integrity mismatch (20 §4).** When the shim's check or the executor
   reports an integrity mismatch for a file at its canonical path and the
   job's read mode allows a download (`local-or-download-from-r2-to-local`,
   `r2`), the shim MUST quarantine the file (rename to `<path>.bad-<ts>`), drop
   its index entry, re-download it once and re-dispatch within the same
   attempt; a second mismatch is `data_defect: integrity_mismatch`. Under
   `--read-from local` the host may not re-download, so the job fails
   `data_missing: integrity_mismatch` (retry ladder, any host).
4. Binance aggTrades and Chainlink `crypto_prices` day files are passed as
   explicit paths in `market.feedFiles` (21 §5), resolved by the shim from its
   configuration. A missing day file is `data_missing: day_file_missing` before
   dispatch, with the exact fix command in the reason (21 §9).

### 6.2 Environment and sandbox

1. Executors MUST start with exactly the environment allowlist of 20 G6 and
   nothing else.
2. cwd MUST be the executor's `--work-dir`: a per-job (process-per-job) or
   per-executor (`serve`) temp directory under the host data root, removed on
   exit.
3. Executors MUST run under a `sandbox-exec` profile that denies all network
   access, allows reads of the artifact, the data roots, the tape root (§6.3)
   and system libraries, and allows writes only to the work dir. A host where
   the profile cannot be applied MUST refuse native jobs (pause the consumer
   and report it in the heartbeat) rather than run unsandboxed. These binaries
   hold agent-written code (M11 follows M6, D39) and run on hosts
   that hold the shared Redis, MySQL and its credentials (worker-1) and R2 read
   keys.
4. The executor inherits the worker's macOS resource policy
   (`run-worker.sh:56-59`, `taskpolicy -a`); §7.3 sets thread QoS on top of it.

### 6.3 Derived tapes (16 §7.5, NT-8; D46)

1. Before G2, tapes exist only on worker-1, under the native checkout's tape
   root (`data/native-tapes/`), within the 40 GB cap of D46. Nothing in the
   fleet working copy changes.
2. After the user's G2 yes on tapes and per-host caps (D46, 16 M-20), M6 adds a fleet
   build step: a `data:sync:worker` stage and a worker-start backfill at
   `background` QoS run `pmb-tape` over the host's local v1 telonex-delta files,
   newest markets first, into `<data root>/native-tapes/`, within the host's
   `native_tape_max_gb` (inventory; worker-1 40 GB, other hosts set at G2) and
   the free-disk floor of 16 NT-7. The v1 files are never rewritten or
   re-converted, and tapes are never uploaded to R2 (NT-1, NT-8).
3. `pmb-tape` is built on each host by the canonical builder during
   `fleet:native:provision` (§17). Its sha MUST equal the sha recorded for that
   engine release (reproducible build); on a mismatch the host builds no tapes
   and reports it. Executors only read tapes (NT-4); a bad or stale tape falls
   back to v1 (NT-5).
4. `fleet:status` shows tape bytes, cap and coverage per host (§15).

## 7. Execution metadata, CPU and memory

### 7.1 Stamping (TS owns provenance)

The shim MUST stamp `marketStats.execution` on every native result (every
candidate result for groups) with the existing field set
(`marketStats.ts:16-25`), so `backtest_run_markets.machine_id` and the timing
columns are never NULL for native rows (`dashboard/src/lib/queries/leaderboard.ts:38-60`
drops NULL-machine rows). All times are taken by the shim on the host clock;
the binary's `diagnostics` (21 §10) are metrics only and are never stamped.
21 §12 states the same rule.

| Field | Value for native jobs |
|---|---|
| `machineId` | `getMachineId()` of the host |
| `workerChildId` | `100 + slot`, where `slot` is the lowest free shim admission index (1..host tokens) at dispatch, so native slots never collide with TS child ids 1..N in displays |
| `startedAtMs` | shim wall clock at dispatch to the executor (after token grant, so shim-side waiting is excluded) |
| `finishedAtMs` | shim wall clock at result receipt |
| `durationMs` | single candidate: `finishedAtMs − startedAtMs`; group of `k` candidates admitted with weight `w`: `floor(w × (finishedAtMs − startedAtMs) / k)` per candidate (41 §7.4) |
| `eventsProcessed`, `eventsByType` | copied from the engine output |
| `commitSha` | the shim's `WORKER_LAUNCH_SHA` (the TS code that ran on that host). Engine identity is per run (artifact sha, `engine_version`, `engine_commit` on the run row) and does not vary per market. |

For a job that succeeded after an isolated re-run (§8.3) the stamps are those
of the successful run. In process-per-job mode, start and finish are spawn and
exit.

`recorderV4Capture` MUST be built by the shim from the job's manifest with the
same function the TS path uses (`runSingleMarket.ts:449-458`); the binary never
emits it.

### 7.2 Host CPU token pool

Static splitting (a fixed number of TS children plus a fixed native thread
count) leaves native threads idle while TS is saturated and the other way
round. v1 therefore shares the host through one pool.

1. Each host has `C` CPU tokens: `--cpu-tokens C` in the inventory command,
   else `cores_for_backtest` from machines.json (same precedence as
   `--market-concurrency`). The supervisor process, which already hosts both the
   TS child pool and the shim (§5.1.1), MUST own one in-process token
   semaphore of size `C`.
2. **TS children** (unchanged count, `--market-concurrency`) MUST hold one token
   while they run a job and MUST NOT fetch a job without one. Mechanism: over
   the existing IPC channel (`backtestWorker.ts:158,166`) the supervisor grants
   a token and the child resumes its BullMQ `Worker`; on job completion the child
   pauses its worker and returns the token. A transient overshoot of at most one
   job per TS child during a grant race is accepted and counted.
3. **Native jobs** acquire `w` tokens before dispatch: a single-candidate job
   weighs 1; a group job weighs `min(k, C)` when the executor may fan its
   candidates out across threads (41 §5.5), else 1. The executor's pool has `C`
   threads and receives `w` as `EngineJob.budget.threads` (21 §5, 20 §6.2).
   Executors' total admitted weight never exceeds the tokens held (16 EX-9).
4. **Sharing policy.** When both sides have waiting work, each side is
   guaranteed `floor(C × share)` tokens (`--native-token-share`, default 0.5)
   and unused share flows to the other side immediately. When only one side has
   work it may take all `C` tokens. A grant never preempts a running job.
5. `--cpu-tokens-mode static --native-threads T` keeps a static split for
   debugging and as the M6 A/B baseline.
6. The heartbeat reports tokens held by TS, by native, idle, and overshoot
   counts (§14). M6 measures fleet throughput under mixed TS and native load
   with the pool vs the static split.

### 7.3 Apple P-cores, E-cores and QoS

1. macOS does not allow pinning threads to cores. Placement is steered by QoS
   (16 §10.1).
2. Native pool threads set their QoS from the executor's `--qos` (16 §10.2),
   configured per host. Defaults: worker-1 and m1-milan `default`; worker-2
   `utility` with `--cpu-tokens 3`, so the Recorder V4 receive path keeps
   priority. Whether this protects recorder receive latency MUST be measured
   with the recorder's own lag metrics under load; if it does not, worker-2's
   tokens are lowered, never raised.
3. The pool is work-stealing, so heterogeneous core speeds never create
   stragglers at job granularity (16 §10.1).
4. The right `C` per host MUST be measured, not assumed, with the sweeps of
   16 §10.3 (worker-1 in M5a, the other M6 hosts in M6) under the benchmark
   conditions of 16 §13.5: a fixed 200-market set, market-candidates per hour,
   `C` set at the knee and written to the inventory and the M6 report.

### 7.4 Memory budget

All fleet Macs except m5-milan have 16 GB and also run Redis, MySQL, GR
sessions or the recorder. Each host has `native_memory_mb` (default 3072)
covering all its executors (16 §6.2). The shim passes each executor a share as
`--max-rss-mb` (the binary then emits `busy` and stops accepting jobs, 20 §6.2)
and also samples executor RSS every second and reads `rssBytes` from `pong`.
Above 80 % of the host budget the shim stops dispatching to the largest
executor; above 100 % it kills that executor (§8.3, `killed: oom_budget`).
Per-day feed caches stay inside `--cache-mb`, LRU by bytes (20 §6.3 S3).

### 7.5 Job granularity

1. v1 keeps one BullMQ job per market (per market and group for candidate
   groups), so job ids, failure rows and the aggregator stay unchanged.
2. Per-job overhead (fetch, lock, complete, parent update, JSON, IPC) is hidden
   by the prefetch of §5.1 rather than amortized by larger jobs. The shim MUST
   measure `overheadFraction = 1 − Σ (finishedAtMs − startedAtMs) × w / (C × wallMs)`
   per host over saturated intervals and report it.
3. Multi-market chunk jobs MAY be introduced later only if `overheadFraction`
   stays above 5 % on a saturated host after prefetch tuning; that change needs
   an aggregate protocol bump and a new job-id grammar.

## 8. Failure handling

### 8.1 Error classes and BullMQ mapping

The class and cause vocabulary is the closed set of 20 §4 and §4.1; the retry
policy is 20 §4.3. This table maps each class to the shim's action. The reason
stored in `backtest_run_failures.reason` is `<class>: <cause>: <message>`
(20 §4.2); class and cause go to `failure_class` and `failure_detail`
(42 §3.6).

| Class (20 §4) | Typical causes, incl. shim causes | Shim action | Ends as |
|---|---|---|---|
| — (`ok`) | — | stamp, store | market row(s) |
| `invalid_input` | bad job or params, `r2://` path, unsupported flag; shim: `target_mismatch`, `artifact_incompatible`, `engine_blocklisted` | `UnrecoverableError` | failure row (every candidate) |
| `data_missing` | a required local file is absent on this host (`day_file_missing`, `input_missing`), or a pre-existing local copy fails its check under `--read-from local` (`integrity_mismatch`) | throw: retry ladder (3 attempts, any host) | failure row naming the fix command after 3 attempts |
| `data_defect` | integrity mismatch of a freshly downloaded canonical copy (after the one re-download of §6.1.3), decode failure of a verified file, unknown format version, foreign file, Chainlink hole ≥ `maxGapMs`, pre-coverage market, PTB pipeline gap (14 §10) | `UnrecoverableError` | failure row |
| `runtime` | transient I/O or resource error, R2 download failure | throw: retry ladder | failure row after 3 attempts |
| `timeout` | cooperative deadline expired (20 §6.3 S4) | first time: set `native.timeouts = 1` with `job.updateData`, throw; the retry runs with 2× budget. Second time: `UnrecoverableError`. A group candidate stuck in a callback: §8.2.3 | failure row |
| `strategy_fault` | strategy panic, overflow or contract breach (12); shim: `result_too_large` (41 §6.2) | single-candidate job: `UnrecoverableError`; group: per-candidate error inside an ok result, no retry; `result_too_large`: `UnrecoverableError` for the whole job | failure row for that candidate only (`result_too_large`: every candidate) |
| `engine_fault` | caught engine panic or invariant violation | `UnrecoverableError`, alert | failure row |
| `invalid_output` | engine egress check (21 §19); shim: `schema`, `echo_mismatch`, `line_too_large` (20 G9) | `UnrecoverableError`, alert | failure row |
| `killed` | executor died by signal; shim: `oom_budget`, `backstop_timeout`, `pong_missing` | isolated re-run within the attempt (§8.3); if the isolated run is killed too, `UnrecoverableError` | failure row only for the job that kills its isolated run |
| `canceled` | shim-initiated cancel (drain deadline) | never persisted; the job is released with `moveToDelayed` (§8.4) | — |

Every failure carries a one-line human reason (20 §4: the structured error
document is authoritative, the last stderr line is the fallback).

### 8.2 Timeouts

1. Every native job MUST carry `budget.wallMs` (21 §5). Default:
   `budgetMs = max(120 000, 10 × expectedMs)` with
   `expectedMs = msPerMB(host class) × inputMB × (1 + 0.3 × (k − 1))`,
   capped at 30 min, doubled after one timeout (§8.1). Coefficients come from
   the M6 benchmark and live in code; until then `120 s + 5 s × k`. Timeouts
   catch hangs, not slow hosts.
2. The binary checks the budget cooperatively and returns `timeout: deadline`
   (20 §6.3 S4). The shim's backstop follows S4 and the constants of 20 §6.5
   exactly (ping every 5 s; kill the executor's process group at 2× budget
   plus 30 s or after 30 s without `pong`). The kill puts every in-flight job
   of that executor through §8.3.
3. **Stuck group candidate.** `progress.inCallback` and
   `pong.inflight[].inCallback` (20 §6.2) name a candidate that has been inside
   strategy code for more than 1 s. When the backstop fires on a group job
   whose latest `inCallback` has named the same candidate since before the
   job's deadline, the shim re-runs that job in isolation (§8.3) without that
   candidate and records a candidate error `timeout: deadline` for it, with the
   callback name in the message. The other candidates' results are valid by
   standalone equivalence (41 §2.2). Otherwise the whole job follows items 1-2.
4. The BullMQ lock keeps renewing while Node is alive (`queue.ts:116-120`), so
   the budget and the backstop, not the lock, free a token.

### 8.3 Crashes, memory, parent death, output bounds

1. Executors MUST be spawned in their own process group; the shim kills the
   group (`SIGKILL` to `-pgid`) so no orphan survives.
2. **Crash attribution (20 §6.3 S5).** When an executor dies unexpectedly
   (signal, non-zero exit, oversize line) or the shim kills it, every job in
   flight on it is marked suspect and re-run once in isolation within the same
   BullMQ attempt, with the same tokens: a `run` (or `run-group`) process per
   job, started sequentially per suspect job. A job whose isolated process is
   killed fails as `killed` (§8.1). A job whose isolated run succeeds completes
   normally. Bystanders of a poison job therefore never fail and never consume
   attempts.
3. An executor that exits 0 after its idle timeout while the shim has just
   written a job to it (idle-exit race) is not a crash: the shim re-dispatches
   that job to a new executor with no isolation step.
4. Crash-loop guard per 20 S5 and §6.5 (jobs are delayed, not failed), reported
   in the heartbeat.
5. Panics in strategy code never abort the executor (D18, 20 G7, 12). The pool
   thread stack size is set only by 16 EX-6; a stack overflow aborts the
   process and is handled by item 2.
6. Parent death and stdin follow 20 G8: stdin EOF without a prior `drain` means
   "parent gone" and the executor exits within 1 s without finishing in-flight
   work. The shim therefore closes stdin only when it wants that effect (it is
   itself exiting without a drain). Orderly shutdown always uses `drain` (§8.4).
7. Framing follows 20 §6.2 and G9: NDJSON, one message per line, line cap of
   20 §6.5. An oversize or malformed line → kill the executor, item 2 applies,
   and a job that reproduces it in isolation fails
   `invalid_output: line_too_large`. stderr (NDJSON logs, 20 G1) is kept in a
   bounded ring (64 KiB per job), keyed by `jobId`.
8. A signal death arrives with no exit code; the shim MUST record the signal
   (today `code ?? 1` loses it, `native.ts:114`).

### 8.4 Drain and stop

1. Self-update and graceful stop: the shim stops fetching (BullMQ `pause`),
   sends `drain` to every executor (20 §6.2) and waits for each `drained`, at
   most the longest remaining job budget and never longer than the executor's
   `--drain-timeout-secs`. At that deadline the shim sends `cancel` for each
   remaining job, waits up to 5 s for the `canceled` results, releases those
   jobs with `moveToDelayed` (no attempt consumed, like the commit gate) and
   kills the executor's process group. Nothing waits forever
   (`backtestWorker.ts:289` today does).
2. `worker-control.sh` `strays()` MUST also match executor processes (command
   path under `data/strategy-artifacts/native/`) so `fleet:stop` and hard stops
   reap them.

## 9. Artifact cache (fleet side)

Build, identity and publish rules are in 31-artifacts-build-publish.md. On each
host:

1. Cache path `data/strategy-artifacts/native/<sha256>` (mode 0755), verified
   once per machine: after a successful sha check and `selftest` (20 §5.3) the
   shim writes `<sha>.verified` holding size and mtime; later processes trust it
   while size and mtime match.
2. Size cap per host (default 5 GiB) with LRU eviction; a sha referenced by a
   live executor or an admitted job MUST NOT be evicted.
3. On submit the producer publishes a prefetch message (Redis pub/sub channel
   `native:prefetch` with sha and R2 URL); shims download and verify in the
   background so many slots never cold-download the same binary at once.
4. Workers MUST refuse any binary whose `describe` reports
   `capabilities.realOrders = true` (31 §5.5, `invalid_input:
   artifact_incompatible`). The `real-orders` variant is a separate feature
   build made by the user on the live host and never read by workers, so fleet
   and agent binaries cannot place orders (D44).
5. `fleet:status` shows cache size, executor count and verified shas per host.

## 10. Fair scheduling

1. Native jobs MUST carry `native.priorityClass`, in this order: `calibration`
   (highest), `user` (CLI runs), `agent` (GR / protocol runs: `--protocol` or
   `BACKTEST_PROTOCOL` set). Within a class the priority value SHOULD grow with
   group weight so a 100-candidate sweep does not block single runs of the same
   class. Priorities order waiting jobs only; a running job is never preempted.
2. BullMQ OSS has no fair share across submissions. Queue wait time per class
   MUST be measured and reported. Agent volume on the native queue starts with
   M11 right after M6 (D39); a fair-share scheduler is a later change only if
   the measurements show starvation.

## 11. Kill switch, blocklist, rollback

1. **Kill switch**: Redis key `native:dispatch:enabled` (`1`/`0`, absent = `0`).
   Producer refuses to enqueue native runs when `0`; shims pause their native
   consumer when `0` and resume when `1` (polled every 5 s). This is the fleet-wide
   stop for an engine bug.
2. **Blocklist**: `native/fleet/blocklist.json`, committed on main, lists artifact
   shas and engine version ranges with a reason. Producer and shim enforce it (§4);
   the dashboard flags runs whose `engine_version` or artifact sha is blocklisted
   (42 §6). Main is the single source, so workers pick it up through normal
   self-update.
3. **Rollback**: set the kill switch to `0`, add the bad engine version to the
   blocklist, merge, `fleet:git:pull`, then set the switch back. Bad runs are not
   deleted; they are flagged.

## 12. Cross-machine determinism proof

Before native dispatch is enabled on the fleet (and after every engine minor
release), a canary MUST show that the same binary and the same jobs give
byte-identical deterministic sections (`resultDigest`, 21 §10) on every native
host (worker-1, worker-2, m1-milan if available):

1. A committed fixture set is run locally on each host by an ansible playbook
   (`fleet:native:canary`) in process-per-job and `serve` modes, at one token
   and at all tokens, with and without tapes (§6.3). The set has ≥ 50 BTC 15m
   telonex-delta markets in ts-compat, the same markets in realistic once M3b
   has landed, and one candidate group once M4 has landed. BTC 5m markets join
   when Telonex 5m data exists (D38), V4 packages after M7.
2. Each host prints the `resultDigest` of each job; the playbook diffs them
   across hosts. Any difference blocks enabling and is a Rust bug until
   classified (10-domain-model.md determinism rules).
3. The same hosts build the same strategy source with the canonical builder
   and compare shas (31 §7.6, DET-12).

## 13. Branch policy and rollout (D03, D12, D36, D37)

| Phase | Where native code runs | Rules |
|---|---|---|
| A. Before G2 (M0-M2) | worker-1, native checkout only (D36) | Engine branch only (D01, D03); main untouched except the rules-capture PR (D37, 11 §13.2.1). No fleet branch switch, no native queue, no shared Redis or MySQL writes, no native run persisted anywhere (01 §8): native code is reached only through the parity tooling and the bench driver, which run executors locally. The host rules of 01 §8.1 apply: read-only data and `node_modules` links into the fleet working copy (H2), builds, tests and parity alongside the fleet worker and GR sessions at reduced concurrency (H4), and benchmarks only in the D47 window with worker-1's GR runs paused (never killed) and its fleet worker drained (H5, 16 §13.5). Draining worker-1 also holds the fleet's aggregate queue for that window. |
| B. G2 merge | nowhere yet | One merge to main (D03) with the M1-M2 content of 01 §8: no migrations, no shim, no native queue, no user-reachable native backtest path. |
| C. M3a-M5b | worker-1, `--sequential` only | Small PRs on main. Native runs execute in the producer process against a local executor (41 §4.9 for groups) and persist to the production schema with full provenance once the M3a migrations are applied (42 §2). No native queue yet, so no `--detach` for native runs. |
| D. M6 fleet canary | M6 native hosts | The shim, native queue, token pool (inactive until a host opts in) and dashboard changes land as M6 PRs; kill switch absent (= off); hosts get them through normal `fleet:git:pull`. Then provisioning (§17), tapes if approved at G2 (§6.3), the cross-machine proof (§12), and a 1,000-market TS vs Rust benchmark run (M6, 16-performance-and-parallelism.md §13). |
| E. Enabled | hosts with `,native` in `--queues` | Kill switch `1`. Small PRs from here (D03). M11 (D39) follows: GR agents submit native runs with `priorityClass: agent`. |

Runbooks (the operator docs under `docs/backtest/fleet/` are written with the
M6 PRs):

- **Enable a host**: add `,native` to `--queues` (and `--cpu-tokens C` if it
  differs from machines.json) in its inventory command, `fleet:git:pull`,
  confirm the heartbeat shows the shim version, target, tokens and sandbox
  active.
- **Deploy a shim change**: merge to main, `fleet:git:pull` (≈ 4-7 s); in-flight
  native jobs finish or are released during the drain (§8.4).
- **Rollback**: §11.3.
- **Emergency branch switch**: MUST NOT be needed (D03). If the user ever orders
  one: pause every GR run, drain both queues, switch all hosts and the aggregator,
  test, drain, switch back, resume (pause before daemon restart, because
  `fleet:runtime:stop` kills in-flight sessions).

During paper, live and calibration sessions, native work on the session host
and on worker-2 (whose recorder is the calibration reference) MUST be stopped
or capped as 51 §7.1 specifies (16 §10.3: `utility` or `background` QoS). Which
host runs calibration and live is a gate-4 question (01 §12.1 item 3).

## 14. Measurement (speed is the top priority)

The shim and the benchmark MUST report, per host and fleet-wide, with no pass
threshold (D07). Fleet numbers are native-artifact throughput, never a
fleet-wide speedup (01 §1.1).

| Metric | Source |
|---|---|
| market-candidates per hour, same 1,000 markets, TS vs Rust, on the M6 native hosts (§2) | M6 benchmark (16-performance-and-parallelism.md §13, 60-verification.md) |
| end-to-end run wall time with the FX-1 phase breakdown, before and after each FX item | producer and aggregator (16 §13.9, FX-8) |
| `overheadFraction` (§7.5) | shim |
| executor busy ms, CPU ms, peak RSS per job | `diagnostics` and `pong` → per-host Redis hash `backtest:worker:<machineId>#native` (`src/backtest/workerIdentity.ts:16-18` key grammar, extended with `'native'`) |
| token utilization: held by TS, held by native, idle, grant overshoots | supervisor |
| throughput with the token pool vs the static split, mixed TS and native load | M6 benchmark (§7.2.6) |
| Node event-loop utilization (`performance.eventLoopUtilization()`) and shim CPU ms per job | shim |
| verification index hit rate, bytes hashed per job, tape path share | shim, `diagnostics` |
| isolated re-runs, idle-exit races, crash-loop pauses | shim |
| `serve` vs process-per-job throughput; throughput vs `C` and QoS per host (§7.3) | benchmark |
| queue wait per priority class | shim |
| Redis memory peak during a large group | benchmark (41 §6) |

Rule E1: if event-loop utilization exceeds 50 % on a saturated host, the shim
MUST move its remaining CPU work (JSON, schema validation, any hashing) to a
`worker_threads` pool or split the native consumer into its own child process
with its own event loop, and the M6 report MUST show the before and after.

The heartbeat hash MUST also carry `nativeShimVersion`, `target`, `cpuTokens`,
`qos`, `sandbox`, `executors`, `cacheBytes`, `tapeBytes`, so `fleet:status` and
the dashboard Workers panel can show them. Per-market CPU and RSS are not
persisted in MySQL in v1 (table growth, 42 §8).

## 15. Dashboard and ops changes owned here

1. Dashboard queue helpers (`dashboard/src/lib/queue.ts`, `queries/batches.ts:65`,
   `queries/queues.ts`, `queries/health.ts`) MUST count active children across
   `backtest-markets` and the native queue.
2. Bull Board MUST list the native queue.
3. `fleet:status` MUST show the native heartbeat fields (§14), cache size (§9),
   tapes (§6.3), provisioning state (§17) and rules-capture coverage (§16).
4. `worker-control.sh` strays (§8.4).

## 16. Pre-start rules snapshot capture (D37)

11 §13.2.1 owns the pre-start capture script (merged to main before G2, D37),
its file format, its deployment on worker-1 (PC7: pinned checkout
`/Users/worker-1/pmb-rules-capture/app`, files under
`/Users/worker-1/pmb-rules-capture/prestart`, LaunchAgent
`com.pmb.rules-capture`) and the import command (PC10). It reads public
endpoints only, writes files only and is independent of the engine, the
fleet copy and the Telonex subscription (D38). This section owns its
operation from M3a on (11 PC9, RC-G2 step 6).

1. **Periodic import.** After the M3a migrations and the first full import
   (11 RC-G2 steps 1-2), a second user LaunchAgent on worker-1,
   `com.pmb.rules-import`, runs `npm run rules:import-jsonl -- --dir
   /Users/worker-1/pmb-rules-capture/prestart --from <yesterday, UTC>` every
   hour from the capture checkout, re-pinned on purpose to a main commit that
   contains the M3a import (PC7, PC10). Worker-1 hosts the production MySQL
   and holds its credentials (market siblings hold none, §1), so that
   checkout's `.env` gets only the `DATABASE_*` settings; the capture itself
   never reads it (PC6). The import is idempotent; a run that exits 1 (sha or
   slug mismatch, malformed line) is reported by item 2.
2. **Monitoring.** From M6, `fleet:status` reads the capture's `status.json`
   (11 PC4) and the import's last result on worker-1, and warns when a
   timeframe's 24 h coverage is below 99 %, `lastTickAtMs` is older than
   10 min, or the last import failed or is older than 2 h. Until M6 the goal
   session runs `--report --days 7` at every milestone start (PC9).
3. **Archive.** The files stay the raw archive after import; completed day
   files SHOULD be copied daily to a second host, because a lost pre-start
   body cannot be re-fetched.

## 17. Build-host provisioning

31 §3 item 4 relies on provisioned build hosts, 31 §7.6 makes the M6 proof build
the same source on every native host (§12.3), §6.3 builds `pmb-tape` on each
host, and M11's build daemon builds agent strategies outside the sandbox
(31 §11, D39).

1. `npm run fleet:native:provision` runs an idempotent ansible playbook
   (`ops/ansible/native-provision.yml`) on every native host (§2). It installs
   rustup when absent and the toolchain pinned in `native/rust-toolchain.toml`
   with `rustfmt` and `clippy` (worker-1 already has a user-level rustup,
   D36); checks the Xcode Command Line Tools version
   (`pkgutil --pkg-info=com.apple.pkg.CLTools_Executables`) against the version
   pinned by the answer to 31 gate-4 question 1, and only records it until then;
   and runs `cargo fetch --locked` for `native/Cargo.lock` into a shared
   per-host `CARGO_HOME` (e.g. `~/.cargo-pmb`), so later builds run
   `--offline` (31 §3.2).
2. It prints one verification line per host (rustc version, CLT version,
   registry ready, `pmb-tape` sha, free disk) and stores it for `fleet:status`.
   It never restarts workers. Expected disk use is about 2 GB per host.
3. Builds on a host that runs backtests (31 §4.5), including the goal
   session's builds in the native checkout while worker-1's fleet worker
   runs (01 §8.1 H4), use `CARGO_BUILD_JOBS` = 4 on M4 hosts and 2 on M1 Pro
   hosts (inventory `cargo_build_jobs` overrides) and `taskpolicy -b`; M5
   measures the effect on build time and backtest throughput.
4. The shim never builds anything; executors run downloaded, verified binaries.

## 18. Dependencies on other documents

None open: every item was applied in the gate-1 consolidation.

## Open questions

None. Decided: phase-A storage (moot, no native persistence before M3a,
01 §8), worker-2 capacity and m1-ivan (D55, §2), the early rules capture (D37,
§16). The priority order of §10 (calibration, then user, then agent) is
settled here as recommended in 03; the user may change it like any decision
(D56).

## Gate-4 questions

None owned here. Two gate-4 questions of 01 §12.1 touch this document: the
calibration and live host (item 3; §13 caps native work on that host while a
session runs) and R2 tokens (item 1; market workers keep read-only R2 keys,
§6.2, and only worker-1 uploads under the interim rule).
