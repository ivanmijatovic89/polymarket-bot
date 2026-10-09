# 00 — Native engine spec: README

This directory is the normative specification of the native (Rust) trading
engine: one deterministic core shared by backtest and live, built for maximum
backtest throughput and minimum live latency. This README is the entry point.
It holds the index, the reading order for a fresh implementation session, how
the spec relates to the decision log and the progress files, the anti-drift
rules every session MUST follow, and the glossary. Normative keywords (MUST,
SHOULD, MAY) follow RFC 2119.

**Spec status:** FROZEN at gate 1, which the user delegated to the lead
(2026-10-09, [02-decisions.md](02-decisions.md) D56). The frozen revision is
committed on `rust-engine` and tagged `native-spec-g1` (§3.4). From then on
the spec changes only through 02-decisions.md (§3.2); the user's review of
[03-overview-for-user.md](03-overview-for-user.md) may still change
decisions.

## 1. Index

| File | Owns |
|---|---|
| `00-README.md` | Entry point, reading order, document relations, anti-drift rules, glossary |
| `01-scope-milestones.md` | Objective, speed mandate, Rust/TS ownership boundary (backtest and live), v1 universe and native strategies, out-of-scope, milestones M0–M11 (with M3a–M3c, M5a–M5b) and their proofs, user gates G1–G4, branch/merge/oracle policy, host rules on worker-1, STATUS.md protocol and 8-hour runs, follow-up goals, gate-4 questions |
| `02-decisions.md` | Decision log D01+ (options, answer, who decided, rationale), incl. the gate-1 record (D56) |
| `03-overview-for-user.md` | Plain-language summary for the owner; non-normative, not read by sessions |
| `10-domain-model.md` | Fixed-point types and rounding, output quantization, outcome/asset indexing, ids, clock model, determinism rules |
| `11-exchange-rules.md` | `ExchangeRules` fields, sources (snapshot, V4 rawJson, dated fallback), the pre-start rules capture script (D37), fee eras, taker delay, GTD, tick/min size, per-rule verification status |
| `12-engine-core.md` | Serial event loop, intents and validation, order state machine, settlement statuses, capital reservation, portfolio and PnL, cascades, window gate, fault semantics |
| `13-execution-models.md` | `Execution` trait (simulator, paper, CLOB V2), ts-compat flag list, realistic fixes with A/B requirement, Fill/Latency/Fee/Report models, scheduler, async split/merge, own-order removal |
| `14-feeds-and-plugins.md` | Binance aggTrades, Chainlink two-clock, price-to-beat, synthetic feed ticks, the feed view (replaces the TS ExternalFeeds plugin), plugins (TimeWindowVolatility, TechnicalIndicators, DwellGate, TimeWindowGate) |
| `15-inputs.md` | telonex-delta reader, Recorder V4 reader, live journal reader, data-anomaly policy |
| `16-performance-and-parallelism.md` | Throughput and latency design rules, executor and threading model, shared caches, Parquet decode, P-core/E-core handling, build profile, benchmark methodology |
| `20-binary-protocol.md` | Subcommands, `describe` capabilities, exit codes, executor I/O, env allowlist, secrets channel |
| `21-job-and-output-contract.md` | `MarketJobData` incl. `ModelConfig` and rules snapshot, `RunSingleMarketOutput`/`MarketStats`, skip taxonomy, schemas |
| `22-trace-ledger-journal.md` | Canonical parity trace, fill ledger, simulator trace, live journal |
| `30-strategy-sdk.md` | `pmb-sdk` surface, params derive, testkit, determinism lints |
| `31-artifacts-build-publish.md` | Crate layout, reproducible builds, publish, trust gate for live |
| `40-fleet-integration.md` | Native queue and version gate, worker shim, executor supervision, isolation, kill switch, cross-machine determinism, runbooks |
| `41-candidate-groups.md` | `--candidates`, shared replay, storage, failure isolation, equivalence proof |
| `42-persistence-and-stats.md` | DB migrations, run provenance, rules snapshot table, TS-owned stats, dashboard changes |
| `50-live-runtime.md` | Live ownership split, discovery/rotation, WS, CLOB V2, risk guards, real-order gate, alerts, service |
| `51-calibration-plan.md` | Rules probes, budget, journal/V4 join, decontamination, metrics and thresholds, validity envelope |
| `60-verification.md` | PARITY.md rules, TS oracle pin, exerciser, parity sets, invariant/property tests, CI, canary |
| `research/` | Evidence only (audits, requirement sweeps). Non-normative. |

