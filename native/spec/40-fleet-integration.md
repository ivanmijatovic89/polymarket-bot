# 40 — Fleet integration

Purpose: define how native (Rust) market jobs travel through the existing
TypeScript BullMQ fleet: which queue they use, what gates them instead of the
producer commit SHA, how the TS worker shim supervises the executor process,
how execution metadata is stamped, how CPU and memory are shared on the Apple
Silicon Macs, how crashes, timeouts and memory blow-ups map to BullMQ retry
semantics, how the branch policy of 02-decisions.md (D03, D12) constrains
rollout, and which fleet-side services (pre-start rules capture, build-host
provisioning) other documents rely on. The design goal is maximum fleet
throughput (market-candidates per hour) without weakening determinism or the
TS output contract.

This document owns fleet behavior only. It defers to other documents for:

| Topic | Owner |
|---|---|
| `serve` wire protocol: NDJSON framing, line cap, messages, drain, idle exit, parent death, env allowlist, exit codes, the closed error-class vocabulary | 20-binary-protocol.md §2, §4, §6 |
| `MarketJobData` additions, `EngineJob`/`EngineResult`, echo checks, the `execution` field set | 21-job-and-output-contract.md §4, §5, §10, §12 |
| In-binary pool, caches, Parquet decoding, pool thread stack size | 16-performance-and-parallelism.md (EX-6 for the stack) |
| Input integrity fields and the executor's memoized verification | 15-inputs.md I-8, I-9 |
| Candidate groups | 41-candidate-groups.md |
| DB columns | 42-persistence-and-stats.md |
| Rules snapshot content and resolution | 11-exchange-rules.md §13 |

Terms: **shim** = the TS module inside the worker supervisor that consumes
native jobs; **executor** = a running native strategy binary process;
**token** = one unit of the host CPU budget (§7.2); **slot** = the shim's
admission index of an in-flight native job.

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
| Stray detection only matches `node … backtestWorker.ts`; stop grace 120 s then SIGKILL | `ops/ansible/lib/worker-control.sh:18-22`, `ops/ansible/stop-workers.yml:7` |
| Dashboard counts active children only in `backtest-markets` | `dashboard/src/lib/queries/batches.ts:65-78`, `dashboard/src/lib/queue.ts:3` |
| Siblings hold read-only R2 keys and no `DATABASE_*` | `docs/backtest/fleet/overview.md:114-131` |
| Long-running producer services run under launchd with `--watch` and `KeepAlive` | `ops/macos/recorder-v4-catalog/com.polymarket.recorder-v4-catalog.plist.template` |
| Measured TS cost 1.2-2.6 s/market; Codex Rust prototype 6.19x end-to-end with one process per market | requirements-sweep `cpu-slots-and-job-granularity`; research/early-audits.md §C |

## 2. Hosts and roles

Names and hardware from `dashboard/src/data/machines.json`; roles and TS slot
counts from the producer's local `ops/ansible/inventory.ini` (gitignored;
explicit `--market-concurrency` wins over machines.json, `run-worker.sh:29-50`).

| Host (machines.json / inventory alias) | Chip | Cores | RAM | `cores_for_backtest` | Roles today | TS slots today |
|---|---|---|---|---|---|---|
| m1-ivan / `ivan-mbp` | M1 Pro | 8P + 2E | 16 GB | 4 | producer, dashboard, live-trading host (`DRY_RUN=false` in its env files), Binance R2 producer, GR daemon | none (`[producer]` only) |
| worker-1 | M4 | 4P + 6E | 16 GB | 8 | markets + aggregate, shared Redis, MySQL (`ops/macos/worker-1/com.polymarket.mysql84.plist`), GR daemon | 6 |
| worker-2 | M4 | 4P + 6E | 16 GB | 8 | markets, Recorder V4 pinned service, GR daemon | 3 |
| m1-milan / `milan-m1` | M1 Pro | 6P + 2E | 16 GB | 4 | markets | 4 |
| m5-milan / `milan-m5` | M5 Pro | 6 Super + 12P | 64 GB | 12 | none (commented out in the inventory) | 0 |

v1 target triple is `aarch64-apple-darwin` only (D12); m5-milan qualifies if
it is ever enabled. The `PC` entry and any cloud burst host MUST never consume
native jobs.

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
7. The producer SHOULD add a run's native children in `market_start_ms` order,
   also for `--random` selections (`idx` keeps the selection order for the
   aggregator), so consecutive jobs on a host hit the same per-day feed cache
   entries (16 §6.1). Dispatch order never affects results.

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

