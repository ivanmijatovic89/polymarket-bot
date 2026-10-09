# 01 — Scope and milestones

This document replaces `native/GOAL.md`. It states what the native engine goal
delivers and in which order: the objective and the speed mandate, the ownership
boundary between Rust and TypeScript for backtest and live, the v1 market
universe and the native strategies, what is out of scope, the milestones with
their proof commands, the four user gates, the branch, merge, oracle and host
policy, how progress is recorded in `native/STATUS.md` so any new session can
resume, the follow-up goals and the questions left for gate 4. It references
the other spec documents instead of restating them (index:
[00-README.md](00-README.md)). Milestone numbers are owned here; other
documents use them.

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
7. Order of work: engine and backtest → fleet → protocols author Rust
   strategies (M11, right after the fleet, D39) in parallel with the Rust
   live runtime in paper mode (M7, M8). The CLOB V2 adapter (M9) and the
   calibration (M10) belong to a separate later goal (D70).
8. No overall wall-clock limit and no stop criteria (D02, D07). Each
   goal-session run lasts at most 8 hours and then pauses (§9.4). Progress is
   bounded by milestone proofs and the user gates of §7 (G1 and G2 in this
   goal; G4 and G3 belong to goal 2, D70). Speed is measured and reported;
   there is no minimum speedup threshold.
9. All engine work runs on worker-1 (D36, §8.1).

### 1.1 Done means

The goal is done when every milestone M0–M8 and M11 (including M3a–M3c and
M5a–M5b) passes its proof on the final revision, all work is merged to main
through PRs with CI green, `PARITY.md` has no unclassified entry, the
benchmark reports exist, and a closing STATUS.md entry records the starting
point for goal 2 (M9 CLOB V2 adapter, M10 calibration, gates 4 and 3; D70).
The telonex-delta BTC 5m cells (E5) are required only once 5m data exists
after a Telonex renewal (D38); until then BTC 5m is proven on Recorder V4
(M7) and the final report states the gap. `realistic` stays opt-in; gate 3
is decided in goal 2.

**What the speedup covers.** Rust speeds up only strategies compiled into a
native artifact: in M1–M6 the strategies of §4.1. About 80% of today's fleet
markets come from Global Runtime protocol runs of TS strategies (16 §9.1,
requirements-sweep `fair-scheduling-heavy-jobs`). Their throughput changes
only as protocols author Rust strategies after M11 (D39). Fleet throughput
numbers in M5a, M5b and M6 are measured on native artifacts and MUST be
reported as such, never as a fleet-wide speedup.

## 2. Speed mandate

The user moved the engine to Rust for speed: maximum backtest throughput on the
fleet and minimum decision latency live. TS implementation choices are not
constraints; some were made only because Node is single-threaded.