Living files outside `spec/` (created and maintained by the implementation
sessions):

| File | Role |
|---|---|
| `native/STATUS.md` | Progress journal and the "Current state" block a new session resumes from (format: 01 §9) |
| `native/PARITY.md` | Classification ledger for every ts-compat mismatch (rules: 60-verification.md) |
| `native/reports/` | A/B reports, benchmark reports, gate reports, calibration reports (file names defined by the owning spec document) |
| `native/parity/` (`sets/`, `cells/`, `engine-paths.txt`, `oracle-allowlist.txt`) | Committed parity inputs (60 §2.2, §4) |
| `native/fixtures/` | Committed fixture markets and TS-generated goldens (60 §7, §12) |
| `native/bench/sets/` | Frozen benchmark set manifests (16 §13.1) |

Superseded files (historical only; they stay on the frozen `rust-engine`
branch and are not carried to the implementation branch, which starts from
main where `native/` does not exist):

| Old file | Replaced by |
|---|---|
| `native/GOAL.md` | `01-scope-milestones.md` |
| `native/TRACE.md` | `22-trace-ledger-journal.md` (note: its 1e-6 tolerance is superseded by R5 below) |
| `native/EXERCISER.md` | `60-verification.md` |
| `native/BINARY-PROTOCOL.md` | `20-binary-protocol.md` |

## 2. Reading order for a fresh implementation session

A session MUST be able to resume any milestone from this directory plus
`native/STATUS.md` alone, with no memory of earlier sessions. The full spec is
about 1.1 MB; reading all of it on every resume wastes context and invites
summarizing drift. A session therefore reads a small **always-read core** and
the **working set** of its current step, and follows section references from
there when it needs them.

Always-read core (every session, every resume):

1. This README: §3 (relations), §4 (rules R1–R15); the glossary §5 as needed.
2. `01-scope-milestones.md` in full.
3. `02-decisions.md` in full. Decisions marked "user" are binding; the others
   are binding unless the user changes them (D56).
4. `native/STATUS.md` "Current state" block, then the current milestone's plan.
5. Resume paused services and verify the tree is green before changing
   anything (01 §9.3).

`03-overview-for-user.md` is for the owner and is not part of the core.

Then the working set of the current step (table below). Before writing engine
code for the first time in a session, also read 10 §1–§3 and 12 §2. A whole
document is read when the step changes a topic that document owns beyond the
listed sections, or when a listed section points to another one the step needs.
`research/` is read only to look up evidence cited by a spec document.

| Step | Working set (document §sections) |
|---|---|
| M0 Spec freeze | Everything |
| M1.0 Rules capture PR (D37) | 01 §6 M1 step 0, §8.1; 11 §13.1, §13.2 (incl. §13.2.1) |
| M1.1 Bootstrap | 01 §6 M1 (salvage table, data access), §8, §8.1, §9; 31 §2–§3; 60 §10.0–§10.1, §14, §16 |
| M1.2 Contract, inputs, books, feeds | 21 §3, §5–§7, §9; 15 §2–§4, §8; 14 §2–§6, §8, §10–§11, §14; 10 §2–§6; 12 §3–§4; 16 §6–§8; 60 §7 |
| M1.3 Core | 10 §7–§12; 12 §5–§14; 14 §12; 16 §9.4; 21 §11, §13, §15–§18; 60 §7.3, §8 |
| M1.4 Execution | 13 §2–§5, §10–§11; 11 §3–§4, §12; 12 §7 |
| M1.5 Binary, SDK, builder, Rust test strategies | 20 §1–§5, §8; 30 §1–§18; 31 §4–§5, §7.1–§7.2, §7.5; 22 §2–§3; 60 §5, §12 |
| M1.6 TS side, T15 cells | 21 §2–§4, §9–§12, §19; 22 §3; 60 §2, §4, §5.8, §14.1; 14 §13 |
| M1.7 Benchmark baseline | 16 §7.5, §13–§14; 01 §8.1 H5 |
| M2 ts-compat parity | 60 §2–§6, §15; 22 §3.4; 13 §5; 30 §9, §14 |
| M3a Native backtest path, persistence | 42 §2–§5, §7; 31 §6–§8; 21 §4, §6, §11–§14; 11 §5.3, §13, §14.1; 40 §16; 41 §4 (step 9) |
| M5a Executor and hot path | 16 §2–§13, §15; 20 §6; 31 §4.2, §4.5–§4.6; 40 §7 |
| M3b Realistic profile | 13 §6–§7; 11 (whole); 12 §9.3; 60 §5.9, §8, §11 |
| M3c Market Simulator | 22 §5; 12 §12 |
| M4 Candidate groups | 41 (whole); 42 §3.2; 21 §8; 20 §5.5; 16 §9; 60 §9 |
| M5b Final benchmark | 16 §9, §13–§15; 41 §10 |
| M6 Fleet | 40 (whole); 31 §6–§10; 42 §6; 20 §6; 16 §13.9; 60 §14 (LG-4) |
| M11 Protocols in Rust | 31 §2.2, §7.3, §9, §11; 30 §17; 41 §3; 16 §9.4 |
| M7 Recorder V4 input | 15 §5–§6, §10; 14 §7; 13 §6.5; 22 §6.2; 51 §3 (P13), §12.4 |
| M8 Paper mode | 50 §1–§7, §8.1, §9–§15, §18; 22 §6; 15 §7; 16 §12 |
| M9 CLOB V2 adapter (goal 2, D70) | 50 §8.2–§8.3, §16–§17; 11 §10; 20 §7; 60 §13; 51 §3, §11.3 |
| M10 Calibration (goal 2, D70) | 51 (whole); 13 §6.13–§6.14; 22 §6.8; 15 §6 |