### 4.1 Gate fields (fleet-owned `MarketJobData` additions)

21 §4 owns `MarketJobData`. The gate reads these fields; the three marked
"40" are owned here and MUST be listed in 21 §4:

| Field | Owner | Content |
|---|---|---|
| `strategyArtifact.kind`, `strategyArtifact.target` | 31 §8 step 7 | `'native'`, target triple of the binary |
| `jobSchemaVersion` | 21 §4 | the `EngineJob` version chosen at submit |
| `native.protocolVersion` | 40 | the binary's `protocolVersion` (20 §3), copied from `describe` at submit |
| `native.minShimVersion` | 40 | lowest shim version able to run this job (step 2 below) |
| `native.priorityClass` | 40 | `calibration` \| `user` \| `agent` (§10) |

### 4.2 Algorithm

Evaluated by the shim before admitting a native job:

1. `strategyArtifact.target` MUST equal the host target. Mismatch →
   `UnrecoverableError`, class `invalid_input`, detail `target_mismatch`
   (defensive; the queue name already prevents it).
2. `NATIVE_SHIM_VERSION` (a TS integer constant) MUST be
   `>= native.minShimVersion`. Otherwise → `moveToDelayed` without consuming an
   attempt and request self-update, exactly like the commit gate today. The
   producer computes `minShimVersion` from a compatibility table keyed by
   `(protocolVersion, jobSchemaVersion)`, not from its own shim version, so a
   producer upgrade does not force needless fleet restarts.
3. The binary's `describe` capabilities (cached per sha on disk and in memory)
   MUST list `native.protocolVersion` and `jobSchemaVersion` (20 §3).
   Otherwise → `UnrecoverableError`, class `invalid_input`, detail
   `artifact_incompatible` ("rebuild the artifact or update the fleet").
4. The artifact sha and its `engineVersion` MUST NOT be on the engine blocklist
   (§11). Otherwise → `UnrecoverableError`, class `invalid_input`, detail
   `engine_blocklisted`.
5. If the fleet kill switch is off, the shim MUST pause its native consumer
   (jobs wait in the queue; nothing fails).

The producer MUST run checks 2-4 against its local shim before enqueueing,
plus the capability flag matrix (20 §5.1), so an unsupported combination fails
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
   same, `--idle-exit-secs 60`, `--drain-timeout-secs 1800` (the job budget cap,
   §8.2), `--cache-mb` and `--max-rss-mb` from §7.4 and `--qos` from §7.3. At
   most `maxExecutors` (default 3) live per host; when a new sha needs an
   executor and the limit is reached, the shim sends `drain` (20 §6.2) to the
   least recently used executor that has no job in flight.
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
4. Build the `EngineJob` from `MarketJobData` (21 §5) plus worker-local paths.
   Worker identity MUST NOT be passed to the binary; its output is a pure
   function of (binary, job), which is what makes the cross-machine proof (§12)
   meaningful. `idx` is never sent (21 §11).
5. Acquire tokens (§7.2), dispatch, supervise (§8).
6. Validate the `EngineResult` against the generated schema and run the echo
   checks of 21 §12 exactly (profile, seed, `modelConfigSha256`,
   `engineVersion`, slug, candidate keys and indices in order). A violation →
   `UnrecoverableError`, class `invalid_output`, detail `schema` or
   `echo_mismatch`. The shim re-attaches `idx` from `MarketJobData.idx`.
   Validation happens here, per market, so one bad value becomes one failure
   row instead of aborting the whole run insert (`src/db/backtests.ts:403-501`,
   single transaction).
7. Stamp execution metadata and `recorderV4Capture` (§7.1).
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
3. If the executor reports `data_defect` with an integrity mismatch for a file
   the shim downloaded into its canonical cache path, the shim MUST quarantine
   the file (rename to `<path>.bad-<ts>`), drop its index entry, re-download it
   once and re-dispatch within the same attempt. A second mismatch is final.
4. Binance aggTrades and Chainlink `crypto_prices` day files are passed as
   explicit paths in `market.feedFiles` (21 §5), resolved by the shim from its
   configuration. A missing day file is `data_missing` before dispatch, with
   the exact fix command in the reason (21 §9).

### 6.2 Environment and sandbox

