# 01 — Scope and milestones

This document replaces `native/GOAL.md`. It states what the native engine goal
delivers and in which order: the objective and the speed mandate, the ownership
boundary between Rust and TypeScript for backtest and live, the v1 market
universe and the native strategies, what is out of scope, the milestones with
their proof commands, the four user gates, the branch, merge and oracle
policy, how progress is recorded in `native/STATUS.md` so any new session can
resume, and the follow-up goals. It references the other spec documents
instead of restating them (index: [00-README.md](00-README.md)). Milestone
numbers are owned here; other documents use them.

## 1. Objective (project direction, decided with the user)

1. Build a **new trading engine in idiomatic Rust**, designed from Polymarket's
   current rules (CLOB V2, per-market `feeSchedule`, FAK, taker delay, GTD
   rules, tick and min size, user WS statuses incl. FAILED, heartbeat), not
   from the TS code.
2. **One engine core for backtest and live**: same code, deterministic, same
   decisions for the same inputs. Backtest and live differ only in the
   execution adapter and the input source.
3. The rest of the application stays TypeScript and receives exactly what it
   receives today: `MarketJobData` in, `RunSingleMarketOutput`/`MarketStats`
   out (21-job-and-output-contract.md).
4. Correctness is proven in two independent ways:
   - **ts-compat**: reproduce the TS engine's order/fill/cancel sequence on
     200+ real markets (R5, R6). This gate proves the port; mismatches are
     fixed or classified, never a reason to stop.
   - **realistic**: follows the current Polymarket rules and is validated
     against live trading through a ~$100 calibration (D34, D35, 51).
5. **The goal is live/backtest agreement.** Every design choice is judged by
   whether a backtest of a market predicts what the live bot does and earns on
   that market.
6. **Speed is the top design priority** (§2).
7. Order of work: engine and backtest → fleet → live (Rust live runtime and
   CLOB V2 adapter are in scope) → calibration. Moving the AI protocols to Rust
   strategies is a follow-up goal (§10); the build/publish step is designed so
   it fits later (31-artifacts-build-publish.md).
8. No wall-clock limit and no stop criteria (D02, D07). Progress is bounded by
   milestone proofs and four user gates (§7). Speed is measured and reported;
   there is no minimum speedup threshold.

### 1.1 Done means

The goal is done when every milestone M0–M9 (including M3a–M3c and M5a–M5b)
passes its proof on the final revision, M10 has been run by the user and
analyzed, gate 3 has been decided, all work is merged to main through PRs with
CI green, `PARITY.md` has no unclassified entry, and the benchmark and
calibration reports exist. If the user has not yet run the calibration, the
goal is paused at gate 4, not failed.

**What the speedup covers.** Rust speeds up only strategies compiled into a
native artifact. In this goal those are the strategies of §4 (the lagsnipe
port and the test strategies). About 80% of today's fleet markets come from
Global Runtime protocol runs of TS strategies (16 §9.1, requirements-sweep
`fair-scheduling-heavy-jobs`). Their throughput is unchanged until protocols
author Rust strategies (follow-up F1, D16). Fleet throughput numbers in this
goal (M5a, M5b, M6) are therefore measured on native artifacts and MUST be
reported as such, never as a fleet-wide speedup (Open question 6).

## 2. Speed mandate

The user moved the engine to Rust for speed: maximum backtest throughput on the
fleet and minimum decision latency live. TS implementation choices are not
constraints; some were made only because Node is single-threaded.