## 3. How the documents relate

### 3.1 Precedence

When two sources disagree, the higher one wins and the lower one is fixed:

1. The user's explicit instructions, decisions marked "user" in
   `02-decisions.md`, and the project direction recorded in 01 §1.
2. The other entries of `02-decisions.md`.
3. Spec documents `01`–`60` (each owns the topics listed in §1; others
   reference it instead of restating it).
4. `research/` (evidence, never instructions).
5. Superseded files (§1).

- When a level-1 statement and a level-2 decision clearly conflict, level 1
  wins; the session proposes an amendment of the 02 entry at the next gate
  (precedent: D19 was amended at G1 because the direction lists all four
  plugins). When it is unclear whether they conflict, the session does not
  choose: it records the question under "Waiting on user" in STATUS.md and
  asks at the next gate or directly.
- When a non-owner document restates a topic and differs from its owner (§1),
  the owner wins and the non-owner is corrected. Non-owners SHOULD reference
  the owner instead of restating it.

### 3.2 Change control after gate 1

- A change that alters behavior, scope, a gate, safety, the parity tolerance or
  a user decision MUST be recorded as a new `02-decisions.md` entry (next
  D-number, date, options, answer, approver) before the spec text changes.
  Changes to user decisions, scope, gates, safety and tolerance need the user.
- Clarifications that change no behavior (typos, evidence fixes, missing
  cross-references) MAY be edited directly, with a one-line note in STATUS.md.
- An unresolved decision blocks only the steps that depend on it. The session
  continues with independent steps and raises the question at the next gate or
  directly to the user. It MUST NOT improvise an answer.
- When the user changes a decision after the delegated gate 1 (D56), the
  change is recorded the same way, and only the steps and proofs that depend
  on it are redone.

### 3.3 STATUS, PARITY, reports

- `STATUS.md` records what was done and proven; it is never normative. A proof
  is recorded only after its command was actually run, with the exact command
  and result.
- `PARITY.md` records every ts-compat mismatch and its class (R6). It is the
  evidence for gate 2 and stays alive afterwards as the regression ledger.
- `native/reports/` holds evidence documents referenced from STATUS.md and
  gate reports.

### 3.4 Spec revision, freeze, numbering and names

- **Revision.** The frozen `native/spec/` is committed on `rust-engine` (spec
  files only), tagged `native-spec-g1`, and the tag is pushed to origin so
  worker-1 can fetch it. D56 and 03 are the gate-1 record. M1 step 1 copies
  `native/spec` onto the implementation branch from that tag (01 §6 M1).
  STATUS.md and the PARITY.md header record the tag and its sha.
- **Milestone numbers** are owned by 01 §6. "M3" without a suffix means M3b
  for realistic topics and M3a for persistence and rules-snapshot topics; "M5"
  without a suffix means M5a and M5b. M11 runs right after M6.