1. Executors MUST start with exactly the environment allowlist of 20 G6
   (`TZ=UTC`, `LANG=C`, `PMB_LOG`, `RUST_BACKTRACE=1`) and nothing else.
2. cwd MUST be a per-job (process-per-job) or per-executor (`serve`) temp
   directory under the host data root, removed on exit.
3. Executors MUST run under a `sandbox-exec` profile that denies all network
   access, allows reads of the artifact, the data roots and system libraries,
   and allows writes only to its temp directory. A host where the profile cannot
   be applied MUST refuse native jobs (pause the consumer and report it in the
   heartbeat) rather than run unsandboxed. These binaries hold agent-written code
   and run on m1-ivan, which holds live keys.
4. The executor inherits the worker's macOS resource policy
   (`run-worker.sh:56-59`, `taskpolicy -a`); §7.3 sets thread QoS on top of it.

## 7. Execution metadata, CPU and memory

### 7.1 Stamping (TS owns provenance)

The shim MUST stamp `marketStats.execution` on every native result (every
candidate result for groups) with the existing field set
(`marketStats.ts:16-25`), so `backtest_run_markets.machine_id` and the timing
columns are never NULL for native rows (`dashboard/src/lib/queries/leaderboard.ts:38-60`
drops NULL-machine rows). All times are taken by the shim on the host clock;
the binary's `diagnostics` (21 §10) are metrics only and are never stamped.

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
exit. 21 §12 MUST state this same rule (it currently names `diagnostics` as the
source; see §18).

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
   threads and receives the per-job thread allowance `w` in the request (§18).
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
   configured per host. Defaults: worker-1, m1-milan and m1-ivan (pre-live)
   `default`; worker-2 `utility`, so the Recorder V4 receive path keeps
   priority. Whether utility QoS on worker-2 actually protects recorder receive
   latency MUST be measured with the recorder's own lag metrics under load.
3. The pool is work-stealing, so heterogeneous core speeds never create
   stragglers at job granularity (16 §10.1).
4. The right `C` per host MUST be measured, not assumed: run a fixed 200-market
   set at `C ∈ {P, P + E/2, P + E}` and each QoS value of 16 §10.3, record
   market-candidates per hour, and set `C` at the knee. Results are reported
   per host in the M6 benchmark and written to the inventory.

### 7.4 Memory budget

All fleet Macs except m5-milan have 16 GB and also run Redis, MySQL, GR
sessions or the recorder. Each host has `native_memory_mb` (default 3072)
covering all its executors (16 §6.2). The shim passes each executor a share as
`--max-rss-mb` (the binary then emits `busy` and stops accepting jobs, 20 §6.2)
and also samples executor RSS every second and reads `rssBytes` from `pong`.
Above 80 % of the host budget the shim stops dispatching to the largest
executor; above 100 % it kills that executor (§8.3, detail `oom_budget`).
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

The class vocabulary is the closed set of 20 §4. This table only maps each
class to a shim action. Conditions the shim detects itself are expressed as a
class plus a detail code; the reason stored in `backtest_run_failures.reason`
is `<class>: [<detail>:] <message>`; the class and detail go to
`failure_class` and `failure_detail` (42 §3.6).

| Class (20 §4) | Typical causes, incl. shim detail codes | Shim action | Ends as |
|---|---|---|---|
| — (`ok`) | — | stamp, store | market row(s) |
| `invalid_input` | bad job or params, `r2://` path, unsupported flag; shim: `target_mismatch`, `artifact_incompatible`, `engine_blocklisted` | `UnrecoverableError` | failure row (every candidate) |
| `data_missing` | a required local file is absent on this host (feed day file, input) | throw: retry ladder (3 attempts, any host) | failure row naming the fix command after 3 attempts |
| `data_defect` | integrity mismatch, unknown format version, Chainlink hole ≥ `maxGapMs`, pre-coverage market (14 §10) | `UnrecoverableError` (after the one re-download of §6.1.3 for a cached download) | failure row |
| `runtime` | transient I/O or resource error | throw: retry ladder | failure row after 3 attempts |
| `timeout` | cooperative deadline expired (20 §6.3 S4) | first time: set `native.timeouts = 1` with `job.updateData`, throw; the retry runs with 2× budget. Second time: `UnrecoverableError` | failure row |
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
2. The binary checks the budget cooperatively and returns `timeout` (20 §6.3
   S4). The shim's backstop follows S4 exactly: it pings every executor every
   5 s and kills the executor's process group when a job exceeds 2× its budget
   plus 30 s or when `pong` is missing for 30 s. The kill puts every in-flight
   job of that executor through §8.3.