| # | Requirement |
|---|---|
| S1 | Design for throughput and latency from M1. Architecture that is hard to retrofit (columnar decode, immutable shared market data, allocation-free hot loop, `Send` engine state, executor-friendly library entry point, the tick interest flag of D41) MUST be in place in M1, not deferred to M5a (16-performance-and-parallelism.md §14). |
| S2 | **Do not copy the TS process model.** TS runs one Node child per core because Node is single-threaded (src/cli/backtestWorker.ts:136-160, scripts/run-worker.sh:29-47), and the WIP native path spawns one process per market and re-verifies hashes per process (src/strategy/artifacts/native.ts:88-121, src/backtest/marketProcessor.ts:49-63). The Rust design MUST evaluate and use: one long-lived executor per machine and artifact (`serve`, 20 §6), a work-stealing thread pool across markets and candidates, shared immutable per-day feed caches (Binance aggTrades, Chainlink rounds) across markets, columnar Parquet decode (row reconstruction was ~50% of the prototype's profile, research/early-audits.md:53), I/O prefetch overlapped with compute, dispatch in `market_start_ms` order so consecutive jobs share feed days (16 §6.1), and candidate groups (M4). No per-market process spawn on the fleet path. |
| S3 | **Heterogeneous cores.** Fleet Macs differ: M4 Mac mini 4P+6E (worker-1, worker-2), M1 Pro 8P+2E (dashboard/src/data/machines.json). Thread counts and QoS are measured per machine type, not assumed; work stealing absorbs speed differences between core types (16 §10). |
| S4 | **Live latency.** The live decision path (frame receipt → book update → strategy → intent → signed request on the wire) is minimized and measured (p50/p99). The deterministic decision loop runs on its own thread; network I/O, signing preparation and journaling do not block it (50 §4.2, §18; 16 §12). |
| S5 | **Measured, not assumed.** A benchmark harness exists from M1. Each milestone records its numbers on a fixed benchmark set in STATUS.md. Each optimization is A/B measured. A regression above 10% against the previous idle milestone measurement MUST be explained in STATUS.md (reporting, not a stop criterion). |
| S6 | **Speed never changes results** (R7, R8). Parallelism is across independent units only; one market-candidate is always a serial deterministic loop. Output is byte-identical across thread counts, machines, group membership and build profiles; the parity suite is the regression guard for every optimization. |
| S7 | **Speed work is not queued behind realism.** The executor, caches, decode path, tape, book layout and build profile do not depend on the realistic profile, so they are a separate milestone (M5a) that depends only on M2. Only the cost of realistic and group scaling wait for M3b and M4 (M5b). |

Baselines to beat (evidence, not targets): TS averages 1.2–2.6 s per market
per process (research/requirements-sweep.json, `cpu-slots-and-job-granularity`);
the Codex prototype ran 1,000 BTC 15m markets with lagsnipe.v15 in 99.6 s vs
TS 617 s (6.19×) with one Rust process per market on m1-ivan, and shared
candidate replay reached ~4× at 100 candidates (research/early-audits.md:51-52).
The TS baselines are re-measured on worker-1 in M1 step 7.

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
| Dashboard, Market Simulator, research tools, protocol tooling, recorder, rules capture | TS |

### 3.2 Live

| Concern | Owner |
|---|---|
| Market discovery and rotation, market WS, user WS, feeds (Binance, PolyBolt Chainlink, PTB), rules fetch, the serial event loop, strategy, validation, order state machine, session guards and kill switch, paper execution, CLOB V2 signing/REST/heartbeat (`real-orders` build only, D44), reconciliation, journal, per-market result | Rust (50) |
| Split/merge on-chain transactions (relayer SDK is TS-only), modeled in Rust as async operations (D25) | TS sidecar |
| Redeem watcher, approvals, pUSD wrapping, balance display, WebUI server (consumes the Rust state stream), persistence of live/paper results as `backtest_runs` rows (D11) | TS |
| Service supervision (launchd), secrets handoff (never env for behavior; secrets channel per 20 §7) | Ops/TS per 50 |

The seam in both modes is the job and output contract (21). There are no
per-tick TS↔Rust calls.

## 4. v1 universe and supported surface

| Item | v1 |
|---|---|
| Markets | **BTC 5m and BTC 15m only** (D06, user). The producer MUST refuse other symbols and timeframes for native artifacts, using `describe` capabilities (20 §3). Gate 2 covers BTC 15m (D38). |
| Target | `aarch64-apple-darwin` only for shipped binaries (D12); Linux is used for CI checks and the live crates' portability tests only. |
| Builds | `standard` (fleet, backtest, paper, agents; cannot send orders) and `real-orders` (live only, built by the user) from the same source (D44, 31 §5.5). Published binaries use the `artifact` profile (D18). |
| Input modes | `telonex-delta` with `--read-from local\|r2\|local-or-download-from-r2-to-local` (M1), `recorder-v4` (M7), live journal replay (M8). Rejected for native: legacy `recorded`, `telonex-paired`, `--time-driven`/`--realtime`, `--order exchange_time`. |
| Profiles | `ts-compat` (default until gate 3) and `realistic` (opt-in until gate 3). |
| Order types | GTC, GTD, FOK, FAK; post-only on GTC/GTD. |
| Intents | `place_limit`, `place_batch` (≤15), `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all`, `split_positions`, `merge_positions`. |
| Market events | `book`, `price_change`, `last_trade_price`, `tick_size_change` (kept even when a strategy ignores them). |
| Feeds | Binance aggTrades, Chainlink (two-clock), price-to-beat, synthetic feed ticks, read through the engine's feed view, which replaces the TS ExternalFeeds plugin (14, P-4). V4-only feeds are decoded but not offered to strategies (D43). |
| Plugins | TimeWindowVolatility, TechnicalIndicators (candles from local aggTrades, no network), DwellGate, TimeWindowGate (D19 as amended, 14 §12). |
| Strategy SDK | Includes the opt-in tick interest filter for new strategies (D41); the in-repo ts-compat ports never declare it. |

### 4.1 Native strategies in this goal

Every native strategy lives in the `native/strategies/` package (31 §2.3) and
is built only by the canonical builder (31 §4). TS twins live in
`src/strategies/testing/` (60 OR-4). Protocol strategies authored after M11
live in the protocols' own packages (31 §2.2).

| Strategy (id) | Kind | Milestone | Spec |
|---|---|---|---|
| `engine-exerciser.rs` + TS twin `engine-exerciser` (WIP, upgraded to schedule v2) | parity test, every intent and order type | M1 step 5 (Rust), M1 step 6 / M2 (schedule v2) | 60 §5.1–§5.7, 30 §18 |
| Feed exerciser, Rust and TS twins | parity test for feeds, plugins and synthetic ticks | M1 step 5 / 6 (`trade: false`), M2 (`trade: true`, TA) | 60 §5.8, 14 V-3 |
| `overnight-opus55-lagsnipe.v15.rs` | port (D20, D40) of TS artifact sha `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8` (strategy_artifacts, read 2026-10-08; BTC 15m telonex-delta only, 264 runs), from the bundle `data/strategy-artifacts/304eceb3….mjs` (13,663 bytes, complete: Zod schema, normCdf/normInv, both callbacks; 60 §6.1–§6.2) | M2 | 60 §6, 30 §18 |
| `engine-exerciser-realistic.rs` | Rust only, realistic features without a TS oracle | M3b | 60 §5.9 |
| `panic-probe.rs` | test only, fault injection in groups | M4 | 60 CG-4 |
| `calibration-probe.v1` | calibration probe, normal SDK | goal 2 (M9, D70); not built in this goal | 51 §3 P6, §6 |

No other TS strategy is ported in this goal.

## 5. Out of scope

- Deleting or rewriting the TS engine (frozen to bug fixes from G2, D49);
  porting any TS strategy not in §4.1.
- Legacy `recorded` and `telonex-paired` input modes, PMXT inputs.
- Deribit volatility index and the live-only RTDS Binance sub-feed.
- V4-only feeds for strategies (D43, follow-up F7).
- Symbols other than BTC; timeframes other than 5m and 15m (follow-up F5).
- Market Simulator features beyond replaying native runs through the existing
  dashboard contract (M3c, D10).
- Maker rebates and taker rebate tiers as PnL components (fees are modeled;
  rebates are not).
- Telonex trades-channel ingestion (follow-up F2; needs the Telonex renewal,
  D38). Re-converting the original telonex-delta files (D46).
- Retention and cleanup of old runs, traces, ledgers and binaries (follow-up
  F3, D15).
- Self-trade probes (D54). Real-money activation by the agent, ever (R10).
  The user launches calibration.

## 6. Milestones

The "Depends on" column is binding: it bounds how far work may be pulled
forward. The **default order** is the table order (M11 directly after M6,
then M7). While waiting at a gate, a session MAY start work that does not
depend on the gate outcome, on the branch, without merging. Each milestone
starts with a step plan written into STATUS.md and ends with its proof, a
green commit, and a STATUS.md entry.

Subcommand and flag names are owned by 20-binary-protocol.md (binary), 31
(build and publish), 60 (parity tooling) and 41 (group CLI); where a command
below differs from its owner, the owner wins and this document is corrected.
**Parity and benchmark evidence is valid only for the recorded oracle pin
(§8) and the recorded binary sha256** produced by the canonical builder
(31 §4); a binary built any other way (for example `cargo build --release`)
MUST NOT be used for parity, benchmark or gate evidence. All proofs run in
the native clone on worker-1 (§8.1); `SCRATCH` is a directory outside the
repository. Parity runs use `--concurrency 4` while the fleet worker runs
(§8.1 H4); concurrency never changes results (R7).

| # | Milestone | Depends on | Proof (summary) | Gate after |
|---|---|---|---|---|
| M0 | Spec freeze | — | Consistent, committed, tagged spec; link check | **G1** (delegated, D56) |
| M1 | Engine core (backtest), with step 0 = rules capture PR (D37) | M0 | Capture running on worker-1; tests, goldens, invariants, deterministic single-market run of the canonical binary, T15 tick-stream cells, bench baseline | — |
| M2 | ts-compat parity (BTC 15m, D38) | M1 | Every gating cell of 60 §4.1 passes 60 §4.4 | **G2**, then merge to main |
| M3a | Native backtest path and persistence | M2, G2 | `backtest --strategy-artifact <sha> --sequential` writes identifiable rows equal to the harness; refusals; rules snapshots imported | — |
| M5a | Executor and hot path | M2 (lands after G2) | `serve` benchmark rows vs TS; determinism across thread counts; parity unchanged | — |
| M3b | Realistic profile | M3a | A/B report per fix; ts-compat parity unchanged | — |
| M3c | Market Simulator for native runs (D10) | M3b | saved-vs-replay within 0.00005 in both profiles | — |
| M4 | Candidate groups | M3a | Group rows == standalone rows; extend equivalence | — |
| M5b | Performance of realistic and groups; final benchmark | M3b, M4, M5a | Full matrix of 16 §13.3 | — |
| M6 | Fleet integration | M3a, M5a (realistic rows after M3b) | Fleet run on the D55 hosts, cross-machine byte identity, native-artifact fleet throughput | — |
| M11 | Protocols author Rust strategies (D39) | M6 | Sandboxed end-to-end authoring, publish and fleet backtest of a Rust strategy | — |
| M7 | Recorder V4 input | M3b | V4 parity vs TS (incl. BTC 5m), realistic on V4 tape, P13 | — |
| M8 | Live paper mode | M7 | Journal replay gives identical decisions; latency report | — |
| M9 | CLOB V2 adapter (goal 2, D70) | M8 | Fixture/mock tests, shadow mode, safety checklist, calibration preparation | **G4** (goal 2) |
| M10 | Calibration (goal 2, D70) | M9, G4 | Calibration report against D35 thresholds | **G3** (goal 2) |

M11 keeps its number so the existing numbers stay stable; it runs right after
M6, and from then on protocol sessions author Rust strategies in parallel with
M7–M10. Gate 4 (first real order) precedes gate 3 (realistic as default) in
time; the numbering follows D02. References to "M3" without a suffix in other
documents mean M3b for realistic topics and M3a for persistence and
rules-snapshot topics; "M5" without a suffix means M5a and M5b.

### M0 — Spec freeze

- Deliverables: all documents listed in 00-README.md §1 exist, cross-reference
  each other by exact file name, cite evidence, and end with genuine open
  questions. Gate 1 was delegated to the lead (D56): the lead answered or
  deferred to gate 4 every gate-1 question (02 D41–D56, §12).
- Consistency items, fixed in the gate-1 consolidation pass and re-checked
  by proof step 2 (00 §3.4 says how to read a stale reference found later):

| Item | Owner(s) |
|---|---|
| Dev, build, parity, benchmark and tape host is worker-1, not m1-ivan (D36); parity at `--concurrency 4` alongside the fleet (§8.1 H4); benchmark and nightly window (D47) | 60 VP-8, HR-9, §14; 16 §13.5 |
| Gate 2 is BTC 15m; E5 cells non-gating until a Telonex renewal; "01 Open question N" → 01 §12.2 | 60 §4.1, MS-5; 16 §13.1 |
| Each answered open question closed and its text aligned with the D entry (02 D56 table) | each owner |
| Tick interest filter (D41) | 16 §9.4, 30 §4.1, 12 §5.3, 14 P-13, 21 §10 (`strategyTicksSkipped`) |
| Two builds (D44) | 20 §1, §7, 31 §5.5, §10, 50 §13.3, §17 |
| `artifact` profile: fastest-running, build time reported only until M11 (D18) | 16 §11.2, 31 §4.6 |
| Self-cross block (D54): `SelfCross`, carried by RF14 | 10 N6, 12 §7.4, 13 §6.12, §7.1 |
| FOK/FAK collateral sizing (D42); gate-3 evidence from 2026-08-17 11:00 UTC (D52); fee-study source (D53); mixed fee eras allowed by default (D51) | 10 §7, 11 §6.2, §14.1, 42 §3.5, §3.8, 51 §12.4 |
| Conformance author started automatically after G1 (D45) | 60 §10.0 C0 |
| `rulesSource` vocabulary `snapshot \| partial \| fallback` (11 RS4) | 21 §7, §17, 30 §5 |
| Calibration sets at `native/contract/calibrations/{latency,feeds}/<id>.json` | 21 §6.3 (13 §7.4, 14 F-57, 42 §7.6, 50 §1, 51 §13 reference it) |
| Rules capture: 11 §13.2.1 owns the script and import; 40 §16 only the post-M3a operation | 11, 40 |
| Gate-4 questions collected only in §12.1; other documents reference it | each owner |

- Proof:
  1. Link check (every `NN-*.md` reference resolves):
     ```bash
     cd native/spec && grep -oh '\b[0-9][0-9]-[A-Za-z0-9-]*\.md' *.md | sort -u \
       | while read -r f; do [ -f "$f" ] || echo "dead link: $f"; done   # prints nothing
     ```
  2. A consistency review (no topic owned by two documents, no contradiction
     with 02-decisions.md, every milestone proof references existing
     documents, every item of the table above fixed).
  3. **Commit and tag:** `native/spec/` is committed on `rust-engine` (spec
     files only, English, no code), tagged `native-spec-g1`, and the tag is
     pushed so worker-1 can fetch it (`git push origin native-spec-g1`).
     D56 and 03-overview-for-user.md are the gate-1 record; there is no
     separate gate-1 report. From then on the spec changes only per 00 §3.2.

### M1 — Engine core (backtest)

Steps (each ends green per R12; a step MAY take several green commits):

0. **Rules capture PR (D37).** First work on worker-1, independent of the
   engine, because pre-start rules are lost for every market that starts
   without a capture.
   - A short branch off `origin/main` in the native clone (§8.1 H1) adds the
     pre-start capture script of 11 §13.2.1 (PC1–PC6: public endpoints only,
     no credentials, no `.env`, no database, no engine-semantics path, so the
     oracle does not move). Normal PR with the PC8 content, CI green, merge
     (CLAUDE.md PR flow).
   - Deployment per PC7: a user LaunchAgent on worker-1 runs it from its own
     pinned checkout of the merged commit, separate from the fleet copy and
     the native clone, and writes outside every checkout; it keeps running
     during benchmarks and fleet pauses. M3a imports the files (PC10).
   - Proof: PC8 items 1–2 before deployment, item 3 after 24 h, recorded in
     the PR and in STATUS.md once it exists (step 1); coverage is then
     checked at every milestone start (PC9).
1. **Bootstrap.**
   - Clone and branch on worker-1 (D01, D36; the clone may exist from step 0):
     ```bash
     FLEET=/Users/worker-1/Sites/polymarket-bot
     NATIVE=/Users/worker-1/Sites/polymarket-bot-native
     [ -d "$NATIVE" ] || git clone "$(git -C "$FLEET" remote get-url origin)" "$NATIVE"
     cd "$NATIVE" && git fetch origin && git switch -c native-engine origin/main
     git fetch origin tag native-spec-g1 && git checkout native-spec-g1 -- native/spec
     ```
     Record the branch, the tag and its sha in STATUS.md (and later in the
     PARITY.md header). After the first green commit, push and open the draft
     PR "DO NOT MERGE before gate 2" (D48).
   - Workspace skeleton from `5446ec4a` (`native/Cargo.toml`,
     `rust-toolchain.toml`, `.gitignore`, `Cargo.lock`), with
     `[profile.release] lto = "thin", codegen-units = 1` **removed**: the
     shipped profiles `iterate` and `artifact` are defined only in
     `native/build/artifact-build.toml` (31 §4.2, added in step 5; D18). The
     engine workspace keeps Cargo's default `release`/`bench` profiles, used
     only for `cargo test` and L0 micro benchmarks.
   - New `native/STATUS.md` in the §9.1 format. Do not carry the superseded
     files (00 §1) or the old STATUS.md.
   - **Data access** per §8.1 H2–H3: gitignored symlinks
     `data/{events,binance,telonex}` into the fleet copy, so TS oracle
     children resolve Telonex `local_path` (relative to the repository root,
     `src/backtest/runSingleMarket.ts:380-390`) exactly as on a worker and
     harness `MarketJobData` keeps production-identical relative paths (60
     H-1). `data/strategy-artifacts/` stays a real directory of the clone (the
     artifact loader requires the cache under the repository root so `#pmb/*`
     resolves to this checkout's engine, WIP `marketJob.ts:43-63`). The
     harness, the bench driver and the golden/fixture generators accept
     `--data-root`, default `<repository root>/data`; the WIP hardcoded
     default `/Users/mijat/Sites/polymarket-bot/data`
     (`src/backtest/parity/marketJob.ts:34`) is removed.
   - Unless the launcher already did (60 §10.0 C0), create the conformance
     author's checkout `/Users/worker-1/Sites/polymarket-bot-conformance`
     with branch `native-conformance` from `origin/main` (60 CF-2); the
     launcher starts Fable there (D45).
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
| `.github/workflows/quality.yml` `native-quality` job | Carry; extend to CI-1 (60 §14), including the separate `native/strategies/` package (31 §7.6); Linux only (D48) |

2. **Contract, inputs, books, feeds.** `pmb-contract` types, schema export
   and generated TS types (21 §3); telonex-delta reader with format-version
   check (15 §4); books (15 §2.1); Binance, Chainlink and PTB visibility and
   the synthetic tick schedule (14 §3–§6, §8). Checkpoint: the TS-generated
   goldens for decode, book, feed visibility and synthetic schedule pass on
   the fixture markets (60 §7.2, 14 V-1/V-2). The full tick-stream cells
   need the binary and the TS tooling and run at the end of step 6.
3. **Core.** Serial event loop, all intents, validation through
   `ExchangeRules`, order state machine, capital reservation, cash-based PnL
   with the cost-basis identity asserted, cascades, window gate, the tick
   interest filter (16 §9.4, D41), fault semantics (10, 12); plugins (14
   §12); per-market stats and skip taxonomy (21 §11, §13).
4. **Execution.** Simulator, discrete-event scheduler, ts-compat Fill/Latency/
   Fee/Report models (13 §2–§5).
5. **Binary, SDK, canonical builder, Rust test strategies.** `describe`,
   `schema`, `selftest` and `run` (20 §5.1–§5.4); `pmb-sdk` surface, params
   derive and the tick interest declaration (30, 30 §4.1); the
   `native/strategies/` package with `engine-exerciser.rs` and the Rust feed
   exerciser (§4.1); the parity trace sink v2 (22 §3);
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
   - TS feed-exerciser twin (60 §5.8); TS trace writer v2 with `feeds` and
     `settlement_update` records (22 §3.2); harness changes HR-1…HR-9 and the H-1 validation
     (60 §4.3); the committed set `native/parity/sets/S15-CL.txt` and cell
     files `T15-on.json`, `T15-off.json` (60 §4.1–§4.2); the verification
     scripts of 60 §14.1 due by this step.
   - Checkpoint: cells T15-on and T15-off pass 60 §4.4 (tick cause, exchange
     time and visible feed values per tick, with and without synthetic
     ticks).
7. **Benchmark baseline.** L0 (`cargo bench`) and L1 (driver over prebuilt
   `EngineJob` files) harness, bench sets `smoke-50` and `heavy-1` (16 §13.1,
   §14), TS baselines on worker-1; the dispatch-boundary measurement M-23
   (12 §14 P6); the `pmb-tape` prototype with the NT-6 (b) check on
   `smoke-50` and `heavy-1`, decode ms (v1 vs tape) and tape bytes recorded,
   inside the 40 GB cap (16 §7.5, D46); first numbers in STATUS.md.
   L1 numbers use only canonical `artifact` binaries; L0 uses the workspace
   `bench` profile and is read only as before/after A/B. Runs outside the
   benchmark window (§8.1 H5) are marked `non-idle` (16 §13.5).

Tests: unit tests; golden fixtures generated by running real TS code (book,
decode, feed visibility, synthetic schedule, plugin math, stats); the TS suites
`capital.test.ts`, `cancellation.test.ts`, `Portfolio.test.ts`,
`restPollCapital.test.ts`, `runnerConfig.test.ts`,
`StrategyRunner.{serial,clock,syntheticTicks}.test.ts` (src/trading/) turned
into Rust fixture tests (60 §7.3); property tests (cash conservation,
reservations never negative and released on every terminal state, fills never
exceed order size, determinism) per 60 §8.

Proof (run from the native clone root):

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
    --out-dir "$SCRATCH/parity/$CELL" --concurrency 4 \
    --rust-bin data/strategy-artifacts/native/<feed-exerciser sha256>
done
```

`diagnostics` (wall time, CPU, RSS, start time) differs between runs by
design (21 §10); everything else MUST be byte-identical.

### M2 — ts-compat parity

Steps:

1. **Data prerequisites.** Commit the sets S15, SL and PS-50 (60 §4.2
   MS-0…MS-5; S15-CL exists from M1 step 6) from the inputs present on
   worker-1 (D36); a market without
   local data is replaced per MS-5, and the goal session never downloads
   into the fleet copy (§8.1 H2). **BTC 5m (D38):** the Telonex subscription
   has expired and R2 held 0 eligible 5m markets on 2026-10-09, so S5 is the
   few local 5m files and E5-0/E5-D run non-gating (60 §4.1). The full E5
   cells run after a Telonex renewal and are appended to the G2 evidence;
   BTC 5m ts-compat parity is also shown on V4 in M7. The agent never runs
   the production data pipeline.
2. **Strategies.** Engine exerciser schedule v2 in both twins (60 §5.3–§5.4);
   feed exerciser `trade: true` and TA (60 §5.8); the lagsnipe port from the
   bundle with the LS-1 strategy-math golden (60 §6, D40).
3. **Matrix runs and classification.** Every M2 cell of 60 §4.1, PARITY.md
   classification (60 §3), oracle self-check (OR-9), TS self-parity (OR-17),
   harness validation (H-1), coverage (60 §5.6, LS-2), Rust-twice
   determinism (DET-1); the conformance tests of workstream C (60 §10.0 C2,
   C3).
4. **Gate-2 report** (60 §15).

Deliverables also include the parity tooling tolerance updated to R5 (the
WIP default is 1e-6, `src/backtest/parity/diff.ts:15`; 60 HR-5).

Proof: one run per M2 cell of 60 §4.1. Gating: E15-0, E15-D, F15-on, F15-off,
F15-TA, L15-0, L15-D (delay D = 140 ms, jitter 0); non-gating: E5-0, E5-D.
Outputs outside the repository:

```bash
npx tsx scripts/parity/run-parity.ts --cell native/parity/cells/<CELL>.json \
  --out-dir "$SCRATCH/parity/<CELL>" --concurrency 4 \
  --rust-bin data/strategy-artifacts/native/<sha256 of that cell's strategy binary>
```

- Exit: every gating cell passes 60 §4.4: every market matches within R5 or
  its mismatch is classified; no open *Rust bug* entry; zero unclassified
  entries; coverage shows every exerciser feature hit; the G2-scope
  conformance tests are green or triaged (60 §10.0).
- Gate 2 (§7), then the merge PR (§8).

### M3a — Native backtest path and persistence

Lands after G2 as small PRs on main (§8). Until this milestone, native code on
main is reachable only through the parity tooling, and no native run is
persisted anywhere.

- Deliverables:
  1. Migrations of 42 §3.1 and §3.3–§3.9 (engine provenance, `model_config`,
     seed, rules snapshot table, rules and fee-era provenance per market row,
     failure class, native artifact columns, conversion format version),
     hand-written per 42 §2 and mirrored in the dashboard schema; the
     aggregate protocol version bump (42 §2.6). The agent applies each to
     production with `npm run db:migrate` after its PR merges (D50). The
     group columns (42 §3.2) come with M4.
  2. Full Rust publish: `strategy:publish` with R2 upload and the
     `strategy_artifacts` row (31 §6–§7.2), from worker-1 under the interim
     R2 rule of §12.1 item 1.
  3. Producer resolution of native artifacts via `describe` and capability
     refusals (31 §8); `resolveModelConfig` with `--native-profile` (default
     `ts-compat`; `realistic` is refused while `describe` does not offer it,
     R14).
  4. Rules snapshots in the RC-G2 order of 11 §13.2: the migrations, the
     import of every file captured since M1 step 0 (`rules:import-jsonl`,
     PC10), the RC4 probe, RC2 and RC3 (BTC 15m; plus the CLOB side if RC4
     finds it served), the RC5 hook, the periodic RC1 import (40 §16), the
     §13.7 proof; then step 8, the fee ground-truth study (11 §14.1; free
     Data API path first, D53), which precedes RF01 in M3b.
  5. `--sequential` native execution through `src/native/` (build job → `run`
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

  plus the rules-capture proof of 11 §13.7, and refusal tests that exit 2
  before anything is enqueued or written: `--symbol eth`, a 1h timeframe,
  `--input-mode recorded`, `--native-profile realistic` before M3b, an
  unknown param.

### M5a — Executor and hot path

Depends only on M2 (S7); lands after G2. All per
16-performance-and-parallelism.md, on worker-1.

- Deliverables: `serve` (20 §6) with a work-stealing pool (S2); shared per-day
  feed caches (16 §6); the chosen decode path (16 M-1…M-3, M-13) and the tape
  executor path (16 §7.5); book layout (M-4); allocator (M-9); per-machine
  thread count and QoS on worker-1 (S3, M-7); memory budget for 16 GB
  machines (16 §6.2); read-ahead (M-12); job granularity (markets and
  candidates per executor request, so Redis round trips and IPC stay a small
  share of compute); the build-profile measurement that fixes the `artifact`
  profile (16 §11.2, 31 §4.6, D18); `--sequential` drives a local `serve`
  executor through the shim logic in the producer process (20 §5.6); dispatch in `market_start_ms` order; the producer-side FX-1 phases
  (16 §13.9); live hot-path micro-benchmarks (S4, 16 §12).
- Proof: benchmark report `native/reports/bench-M5a-<date>-worker-1.md`,
  measured in the benchmark window (§8.1 H5), on `recent-1k` and `june-1k`
  with rows 1–5 and 7–9 of 16 §13.3 (TS row 1 vs Rust
  `overnight-opus55-lagsnipe.v15.rs`), each with wall time, markets/s, CPU
  utilization, peak RSS and phase profile; DET-2 (`run` vs `serve` at 1 and
  8 threads) and DET-4 pass; outputs byte-identical across every thread
  count, both input paths (tape and v1) and both build profiles; PS-50 and
  the full ts-compat matrix (Rust-only, cached TS traces) still pass.

### M3b — Realistic profile

- Deliverables: the fixes RF01–RF15 of 13 §7.1, in the development order of
  13 §7.2: rule fixes reported as commit pairs, axes as arms, leave-one-out
  and the profile pair at the end. The A/B reports start after 11 RC-G2
  step 7; RF01 runs after the fee study (step 8) or with F1/F2 flagged
  unverified (11 FS1). The fixes carry D42
  (FOK/FAK BUY in collateral, RF04), D51 (mixed fee eras allowed with
  per-era statistics), D52 (pre-2026-08-17 taker-delay markets flagged) and
  D54 (self-cross block). `engine-exerciser-realistic.rs` (60 §5.9);
  `describe` offers `realistic` once the list is complete. Backtest capital
  is already an isolated per-market allowance (12 §9.4); the live `min()` cap
  (D31) belongs to paper and live.
- Proof: one A/B report per fix under `native/reports/ab/` on the M3 set (60
  §11 AB-1…AB-5); realistic invariants (no oversell, liquidity conservation)
  pass; the full M2 parity matrix still passes under ts-compat; the G3-scope
  conformance tests start (60 §10.0 C4).

### M3c — Market Simulator for native runs (D10)

- Deliverables: the `SimulatorSink` (22 §5) and `run --sim-trace <dir>` (20
  §5.4); a native branch in `src/backtest/simulator/resolveMarket.ts` that
  ensures the binary through the local artifact cache (`src/native/`
  runner), runs `run --sim-trace` with the stored job inputs, model config
  and params, and ingests the chunks into the existing contract
  (`src/backtest/simulator/contracts.ts`); the D10 guard (merged at G2) stays
  for engine versions without the sink.
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
  41 §10.5); the tick-filter gain (M-21, D41); the L2 production-path row (16
  §13.2) through `--sequential` or M6's queue; the decision register of 16
  §15.2 resolved for every M5 item. BTC 5m bench rows wait for data (D38).
- Proof: benchmark report `native/reports/bench-M5b-<date>-worker-1.md` with
  every row of 16 §13.3 (rows 6 and 10 added to M5a's), outputs
  byte-identical across thread counts and group membership, the M2 parity
  matrix still passing.

### M6 — Fleet integration

- Deliverables: native queue and version/target gate (D12), worker shim
  supervising the executor and reusing `src/native/` (40 §5), producer
  enqueue in `market_start_ms` order (16 §6.1), env allowlist and isolation,
  execution stamping by TS, fleet artifact cache, build-host provisioning (40
  §17), reproducible builds (D17), the fleet tape build step if the user
  approved it at G2 (D46, 16 NT-8), native kill switch and engine-version
  blocklist, dashboard engine badges and cross-engine comparison guard, docs
  pages (new pages via the docs-writer skill, sidebar entries,
  `npm --prefix docs run build` green) and CLAUDE.md updates (40, 31, 42).
  Hosts per D55: worker-1, worker-2 (about 3 slots), milan-m1 (`m1-milan`) if it is
  reachable and can stay awake; m1-ivan takes no native market jobs.
- Proof: a 1,000-market run of `overnight-opus55-lagsnipe.v15.rs` on the D55
  hosts in ts-compat, and in realistic once M3b is done; a ≥50-market subset
  produces byte-identical outputs on every host (DET-6); the same source
  builds to the same sha on every host (31 §7.6, DET-12); fleet throughput
  (market-candidates per hour) TS vs Rust, reported as native-artifact
  throughput (§1.1), with the FX-8 breakdown (16 §13.9); `--extend` of a
  native run works; kill-switch and rollback drills recorded.

### M11 — Protocols author Rust strategies (D39)

Right after M6; promotes follow-up F1. The protocols' own content stays with
their sessions (CLAUDE.md); this milestone builds the engine-side path.

- Deliverables: the out-of-sandbox build daemon of 31 §11 on every host that
  runs Global Runtime sessions (check with the `iterate` profile, publish
  with `artifact`; the sandbox holds no cargo, toolchain or publish
  credential); publish authorization per 31 §9 updated for agent publishes;
  `strategy:new -- --lang rust` (31 §7.3); the Rust author documentation and
  ENGINE-CONTRACT per profile (30 §17); candidate-group submission from
  protocol tooling (D14, 41); `pte` access to the Rust commands; measured
  warm `check` and `publish` times on an M4 mini, presented to the user, who
  sets the rebuild-time limit (D18).
- Proof: from a sandboxed session, a test package in the external-repo layout
  (31 §2.2) is created from the template, gets diagnostics through the
  daemon, is published, and runs a ≥1,000-market fleet backtest with
  `--strategy-artifact <sha>`, its rows labeled with the native engine; a
  check confirms that no R2 write or publish credential is readable inside
  the sandbox.

### M7 — Recorder V4 input

- Deliverables: V4 reader with manifest and sha verification, coverage gate
  (`incomplete_capture`, `coverageReasons`), `--allow-capture-gaps`, recorded
  receipt order and receive times, rules from V4 `rawJson` (15 §5); trade
  prints feed the queue-position model; the journal reader foundation shared
  with M8 (D26, 15 §7, 22 §6); the Telonex-vs-V4 realism report P13 on every
  worker-2 market both datasets cover (51 §3).
- Proof: cell V4-E (60 §4.1): ts-compat parity against TS
  `--input-mode recorder-v4` on ≥50 worker-2 packages, BTC 5m and 15m (TS V4
  window semantics per D23); realistic runs on the same packages; a
  money-free fill-model evaluation report on V4 tape (did traded volume
  through our level justify each modeled fill); P13.

### M8 — Live paper mode

- Deliverables: the Rust live runtime with discovery and pre-subscribed
  rotation for BTC 5m and 15m, market WS (incl. `custom_feature_enabled`, text
  PING), feeds, rules fetch, the serial loop, paper execution with the
  realistic profile (D28), session guards, restart behavior (D29), the journal
  (D26), per-market results stored as `input_mode='paper'` runs (D11) (50).
  `standard` build only (D44); the agent loads no credentials.
- **Who runs which session.** Agent-run sessions run on worker-1 and load no
  secrets (50 §8.1): the engine exerciser and the feed exerciser with
  `chainlink: false` (60 §5.8). Sessions of strategies that request Chainlink
  (lagsnipe, the full feed exerciser) need the PolyBolt CLOB API values
  (passed through `paper --feed-secrets-fd`, 20 §7) and are launched by the
  user, until the gate-4 answer on an empty-wallet key (§12.1 item 2). No benchmark runs during a paper session (D47).
- Proof: paper sessions totaling ≥24 hours covering both timeframes (50 §19,
  60 LV-1, LV-2); every market's journal replayed through the backtest path
  gives an identical intent/fill/cancel sequence and byte-identical
  deterministic `EngineResult` section (DET-11); latency report (receipt →
  intent p50/p99) labeled with its host; reconnect and restart drills.
  SHOULD: paper results compared with backtests of the same markets from
  worker-2 V4 packages, with differences attributed to input clocks (50
  §13.5).

### M9 — CLOB V2 adapter

**Deferred to goal 2 (D70).** Not started in this goal; the text below is kept
as goal 2's plan.

- Deliverables: V2 order struct and EIP-712 domain v2 signing, REST place/
  cancel/batch with the shared error taxonomy, ambiguous-outcome
  reconciliation, 429 backoff, user WS mapping incl. FAILED reversal and maker
  identity, heartbeat with per-key lockfile (D30), live capital rule (D31),
  strategy-panic policy (D32), alerts (D33), real-order gate (`real-orders`
  build plus CLI flag, D05, D44), launchd service and upgrade rule (50).
- Calibration preparation (presented at G4, 51 §3): `calibration-probe.v1`
  with a ≥24 h paper rehearsal of all phases (51 P6), the runbook, D35
  thresholds frozen in a commit, the host isolation plan, and the analysis
  tooling with its self-tests passing (51 §11.3).
- Proof: 60 LV-5…LV-9 and 50 §19: signing vectors from the docs;
  recorded-fixture and mock-exchange tests (place, cancel, batch, heartbeat
  loss, FAILED reversal, reconnect resync, 429, ambiguous POST); shadow mode
  during a paper session (orders built and signed with a throwaway test key,
  never sent); a test proving a `standard` binary cannot send; the gate 4
  checklist (§7).
- Gate 4: the user answers §12.1 and approves the first real order.
  Authenticated read-only checks with the user's keys are performed by the
  user as part of this gate.

### M10 — Calibration

**Deferred to goal 2 (D70).** Not started in this goal; the text below is kept
as goal 2's plan.

- The user launches and stops the bot on the host chosen at G4; budget and
  stop per D34; worker-2 records the same markets with Recorder V4 (51 §7).
- Analysis: journal ↔ V4 join, decontamination, execution-pinned and
  end-to-end replay modes (51 §9–§11).
- Proof: calibration report with every D35 metric (pass/fail, confidence
  intervals), per input mode (51 §12.4); fitted model parameters committed as
  a versioned calibration artifact with its validity envelope;
  realistic-vs-live next to realistic-vs-ts-compat (51 §13, §15).
- Gate 3: the user decides whether `realistic` becomes the default profile.

## 7. User gates

At each gate the session stops the gated work, writes a gate report under
`native/reports/` (60 §15), sets STATUS.md "Waiting on user", and asks the
user.

| Gate | When | The session presents | The user decides |
|---|---|---|---|
| G1 | End of M0 | Delegated to the lead (D56): the frozen spec (tag `native-spec-g1`), D36–D56, 03-overview-for-user.md | The user reviews 03 and may change any decision (00 §3.2) |
| G2 | End of M2 | BTC 15m parity matrix results (D38), PARITY.md (money-semantics classifications highlighted), coverage, invariants, conformance results, benchmark and tape numbers so far, spec deviations (new D entries), the merge content (§8) | Accept the port; merge to main; confirm classifications; fleet-wide tape (D46) |
| G4 (goal 2, D70) | End of M9 | Adapter test report, paper journal-replay identity, safety checklist (`standard` vs `real-orders` build, flag gate, heartbeat, lockfile, session guards, kill switch, alerts), calibration runbook, probe rehearsal and frozen thresholds, the questions of §12.1 | Answer §12.1; approve the first real order; the user launches |
| G3 (goal 2, D70) | End of M10 | Calibration report against D35 per input mode, with C9/C10 as headline if accepted at G4 (51 §12.4, §15), validity envelope, A/B summary | Make `realistic` the default profile |

## 8. Branch, merge and oracle policy

- **Branch.** All work happens on `native-engine` in the native clone on
  worker-1 (§8.1), created in M1 step 1 from `origin/main` (D01, D36) and
  pushed with a draft PR "DO NOT MERGE before gate 2" (D48). The
  `rust-engine` branch, including `fef5f199`, is a frozen read-only reference
  after the M0 spec commit. Until gate 2, main is untouched except the rules
  capture PR of M1 step 0 (D37), the fleet never switches branch, parity runs
  on worker-1, and no native run is enqueued on the shared fleet Redis or
  written to MySQL (D03, R13, 40 §13 phase A).
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
  twins, the conformance tests, the canonical builder in local-only mode, the
  native CI job, the spec, STATUS.md, PARITY.md and reports. It also adds the
  Market Simulator guard for native runs (D10, 22 §5) and the D04/D49 rule to
  CLAUDE.md (TS engine: bug fixes only; a feature the protocols still need
  also gets a Rust version and a parity test; every engine-semantics PR adds
  an exerciser case or a PARITY.md entry). It contains **no migrations and no
  user-reachable native backtest path**: those arrive together in M3a, so
  every persisted native run is identifiable from the first one. The merge
  MUST NOT change the behavior of TS strategies (TS self-parity, 60 OR-17).
- **After the merge.** Each later milestone lands as small PRs from short
  branches off main. The agent applies merged migrations (D50). Native
  dispatch applies only to native artifacts and, from M6, has a kill switch
  (40 §11). TS engine changes follow D49.

### 8.1 Host rules on worker-1 (D36, D47)

| # | Rule |
|---|---|
| H1 | **Checkouts.** The goal session works only in the native clone `/Users/worker-1/Sites/polymarket-bot-native` (short PR branches included), the pinned rules-capture checkout (11 PC7, re-pinned only on purpose) and, for setup only, the conformance checkout (D45). It never edits, builds or runs anything in the fleet copy `/Users/worker-1/Sites/polymarket-bot`. |
| H2 | **Read-only links.** `data/{events,binance,telonex}` and `node_modules` MAY be symlinks into the fleet copy; `node_modules` only while `package-lock.json` equals the fleet copy's, otherwise `npm ci` in the checkout. Nothing is written, moved or deleted through these links; a missing input is handled by 60 MS-5 or reported in STATUS.md. |
| H3 | **Env.** The native clone's `.env` holds only the `DATABASE_*` settings (set selection through `src/db/telonexMarkets.ts` and the mission CLI of H5 read MySQL), `GLOBAL_RUNTIME_TOKEN` when the Global Runtime daemons require auth (docs/global-runtime/cli.md), and R2 settings from M3a (§12.1 item 1), each copied from what worker-1 already holds. No trading keys or API secrets (R10). |
| H4 | **Alongside the fleet.** Builds, tests and parity runs MAY run while the fleet worker (concurrency 6) and Global Runtime sessions run, with parity at `--concurrency 4` and cargo at `-j 4`. |
| H5 | **Benchmark window.** Benchmarks run only 01:00–07:00 local time, never while a live or paper session runs, and only after the pause sequence below (D47). The nightly canary and extras (60 OR-16, LG-5) use the same window; only their benchmark part needs the pause. Before: write the paused items under "Paused" in STATUS.md; pause every Global Runtime run on worker-1 (Mission Control or `npm run mission -- pause <id>`, docs/global-runtime/cli.md; the active session finishes first, nothing is killed) and wait until no session is active; drain the worker-1 fleet worker with the per-host step of docs/backtest/fleet/stop.md, run locally because the ansible inventory lives on the producer: record the exact `run-worker.sh` command line of the `polymarket-backtest-worker` tmux session (`ps`), send it `Ctrl-C` and wait until it has exited (never kill a job); schedule a one-shot resume at 07:00 so a goal run that stops mid-window never leaves them paused. After: recreate that tmux session in the fleet copy with the recorded command line (the start step of `fleet:start`, without its checkout update), `npm run mission -- resume <id>`, clear "Paused". Draining worker-1 also holds the fleet's aggregate queue for that time. The rules capture keeps running (11 PC7). |
| H6 | **Safety.** m1-ivan is not used for engine work. The agent never launches the TS trading bot and never builds or runs the `real-orders` variant (R10, D44). |

## 9. Progress recording and resuming

### 9.1 `native/STATUS.md` format

```markdown
# Native engine — status

## Current state            <!-- rewritten by every step -->
- Host / clone: worker-1 /Users/worker-1/Sites/polymarket-bot-native
- Branch: <name> @ <sha> (green: yes/no); draft PR #<n>
- Spec: native-spec-g1 @ <sha> (+ D entries since: D<n>…)
- Milestone / step: M3b / 4 of 15 — taker delay
- Oracle pin: main@<sha> (synced <date>)
- Binaries: <strategy id> <sha256> (canonical build, <date>) …
- Data roots: symlinks data/{events,binance,telonex} → fleet copy (read-only)
- Rules capture: running since <date>; `--report --days 7` coverage <result> (11 PC9)
- Paused: none | GR runs <ids>, fleet worker (resume scheduled 07:00)
- Last proof: `<command>` → <result>
- Benchmark (fixed set): <markets/s>, idle|non-idle, Δ vs previous milestone
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
  reference to the open question or gate report; independent work continues
  (00 §3.2).

### 9.3 Resume procedure for a new session

1. Follow the reading order in 00-README.md §2 (always-read core plus the
   working set of the current step).
2. `cd /Users/worker-1/Sites/polymarket-bot-native`; confirm the branch head
   matches the recorded sha, or read the log entries after it.
3. If "Paused" is not `none` and no benchmark is about to continue inside
   the window, resume what it lists first (§8.1 H5).
4. Verify green: `(cd native && cargo test --workspace --locked)`,
   `(cd native/strategies && cargo test --locked)`, and the TS checks for
   files touched by the last step (`npm run lint`, `npm run code:typecheck`).
   Confirm the data symlinks resolve; at a milestone start, run the
   rules-capture coverage check (11 PC9).
5. If the tree is not green, or the last step has no log entry, restart that
   step from the last green commit.
6. Continue with "Next action". Never redo a recorded proof unless a sync, a
   new binary sha or a change invalidated it.

### 9.4 Runs

A goal-session run lasts at most 8 hours and then pauses; it never abandons
the goal (D02). The user resumes it, and the new run starts with §9.3. A run
commits small green steps (R12) so the limit loses at most the step in
progress, and it does not start a benchmark window it cannot finish before
its limit.

## 10. Follow-up goals (after this goal)

| # | Goal |
|---|---|
| F1 | **Protocols in Rust.** Promoted into this goal as M11 (D39). Adoption by individual protocols continues after it. |
| F2 | **Telonex trades.** Ingest the Telonex `trades` channel, merge prints into telonex-delta replay as `last_trade_price` and A/B the queue-position model on Telonex. Needs the Telonex renewal (D38). The Telonex-vs-V4 realism report moved into M7 (P13). |
| F3 | **Retention script.** Cleanup policy for `backtest_run_markets` of unpromoted runs, R2 traces and ledgers, and old binaries; live journals kept long-term in a private bucket (D15). |
| F4 | **TS retirement review.** About three months after gate 3 (D49): which TS engine parts remain (Recorder V4 depends on `src/market` and the feed clients), and how historical TS evidence is re-baselined against realistic results (D04). |
| F5 | **Universe expansion.** Other symbols and timeframes with their own rules, feeds and Chainlink coverage, flagged unvalidated until calibrated. |
| F6 | **Larger calibration.** Extend the validity envelope beyond ~10-share orders once the user raises capital (51 §14). |
| F7 | **V4-only feeds for strategies** (D43): Binance bookTicker, Chainlink TWAP and the opening-TWAP price to beat on recorder-v4, journal and live; revisit after calibration, starting with the opening-TWAP price to beat. |

## 11. Risks

| Risk | Mitigation |
|---|---|
| A session limit or the 8-hour run limit leaves a broken tree (happened at `fef5f199`) | R12 green steps; STATUS.md per step; §9.4 |
| Engine work disturbs the fleet worker or GR sessions on worker-1 | Separate clone, read-only links, capped parity and build parallelism, benchmarks only in the window with a scheduled resume (§8.1) |
| The user changes a lead decision after the delegated gate 1 | New D entry; only dependent steps are redone (00 §3.2); M1 depends on few lead decisions |
| ts-compat grows into a port of TS structure | R4; ts-compat limited to model traits and a flag list |
| Correlated errors (one agent writes code, tests and classifications) | Conformance tests by Fable without engine-source access (D45, 60 §10); user confirms money-semantics classifications at G2 |
| Non-reproducible oracle (unseeded jitter, env knobs, wall-clock rules) | Jitter 0, pinned ModelConfig and environment for TS runs (60 §2.3) |
| Parity evidence from a binary that does not ship | Only canonical builds count; the sha is recorded with every proof (§6) |
| Optimizations change results | S6; parity matrix and thread-count determinism tests after every optimization |
| No BTC 5m Telonex data (subscription expired) | Gate 2 on 15m; 5m proven on V4 in M7; E5 cells after renewal (D38) |
| Pre-start rules lost for markets before capture starts | Capture PR is M1 step 0 (D37); older markets use RC3 backfill or `partial`/`fallback` rules (11 §13) |
| The user expects a fleet-wide speedup before protocols use Rust | §1.1; M11 right after M6 (D39) |
| Telonex has no trade prints, so the queue model is weaker there | V4 evaluation and P13 in M7; F2 |
| Small calibration sample | Validity envelope and confidence intervals (51) |
| Heterogeneous fleet cores and 16 GB memory | Per-machine measured thread counts and memory budget (S3, 16 §6.2, §10) |

## 12. Gate-4 questions and resolved gate-1 questions

### 12.1 Gate-4 questions (deferred by the lead, D56; asked at the start of goal 2, D70)

Asked at G4 at the latest; none blocks work before M9. Interim rules apply
until answered.

Owning documents keep the details and recommendations in their own
"Gate-4 questions" sections (q = question number there).

1. **R2 buckets and tokens** (22 q1, 31 q2, 42 q1): separate scoped tokens
   for native binaries, ledgers and live journals? Interim: native binaries
   and ledgers are uploaded only from worker-1, with the R2 write credential
   worker-1 already holds (copied into the native clone's `.env` at M3a,
   §8.1 H3). If it holds none, the M3a full publish waits under "Waiting on
   user" and ledgers stage locally (42 §7.5.3). No sandbox holds one; live
   journals stay local.
2. **Agent-run paper sessions with an empty-wallet API key** for the Chainlink
   feed (50 q1, 20 q1). Interim: option (a) of 50 §8.1, M8 above.
3. **Calibration and live host** (50 q2, 51 q1, 12 q1, 16 q1), whether one
   cloud host is provided for the M9 network report, and how byte
   reproducibility on that host is ensured (31 q1).
4. **Wallet type** for real orders (50 q3). Recommended: a new dedicated EOA.
5. **Alert channel** (50 q4, D33). Recommended: ntfy with a private topic.
6. **Auto-restart in real mode** (50 q5). Recommended: up to 3 per hour,
   each with reconciliation and an alert.
7. **Calibration threshold additions** (51 q2, 14 q1): feed-leg p99,
   seconds-scale components on the ±20% rule only, C9/C10, a separate
   Telonex verdict. The Telonex verdict needs a Telonex renewal active until
   at least 3 days after the last calibration day (D38); without it the
   telonex-delta rows are INSUFFICIENT and telonex-delta keeps its default
   unless the user decides otherwise.
8. **Maker budget extension** (51 q3) if C5 ends borderline.
9. **Calibration days** and the user's availability (51 q4), decided together
   with the Telonex renewal of item 7.

### 12.2 Gate-1 questions of the draft (resolved)

References to "01 Open question N" in other documents resolve here.

| Old # | Topic | Resolution |
|---|---|---|
| 1 | Plugin scope | D19 (amended) |
| 2 | Faster-running build for fleet binaries | D18 (amended) |
| 3 | Faster data format / re-conversion | D46 (never re-convert; derived tape) |
| 4 | lagsnipe.v15 source | D40 |
| 5 | BTC 5m data for parity | D38 |
| 6 | When the fleet gets faster | D39 (M11) |
| 7 | Fleet membership | D55 |
| 8, 9 | TS freeze point, sunset date | D49 |
| 10 | Agent-run paper mode and Chainlink | interim option (a); empty-wallet key is gate-4 question 2 |
| 11 | Production migrations after G2 | D50 |

## Open questions

None. Gate-4 questions are in §12.1; questions still open in other documents
block only the steps that depend on them (00 §3.2).