- **Stale references** missed by the gate-1 consolidation (01 §6 M0 table)
  are read as follows and fixed as clarifications (§3.2):
  - "M7 identity proof" or "M7 determinism proof" for journal replay means M8.
  - Written before D36: m1-ivan, "this machine", "this MacBook" or "this M1
    Pro" as the host of implementation, builds, parity, benchmarks, tapes or
    agent-run paper sessions means worker-1 (M4, 4P+6E, 16 GB). m1-ivan stays
    today's live-trading Mac and the producer; the calibration and live host
    is a gate-4 question (01 §12.1).
  - "01 Open question N" resolves through 01 §12.2. An open question of
    another document that 02 D56 lists as answered is closed by that entry.
  - "Follow-up F1" means M11 (D39). BTC 5m cells "waiting for 01 Open
    question 5" wait for a Telonex renewal (D38).
- **File names** are exactly those of §1. A reference to the short name
  `16-performance` means `16-performance-and-parallelism.md`. The M0 proof
  includes a link check that every `NN-*.md` reference resolves (01 §6 M0).
- **Commands** in a proof are owned by the document that defines the command
  (20 binary subcommands, 31 build and publish, 60 parity tooling, 41 group
  CLI). Where 01 differs from the owner, the owner wins and 01 is corrected.

## 4. Anti-drift rules

These rules apply to every session, every milestone, every line of code. They
are cited as R1–R15 from other documents.

| # | Rule |
|---|---|
| R1 | **Idiomatic Rust. Never emulate JavaScript/Node semantics**: no emulation of JS `Number`, JSON number formatting, `Math.round`/`Math.random`, `Date`, RegExp, `structuredClone`, Promise or microtask ordering, object-identity maps. The abandoned Codex attempt drifted exactly here (research/early-audits.md:55). |
| R2 | Money, prices and sizes are fixed-point integers at 1e6 base units (10-domain-model.md). `f64` is allowed only for external feed values and analytics (plugin math), never for ledger state. No bit-exact float chasing. |
| R3 | **TS is a test oracle, never a design template**, and only where it is believed correct: replay ordering and book semantics, Telonex row decode, feed visibility clocks and synthetic-tick rules, breadth-first cascade ordering, capital reservation rules, tick-scoped plugin snapshot, plugin math, the stats contract and skip semantics (research/approach-audit.json, judge "correctness", roleOfTsEngine). TS is **not** an oracle for execution realism, fees, exchange rules or live. |
| R4 | The ts-compat profile is a configuration of model trait implementations (Fill, Latency, Fee, Report) plus the flag list in 13-execution-models.md. It MUST NOT copy TS structure (OrderManager/Portfolio layout, pending-capital overlay, two ledgers). TS accounting quirks that do not change decisions are classified in PARITY.md, not reproduced. |
| R5 | **Parity tolerance (ts-compat):** identical order/fill/cancel sequence, sides, prices and sizes; USDC and PnL within 1e-4 per market; final stats compared at the persisted precision. |
| R6 | Every parity mismatch is classified in PARITY.md as *TS bug* (keep Rust, document), *Rust bug* (fix; never left open at a gate) or *intended model change*. Zero unclassified mismatches at gate 2. A classification that changes money semantics is confirmed by the user at gate 2. |
| R7 | **Determinism:** the same binary, job and seed give byte-identical output on every fleet Mac, at every thread count, in every scheduling order, inside or outside a candidate group. Per-market seeds derive only from (run seed, slug). The binary never reads env for behavior, never reads the wall clock inside the engine, and does no network I/O in backtest. Decision paths use ordered collections (10-domain-model.md). |
| R8 | **Speed is the top design priority**, inside R7 and the gates: design for throughput and latency from M1; do not copy TS's process model, data layout or algorithms because they exist in TS; parallelize across independent units (markets, candidates, I/O), never inside one market's decision loop; every optimization is measured before/after and MUST keep parity traces byte-identical (16-performance-and-parallelism.md, 01 §2). Benchmark and parity evidence counts only for binaries from the canonical build (31 §4, 01 §6). |
| R9 | The realistic profile follows the current Polymarket rules (docs). Where docs and charged amounts disagree, charged amounts win (D22). |
| R10 | **Safety:** the agent never places real orders, never loads trading keys or API secrets, never builds or runs the `real-orders` variant, and never launches the TS trading bot (m1-ivan has `DRY_RUN=false` in its env files). Real-order mode is a separate feature build plus a CLI flag, never env; `standard` builds cannot send orders (D05, D44, 50-live-runtime.md). |
| R11 | No scope change without the user. Anything that needs the user goes to STATUS.md "Waiting on user" or a gate report, and an answer becomes a 02 entry (§3.2). |
| R12 | **Green steps:** every commit on the implementation branch compiles, passes `cargo test`, clippy and fmt, and passes the TS checks it touches. STATUS.md is updated in the same commit. Non-compiling WIP commits are forbidden (the WIP commit fef5f199 is the counterexample). Commit in small steps so a session limit never loses more than one step. |
| R13 | **Branch and host policy:** all engine work runs on worker-1 in the native clone, never in the fleet copy and never on m1-ivan (D36, 01 §8.1). Until gate 2 all work stays on the implementation branch `native-engine` (draft PR, never merged before G2, D48); main is untouched except the rules-capture PR (D37; merging main into the branch is allowed); no fleet branch switch; no native job on the shared fleet Redis; no native run is persisted to any database before M3a (01 §8). |
| R14 | **Fail loud:** unknown params, fields, modes or flag combinations are errors; every fallback is explicit and recorded in the output (e.g. `rulesSource=fallback`). No silent substitution. |
| R15 | English only in code, comments, docs, commits and PRs. |