3. Candidate-level timeouts in groups need the candidate index in `progress`
   or `pong.inflight`, which 20 §6.2 does not define yet (§18). Until it does, a
   stuck group job fails as a whole by the rules above.
4. The BullMQ lock keeps renewing while Node is alive (`queue.ts:116-120`), so
   the budget and the backstop, not the lock, free a token.

### 8.3 Crashes, memory, parent death, output bounds

1. Executors MUST be spawned in their own process group; the shim kills the
   group (`SIGKILL` to `-pgid`) so no orphan survives.
2. **Crash attribution (20 §6.3 S5).** When an executor dies unexpectedly
   (signal, non-zero exit, oversize line), every job in flight on it is marked
   suspect and re-run once in isolation within the same BullMQ attempt, with
   the same tokens: a `run` process per job, started sequentially per suspect
   job. A job whose isolated process is killed fails as `killed` (§8.1). A job
   whose isolated run succeeds completes normally. Bystanders of a poison job
   therefore never fail and never consume attempts.
3. An executor that exits 0 after its idle timeout while the shim has just
   written a job to it (idle-exit race) is not a crash: the shim re-dispatches
   that job to a new executor with no isolation step.
4. Crash-loop guard: more than 3 crashes of one sha within 60 s → the shim stops
   dispatching that sha for 10 min (jobs are delayed, not failed) and reports
   it in the heartbeat.
5. Panics in strategy code never abort the executor (D18, 20 G7, 12). The pool
   thread stack size is set only by 16 EX-6; a stack overflow aborts the
   process and is handled by item 2.
6. Parent death and stdin follow 20 G8: stdin EOF without a prior `drain` means
   "parent gone" and the executor exits within 1 s without finishing in-flight
   work. The shim therefore closes stdin only when it wants that effect (it is
   itself exiting without a drain). Orderly shutdown always uses `drain` (§8.4).
7. Framing follows 20 §6.2 and G9: NDJSON, one message per line, at most 64 MiB
   per line. An oversize or malformed line → kill the executor, item 2 applies,
   and a job that reproduces it in isolation fails `invalid_output`
   (`line_too_large`). stderr (NDJSON logs, 20 G1) is kept in a bounded ring
   (64 KiB per job), keyed by `jobId`.
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
4. Workers MUST refuse any artifact whose `describe` reports a variant other
   than `standard` (31 §5.5).
5. `fleet:status` shows cache size, executor count and verified shas per host.

## 10. Fair scheduling

1. Native jobs MUST carry `native.priorityClass`: `calibration` (highest),
   `user` (CLI runs), `agent` (GR / protocol runs: `--protocol` or
   `BACKTEST_PROTOCOL` set). Within a class the priority value SHOULD grow with
   group weight so a 100-candidate sweep does not block single runs of the same
   class.
2. BullMQ OSS has no fair share across submissions. Queue wait time per class
   MUST be measured and reported; a fair-share scheduler is a later change only if
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
host:

1. A committed fixture set (≥ 50 BTC 5m/15m markets, both profiles, one candidate
   group) is run locally on each host by an ansible playbook (`fleet:native:canary`)
   in process-per-job and `serve` modes at one token and at all tokens.
2. Each host prints the `resultDigest` of each job; the playbook diffs them
   across hosts. Any difference blocks enabling and is a Rust bug until
   classified (10-domain-model.md determinism rules).

## 13. Branch policy and rollout (D03, D12)

| Phase | Where native jobs run | Rules |
|---|---|---|
| A. Before gate 2 | m1-ivan only | On the engine branch only (D01, D03). Main untouched. No fleet branch switch. Native runs use `--sequential` (local executor, no queue) or a **separate local Redis** (e.g. port 6380), never the shared fleet Redis: worker-1 consumes `backtest-aggregate` and would defer the branch's aggregate job, request self-update, fail to reach the commit and exit 1 (`run-worker.sh:97-107`), taking the fleet aggregator down. Results go to a **separate MySQL schema** (42 §2), never the shared production schema. Parity uses 8 local threads / 8 local TS workers. |
| B. Gate 2 merge | nowhere yet | One merge to main (D03): shim, native queue, token pool (inactive until a host opts in), migrations, dashboard changes. Kill switch absent (= off). Hosts get the shim via normal `fleet:git:pull`. |
| C. Fleet canary | all native hosts | Provisioning (§17), cross-machine proof (§12), then a 1,000-market TS vs Rust benchmark run (M6, 16-performance.md). |
| D. Enabled | hosts with `,native` in `--queues` | Kill switch `1`. Small PRs from here (D03). |