| # | Requirement |
|---|---|
| S1 | Design for throughput and latency from M1. Architecture that is hard to retrofit (columnar decode, immutable shared market data, allocation-free hot loop, `Send` engine state, executor-friendly library entry point) MUST be in place in M1, not deferred to M5a (16-performance-and-parallelism.md §14). |
| S2 | **Do not copy the TS process model.** TS runs one Node child per core because Node is single-threaded (src/cli/backtestWorker.ts:136-160, scripts/run-worker.sh:29-47), and the WIP native path spawns one process per market and re-verifies hashes per process (src/strategy/artifacts/native.ts:88-121, src/backtest/marketProcessor.ts:49-63). The Rust design MUST evaluate and use: one long-lived executor per machine and artifact (`serve`, 20 §6), a work-stealing thread pool across markets and candidates, shared immutable per-day feed caches (Binance aggTrades, Chainlink rounds) across markets, columnar Parquet decode (row reconstruction was ~50% of the prototype's profile, research/early-audits.md:53), I/O prefetch overlapped with compute, dispatch in `market_start_ms` order so consecutive jobs share feed days (16 §6.1), and candidate groups (M4). No per-market process spawn on the fleet path. |
| S3 | **Heterogeneous cores.** Fleet Macs differ: M4 Mac mini 4P+6E, M1 Pro 8P+2E (dashboard/src/data/machines.json). Thread counts and QoS are measured per machine type, not assumed; work stealing absorbs speed differences between core types (16 §10). |
| S4 | **Live latency.** The live decision path (frame receipt → book update → strategy → intent → signed request on the wire) is minimized and measured (p50/p99). The deterministic decision loop runs on its own thread; network I/O, signing preparation and journaling do not block it (50 §4.2, §18; 16 §12). |
| S5 | **Measured, not assumed.** A benchmark harness exists from M1. Each milestone records its numbers on a fixed benchmark set in STATUS.md. Each optimization is A/B measured. A regression above 10% against the previous milestone MUST be explained in STATUS.md (this is reporting, not a stop criterion). |
| S6 | **Speed never changes results** (R7, R8). Parallelism is across independent units only; one market-candidate is always a serial deterministic loop. Output is byte-identical across thread counts, machines and group membership; the parity suite is the regression guard for every optimization. |
| S7 | **Speed work is not queued behind realism.** The executor, caches, decode path, book layout and build profile do not depend on the realistic profile, so they are a separate milestone (M5a) that depends only on M2. Only the cost of realistic and group scaling wait for M3b and M4 (M5b). |

Baselines to beat (evidence, not targets): TS averages 1.2–2.6 s per market
per process (research/requirements-sweep.json, `cpu-slots-and-job-granularity`);
the Codex prototype ran 1,000 BTC 15m markets with lagsnipe.v15 in 99.6 s vs
TS 617 s (6.19×) with one Rust process per market, and shared candidate replay
reached ~4× at 100 candidates (research/early-audits.md:51-52).

## 3. Ownership boundary

### 3.1 Backtest

| Concern | Owner |
|---|---|
| CLI and producer: argument parsing, market selection (Telonex eligibility only through `src/db/telonexMarkets.ts`), feed preflights, `ModelConfig` resolution, rules snapshot lookup, candidate expansion, `describe` capability checks, enqueue | TS |
| Input fetching: R2 → verified local file (Parquet, aggTrades, crypto_prices, V4 packages); artifact download and sha verification once per machine | TS |
| `EngineJob` construction from `MarketJobData`, `EngineResult` validation and mapping to `RunSingleMarketOutput`: one TS module `src/native/` shared by the parity harness, `--sequential` and the worker shim (M1 step 6) | TS |
| BullMQ consumption, retries, job leasing, worker heartbeats, execution metadata stamping (machineId, slot, timing, worker sha, `recorderV4Capture`) | TS (worker shim, 40) |
| CPU scheduling inside a machine: executor process, thread pool, shared caches, market and candidate parallelism, memory budget | Rust (16, 40) |
| Decode, order books, feed visibility, synthetic ticks, plugins, strategy, order validation, order state machine, capital, portfolio, simulator, per-market stats (`RunSingleMarketOutput`) | Rust |
| Parity trace, fill ledger, simulator trace (written by Rust; uploaded by TS) | Rust writes, TS stores |
| Aggregation: batch stats, segments, wall clock, failure rows, extend merge, all MySQL writes | TS (42) |
| Dashboard, Market Simulator, research tools, protocol tooling, recorder | TS |

### 3.2 Live

| Concern | Owner |
|---|---|
| Market discovery and rotation, market WS, user WS, feeds (Binance, PolyBolt Chainlink, PTB), rules fetch, the serial event loop, strategy, validation, order state machine, session guards and kill switch, paper execution, CLOB V2 signing/REST/heartbeat, reconciliation, journal, per-market result | Rust (50) |
| Split/merge on-chain transactions (relayer SDK is TS-only), modeled in Rust as async operations (D25) | TS sidecar |
| Redeem watcher, approvals, pUSD wrapping, balance display, WebUI server (consumes the Rust state stream), persistence of live/paper results as `backtest_runs` rows (D11) | TS |
| Service supervision (launchd), secrets handoff (never env for behavior; secrets channel per 20 §7) | Ops/TS per 50 |

The seam in both modes is the job and output contract (21). There are no
per-tick TS↔Rust calls.

## 4. v1 universe and supported surface

| Item | v1 |
|---|---|
| Markets | **BTC 5m and BTC 15m only** (D06, user). The producer MUST refuse other symbols and timeframes for native artifacts, using `describe` capabilities (20 §3). |
| Target | `aarch64-apple-darwin` only for shipped binaries (D12); Linux is used for CI checks only. |
| Input modes | `telonex-delta` with `--read-from local\|r2\|local-or-download-from-r2-to-local` (M1), `recorder-v4` (M7), live journal replay (M8). Rejected for native: legacy `recorded`, `telonex-paired`, `--time-driven`/`--realtime`, `--order exchange_time`. |
| Profiles | `ts-compat` (default until gate 3) and `realistic` (opt-in until gate 3). |
| Order types | GTC, GTD, FOK, FAK; post-only on GTC/GTD. |
| Intents | `place_limit`, `place_batch` (≤15), `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all`, `split_positions`, `merge_positions`. |
| Market events | `book`, `price_change`, `last_trade_price`, `tick_size_change` (kept even when a strategy ignores them). |
| Feeds | Binance aggTrades, Chainlink (two-clock), price-to-beat, synthetic feed ticks (14). |
| Plugins | ExternalFeeds plus all four of the project direction: TimeWindowVolatility, TechnicalIndicators (candles from local aggTrades, no network, D19), DwellGate, TimeWindowGate (14 §12). The direction (level 1, 00 §3.1) overrides D19's deferral of TechnicalIndicators and TimeWindowVolatility; D19 keeps its offline-candle rule and is amended at G1. |

### 4.1 Native strategies in this goal

Every native strategy lives in the `native/strategies/` package (31 §2.3) and
is built only by the canonical builder (31 §4). TS twins live in
`src/strategies/testing/` (60 OR-4).

| Strategy (id) | Kind | Milestone | Spec |
|---|---|---|---|
| `engine-exerciser.rs` + TS twin `engine-exerciser` (WIP, upgraded to schedule v2) | parity test, every intent and order type | M1 step 5 (Rust), M1 step 6 / M2 (schedule v2) | 60 §5.1–§5.7, 30 §18 |
| Feed exerciser, Rust and TS twins | parity test for feeds, plugins and synthetic ticks | M1 step 5 / 6 (`trade: false`), M2 (`trade: true`, TA) | 60 §5.8, 14 V-3 |
| `overnight-opus55-lagsnipe.v15.rs` | port (D20) of TS artifact sha `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8` (strategy_artifacts, read 2026-10-08; BTC 15m telonex-delta only, 264 runs), ported from the bundle `data/strategy-artifacts/304eceb3….mjs` (13,663 bytes, complete: Zod schema, normCdf/normInv, both callbacks; 60 §6.1–§6.2) | M2 | 60 §6, 30 §18 |
| `engine-exerciser-realistic.rs` | Rust only, realistic features without a TS oracle | M3b | 60 §5.9 |
| `panic-probe.rs` | test only, fault injection in groups | M4 | 60 CG-4 |
| `calibration-probe.v1` | calibration probe, normal SDK | prepared and paper-rehearsed before G4 (M9) | 51 §3 P6, §6 |

No other TS strategy is ported in this goal.

## 5. Out of scope

- Deleting or rewriting the TS engine; porting any TS strategy not in §4.1.
- Legacy `recorded` and `telonex-paired` input modes, PMXT inputs.
- Deribit volatility index and the live-only RTDS Binance sub-feed.
- Symbols other than BTC; timeframes other than 5m and 15m (follow-up F5).
- Market Simulator features beyond replaying native runs through the existing
  dashboard contract (M3c, D10).
- Maker rebates and taker rebate tiers as PnL components (fees are modeled;
  rebates are not).
- AI protocol sessions authoring Rust strategies (follow-up F1).
- Telonex trades-channel ingestion and the queue model on Telonex data
  (follow-up F2).
- Retention and cleanup of old runs, traces, ledgers and binaries (follow-up
  F3, D15).
- Real-money activation by the agent, ever (R10). The user launches
  calibration.

## 6. Milestones

The "Depends on" column is binding: it bounds how far work may be pulled
forward. The **default order** is the table order; a session changes it only
after a user answer (Open question 6). While waiting at a gate, a session MAY
start work that does not depend on the gate outcome, on the branch, without
merging. Each milestone starts with a step plan written into STATUS.md and
ends with its proof, a green commit, and a STATUS.md entry.

Subcommand and flag names are owned by 20-binary-protocol.md (binary), 31
(build and publish), 60 (parity tooling) and 41 (group CLI); where a command
below differs from its owner, the owner wins and this document is corrected.
**Parity and benchmark evidence is valid only for the recorded oracle pin
(§8) and the recorded binary sha256** produced by the canonical builder
(31 §4); a binary built any other way (for example `cargo build --release`)
MUST NOT be used for parity, benchmark or gate evidence.

| # | Milestone | Depends on | Proof (summary) | Gate after |
|---|---|---|---|---|
| M0 | Spec freeze | — | Consistent, committed spec; link check; user approval | **G1** |
| M1 | Engine core (backtest) | M0 | Tests, goldens, invariants, deterministic single-market run of the canonical binary, T15 tick-stream cells, bench baseline | — |
| M2 | ts-compat parity | M1 | Every cell of 60 §4.1 for M2 passes 60 §4.4 | **G2**, then merge to main |
| M3a | Native backtest path and persistence | M2, G2 | `backtest --strategy-artifact <sha> --sequential` writes identifiable rows equal to the harness; refusals | — |
| M5a | Executor and hot path | M2 (lands after G2) | `serve` benchmark rows vs TS; determinism across thread counts; parity unchanged | — |
| M3b | Realistic profile | M3a | A/B report per fix; ts-compat parity unchanged | — |
| M3c | Market Simulator for native runs (D10) | M3b | saved-vs-replay within 0.00005 in both profiles | — |
| M4 | Candidate groups | M3a | Group rows == standalone rows; extend equivalence | — |
| M5b | Performance of realistic and groups; final benchmark | M3b, M4, M5a | Full matrix of 16 §13.3 | — |
| M6 | Fleet integration | M3a, M5a (realistic rows after M3b) | 4-Mac run, cross-machine byte identity, fleet throughput on native artifacts | — |
| M7 | Recorder V4 input | M3b | V4 parity vs TS, realistic on V4 tape | — |
| M8 | Live paper mode | M7 | Journal replay gives identical decisions; latency report | — |
| M9 | CLOB V2 adapter | M8 | Fixture/mock tests, shadow mode, safety checklist, calibration preparation | **G4** |
| M10 | Calibration | M9, G4 | Calibration report against D35 thresholds | **G3** |

Gate 4 (first real order) precedes gate 3 (realistic as default) in time; the
numbering follows 02-decisions.md D02. References to "M3" without a suffix in
other documents mean M3b for realistic topics and M3a for persistence and
rules-snapshot topics; "M5" without a suffix means M5a and M5b.

### M0 — Spec freeze

- Deliverables: all documents listed in 00-README.md §1 exist, cross-reference
  each other by exact file name, cite evidence, and end with genuine open
  questions. The gate-1 question list (Open questions below and in the
  owning documents) is answered or explicitly deferred by the user.
- Consistency items found in review, fixed by the owning documents before
  the gate-1 report (each owner edits only its own document):

| Item | Fix | Owner |
|---|---|---|
| Links to the short name `16-performance` (no such file) | point to `16-performance-and-parallelism.md` | every document the link check (proof 1) still reports |
| "M7 identity proof" / "M7 determinism proof" for journal replay | M8 | 22 §1, §6.1; D26 (and any other document still using it) |
| T15 cells marked "M1 step 2 checkpoint" | "M1 step 6 checkpoint" (needs the binary, SDK, both feed exercisers and trace v2) | 60 §4.1 |
| DET-1 "identical stdout and trace" | "identical deterministic section (`resultDigest`, 21 §10) and decompressed trace bytes"; `diagnostics` differs between runs by design | 60 §9 |
| Producer enqueue in `market_start_ms` order "40 owns" | add to 40 §3 (native queue) and to the `--sequential` executor; scheduled in M5a (§6) | 40, 16 §6.1 |
| Native persistence before G2 (dev schema, migrations in the G2 merge) | native runs persist only from M3a, after G2; migrations land as M3a PRs on main; no branch dev schema is needed (40 Open question 1 becomes moot) | 40 §13 phases A–B, 42 §2.4–§2.5, 31 §7.5 second bullet |
| `--sequential` groups "before gate 2" | "before M6" (groups are M4, after G2) | 41 §4.9 |
| HR-2 builder | the `EngineJob` comes from `src/native/buildEngineJob` (M1 step 6), shared later by `--sequential` and the shim | 60 §4.3 |
| Fixture jobs with absolute paths | committed fixture `job.json` uses fixture-relative paths; `npm run native:fixture-job -- <slug>` renders the absolute-path `EngineJob` 21 §5.1 requires | 60 §12 |
| `run --sim-trace <dir>` | added to 20 §5.4 in M3c | 20, 22 §5 |
| Feed exerciser without Chainlink for agent-run paper sessions | add a `chainlink: bool` param (default true) | 60 §5.8 (if Open question 10 picks option a) |
| D19 plugin scope | amended to "all four plugins in v1; TA candles from local aggTrades" | 02 |

- Proof:
  1. Link check (every `NN-*.md` reference resolves):
     ```bash
     cd native/spec && grep -oh '\b[0-9][0-9]-[A-Za-z0-9-]*\.md' *.md | sort -u \
       | while read -r f; do [ -f "$f" ] || echo "dead link: $f"; done   # prints nothing
     ```
  2. A consistency review (no topic owned by two documents, no
     contradiction with 02-decisions.md, every milestone proof references
     existing documents, every item of the table above fixed).
  3. **Commit:** `native/spec/` is committed on `rust-engine` (spec files
     only, English, no code) before the gate-1 report; the report under
     `native/reports/` (copied to the implementation branch in M1 step 1)
     names that commit sha as the reviewed revision.
- Gate 1: the user approves the spec and confirms or changes the lead
  decisions in 02-decisions.md. Requested changes are committed on top. The
  approved commit is tagged `native-spec-g1` (a local tag; the worktrees share
  the repository). From then on the spec changes only per 00 §3.2.

### M1 — Engine core (backtest)

Steps (each ends green per R12; a step MAY take several green commits):

1. **Bootstrap.**
   - Branch and worktree: `git worktree add -b native-engine
     .claude/worktrees/native-engine origin/main` (D01; main has no `native/`
     directory), then `git checkout native-spec-g1 -- native/spec
     'native/reports/gate-1-*.md'` (quoted: git expands the pathspec). Record the branch, the tag and its sha in
     STATUS.md (and later in the PARITY.md header).
   - Workspace skeleton from `5446ec4a` (`native/Cargo.toml`,
     `rust-toolchain.toml`, `.gitignore`, `Cargo.lock`), with
     `[profile.release] lto = "thin", codegen-units = 1` **removed**: it
     contradicts D18, and the shipped profile is `artifact`, defined only in
     `native/build/artifact-build.toml` (31 §4.2, added in step 5). The
     engine workspace keeps Cargo's default `release`/`bench` profiles, used
     only for `cargo test` and L0 micro benchmarks.
   - New `native/STATUS.md` in the §9.1 format. Do not carry the superseded
     files (00 §1) or the old STATUS.md.
   - **Data access** (the worktree has no datasets; Telonex `local_path` is
     relative to the repository root, `src/backtest/runSingleMarket.ts:380-390`):
     create gitignored symlinks into the main checkout, so TS oracle children
     resolve paths exactly as on a worker and harness `MarketJobData` keeps
     production-identical relative paths (60 H-1):
     ```bash
     MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
     mkdir -p data && for d in events binance telonex; do
       [ -e "data/$d" ] || ln -s "$MAIN/data/$d" "data/$d"; done
     ```
     `data/strategy-artifacts/` stays a real directory of the worktree (the
     artifact loader requires the cache under the repository root so `#pmb/*`
     resolves to this checkout's engine, WIP `marketJob.ts:43-63`). Downloads
     run from the worktree land in the main checkout's `data/`, the canonical
     location. The harness, the bench driver and the golden/fixture
     generators accept `--data-root`, default `<repository root>/data`; the
     WIP hardcoded default `/Users/mijat/Sites/polymarket-bot/data`
     (`src/backtest/parity/marketJob.ts:34`) is removed. Record the choice in
     STATUS.md.
   - Salvage from WIP commit `fef5f199` (read with `git show fef5f199:<path>`)
     per this table, and add the native CI job:

| WIP item | Verdict |
|---|---|
| Rust leaves `fixed.rs`, `market.rs` book semantics and tests, `rules.rs` fee math (taker delay table fixed per 11 §6), plugin math with goldens, `pq.rs`, `telonex.rs`, `slug.rs`, `feeds/binance.rs`, the `Execution`/`TraceSink` seam | Carry after review (10 §13, 11 §16, 14 §15) |
| `order_manager.rs`, the `portfolio.rs` ledgers, the `stats.rs` PnL formula | Drop (research/early-audits.md:57-61); keep their test vectors as fixtures (60 §16) |
| `src/backtest/parity/*`, `src/cli/parity/*`, `scripts/parity/*` | Carry; apply HR-1…HR-9, trace v2, diff v2, coverage v2 in step 6 (60 §4.3, §16) |
| `src/strategies/testing/engine-exerciser.ts` | Carry; schedule v2 in step 6 / M2 (60 §5.3) |
| `native/crates/pmb-core/tests/fixtures/{stats_gen,plugins_gen}.ts` and goldens | Carry; move to `native/fixtures/` (60 §16) |
| `src/strategy/artifacts/native.ts` (protocol v1, `<bin> --job`) | Rewrite in step 6 as the protocol-v2 runner inside `src/native/` (`describe`, `run`; 20); keep its download, sha-verify and per-process memoize logic (`native.ts:46-84`) |
| `src/strategy/artifacts/types.ts` (`kind?: 'native'`) | Carry (31 §8 reads `kind`) |
| `src/backtest/jobTypes.ts` (`nativeProfile`) | Drop; replaced by `modelConfig` (21 §4, §6) |
| `src/backtest/marketProcessor.ts` native branch | Drop; the worker path is rebuilt in M6 (shim, 40 §5) |
| `src/cli/backtest.ts` native branch (+40 lines, passes `MarketJobData` straight to the binary) | Drop; rebuilt in M3a on `src/native/` |
| `src/cli/helpers/backtestArgs.ts` `--native-profile` | Flag name kept (41 §3.1); rebuilt in M3a as an input of `resolveModelConfig`, not a `MarketJobData` field |
| `src/cli/helpers/strategyArgs.ts` inert placeholder TS strategy for native | Drop (31 §8 forbids it) |
| `.github/workflows/quality.yml` `native-quality` job | Carry; extend to CI-1 (60 §14), including the separate `native/strategies/` package (31 §7.6) |

2. **Contract, inputs, books, feeds.** `pmb-contract` types, schema export
   and generated TS types (21 §3); telonex-delta reader with format-version
   check (15 §4); books (15 §2.1); Binance, Chainlink and PTB visibility and
   the synthetic tick schedule (14 §3–§6, §8). Checkpoint: the TS-generated
   goldens for decode, book, feed visibility and synthetic schedule pass on
   the fixture markets (60 §7.2, 14 V-1/V-2). The full tick-stream cells
   need the binary and the TS tooling and run at the end of step 6.
3. **Core.** Serial event loop, all intents, validation through
   `ExchangeRules`, order state machine, capital reservation, cash-based PnL
   with the cost-basis identity asserted, cascades, window gate, fault
   semantics (10, 12); plugins (14 §12); per-market stats and skip taxonomy
   (21 §11, §13).
4. **Execution.** Simulator, discrete-event scheduler, ts-compat Fill/Latency/
   Fee/Report models (13 §2–§5).
5. **Binary, SDK, canonical builder, Rust test strategies.** `describe`,
   `schema`, `selftest` and `run` (20 §5.1–§5.4); `pmb-sdk` surface and params
   derive (30); the `native/strategies/` package with `engine-exerciser.rs`
   and the Rust feed exerciser (§4.1); the parity trace sink v2 (22 §3);
   `native/build/artifact-build.toml` and the canonical builder in
   local-only mode, `strategy:publish -- --local-only` (31 §4, §7.1–§7.2,
   §7.5), which writes `data/strategy-artifacts/native/<sha>` plus its build
   manifest and prints the path and sha256; committed fixture markets so CI
   runs complete jobs without R2, MySQL or Redis (60 §12).
6. **TS side and tick-stream checkpoint.**
   - `src/native/` (one module, later shared by the harness, `--sequential`
     and the worker shim): `buildEngineJob(MarketJobData, dataRoots)` (21 §5,
     §9), `resolveModelConfig(cliFlags)` with committed ts-compat defaults
     (21 §6; the values of the 60 OR-7 table), `validateEngineResult` (21
     §19), `toRunSingleMarketOutput` (21 §11), the generated contract types
     `src/native/contract/generated.ts` (21 §3) and the protocol-v2 runner.
   - TS feed-exerciser twin (60 §5.8); TS trace writer v2 with `feeds`
     records (22 §3.2); harness changes HR-1…HR-9 and the H-1 validation
     (60 §4.3); the committed set `native/parity/sets/S15-CL.txt` and cell
     files `T15-on.json`, `T15-off.json` (60 §4.1–§4.2).
   - Checkpoint: cells T15-on and T15-off pass 60 §4.4 (tick cause, exchange
     time and visible feed values per tick, with and without synthetic
     ticks).
7. **Benchmark baseline.** L0 (`cargo bench`) and L1 (driver over prebuilt
   `EngineJob` files) harness, bench sets `smoke-50` and `heavy-1` (16 §13.1,
   §14); first numbers in STATUS.md. L1 numbers use only canonical
   `artifact` binaries (the profile that ships); L0 uses the workspace
   `bench` profile and is read only as before/after A/B.

Tests: unit tests; golden fixtures generated by running real TS code (book,
decode, feed visibility, synthetic schedule, plugin math, stats); the TS suites
`capital.test.ts`, `cancellation.test.ts`, `Portfolio.test.ts`,
`restPollCapital.test.ts`, `runnerConfig.test.ts`,
`StrategyRunner.{serial,clock,syntheticTicks}.test.ts` (src/trading/) turned
into Rust fixture tests (60 §7.3); property tests (cash conservation,
reservations never negative and released on every terminal state, fills never
exceed order size, determinism) per 60 §8.

Proof (run from the implementation worktree root; `SCRATCH` is a directory outside the repository):

```bash
# engine workspace and strategy package gates (31 §2.1, §7.6)
(cd native && cargo fmt --all --check \
  && cargo clippy --workspace --all-targets --locked -- -D warnings \
  && cargo test --workspace --locked)
(cd native/strategies && cargo fmt --all --check \
  && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked)
npm run lint && npm run code:typecheck

# canonical local-only build (31 §4.1, §7.5); record the printed sha256 in STATUS.md
npm run strategy:publish -- --local-only --repo native/strategies --bin engine-exerciser
BIN=data/strategy-artifacts/native/<sha256 printed above>

# same job twice → identical deterministic section and identical trace bytes
# (the profile is job.run.modelConfig.profile = "ts-compat"; `run` has no --profile flag)
T=$(mktemp -d); J=$(npm run -s native:fixture-job -- <fixture slug>)
"$BIN" run --job "$J" --trace "$T/a.jsonl.gz" > "$T/a.json"
"$BIN" run --job "$J" --trace "$T/b.jsonl.gz" > "$T/b.json"
cmp <(jq -cS 'del(.diagnostics)' "$T/a.json") <(jq -cS 'del(.diagnostics)' "$T/b.json")
cmp <(gzip -dc "$T/a.jsonl.gz") <(gzip -dc "$T/b.jsonl.gz")

# tick-stream checkpoint (step 6)
for CELL in T15-on T15-off; do
  npx tsx scripts/parity/run-parity.ts --cell native/parity/cells/$CELL.json \
    --out-dir "$SCRATCH/parity/$CELL" --concurrency 8 \
    --rust-bin data/strategy-artifacts/native/<feed-exerciser sha256>
done
```

`diagnostics` (wall time, CPU, RSS, start time) differs between runs by
design (21 §10); everything else MUST be byte-identical.

### M2 — ts-compat parity

Steps:

1. **Data prerequisites.**
   - Commit the sets S15, SL and PS-50 (60 §4.2 MS-1…MS-5). Inputs MUST be
     local before a gating run; missing BTC 15m inputs are fetched with the
     read-from-R2 dataset commands, which write only under the local `data/`
     (`telonex:download-converted-r2-to-local`,
     `binance:download-aggtrades-r2-to-local`,
     `telonex:crypto-prices:download-r2-to-local`).
   - **BTC 5m.** Only 6 converted 5m files exist locally (all 2026-02-12),
     and the read-only preflight
     `npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 5m --dry-run`
     reported **0** R2-eligible 5m markets on 2026-10-09 (27,679 for 15m).
     Re-run the preflight at M2 start. If 5m conversions exist by then,
     download them and commit S5. If not, the 5m cells E5-0 and E5-D wait for
     the user's answer to Open question 5; producing them needs the
     production data pipeline, which writes to the shared database and R2,
     and the agent MUST NOT run it without that answer. All other M2 work
     continues.
2. **Strategies.** Engine exerciser schedule v2 in both twins (60 §5.3–§5.4);
   feed exerciser `trade: true` and TA (60 §5.8); the lagsnipe port from the
   bundle with the LS-1 strategy-math golden (60 §6).
3. **Matrix runs and classification.** Every M2 cell of 60 §4.1, PARITY.md
   classification (60 §3), oracle self-check (OR-9), TS self-parity (OR-17),
   harness validation (H-1), coverage (60 §5.6, LS-2), Rust-twice
   determinism (DET-1).
4. **Gate-2 report** (60 §15).

Deliverables also include the parity tooling tolerance updated to R5 (the
WIP default is 1e-6, `src/backtest/parity/diff.ts:15`; 60 HR-5).

Proof: one run per cell of 60 §4.1 marked M2 (E15-0, E15-D, E5-0, E5-D,
F15-on, F15-off, F15-TA, L15-0, L15-D; delay D = 140 ms, jitter 0),
locally on this M1 Pro with 8 concurrent workers (R13), outputs outside the
repository:

```bash
npx tsx scripts/parity/run-parity.ts --cell native/parity/cells/<CELL>.json \
  --out-dir "$SCRATCH/parity/<CELL>" --concurrency 8 \
  --rust-bin data/strategy-artifacts/native/<sha256 of that cell's strategy binary>
```

- Exit: every cell passes 60 §4.4: every market matches within R5 or its
  mismatch is classified; no open *Rust bug* entry; zero unclassified
  entries; coverage shows every exerciser feature hit. If Open question 5 is
  still unanswered when everything else passes, the gate-2 report presents
  E5-0/E5-D as blocked and the user decides whether G2 waits for them.
- Gate 2 (§7), then the merge PR (§8).

### M3a — Native backtest path and persistence

Lands after G2 as small PRs on main (§8). Until this milestone, native code on
main is reachable only through the parity tooling, and no native run is
persisted anywhere.

- Deliverables:
  1. Migrations of 42 §3.1 and §3.3–§3.7 (engine provenance, `model_config`,
     seed, rules snapshot table, rules provenance per market row, failure
     class, native artifact columns, conversion format version), hand-written
     per 42 §2 and mirrored in the dashboard schema; the aggregate protocol
     version bump (42 §2.6). Applied to production per Open question 11.
     The group columns (42 §3.2) come with M4.
  2. Full Rust publish: `strategy:publish` with R2 upload and the
     `strategy_artifacts` row (31 §6–§7.2).
  3. Producer resolution of native artifacts via `describe` and capability
     refusals (31 §8); `resolveModelConfig` with `--native-profile` (default
     `ts-compat`; `realistic` is refused while `describe` does not offer it,
     R14); per-condition rules snapshot capture and resolution (11 §13.2–§13.3,
     D21); fee eras verified against charged amounts (D22, 11 §5.3).
  4. `--sequential` native execution through `src/native/` (build job → `run`
     → validate → map → existing persistence with provenance); dispatch in
     `market_start_ms` order (16 §6.1); `--extend` of a native run with
     `model_config` equality (42 §5).
- Proof:

```bash
npm run strategy:publish -- --repo native/strategies --bin engine-exerciser
npm run backtest -- --strategy-artifact <sha256> --sequential --slug <s1>,<s2>,<s3>
#   → one backtest_runs row: engine='native-ts-compat', engine_version, model_config, seed;
#     its market rows equal (R5) the M2 harness results for the same slugs
npm run backtest -- --extend <runId> --limit 3       # model_config inherited, equality checked
```

  plus refusal tests that exit 2 before anything is enqueued or written:
  `--symbol eth`, a 1h timeframe, `--input-mode recorded`,
  `--native-profile realistic` before M3b, an unknown param.

### M5a — Executor and hot path

Depends only on M2 (S7); lands after G2. All per
16-performance-and-parallelism.md.

- Deliverables: `serve` (20 §6) with a work-stealing pool (S2); shared per-day
  feed caches (16 §6); the chosen decode path (16 M-1…M-3, M-13); book layout
  (M-4); allocator (M-9); per-machine thread count and QoS on m1-ivan (S3,
  M-7); memory budget for 16 GB machines (16 §6.2); read-ahead (M-12); job
  granularity (markets and candidates per executor request, so Redis round
  trips and IPC stay a small share of compute); build-profile measurement
  (16 §11.2, M-8; adoption per Open question 2); `--sequential` uses the same
  executor in process; dispatch in `market_start_ms` order; live hot-path
  micro-benchmarks (S4, 16 §12).
- Proof: benchmark report `native/reports/bench-M5a-<date>-m1-ivan.md` on
  `recent-1k` and `june-1k` with rows 1–5 and 7–9 of 16 §13.3 (TS row 1 vs
  Rust `overnight-opus55-lagsnipe.v15.rs`), each with wall time, markets/s,
  CPU utilization, peak RSS and phase profile; DET-2 (`run` vs `serve` at 1
  and 8 threads) and DET-4 pass; outputs byte-identical across every thread
  count; PS-50 and the full ts-compat matrix (Rust-only, cached TS traces)
  still pass.

### M3b — Realistic profile

- Deliverables: one realistic fix at a time (13 §7.1, RF01–RF14): fee from
  `feeSchedule` (5 dp, eras), taker delay by exchange time, GTD ≥3 min lead
  with 60 s early expiry, FAK and FOK/FAK BUY sized in collateral,
  tick/min-size/price-bound validation and `tick_size_change`, liquidity
  depletion with our own orders in the book, no free fill of a crossing
  remainder, queue-position fill model (on Telonex without trade prints per
  13 §6.5; full model on V4 in M7), separate seeded place and cancel latency
  at exact event time, settlement statuses with FAILED reversal, the
  window-end rule (D23), async split/merge (D25), isolated per-market capital
  (D31); `engine-exerciser-realistic.rs` (60 §5.9); `describe` offers
  `realistic` once the ladder is complete.
- Proof: one A/B report per fix under `native/reports/ab/` on the M3 set (60
  §11 AB-1…AB-5); realistic invariants (no oversell, liquidity conservation)
  pass; the full M2 parity matrix still passes under ts-compat.

### M3c — Market Simulator for native runs (D10)

- Deliverables: the `SimulatorSink` (22 §5) and `run --sim-trace <dir>` (added
  to 20 §5.4 by its owner); a native branch in
  `src/backtest/simulator/resolveMarket.ts` that ensures the binary through the
  local artifact cache (`src/native/` runner), runs `run --sim-trace` with the
  stored job inputs, model config and params, and ingests the chunks into the
  existing contract (`src/backtest/simulator/contracts.ts`); the D10 guard
  (merged at G2) stays for engine versions without the sink.
- Proof: for runs persisted by the M3a proof in `ts-compat` and for the same
  slugs in `realistic`, the saved-vs-replay comparison passes at its existing
  tolerance of 0.00005 (`src/backtest/simulator/captureTrace.ts:72`).

### M4 — Candidate groups

- Deliverables: `--candidates <file.json>` (D14), shared replay of one market
  for N candidates (`run-group`, 20 §5.5), one `backtest_runs` row per
  candidate written by one group aggregate (D13), the group columns (42
  §3.2), failure isolation with `panic-probe.rs`, seed per (run seed, slug)
  (41).
- Proof: 41 §10 and 60 CG-1…CG-5: a group of ≥20 candidates on ≥200 markets
  equals the same candidates run standalone, compared on persisted rows with
  `npm run backtest:verify-diff`; a standalone `--extend` of one candidate
  equals its group result; group speedup recorded.

### M5b — Performance of realistic and groups; final benchmark

- Deliverables: cost of the realistic profile vs ts-compat (16 §14 M3 row);
  group scaling at 1/10/100 candidates, both layouts, plugin dedupe (M-5,
  41 §10.5); the L2 production-path row (16 §13.2) once M6's queue exists or
  through `--sequential`; the decision register of 16 §15.2 resolved for
  every M5 item.
- Proof: benchmark report `native/reports/bench-M5b-<date>-m1-ivan.md` with
  every row of 16 §13.3 (rows 6 and 10 added to M5a's), outputs
  byte-identical across thread counts and group membership, the M2 parity
  matrix still passing.

### M6 — Fleet integration

- Deliverables: native queue and version/target gate (D12), worker shim
  supervising the executor and reusing `src/native/` (40 §5), producer
  enqueue in `market_start_ms` order (16 §6.1), env allowlist and isolation,
  execution stamping by TS, fleet artifact cache, reproducible builds (D17),
  native kill switch and engine-version blocklist, dashboard engine badges and
  cross-engine comparison guard, docs pages (new pages via the docs-writer
  skill, sidebar entries, `npm --prefix docs run build` green) and CLAUDE.md
  updates (40, 31, 42).
- Proof: a 1,000-market run of `overnight-opus55-lagsnipe.v15.rs` on the 4
  fleet Macs (Open question 7) in ts-compat, and in realistic once M3b is
  done; a ≥50-market subset produces byte-identical outputs on every Mac
  (DET-6); the same source builds to the same sha on all four Macs (31 §7.6,
  DET-12); fleet throughput (market-candidates per hour) TS vs Rust,
  reported as native-artifact throughput (§1.1); `--extend` of a native run
  works; kill-switch and rollback drills recorded.

### M7 — Recorder V4 input

- Deliverables: V4 reader with manifest and sha verification, coverage gate
  (`incomplete_capture`, `coverageReasons`), `--allow-capture-gaps`, recorded
  receipt order and receive times, rules from V4 `rawJson` (15 §5); trade
  prints feed the queue-position model; the journal reader foundation shared
  with M8 (D26, 15 §7, 22 §6).
- Proof: cell V4-E (60 §4.1): ts-compat parity against TS
  `--input-mode recorder-v4` on ≥50 worker-2 packages (TS V4 window semantics
  per D23); realistic runs on the same packages; a money-free fill-model
  evaluation report on V4 tape (did traded volume through our level justify
  each modeled fill).

### M8 — Live paper mode

- Deliverables: the Rust live runtime with discovery and pre-subscribed
  rotation for BTC 5m and 15m, market WS (incl. `custom_feature_enabled`, text
  PING), feeds, rules fetch, the serial loop, paper execution with the
  realistic profile (D28), session guards, restart behavior (D29), the journal
  (D26), per-market results stored as `input_mode='paper'` runs (D11) (50).
  Built without the real-order feature; the agent loads no credentials.
- **Who runs which session** (pending Open question 10): agent-run sessions
  use only strategies that need no credentials: the engine exerciser and the
  feed exerciser with Chainlink disabled (public market WS, Binance and
  Gamma price-to-beat). Sessions of strategies that request Chainlink
  (lagsnipe, the full feed exerciser) need the PolyBolt CLOB API values
  (50 §8.1) and are launched by the user unless the answer says otherwise.
- Proof: paper sessions totaling ≥24 hours covering both timeframes (50 §19,
  60 LV-1, LV-2); every market's journal replayed through the backtest path
  gives an identical intent/fill/cancel sequence and byte-identical
  deterministic `EngineResult` section (DET-11); latency report (receipt →
  intent p50/p99); reconnect and restart drills. SHOULD: paper results
  compared with backtests of the same markets from worker-2 V4 packages, with
  differences attributed to input clocks (50 §13.5).

### M9 — CLOB V2 adapter

- Deliverables: V2 order struct and EIP-712 domain v2 signing, REST place/
  cancel/batch with the shared error taxonomy, ambiguous-outcome
  reconciliation, 429 backoff, user WS mapping incl. FAILED reversal and maker
  identity, heartbeat with per-key lockfile (D30), live capital rule (D31),
  strategy-panic policy (D32), alerts (D33), real-order gate (CLI flag plus
  compile-time feature), launchd service and upgrade rule (50).
- Calibration preparation (presented at G4, 51 §3): `calibration-probe.v1`
  with a ≥24 h paper rehearsal of all phases (51 P6), the runbook, D35
  thresholds frozen in a commit, the host isolation plan, and the analysis
  tooling with its self-tests passing (51 §11.3).
- Proof: 60 LV-5…LV-9 and 50 §19: signing vectors from the docs;
  recorded-fixture and mock-exchange tests (place, cancel, batch, heartbeat
  loss, FAILED reversal, reconnect resync, 429, ambiguous POST); shadow mode
  during a paper session (orders built and signed with a throwaway test key,
  never sent); a test proving a binary without the feature cannot send; the
  gate 4 checklist (§7).
- Gate 4: the user approves the first real order. Authenticated read-only
  checks with the user's keys are performed by the user as part of this gate.

### M10 — Calibration

- The user launches and stops the bot; budget and stop per D34; worker-2
  records the same markets with Recorder V4 (51 §7).
- Analysis: journal ↔ V4 join, decontamination, execution-pinned and
  end-to-end replay modes (51 §9–§11).
- Proof: calibration report with every D35 metric (pass/fail, confidence
  intervals); fitted model parameters committed as a versioned calibration
  artifact with its validity envelope; realistic-vs-live next to
  realistic-vs-ts-compat (51 §13, §15).
- Gate 3: the user decides whether `realistic` becomes the default profile.

## 7. User gates

At each gate the session stops the gated work, writes a gate report under
`native/reports/` (60 §15), sets STATUS.md "Waiting on user", and asks the
user.

| Gate | When | The session presents | The user decides |
|---|---|---|---|
| G1 | End of M0 | The committed spec revision (sha), the gate-1 question list (Open questions of every document), the lead decisions in 02 | Spec freeze (tag `native-spec-g1`); changes to lead decisions |
| G2 | End of M2 | Parity matrix results, PARITY.md (money-semantics classifications highlighted), coverage, invariants, benchmark so far, spec deviations (new D entries), the merge content (§8) | Accept the port; merge to main; confirm classifications |
| G4 | End of M9 | Adapter test report, paper journal-replay identity, safety checklist (feature + flag gate, heartbeat, lockfile, session guards, kill switch, alerts), calibration runbook, probe rehearsal and frozen thresholds | Approve the first real order; the user launches |
| G3 | End of M10 | Calibration report against D35, validity envelope, A/B summary | Make `realistic` the default profile |

## 8. Branch, merge and oracle policy

- **Branch.** All work happens on `native-engine` in the worktree
  `.claude/worktrees/native-engine`, created in M1 step 1 from `origin/main`
  (D01). The `rust-engine` branch, including `fef5f199`, is frozen read-only
  reference after the M0 spec commit. Until gate 2, main is untouched, the
  fleet never switches branch, and parity runs locally (D03, R13).
- **Sync.** `origin/main` is merged into the branch at least at every
  milestone start and before every parity run. The merged main commit is the
  **oracle pin**; it is recorded in STATUS.md and in the PARITY.md header.
  Parity evidence is valid only for its pin and its binary sha. If a sync
  brings engine-semantics changes (`src/trading`, `src/strategy`,
  `src/market`, `src/backtest`, `src/parquet`; full list in 60 OR-2), the
  parity matrix is re-run and new mismatches classified (D04).
- **Merge content at G2.** One PR merges the branch into main (CLAUDE.md PR
  flow, CI green). It contains what M1–M2 built: the engine workspace and
  `native/strategies/`, the contract schemas and generated TS types,
  `src/native/` (used only by the parity tooling), the parity tooling and TS
  twins, the canonical builder in local-only mode, the native CI job, the
  spec, STATUS.md, PARITY.md and reports. It also adds the Market Simulator
  guard for native runs (D10, 22 §5) and the D04 rule to CLAUDE.md (every
  engine-semantics PR on main adds an exerciser case or a PARITY.md entry).
  It contains **no migrations and no user-reachable native backtest path**:
  those arrive together in M3a, so every persisted native run is identifiable
  from the first one. The merge MUST NOT change the behavior of TS strategies
  (TS self-parity, 60 OR-17).
- **After the merge.** Each later milestone lands as small PRs from short
  branches off main. Native dispatch applies only to native artifacts and,
  from M6, has a kill switch (40 §11). TS engine changes are limited to bug
  fixes and new engine features are built Rust-first (D04).

## 9. Progress recording and resuming

### 9.1 `native/STATUS.md` format

```markdown
# Native engine — status

## Current state            <!-- rewritten by every step -->
- Branch: <name> @ <sha> (green: yes/no)
- Spec: native-spec-g1 @ <sha> (+ D entries since: D<n>…)
- Milestone / step: M3b / 4 of 14 — taker delay
- Oracle pin: main@<sha> (synced <date>)
- Binaries: <strategy id> <sha256> (canonical build, <date>) …
- Data roots: symlinks data/{events,binance,telonex} → <main checkout>/data
- Last proof: `<command>` → <result>
- Benchmark (fixed set): <markets/s>, Δ vs previous milestone
- Waiting on user: none | G<n> | question <ref>
- Next action: <one line>

## Milestone plans
### M3b (started <date>)
- [x] 3b.1 <step> — <sha>
- [ ] 3b.2 <step>

## Log (newest first)
### <date> — M3b.3 <title>
- Commit <sha>; proof `<command>` → <result>; reports: <links>
- Decisions referenced or added: D<n>
- Notes / anomalies
```

### 9.2 Rules

- STATUS.md is updated in the same commit as the work it describes (R12).
- A proof is recorded only after it was run; record the exact command,
  the binary sha and the result. Failed attempts that change the plan are
  logged too.
- Benchmark numbers come from the fixed benchmark sets of 16 §13.1.
- Blockers that need the user are written under "Waiting on user" with a
  reference to the open question or gate report.

### 9.3 Resume procedure for a new session

1. Follow the reading order in 00-README.md §2 (always-read core plus the
   working set of the current step).
2. `cd .claude/worktrees/native-engine`; confirm the branch head matches the
   recorded sha, or read the log entries after it.
3. Verify green: `(cd native && cargo test --workspace --locked)`,
   `(cd native/strategies && cargo test --locked)`, and the TS checks for
   files touched by the last step (`npm run lint`, `npm run code:typecheck`).
   Confirm the data symlinks resolve.
4. If the tree is not green, or the last step has no log entry, restart that
   step from the last green commit.
5. Continue with "Next action". Never redo a recorded proof unless a sync, a
   new binary sha or a change invalidated it.

## 10. Follow-up goals (after this goal)

| # | Goal |
|---|---|
| F1 | **Protocols in Rust.** Global Runtime agents in polymarket-protocols author Rust strategies: build step outside the sandbox (31 §11), toolchain on the fleet, publish authorization (31 §9), a Rust ENGINE-CONTRACT per profile (30 §17), candidate submission for protocol searches (D16). This is when the fleet-wide speedup arrives (§1.1); Open question 6 asks whether a minimal F1 step moves forward. |
| F2 | **Telonex trades and queue model on Telonex.** Ingest the Telonex `trades` channel, merge prints into telonex-delta replay as `last_trade_price`, A/B the queue-position model on Telonex, and quantify realistic-on-Telonex vs realistic-on-V4 on overlapping markets. |
| F3 | **Retention script.** Cleanup policy for `backtest_run_markets` of unpromoted runs, R2 traces and ledgers, and old binaries; live journals kept long-term in a private bucket (D15). |
| F4 | **TS sunset review.** On a user-set date: which TS engine parts remain (Recorder V4 depends on `src/market` and the feed clients), and how historical TS evidence is re-baselined against realistic results (D04). |
| F5 | **Universe expansion.** Other symbols and timeframes with their own rules, feeds and Chainlink coverage, flagged unvalidated until calibrated. |
| F6 | **Larger calibration.** Extend the validity envelope beyond ~10-share orders once the user raises capital (51 §14). |

## 11. Risks

| Risk | Mitigation |
|---|---|
| A session limit leaves a broken tree (happened at `fef5f199`) | R12 green steps; STATUS.md per step |
| The uncommitted spec is lost before G1 | M0 commits `native/spec/` on `rust-engine` before the gate-1 report |
| ts-compat grows into a port of TS structure | R4; ts-compat limited to model traits and a flag list |
| Correlated errors (one agent writes code, tests and classifications) | Conformance tests written from the spec by a separate session or subagent that has not seen the implementation; user confirms money-semantics classifications at G2 (60 §10) |
| Non-reproducible oracle (unseeded jitter, env knobs, wall-clock rules) | Jitter 0, pinned ModelConfig and environment for TS runs (60 §2.3) |
| Parity evidence from a binary that does not ship | Only canonical builds count; the sha is recorded with every proof (§6) |
| Optimizations change results | S6; parity matrix and thread-count determinism tests after every optimization |
| BTC 5m data is not in R2 (0 eligible on 2026-10-09) | M2 step 1 preflight; Open question 5; other cells continue |
| The user expects a fleet-wide speedup from this goal | §1.1 states that only native artifacts speed up; Open question 6 |
| lagsnipe.v15 source not available locally; artifact built from a dirty tree | TS oracle uses the exact artifact sha; port from the complete bundle (60 §6.2); Open question 4 asks only for a cross-check source |
| Telonex has no trade prints, so the queue model is weaker there | V4 evaluation in M7; F2 |
| Small calibration sample | Validity envelope and confidence intervals (51) |
| Heterogeneous fleet cores and 16 GB memory | Per-machine measured thread counts and memory budget (S3, 16 §6.2, §10) |

## Open questions

These form the gate-1 question list of this document, in plain words. The
gate-1 report also collects the open questions of every other document.

1. *(Closed.)* Plugin scope: the project direction (level 1) lists all four
   plugins, so §4 ships them and D19 is amended at G1 (§6 M0 table).
2. **Faster-running build for fleet binaries.** If tests show at least 10%
   faster backtests, may the binaries the fleet runs use a build setting that
   takes longer to compile (thin or full link-time optimization) but runs
   faster? The measurement and the exact rule (≥10% on `recent-1k`, warm
   rebuild ≤60 s on an M4 mini, reproducible builds still byte-identical)
   are in 16 §11.2; the answer becomes a D entry and fixes M5a row 7.
3. **Faster data format.** If reading the data files is still the slowest
   part after the M5a optimizations, would you accept re-converting all
   ~31,000 historical BTC 15m market files (52 GB locally, plus the R2 copies)
   into a faster format (15 §4.4, 15 Open question 1)? The answer becomes a
   D entry; with "no", version 1 stays the only format.
4. **lagsnipe.v15 source.** The strategy exists on this machine only as a
   built file (sha `304eceb3…`, built from a dirty tree at polymarket-protocols
   commit `78ad993c`, entrypoint
   `protocols/game-overnight-opus-5-5/strategies/overnight-opus55-lagsnipe.v15.ts`).
   The plan is to port it to Rust from that built file, which is complete and
   readable (60 §6.2). Is that fine? If you can provide the original source,
   it is used as a cross-check.
5. **BTC 5m data for the parity test.** Parity needs 200+ BTC 5m markets, but
   only 6 are on this machine and none is in R2 (dry run on 2026-10-09: 0
   eligible 5m markets vs 27,679 15m). Producing them needs the production
   data pipeline (`npm run data:sync:main -- --market btc:5m`), which writes
   to the shared database and R2. May the agent run it before gate 2, do you
   want to run it yourself, or should the 5m parity cells wait (gate 2 then
   covers BTC 15m only, and the 5m cells run before M3b)?
6. **When the fleet gets faster.** The Rust engine speeds up only strategies
   written in Rust. Your current fleet load (AI protocol sweeps) is
   TypeScript and stays at today's speed until the follow-up goal F1.
   Should a minimal F1 step (Rust build step outside the sandbox, publish
   authorization, a Rust engine contract for agents) move right after fleet
   integration (M6), before the live work, or is it fine that the real fleet
   speedup arrives after this goal? With "move it", the order after G2
   becomes M3a, M5a, M6 (ts-compat), F1-min, then M3b onward.
7. **Fleet membership.** dashboard/src/data/machines.json lists m1-ivan,
   worker-1, worker-2, m1-milan and m5-milan. Which four Macs form the fleet
   for the M6 run and throughput benchmark, and are the MacBooks available
   for long runs?
8. **TS freeze point.** D04 freezes TS engine features "after acceptance".
   This document reads acceptance as gate 2. Confirm.
9. **TS sunset date.** D04 calls for a sunset review on a fixed date (F4).
   Which date?
10. **Paper mode: what the agent may run.** M8 needs the Rust paper runtime on
    live public market data on this machine, built without the real-order
    feature and with no keys loaded. Is that allowed? And strategies that use
    Chainlink prices need the three CLOB API values for the PolyBolt feed
    (50 §8.1), which the agent must never load (R10). Choose: (a) the agent
    runs only strategies without Chainlink, and you launch the Chainlink
    sessions (lagsnipe); (b) you create a separate API key on a wallet with no
    funds, used only for paper market data; (c) Chainlink from another
    source (changes the feed model; not recommended). (Also 50 Open
    question 7.)
11. **Production database migrations after gate 2.** M3a (and later M4) add
    columns and one table to the production database (42 §3, additive,
    `ALGORITHM=INSTANT`). After each PR merges, may the agent run
    `npm run db:migrate` on the producer, or do you run it?