## 5. Glossary

| Term | Meaning |
|---|---|
| A/B report | Same markets run under two ModelConfigs that differ in exactly one realistic fix; required per fix (13, 60). |
| Account event | Engine → strategy lifecycle notification: `order_submitted`, `order_accepted`, `order_rejected`, `order_open`, `order_done`, `fill`, `cancel_failed`, `positions_split`, `split_failed`, `positions_merged`, `merge_failed` and settlement updates; realistic, paper and live add `order_delayed` and `cancel_acked` (10 §10.1; delivery order 12 §6). |
| Artifact (native) | One `aarch64-apple-darwin` binary = engine + one strategy; identity = sha256 of its bytes (31). |
| Calibration | User-launched ~$100 live run whose journal is compared with backtests of the same markets recorded by Recorder V4 (51, D34, D35). |
| Candidate | One parameter set (or ModelConfig variant) inside a group; stored as its own `backtest_runs` row (41, D13). |
| Candidate group / shared replay | N candidates evaluated over one decoded copy of a market's inputs; only immutable data is shared (41). |
| Canonical build | The only build whose binary ships or counts as parity, benchmark or gate evidence: `--profile artifact` (the fastest-running reproducible profile, D18) through the builder of 31 §4 with its post-link gates. `strategy:publish -- --local-only` writes it to the local cache only (31 §7.5). The `iterate` profile serves local checks only. |
| Cascade | Account events produced while handling a callback, delivered breadth-first FIFO within the same tick; each may return intents (12). |
| Cell (parity) | One row of the parity matrix (strategy, market set, ModelConfig, trace level, profile), committed as `native/parity/cells/<cell>.json` (60 §4). |
| Charged amounts | Fees actually charged (on-chain fills or Data API `usdc_size`); they win over docs (D22). |
| CLOB V2 | Polymarket exchange version since 2026-04-28 (new order struct, EIP-712 domain v2, pUSD collateral). TS live is broken on it (issue #249, docs/live-trading/live-trading-bot.md:11). |
| Data roots | Where dataset files live. In the native clone `data/{events,binance,telonex}` are read-only symlinks into the fleet copy on worker-1; tools take `--data-root`, default `<repository root>/data` (01 §6 M1, §8.1). |
| Decontamination | Removing our own orders and fills from recorded books before calibration replays (D24, 13, 51). |
| Engine exerciser / feed exerciser | Deterministic test strategies with TS and Rust twins: the first drives every intent and order type, the second every feed, plugin and synthetic-tick rule (60 §5). |
| Exchange time / receive time | Timestamp assigned by Polymarket vs local receipt time; which one drives `ctx.now` per input mode is defined in 10 (D27). |
| ExchangeRules | Rules in force for one market: tick, min size, price bounds, feeSchedule, taker delay, GTD lead and early expiry, batch cap, negRisk, exchange version (11, D21). |
| Execution adapter | Implementation of the `Execution` trait: simulator (backtest), paper (live inputs + simulator), CLOB V2 (real orders). With the input source, the only part that differs between backtest and live (13). |
| Executor | Long-lived native process that runs many market jobs concurrently on a work-stealing thread pool; replaces one process per market (16, 20, 40). |
| Fleet copy / native clone | On worker-1: the fleet's working copy `/Users/worker-1/Sites/polymarket-bot` (never touched by the goal session) and the goal session's separate clone `/Users/worker-1/Sites/polymarket-bot-native` (D36). |
| Fill / Latency / Fee / Report model | Pluggable simulator traits: who fills and how much; when actions reach the exchange; fee per fill; when statuses (MATCHED, MINED, FAILED) are reported (13). |
| Fixed-point | Integer at 1e6 base units for prices, sizes and USDC (10). |
| Gate (G1–G4) | User approval point: spec freeze (G1 delegated to the lead, D56), ts-compat parity, realistic as default, first real order (01 §7). |
| Input mode | Source of market events: `telonex-delta`, `recorder-v4`, live journal (v1 native set; 15). |
| Intent | Strategy → engine request: `place_limit`, `place_batch` (≤15), `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all`, `split_positions`, `merge_positions` (12). |
| Journal | Replayable record of every live input envelope plus an execution sidecar, in the extended Recorder V4 envelope (D26, 22). |
| Fill ledger | Opt-in per-market order and fill record, gzipped JSONL in R2 (D11, 22). Not the engine's internal cash/position ledger. |
| `MarketJobData` / `RunSingleMarketOutput` / `MarketStats` | The TS↔Rust seam: job in, per-market result out, exactly the shapes TS consumes today (21). |
| Market job | One market (optionally × candidates) dispatched to a worker; produces one result per candidate. |
| ModelConfig | Versioned, producer-resolved settings that change results (latencies, jitter, seed, gap thresholds, PTB latency, rules version, fill model, per-market starting capital, profile). Carried in the job, stored on the run (D09, 21). |
| Oracle pin | The TS engine commit that produced the reference traces of a parity cycle (01 §8, 60). |
| P-core / E-core | Apple performance vs efficiency cores. M4 Mac mini (worker-1, worker-2): 4P+6E; M1 Pro (m1-ivan): 8P+2E (dashboard/src/data/machines.json). |
| Paper mode | Live inputs, realistic simulator fills, no orders sent (D28). |
| Parity trace | Canonical JSONL of ticks, intents, account events and final stats for one market, written by both engines and diffed (22). |
| PARITY.md | Ledger of classified ts-compat mismatches (60). |
| Profile | Named execution configuration: `ts-compat` (reproduces TS execution to prove the port; default until G3) or `realistic` (current Polymarket rules, calibrated against live). |
| PTB | Price to beat: the strike of an up/down market (14). |
| Rules capture | The pre-start Gamma/CLOB rules capture on worker-1, merged early to main (D37, 11 §13.2.1); its files are imported in M3a. |
| Rules snapshot / `rulesSource` | Per-condition captured rules; `rulesSource` is `snapshot` (every required field captured before the start), `partial` or `fallback` (nothing captured; dated table) (D21, 11 RS4). |
| Seed | Per-market RNG seed derived only from (run seed, slug) (10). |
| Session guards | Live risk limits that survive market rotation: session loss, wallet exposure, order rate, kill switch (D31, 50). |
| `src/native/` | TS module that builds `EngineJob`s, resolves `ModelConfig`, validates `EngineResult`s and maps them to `RunSingleMarketOutput`; shared by the parity harness, `--sequential` and the worker shim (01 §3.1). |
| Spec tag | `native-spec-g1`, the approved spec revision (§3.4). |
| Synthetic feed tick | Opt-in extra `onMarketTick` on a Binance aggTrade or Chainlink round with an unchanged book; never drives the simulator (14). |
| Taker delay | Exchange hold of marketable crypto up/down orders, dated by exchange arrival time: 50 ms from 2026-08-17 11:00 UTC, 150 ms from 2026-09-04 14:00 UTC; earlier rows are third-party reports, used but flagged and not gate-3 evidence (11 §6.2, D52). |
| Tape (derived) | Engine-owned lossless re-encoding of a telonex-delta file for fast reads; the original is never changed (16 §7.5, D46). |
| Tick interest filter | Opt-in SDK declaration that skips `on_tick` calls that cannot matter; new Rust strategies only (16 §9.4, D41). |
| TraceSink | Engine observer interface for traces and the future simulator view; no-op by default (22). |
| Two-clock (Chainlink) | Visibility keyed on broadcast time plus a measured bot leg, while the emitted timestamp stays the round time (14). |
| Validity envelope | Conditions under which a calibration result applies (size range, symbol, host, dates) (51). |
| Visibility clock | Replay time at which an external feed value becomes visible to the strategy (14). |
| Window gate | Rule deciding which ticks invoke the strategy relative to the market window, and what happens to resting orders at the window end (12, D23). |
| Worker shim | TS process on each fleet Mac that consumes native BullMQ jobs, feeds the executor and stamps execution metadata (40). |

## Open questions

None. Gate-4 questions are listed in 01 §12.1; questions still open in other
documents block only the steps that depend on them (§3.2).