Runbooks (the operator docs under `docs/backtest/fleet/` are written with the
merge):

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

During the live calibration (51-calibration-plan.md) native work on m1-ivan
and worker-2 MUST be stopped or capped as that document specifies (16 §10.3:
`utility` or `background` QoS while paper or live runs).

## 14. Measurement (speed is the top priority)

The shim and the benchmark MUST report, per host and fleet-wide, with no pass
threshold (D07):

| Metric | Source |
|---|---|
| market-candidates per hour, same 1,000 markets, TS vs Rust | M6 benchmark (16-performance.md, 60-verification.md) |
| `overheadFraction` (§7.5) | shim |
| executor busy ms, CPU ms, peak RSS per job | `diagnostics` and `pong` → per-host Redis hash `backtest:worker:<machineId>#native` (`src/backtest/workerIdentity.ts:16-18` key grammar, extended with `'native'`) |
| token utilization: held by TS, held by native, idle, grant overshoots | supervisor |
| throughput with the token pool vs the static split, mixed TS and native load | M6 benchmark (§7.2.6) |
| Node event-loop utilization (`performance.eventLoopUtilization()`) and shim CPU ms per job | shim |
| verification index hit rate, bytes hashed per job | shim |
| isolated re-runs, idle-exit races, crash-loop pauses | shim |
| `serve` vs process-per-job throughput; throughput vs `C` and QoS per host (§7.3) | benchmark |
| queue wait per priority class | shim |
| Redis memory peak during a large group | benchmark (41 §6) |

Rule E1: if event-loop utilization exceeds 50 % on a saturated host, the shim
MUST move its remaining CPU work (JSON, schema validation, any hashing) to a
`worker_threads` pool or split the native consumer into its own child process
with its own event loop, and the M6 report MUST show the before and after.

The heartbeat hash MUST also carry `nativeShimVersion`, `target`, `cpuTokens`,
`qos`, `sandbox`, `executors`, `cacheBytes`, so `fleet:status` and the dashboard
Workers panel can show them. Per-market CPU and RSS are not persisted in MySQL in
v1 (table growth, 42 §8).

## 15. Dashboard and ops changes owned here

1. Dashboard queue helpers (`dashboard/src/lib/queue.ts`, `queries/batches.ts:65`,
   `queries/queues.ts`, `queries/health.ts`) MUST count active children across
   `backtest-markets` and the native queue.
2. Bull Board MUST list the native queue.
3. `fleet:status` MUST show the native heartbeat fields (§14), cache size (§9),
   provisioning state (§17) and rules-capture coverage (§16).
4. `worker-control.sh` strays (§8.4).

## 16. Pre-start rules snapshot capture

11 §13.2 needs pre-start Gamma and CLOB snapshots of every upcoming BTC 5m/15m
market. Pre-start CLOB fields (`mts`, `mos`, `itode`, `oas`) cannot be
backfilled later (11 TT1, RS2), and V4 bootstrap captures only Gamma.

1. **Command.** `npm run rules:capture-prestart -- --market btc:5m,btc:15m --watch [--sink db|jsonl]`.
   It reads only public endpoints and holds no trading credentials.
2. **Host.** worker-1, under launchd with `KeepAlive`, in the style of the
   Recorder V4 catalog service. worker-1 is an always-on Mac mini that already
   holds the aggregator's DB credentials and hosts MySQL; the producer laptop
   is not used because it sleeps and travels.
3. **Schedule.** A 60 s tick. For each market whose start lies in
   `(now + 15 s, now + 10 min]` (slugs from the 5m/15m epoch grid), fetch Gamma
   `/markets/slug/{slug}` and, once the condition id is known, CLOB
   `/clob-markets/{condition_id}`. Each source is fetched on every tick until
   one response succeeds, plus one final fetch in `(start − 90 s, start − 15 s]`.
   Per request: 5 s timeout, up to 3 retries with jitter inside the window,
   back-off on HTTP 429 and 5xx. One market's failure never blocks another.
4. **Writes.** Through `src/db/exchangeRules.ts` only (42 §3.3, §3.4): one row per
   fetch, `phase` derived from `fetched_at_ms < market_start_ms`, deduplicated
   by the table's unique key.
5. **Monitoring.** Redis hash `rules:capture:heartbeat` with `lastOkMs`,
   24 h coverage per source (markets started in the last 24 h that have at least
   one `pre_start` row from that source), and miss counts. `fleet:status` shows
   it and warns when coverage drops below 99 % or `lastOkMs` is older than
   10 min.
6. **Before gate 2.** The table lands only in M3 (01). If the user approves
   (Open question 5), the agent runs the same command on m1-ivan from the
   branch with `--sink jsonl`: one line per fetch (`source`, `slug`,
   `conditionId`, `marketStartMs`, `fetchedAtMs`, `rawSha256`, verbatim body)
   appended to `data/exchange-rules/prestart/<yyyy-mm-dd>.jsonl`. M3 imports
   these files with `rules:import-jsonl`, idempotent through the unique key.
   Gaps while the laptop sleeps are recorded by the coverage metric.

## 17. Build-host provisioning

31 §3.4 relies on provisioned build hosts, and 31 §7.6 makes the M6 proof
build the same source on every fleet Mac.

1. `npm run fleet:native:provision` runs an idempotent ansible playbook
   (`ops/ansible/native-provision.yml`) on every native host. It installs
   rustup when absent and the toolchain pinned in `native/rust-toolchain.toml`
   with `rustfmt` and `clippy`; checks the Xcode Command Line Tools version
   (`pkgutil --pkg-info=com.apple.pkg.CLTools_Executables`) against the version
   pinned by the answer to 31 Open question 1, and only records it until then;
   and runs `cargo fetch --locked` for `native/Cargo.lock` into a shared
   per-host `CARGO_HOME` (e.g. `~/.cargo-pmb`), so later builds run
   `--offline` (31 §3.2).
2. It prints one verification line per host (rustc version, CLT version,
   registry ready, free disk) and stores it for `fleet:status`. It never
   restarts workers. Expected disk use is about 2 GB per host.
3. The shim never builds anything; executors run downloaded, verified binaries.

## 18. Dependencies on other documents

These rules are owned here and require the named owner to match:

| Owner | Required change |
|---|---|
| 21 §4 | List `native.protocolVersion`, `native.minShimVersion`, `native.priorityClass` (§4.1). |
| 21 §5 | A non-semantic `budget.threads` field carrying the per-job thread allowance `w` (§7.2.3, 16 §9.3). |
| 21 §12 | Stamping per §7.1: shim clock at dispatch and receipt, `workerChildId = 100 + slot`, the weighted group duration; `diagnostics` stay metrics only. |
| 20 §6.2 | Optional `candidateIndex` in `progress` and `pong.inflight` for candidate-level timeouts (§8.2.3). |
| 22 §4.1 | Ledger transport per 42 §7.5 (inline in the result, uploaded by the aggregate host); siblings hold read-only R2 keys. |
| 30 §12 | Class name `strategy_fault` (20 §4) instead of `strategy_panic`. |

## Open questions

1. Phase A storage: is a separate MySQL schema for branch-phase runs acceptable
   (branch runs are then invisible in the production dashboard unless it is
   pointed at that schema), or does the user prefer applying the additive
   migrations to production early, accepting the migration-ordering rule of
   42-persistence-and-stats.md §2?
2. How many CPU tokens may worker-2 offer in normal operation, given that the
   Recorder V4 pinned service runs there and its receive timestamps are
   calibration ground truth? (Today it runs 3 TS slots; machines.json says 8.)
3. Should m1-ivan consume native fleet jobs after gate 2 at all, given that it is
   the live-trading host and will run the Rust live runtime after gate 4?
4. Must user-launched runs always preempt agent runs in the native queue (§10),
   or should agents and the user share one class?
5. Pre-start exchange-rule snapshots (tick size, minimum size, taker-delay flag)
   can only be captured before each market starts and cannot be recovered
   later. May the agent start the capture job of §16 now, before gate 2, on
   m1-ivan from the branch, reading only public Polymarket endpoints and
   writing only local files? Alternatively, may the capture script alone be
   merged to main early so it runs on worker-1 (an exception to "main untouched
   until gate 2")? Without either, every market until M3 has no pre-start CLOB
   snapshot and realistic runs over that period use `partial` or `fallback`
   rules.
