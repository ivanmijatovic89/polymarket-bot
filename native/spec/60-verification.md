# 60 — Verification

This document defines how the native engine is proven correct and how that
proof reaches the user. It owns: the layered verification plan, the TS oracle
(scope, pin, reproducible runs, tracking of main changes), the rules of
`native/PARITY.md`, the parity matrix and its market sets, the engine
exerciser (it replaces `native/EXERCISER.md`), the lagsnipe.v15 parity set,
golden fixtures generated from TS, invariant, property and fuzz tests, the
determinism suite, independent spec-conformance tests, the rules for realistic
A/B reports, committed fixture markets, the live verification suite, CI and
local gates, and the gate evidence format. Formats and semantics it tests are
owned elsewhere and only referenced: trace records and diff rules
([22](22-trace-ledger-journal.md) §3), job and output contract
([21](21-job-and-output-contract.md)), domain and determinism rules
([10](10-domain-model.md), [12](12-engine-core.md) §13), execution models,
the ts-compat flag list (TC rules) and the realistic fix list (RF ids)
([13](13-execution-models.md)), benchmark method
([16](16-performance-and-parallelism.md) §13). Normative keywords follow
RFC 2119. Paths are relative to the repository root.

## 1. Verification layers

| # | Layer | Proves | Authority | First milestone | Gate |
|---|---|---|---|---|---|
| L1 | Leaf goldens (§7) | Leaf semantics equal TS where TS is the oracle | Real TS code at the oracle pin | M1 | G2 |
| L2 | Converted TS suites (§7.3) | Ordering, capital, cancel-resolution scenarios | TS tests at the pin | M1 | G2 |
| L3 | Spec conformance (§10) | Rules are implemented as specified and published | Spec + Polymarket docs, independent author (Fable, D45) | Workstream C right after G1 (§10.0); executable from M1 step 5; G3 scope from M3b, G4 scope from M9 | G2, G3, G4 |
| L4 | Invariants, properties, fuzz (§8) | Internal consistency | Arithmetic identities | M1 | every gate |
| L5 | Determinism (§9) | Same input and seed → same bytes everywhere | R7 | M1 | every gate |
| L6 | Exerciser trace parity (§4, §5) | The port of the mechanics | TS at the pin, plus classified patches (§3.4) | M1 step 6 (T15), M2 | G2 |
| L7 | lagsnipe.v15 trace parity (§6) | A real strategy decides identically | TS artifact at the pin | M2 | G2 |
| L8 | Contract tests ([21](21-job-and-output-contract.md) §3, §19) | TS receives exactly today's shapes | Generated schemas | M1 | G2 |
| L9 | Group and extend equivalence (§9, [41](41-candidate-groups.md) §10) | Candidate groups change nothing | Standalone runs | M4 | — |
| L10 | Realistic A/B reports and approved snapshots (§8.4, §11) | Each realistic fix has an explained effect | Spec | M3b | G3 |
| L11 | Journal replay identity, adapter fixtures, fault injection (§13) | One core; live adapter safety | Journals, mock exchange | M8, M9 | G4 |
| L12 | Calibration ([51](51-calibration-plan.md)), with conformance tests of its analysis harness (§10.2 G4 row) | Realistic predicts live | Live journal + Recorder V4 | M9 (harness), M10 | G3 |

Chain of evidence for live/backtest agreement (01 §1 item 5): L6 and L7 prove
the port reproduces today's mechanics; L3 and L10 prove realistic follows the
published rules; L11 proves live and backtest run one core that decides
identically on identical inputs; L12 proves the realistic execution model
matches what live actually filled and paid. A gap in any link is reported at
the next gate.

Principles:

- **VP-1** No layer substitutes another. Each gate report lists the result of
  every layer the gate requires (§15).
- **VP-2** All evidence is reproducible: every run writes a manifest with the
  exact command, oracle pin, engine commit, binary sha256, `modelConfigSha256`,
  market-set sha256 and input file identities. Numbers in reports are
  rendered from manifests, never typed by hand (§15.2).
- **VP-3** Gate runs use the fixed diff rules of 22 §3.4. A tolerance override
  marks a run non-gating.
- **VP-4** Verification is cheap enough to run after every change: TS traces
  are cached per oracle tree (OR-12), so Rust-only re-runs cost only Rust
  time. Every optimization commit passes PS-50 (§4.5, 16 §13.8); structural
  changes (decode, scheduler, caches, book layout, threading, tape) re-run the
  whole matrix Rust-only before they land (R8, 01 §2 S6).
- **VP-5** Speed never changes results: an optimization that changes one byte
  of a parity trace or a `resultDigest` is a Rust bug.
- **VP-6** Separation of duties against correlated errors (01 §11): the
  implementation session never edits conformance tests (§10.1), and no
  money-semantics classification is final without an independent review and
  the user's confirmation (CL-10).
- **VP-7** Evidence comes from the binary that ships. Parity, benchmark and
  gate evidence use the canonical `artifact` binary (01 §6, 31 §4) of the
  `standard` variant (D44). Invariant checks need debug assertions, which
  `artifact` does not have, so they run in a second canonical binary,
  `parity-check` (§8.1). Both binaries MUST give identical deterministic
  output and trace bytes.
- **VP-8** Host. Local verification (parity, goldens, fixtures, LG-1–LG-3,
  LG-5) runs on worker-1 in the native clone (D36, 01 §8.1), alongside the
  fleet worker and Global Runtime sessions at the capped parallelism of
  01 §8.1 H4; benchmarks and nightly jobs only in the window of H5 (D47).
  LG-4 runs on the M6 native hosts, CI on GitHub. Concurrency never changes
  results (R7).

## 2. The TS oracle

### 2.1 Scope

TS is a test oracle only for the areas of R3 (00-README.md): replay ordering
and book semantics, Telonex row decode, feed visibility clocks and
synthetic-tick rules, breadth-first cascade ordering, capital reservation
rules, the tick-scoped plugin snapshot, plugin math, the stats contract and
skip semantics ([12](12-engine-core.md) §15 lists the evidence). TS is **not**
an oracle for execution realism, fees and exchange rules beyond the fixed
ts-compat values ([11](11-exchange-rules.md) §4), live behavior, or accounting
quirks; those are verified by L3, L4, L10–L12, and TS differences there are
classified (§3), never copied into realistic.

### 2.2 Pin and oracle tree

- **OR-1** The oracle pin is the `origin/main` commit last merged into the
  implementation branch (01 §8). It is recorded in STATUS.md, in the
  PARITY.md header, in every parity manifest, in every golden header and in
  every gate report. Evidence is valid only for its pin.
- **OR-2** `native/parity/engine-paths.txt` is the single list of TS paths
  whose changes can alter engine semantics: `src/trading`, `src/strategy`,
  `src/market`, `src/backtest`, `src/parquet` (01 §8), plus
  `src/polymarket/upDownSlugWindow.ts` and `src/polymarket/gammaMarketMeta.ts`
  (window and token map). A second section lists input-format paths
  (`src/telonex/` converters); a change there triggers the format-version check
  of [15](15-inputs.md) §4.1 in addition to a matrix re-run. The sync report
  (OR-11), the trace cache key (OR-12) and the CI rule (OR-14) all read this
  file.
- **OR-3** Oracle tree = the TS sources at the branch head. A gating run
  requires that `git diff --name-only <pin> HEAD -- <engine paths>` lists only
  files in `native/parity/oracle-allowlist.txt` (before G2: the parity
  tooling under `src/backtest/parity/`, which main does not have;
  `src/strategy/artifacts/types.ts` (`kind`, 31 §8); the Market Simulator
  guard in `src/backtest/simulator/resolveMarket.ts` (D10, 22 §5)) and that
  the working tree is clean. `run-parity` checks both and records
  `oracleTreeClean`. Every allowlisted file is covered by TS self-parity
  (OR-17).
- **OR-4** The TS twins of the exerciser and the feed exerciser live in
  `src/strategies/testing/`, outside the engine paths. The TS trace writer
  needs no engine change: the runner observer hooks already exist on main
  (`src/backtest/runSingleMarket.ts:62-66,317-319`; `onContext` for the
  `feeds` level at `src/trading/StrategyRunner.ts:450`).
- **OR-5** The lagsnipe oracle is the artifact bundle (sha `304eceb3…`, 01 §4)
  executed against the pinned engine: external artifacts resolve `#pmb/*` to
  the checkout's engine (`src/backtest/parity/marketJob.ts:44-47`). Its trace
  changes with the pin like any TS strategy.

### 2.3 Reproducible oracle runs

- **OR-6** Jitter is 0 in every ts-compat cell. TS jitter uses unseeded
  `Math.random` (`src/trading/execution/BacktestExecution.ts:240`) and is
  forced to 0 only when the delay is 0 (`src/backtest/runSingleMarket.ts:187`).
- **OR-7** TS children run with an allowlisted environment (`PATH`, `HOME`,
  `TZ=UTC`, data-root variables) plus every result-affecting knob set
  explicitly from the cell's `ModelConfig`; `BOT_ENV` is unset, because
  `.env.$BOT_ENV` loads with override (`src/config/env.ts:16-30`). Explicit
  values win over `.env` because dotenv does not override variables already
  set. The manifest records the effective `oracleEnv`. Today the harness passes
  the whole parent environment after loading `.env`
  (`src/cli/parity/run-parity.ts:1,291`); this MUST change. Knobs:

| Knob | Read at | Cell value (ts-compat defaults, 21 §6) |
|---|---|---|
| `BACKTEST_BINANCE_FEED_LATENCY_MS`, `_LOOKBACK_MS` | `src/backtest/feeds/wireBacktestExternalFeeds.ts:68,96,228` | 110, 300000 |
| `BACKTEST_RTDS_CHAINLINK_LATENCY_MS`, `_LOOKBACK_MS` | same file `:91,99,275` | 320, 300000 |
| `BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS` | `src/backtest/feeds/chainlinkCryptoPricesSource.ts:217` | 300000 |
| `BACKTEST_PRICE_TO_BEAT_LATENCY_MS` | `wireBacktestExternalFeeds.ts:297` | 2700 |
| `MAX_EVENTS_PER_DRAIN` | `src/trading/runnerConfig.ts:5` | 4200 |
| `WEB_UI_ORDERBOOK_LEVELS` (caps only the cumulative `bidsDepthByLevel`/`asksDepthByLevel` arrays; the `bids`/`asks` level arrays are never capped, `src/market/orderbook/OrderBookEngine.ts:50-70`) | `src/market/orderbook/utils.ts:3-12` | 10 |
| `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS`, `BACKTEST_TECH_IND_TIMEOUT_MS`, `BACKTEST_TECH_IND_POLL_MS` | `src/trading/StrategyRunner.ts:404-417` | `1` only in the TA cell |

  Latency delay and jitter travel in the job, not in the env. Starting
  capital comes only from the cell (`ModelConfig.capital`, §4.1, §6.3): the
  harness MUST NOT fall back to the `STARTING_CAPITAL` variable that the WIP
  reads through `resolveStartingCapital`
  (`src/cli/helpers/capitalArgs.ts:10-23`, `src/cli/parity/common.ts:70-86`).
  `npm run native:oracle:env-audit` (a short grep script, §14.1) lists every
  `process.env` read under the engine paths (OR-2) and fails when one is
  neither in this table nor in an allowlist of result-neutral variables; it
  runs at every sync (OR-11), so a knob added on main cannot silently diverge
  the oracle.
- **OR-8** Wall clock. Parity markets are older than the 3-day publication
  guard and the 30 h price-to-beat grace, so the `Date.now()` branches of
  21 §5.3 take their old-market path; manifests record `asOfMs`. The
  `|| Date.now()` fallbacks in the runner (`StrategyRunner.ts:314,328,457,679`)
  fire only on a zero timestamp; OR-9 detects any effect.
- **OR-9** Oracle self-check. Every gating cell re-runs TS on a seeded 10%
  sample (at least 20 markets; 100% for E15-0 and L15-0 in the G2 evidence
  run) and requires byte-identical TS traces. A non-reproducible market is
  excluded from the cell, counted, and entered as a TS bug of subclass
  `nondeterministic-oracle` with its remedy (usually another pinned knob).
- **OR-10** TA: TS TA fetches REST klines with a wall-clock wait
  ([14](14-feeds-and-plugins.md) P-10). Only cell F15-TA uses it; a failed
  fetch is an oracle failure (retried), never a mismatch.

### 2.4 Tracking main changes

Before gate 2 (main moves with other work and with the D37 rules-capture PR):

- **OR-11** Every sync appends to PARITY.md "Oracle changes" the output of
  `git log --oneline <old pin>..<new pin> -- <engine paths>` with one line per
  commit: assessed effect (none, exerciser feature, lagsnipe, goldens) and the
  action taken. Tool: `npm run native:oracle:sync-report -- --from <old> --to <new>`
  (§14.1).
- **OR-12** If that list is non-empty, the full matrix is re-run (01 §8). The
  TS trace cache key is (git tree hashes of the engine paths at the pin, job
  sha256, input file identities, `oracleEnv` sha256, patch-set sha256), so
  unchanged trees reuse traces and changed trees invalidate exactly the
  affected ones.
- **OR-13** The golden regeneration check (GF-4) runs at every sync. A diff
  means a TS leaf behavior changed: regenerate, add an oracle-change note,
  and classify any resulting Rust failure.

After gate 2:

- **OR-14** CLAUDE.md gains the D04/D49 rule with the merge (01 §8). CI job
  `parity-rule` (§14) fails a PR to main that changes an engine path unless
  the same PR changes `native/PARITY.md` (an Oracle changes line naming the PR)
  or both exerciser twins. The label `engine-semantics-none` bypasses it; only
  the user sets it, agent sessions MUST NOT.
- **OR-15** From the G2 merge the TS engine takes only bug fixes (D49). The
  exception, a feature the AI protocols need before they move to Rust, lands
  only with its Rust version and a parity test (an exerciser case in both
  twins, or a Rust twin with its own cell) in the same or a linked PR. A TS
  fix that resolves a PARITY entry retires its patch (§3.4); the entry
  becomes `fixed-on-main@<sha>`.
- **OR-16** Parity canary (both phases): before every sync, and nightly in
  the D47 window (01 §8.1 H5), cells E15-0 and L15-0 run on the PS-50
  markets (§4.5) with TS traces regenerated at the latest `origin/main`. A new divergence
  opens a `pending` PARITY entry and, when money-affecting, a STATUS.md
  "Waiting on user" note. Not blocking.

### 2.5 TS self-parity

- **OR-17** The branch MUST NOT change how TS strategies behave (01 §8). The
  same exerciser twin file and the lagsnipe artifact, run against the TS engine
  tree at the pin (a scratch worktree of the pin with the twin and the parity
  tooling, `src/backtest/parity/`, `src/cli/parity/`, `scripts/parity/`,
  copied in) and at the branch head, on the E15-0 and L15-0 sets, MUST give
  byte-identical TS traces (same engine, no tolerance). Required in the G2
  report, in the merge PR, and in every later PR that touches an allowlisted
  engine-path file.

## 3. PARITY.md

### 3.1 Layout

`native/PARITY.md` holds, in order:

1. Header: oracle pin, engine commit, exerciser schedule version, trace format
   (`pmb-parity-trace/2`), diff rules version, sha256 of the last matrix
   manifest.
2. Matrix status: `Cell | Markets | Identical | Identical (patched) | Classified | Masked | Unclassified | Excluded | Manifest`.
3. Oracle changes (OR-11).
4. Entries, newest first, one per divergence signature.
5. Standing auto-class entries (§3.5).

Supporting files live under `native/parity/`: `cells/`, `sets/`,
`matchers/`, `patches/`, `repro/`, `engine-paths.txt`,
`oracle-allowlist.txt`.

### 3.2 Entry fields

| Field | Rule |
|---|---|
| `id` | `PE-NNNN`, never reused |
| `class` | `TS bug` \| `Rust bug` \| `Intended model change` (R6) |
| `subclass` | e.g. `accounting`, `sequence`, `nondeterministic-oracle`, `float-boundary`, `data` |
| `money` | `yes` when pnl, cost, fees, cash, positions, fills or reservations differ |
| `status` | `open` \| `fixed <sha>` \| `accepted` \| `fixed-on-main@<sha>` \| `not-observed@<pin>` \| `pending` |
| `first seen` | cell, slug, pin |
| `signature` | first divergent record type, kind and field path, plus preconditions |
| `matcher` | `native/parity/matchers/PE-NNNN.json`: declarative (record type, kind, path glob, required event kinds in the market); no code |
| `affected` | per cell: markets; Σ\|Δ unrounded pnl\|; max \|Δ pnl\|; markets whose won/lost/flat class flips (sign of the rounded pnl, `src/backtest/stats/batchStats.ts:194-235`) |
| `evidence` | TS file:line, Rust file:line, and the spec clause, 02 decision or Polymarket doc |
| `repro` | TS bug: `native/parity/repro/PE-NNNN.test.ts` (runs with `tsx --test` at the pin and demonstrates the TS behavior on a minimal scenario). Rust bug: path of the Rust regression test |
| `counterfactual` | patch path and the manifest of the patched-oracle run (§3.4); `not required (field-only, money = no)` (PM-1); or `n/a` with reason (the market is then masked, PM-4) |
| `ts-compat handling` | `reproduced under TC rule <id>` (13 §5.2) \| `not reproduced` |
| `independent review` | reviewer, date, agree/disagree (§10.4) |
| `user` | for `money = yes`: `confirmed at G2 <date>` \| `pending` |

### 3.3 Classification rules

- **CL-1** Classify per signature, not per market. Every divergent market's
  first divergence MUST be matched by exactly one matcher. No market is
  explained by prose alone.
- **CL-2** A divergence is a Rust bug until evidence proves another class.
  Rust bugs are fixed with a regression test that names the entry; none is
  open at a gate (R6).
- **CL-3** `TS bug` requires all of: (a) the spec clause, 02 decision or
  Polymarket doc that the TS behavior contradicts, or the non-oracle area of
  §2.1 it lies in; (b) a TS repro; (c) a passing counterfactual (§3.4) where
  PM-1 requires one, unless CL-6 applies; (d) the ts-compat handling: a decision-changing TS behavior is
  reproduced only if it is already a TC rule of 13 §5.2 or a new TC rule
  recorded as a 02-decisions entry (00 §3.2, 13 §5.5); TS accounting
  quirks that change no decision are not reproduced (R4).
- **CL-4** `Intended model change` in ts-compat only where the spec mandates
  the difference, citing the decision or clause. Known members: negative
  rounding ties (D08, 10 §4 Q3), lossless `intentMeta` instead of the 500-fill
  ring (21 §16), the drain budget halting instead of dropping events
  (12 §6.3), the fee carried on the fill (10 §9.1), the fee rounded from its
  exact decimal value instead of an `f64` product (10 R8; standing entry PE-R3,
  §3.5). Differences between
  realistic and ts-compat are not PARITY entries; they are A/B reports (§11).
- **CL-5** `float-boundary` (subclass of intended model change, R1, R2)
  applies only to strategy `f64` math and to the TS engine float tolerances
  listed as not reproduced in 13 §5.4 (for example the 1e-8 funding tolerance,
  `OrderManager.ts:153`). Proof: a margin probe, i.e. scratch instrumented runs
  on both sides showing the compared quantities within relative 1e-9 of the
  threshold (strategy math) or within the TS tolerance (engine) at the
  divergent `seq`. The market's suffix is masked (PM-4).
- **CL-6** `nondeterministic-oracle` (subclass of TS bug): OR-9 failures. No
  counterfactual; the market is excluded and counted.
- **CL-7** Both engines skipping or failing a market with the same
  `skipReason` or error class is identical, not a mismatch. Different classes
  are classified like any divergence.
- **CL-8** `reason_code_unmapped` (22 §3.4) is never a class: the code is
  mapped in 21 §17; until then it is a Rust or tooling bug.
- **CL-9** No entry changes a tolerance or a diff rule (VP-3, R5).
- **CL-10** An entry with `money = yes` needs the independent review (§10.4)
  before the gate report is generated, and the user's confirmation at G2 (R6).

### 3.4 Counterfactual proof (patched oracle)

A classification is only trusted when TS, corrected exactly as the entry
claims, matches Rust completely. This also proves nothing else differs after
the divergence, which a classified first divergence would otherwise hide.

- **PM-1** A minimal patch `native/parity/patches/PE-NNNN.patch` against the
  pin is REQUIRED for a TS-bug or intended-model-change entry when (a)
  `money = yes`, or (b) its divergence shifts the record sequence (later
  records no longer align), which would leave the rest of the market
  unverified. A **field-only** divergence (records stay aligned, money = no,
  for example a reason parameter) needs no patch: the diff continues past it
  (HR-6) and verifies everything after it. Rounding and float boundaries have
  no patch (CL-5, §3.5). `run-parity --oracle-patch <patch>…` applies the
  patch set in a scratch worktree of the pin (never committed to main, never
  on the fleet) and produces patched TS traces.
- **PM-2** Rust ts-compat MUST equal the patched oracle, with zero
  divergences, on every market the entry matches.
- **PM-3** Gate statement per cell: Rust = TS@pin + P on 100% of non-excluded,
  non-masked markets, where P is the set of accepted patches; and every Rust
  vs TS@pin divergence is matched by an entry.
- **PM-4** A market is **masked** when PM-1 requires a counterfactual and none
  passes (CL-5, or a TS behavior no patch can express). Its suffix after the
  divergence is unverified; coverage (§5.6) counts only its identical prefix.
  The G2 report lists every masked market. Masking is allowed only under
  CL-5; anything else needs the user's explicit acceptance at G2.
- **PM-5** Patches touch only the cited lines and never port Rust logic into
  TS.

### 3.5 Auto-classes

Standing entries, counted per cell. None of them masks another difference in
the same record or later in the market.

| Entry | Diff kind | Condition | Handling |
|---|---|---|---|
| PE-R1 | `rounding_boundary` | 22 §3.4 | counted |
| PE-R2 | `rounding_tie` | 22 §3.4, D08 | counted |
| PE-R3 | `fee_rounding_tie` | A `fill` record whose `fee` differs by exactly 1e-4 (100 micros) while the exact ts-compat fee `0.07 × p × (1 − p) × C`, computed in exact decimal from the traced price and size, lies exactly on a 4-dp half (5th decimal 5, nothing after it). Cause: TS rounds an `f64` product (`src/trading/fees.ts:20-24`), Rust rounds the exact value `HalfAwayFromZero` (10 R8). Exact ties are common with cent prices and 2-dp sizes (for example p = 0.50, C = 10.02 gives 0.17535). | counted; before the 1e-4 check the diff removes the effect of the classified fee deltas (with each field's sign) from the USDC fields that include fees (`final.unrounded.feesPaid`, `pnl`, `cost`), so several ties in one market do not add up to a failure; a quantized stat that then differs falls under PE-R1 |

The diff tool implements these kinds (HR-5; all three are listed in 22 §3.4).
The same tie can occur in the fee part of
a BUY reservation (`src/trading/capital.ts:16-28`), which is not traced but
shifts `availableCash` by 1e-4. A later decision divergence in a market with
a PE-R3 tie is not covered by PE-R3: it is classified like any divergence,
with the standing patch `native/parity/patches/PE-R3.patch` (TS fee rounded
from the exact decimal value) as its counterfactual (PM-1).

### 3.6 After gate 2

PARITY.md stays as the regression ledger (00 §3.3). On each new pin all
matchers re-run; entries no longer matched become `not-observed@<pin>` and are
kept.

## 4. Parity matrix

### 4.1 Cells

All cells run the ts-compat profile with TS default values in `ModelConfig`
(the OR-7 table, starting capital 500 except in the L15 cells (§6.3), risk
defaults of `src/trading/riskLimits.ts:24`). Delay `D` = 140 ms, the
documented suggestion and the protocol default (research/early-audits.md:40);
jitter is always 0. The Rust side of every cell is the canonical `artifact`
binary (VP-7).

| Cell | Strategy | Market set | Delay | Trace level | Milestone |
|---|---|---|---|---|---|
| T15-on, T15-off | Feed exerciser, `trade: false`, `tickOnUpdate` on / off | S15-CL | 0 | `feeds` | M1 step 6 checkpoint |
| E15-0, E15-D | Engine exerciser v2 | S15 | 0, D | `decisions` | M2 (gating) |
| E5-0, E5-D | Engine exerciser v2 | S5 | 0, D | `decisions` | M2, non-gating (D38) |
| F15-on, F15-off | Feed exerciser, `trade: true`, `tickOnUpdate` on / off | S15-CL | 0 | `feeds` | M2 (gating) |
| F15-TA | Feed exerciser with TA | 50 markets of S15-CL | 0 | `feeds` | M2 (gating) |
| L15-0, L15-D | lagsnipe.v15 | SL | 0, D | `feeds` | M2 (gating) |
| V4-E | Engine exerciser v2 | ≥ 50 worker-2 Recorder V4 packages, BTC 5m and 15m | 0 | `decisions` | M7, after G2 (15 §5.6) |

**BTC 5m (D38).** Gate 2 covers BTC 15m only. E5-0 and E5-D need S5
(≥ 200 BTC 5m markets), but the Telonex subscription has expired and R2 held
no eligible 5m market on 2026-10-09 (01 M2 step 1). S5 is therefore the BTC
5m markets present locally on worker-1 (possibly none); E5-0 and E5-D run on
it non-gating, and the G2 verdict table says so. The full E5 cells run after
a Telonex renewal and their result is appended to the G2 evidence; BTC 5m
ts-compat parity is shown on Recorder V4 in M7 (V4-E).

### 4.2 Market sets

- **MS-0** Sets: S15 (≥ 200 BTC 15m, no feed requirement), S5 (≥ 200 BTC
  5m), S15-CL (≥ 200 BTC 15m eligible for Binance, Chainlink and
  price-to-beat), SL (≥ 200 BTC 15m eligible under lagsnipe's declared feeds),
  PS-50 (§4.5).
- **MS-1** Sets are committed slug lists `native/parity/sets/<set>.txt` with a
  header (selection command, seed, eligibility parameters, pin, date). Later
  cycles reuse the same markets.
- **MS-2** Selection is seeded random through `listEligibleTelonexMarkets`
  with the cell strategy's required feeds (the only allowed eligibility path,
  `src/db/telonexMarkets.ts`; already used by `selectParitySlugs`), stratified
  by calendar month over the eligible range, and covering every fee era of
  11 §5.3 so the same sets serve the A/B reports (§11). Sets that need
  Chainlink start at 2026-04-02 (coverage start). The eligible range ends
  where the local Telonex catalog ends (subscription expired, D38).
- **MS-3** Each set adds at least 10 edge markets chosen from a scan: most and
  fewest events, crossed-book ticks, local or exchange clock going backwards,
  deltas before the first book (15 §8 counters), a missing best bid or ask at
  window start.
- **MS-4** SL MUST contain at least 100 markets where TS lagsnipe places at
  least one order; otherwise it is extended with the next seeded markets.
- **MS-5** Gating runs read only local inputs (`--read-from local`): the
  telonex-delta, Binance and Chainlink files already on worker-1, through the
  read-only data links of 01 §8.1 H2 (nothing is downloaded into the fleet
  copy). Each input is identified by size and sha256 in the manifest. A
  market without local data is replaced by the next seeded market, recorded.
  When a whole set cannot be filled (BTC 5m, §4.1), the set header records
  the shortfall and the affected cells are non-gating. The agent never runs
  the production dataset pipeline (`data:sync:main`, conversions, R2 uploads,
  catalog writes; D38).

### 4.3 Harness

The salvaged tooling (`src/cli/parity/run-parity.ts`, `src/backtest/parity/*`)
MUST be changed as follows:

| # | Requirement |
|---|---|
| HR-1 | Cells are files `native/parity/cells/<cell>.json` (set, `ModelConfig`, trace level, profile, params source, and both strategy identities: `tsStrategy` (registry id or artifact sha) and `rustStrategyId`, for example `engine-exerciser` and `engine-exerciser.rs`, D20). The harness builds each side's job with its own id; `EngineJob.run.strategyId` equals the binary's id (21 §5.1). The L15 cells also record the params run id and the inherited allowance (§6.3). |
| HR-2 | Rust runs as `run --job <EngineJob> --trace … --trace-level …` ([20](20-binary-protocol.md) §5.4); today it calls `<bin> --job --trace` (`run-parity.ts:336`). The `EngineJob` comes from `src/native/buildEngineJob` (01 M1 step 6), the builder later shared by `--sequential` and the worker shim (21 §9); the TS `MarketJobData` comes from the producer's own builder, or the harness passes H-1. |
| HR-3 | Pinned oracle environment and `oracleEnv` in the manifest (OR-7). |
| HR-4 | `--oracle-patch` (PM-1), `--repeat-ts` (OR-9), the trace cache (OR-12). |
| HR-5 | Diff v2 (22 §3.4) replaces the 1e-6 default (`src/backtest/parity/diff.ts:15`), plus the `fee_rounding_tie` kind of §3.5; `--tolerance` marks the report non-gating. |
| HR-6 | Matchers applied; after a field-only divergence matched by an entry, the diff continues and the market is `classified PE-…` only if every later difference is also matched (PM-1). Per-market verdict `identical`, `identical-patched`, `classified PE-…`, `masked`, `unclassified`, `excluded`. |
| HR-7 | Manifest per OR-1, OR-3, VP-2, written atomically, with coverage (§5.6). `native:parity:summary` renders the PARITY.md matrix status and the gate evidence tables from manifests (§15.2). |
| HR-8 | Exit 0 only with zero `unclassified` and zero markets matched by an open Rust-bug entry. |
| HR-9 | Runs on worker-1 in the native clone (VP-8, R13), at `--concurrency 4` while the fleet worker runs (01 §8.1 H4). |

- **H-1 Harness validation** (once per cell definition, reported at G2): on
  20 markets per strategy, the harness's `MarketJobData` equals the production
  producer's jobs (normalized: `idx`, batch and submission fields removed), and
  the TS trace `final.stats` equals the `RunSingleMarketOutput` of the worker
  path (`src/backtest/parity/runJob.ts:21` already runs `makeMarketProcessor`).

### 4.4 Pass criteria per cell (gate 2)

Zero unclassified; zero open Rust bugs; PM-3 holds; masked markets only under
PM-4; oracle self-check passed (OR-9); coverage thresholds met (§5.6, §6.4);
Rust run twice byte-identical (DET-1); the `parity-check` binary identical to
the `artifact` binary with no invariant violation (§8.1); harness validated
(H-1).

### 4.5 Parity subset PS-50

PS-50 = cell E15-0 on 50 fixed markets of S15 and cell L15-0 on 50 fixed
markets of SL (`native/parity/sets/ps-50.txt`), run Rust-only against cached
TS traces, plus the fixture-market parity of §12. It is "the parity subset of 60" that every
optimization commit passes (16 §13.8), the per-fix check of AB-4, and the
canary set of OR-16. It MUST stay fast enough to run before every such commit.

## 5. Engine exerciser

### 5.1 Rules

- Implemented identically in TS (`src/strategies/testing/engine-exerciser.ts`,
  id `engine-exerciser`) and Rust (`native/strategies/`, id
  `engine-exerciser.rs`, D20, 30 §18); cell files name both (HR-1). It drives
  engine features on real markets; it is not a trading strategy. Params `{}`;
  no feeds; no plugins.
- `n` = count of real `book`/`price_change` ticks delivered to the strategy
  inside the strategy window (first is `n = 0`); synthetic feed ticks never
  count. `UP` = outcome 0, `DOWN` = outcome 1. `bid(A)`/`ask(A)` = best bid/ask
  of A. `pos(A)` = portfolio position quantity.
- An action whose `bid`/`ask` is missing stays pending and is retried on every
  following tick, in schedule order, until it fires. A *skip* condition
  completes the action without an intent.
- Prices are snapped on the 1e-6 grid, then down (BUY) or up (SELL) to the
  0.01 tick, then clamped to [0.01, 0.99]. Sizes are shares. Client ids are
  exactly the strings below. Unsnapped prices are marked "raw".
- Periodic slots: a new slot supersedes a still-pending older slot; the
  "no open orders" check reads the decision portfolio of that tick; the cancel
  fires at slot `n + 40` only if the slot's order was placed
  (`engine-exerciser.ts:22-34`).
- v2: every placed order carries `meta {"case": <cid>, "n": <n at firing>}`,
  which exercises `intentMeta` order and first-fill dedupe (21 §16).

### 5.2 Schedule v1 (unchanged from `native/EXERCISER.md`)

| n | Action |
|---|---|
| 50 | `place_limit` GTC BUY UP @ bid(UP), size 10, postOnly, cid `x1` |
| 60 | `place_limit` FOK BUY DOWN @ ask(DOWN), size 5, cid `x2` |
| 70 | `split_positions` size 10 |
| 90 | `place_limit` GTD BUY UP @ bid(UP) − 0.02, size 6, `expireAtMs` = tick ts + 120000, cid `x3` |
| 100 | `place_batch` [GTC SELL UP @ ask(UP) + 0.03 size 4 cid `x4a`, GTC SELL DOWN @ ask(DOWN) + 0.03 size 4 cid `x4b`] |
| 120 | `cancel_order` `x1` |
| 150 | `place_limit` GTC BUY UP @ ask(UP) + 0.02, size 200, cid `x5` (crossing, larger than depth) |
| 180 | `place_limit` FOK BUY UP @ bid(UP) − 0.05, size 5, cid `x6` (killed) |
| 200 | `place_limit` GTC BUY DOWN @ ask(DOWN), size 3, postOnly, cid `x7` (post-only cross) |
| 220 | `cancel_batch` [`x4a`, `x4b`, `x9-missing`] |
| 260 | `merge_positions` size min(pos(UP), pos(DOWN), 5); skip if 0 |
| 300 | `cancel_market` asset UP |
| 400 | `place_limit` GTC SELL UP @ bid(UP), size min(pos(UP), 5) (skip if < 1), cid `x8` (crossing sell) |
| 500 | `cancel_all` |
| 600 + 100k | if no open orders: GTC BUY UP @ bid(UP) − 0.01 size 5, cid `r{n}`; at `n + 40` `cancel_order` `r{n}` |

### 5.3 Schedule v2 additions

Added between 270 and 500 so that `cancel_all` at 500 leaves no open orders
before the periodic phase.

| n | Action | Case (audit source) |
|---|---|---|
| 280 | If x2's trade status is at least MINED (TS `isOrderTradeStatusAtLeast`, `src/strategy/strategyToolkit.ts:41-49`; SDK status accessor in Rust): GTC BUY DOWN @ bid(DOWN) − 0.04 size 5 cid `x9s`; else skip | Settlement statuses visible to decisions (10 §9.2 F3) |
| 310 | GTC BUY UP @ bid(UP) − 0.03 size 5 cid `x10` | setup |
| 320 | One list: [`cancel_order` `x10`, GTC BUY UP @ bid(UP) − 0.04 size 5 cid `x10`] | Same-cid cancel and replace (`cancellation.test.ts:721-746`) |
| 330 | GTC BUY UP @ bid(UP) − 0.05 size 5 cid `x10` | Re-place of an active cid (`OrderManager.ts:466`) |
| 340 | GTC BUY DOWN @ bid(DOWN) − 0.03 size 5 cid `x11` | Triggers A1 |
| 350 | One list: [GTC BUY UP @ bid(UP) − 0.06 size 5 cid `x12`, `cancel_order` `x12`] | Place then cancel in one list (`cancellation.test.ts:362`) |
| 360 | `place_batch` of 15: GTC BUY UP @ 0.01 (raw) size 5 postOnly, cids `b15-00` … `b15-14` | Batch at the cap |
| 370 | `place_batch` of 16: GTC BUY DOWN @ 0.01 (raw) size 5 postOnly, cids `b16-00` … `b16-15` | Batch over the cap |
| 380 | `cancel_batch` [all `b15-*` then all `b16-*`, in cid order] | Mixed known/unknown batch cancel |
| 390 | `merge_positions` size 0 | Zero-size merge (10 N4) |
| 395 | `split_positions` size 100000 | Split beyond capital |
| 405 | `merge_positions` size 100000 | Merge clamp (`OrderManager.ts:412-431`) |
| 410 | GTC BUY UP @ 0.99 (raw) size 1000 postOnly cid `x13` | Engine-level insufficient capital; triggers A3 |
| 420 | `cancel_order` `x6` | Cancel of a terminal order |
| 430 | `cancel_order` `x-never` | Cancel of a never-placed cid |
| 440 | `place_batch` [GTC BUY UP @ bid(UP) − 0.07 size 5 cid `x16a`, same with size 0 cid `x16b`] | Partial batch; rejection without `order_submitted` (`OrderManager.ts:664-706`) |
| 450 | GTC SELL DOWN @ bid(DOWN), size pos(DOWN) + 5, cid `x14` | Oversell (10 F2) |
| 460 | `cancel_market` with `market` = the tick's condition id, no asset filter | Market-scoped cancel |
| 470 | GTD BUY UP @ bid(UP) − 0.02 size 5, `expireAtMs` = tick ts + 30000, cid `x15` | GTD too soon |
| 475 | GTD BUY UP @ bid(UP) − 0.02 size 5, no `expireAtMs`, cid `x17` | GTD without expiry |
| 480 | FOK BUY UP @ ask(UP) size 5 postOnly cid `x18` | Post-only on a market order |
| 485 | GTC BUY UP @ 0 (raw) size 5 cid `x19` | Invalid price |
| 487 | GTC BUY UP @ bid(UP) − 0.08 size 0 cid `x20` | Invalid size, single path (TS has two placement paths, 10 N2) |

### 5.4 Account callbacks

| # | Trigger (first occurrence only) | Returned intents | Case |
|---|---|---|---|
| A0 (v1) | first `fill` of `x2` | GTC SELL DOWN @ fill price + 0.05 (snap up), size = fill size, cid `x2-exit` | Cascading intent from a fill |
| A1 | `order_submitted` of `x11` | GTC BUY DOWN @ x11 price − 0.01 size 5 cid `x11-sib` | Intent from an engine-synthesized event (`StrategyRunner.ts:628-689`) |
| A2 | `order_open` of `x11-sib` | `cancel_order` `x11` | Cancel from a second-level cascade |
| A3 | `order_rejected` of `x13` | GTC BUY UP @ 0.01 (raw) size 5 cid `x13-retry` | Intent from a rejection (lagsnipe resets on it, §6.1) |

### 5.5 Expected behavior per profile

ts-compat expectations are whatever TS does at the pin; the evidence column
says where to look. Realistic expectations come from the cited clause.

| Case | ts-compat (TS evidence; TC rule of 13 §5.2) | Realistic (RF id of 13 §7.1) |
|---|---|---|
| x3 lead 120 s | accepted; expires at `expireAtMs` (TC-C1, TC-E5) | rejected, lead < 3 min (10 GD4, 11 GT2; RF03) |
| x2, x6 (FOK BUY) | sized in shares (TC-E4, 10 O3) | converted to collateral at the limit price; can receive more shares when filled below the limit (10 O2, D42; RF04) |
| x10 at 320 | depends on whether the cancel completes inside the list: in-list completion releases the cid, a queued cancel leaves it deduped (`OrderManager.ts:268-337, 466`; 12 §7.6; TC-E1) | 12 §7.6 (RF05) |
| x10 at 330 | dropped silently, no trace record; diagnostics counter `duplicate_active_cid` (12 §7.6) | same: dropped silently and counted, never emitted (12 §7.6; strategies re-send the same intent every tick on purpose, `OrderManager.ts:105`) |
| a placement that could match an own resting order (e.g. x7 BUY DOWN at ask(DOWN) while the x5 remainder rests as BUY UP at ask(UP) + 0.02: mint match) | no check (TC-C14) | `SelfCross` before sending (10 N6, 12 §7.4, D54; RF14) |
| A1, A2 | `order_submitted` and `order_open` reach the strategy; breadth-first order (12 §6.2) | same |
| b16 | all 16 accepted (TC-C12) | whole intent rejected, 16 × `BatchTooLarge` (11 §9; RF02) |
| merge 0 | dropped silently (TC-C7) | `MergeFailed(InvalidSize)` (10 N4; RF14) |
| split 100000 | `split_failed` with the funding error (`OrderManager.ts:372-383`) | `SplitFailed(InsufficientCollateral)` (RF12) |
| merge 100000 | clamped to held pairs minus pending merges (12 §7.3) | 12 §7.3 |
| x13 | `insufficient_capital(required=…,available=…)` (12 §7.5) | same code |
| cancel x6, x-never | no event (TC-C5, TC-C10) | 12 §7.3, 13 §6.6 (RF14) |
| x16b | `order_rejected invalid_size`, no `order_submitted`; x16a proceeds | same |
| x14 | naked sell fills (TC-C4) | `InsufficientInventory` (RF14) |
| x15 | `gtd_expireAtMs_too_soon(min_offset_ms=60000)` (TC-C1) | lead rule (11 §8 GT2; RF03) |
| x17, x18, x19, x20 | `gtd_requires_expireAtMs`, `post_only_requires_gtc_or_gtd`, `invalid_price`, `invalid_size` (`OrderManager.ts:756-772`) | engine reject reasons (10 §10.2) |

### 5.6 Coverage

`src/backtest/parity/coverage.ts:26-50` defines the 23 v1 features. v2 adds:
`x9s status-gated`, `x10 replacement rests`, `x10 old generation canceled`,
`x10 re-place dropped`, `x11 order_submitted cascade`, `x11-sib cascade cancel`,
`x12 place-then-cancel`, `b15 accepted`, `b16 over cap`, `cancel_batch mixed`,
`merge zero`, `split insufficient`, `merge clamp`, `x13 insufficient capital`,
`x13-retry cascade`, `cancel terminal`, `cancel unknown`, `x16 partial batch`,
`x14 oversell`, `cancel_market by market`, `x15 gtd too soon`,
`x17 gtd no expiry`, `x18 post-only market order`, `x19 invalid price`,
`x20 invalid size`, `intentMeta populated`.

Each feature is class **D** (deterministic once a best price exists:
validation, rejections, cancels, cascades) or **L** (liquidity-dependent:
fills, FOK fill vs kill, maker fills, expiry). Thresholds per exerciser cell:
D in at least 95% of markets; L in at least one market per cell and at least
20 markets across the E15 cells. A shortfall blocks G2 unless the gate
report explains it with market conditions (for example markets with fewer
than 600 ticks). The non-gating E5 cells report coverage without thresholds.

### 5.7 Versioning

`EXERCISER_SCHEDULE_VERSION = 2` exists in both twins; the manifest records
it and `run-parity` refuses a mismatch. A schedule change bumps the version and
changes both twins, the coverage list and this section in the same commit.

### 5.8 Feed exerciser

Defined by [14](14-feeds-and-plugins.md) V-3. Params
`{tickOnUpdate: bool, trade: bool, ta: bool, chainlink: bool}` (`chainlink`
defaults to true). It requests Binance, Chainlink (only when `chainlink`)
and price-to-beat with `tickOnUpdate` per the param, and the plugins
TimeWindowVolatility, DwellGate, TimeWindowGate and, only when `ta`,
TechnicalIndicators (D19 as amended). Every parity cell uses
`chainlink: true`; `chainlink: false` exists for agent-run paper sessions,
which load no Chainlink credentials (01 M8, 50 §8.1; 01 §12.1 item 2).
`trade: false` returns no intents (the T15 tick-stream checkpoint);
`trade: true` runs schedule v2 on real ticks only. Both twins live next to
the engine exerciser.

### 5.9 Realistic exerciser (Rust only)

`engine-exerciser-realistic.rs` drives features that have no TS oracle. It runs
in realistic on the fixture markets and on the M3 set (AB-1), feeds the invariant suite
(§8) and the approved snapshots (§8.4), and is one of the A/B strategies
(§11). Cases: FAK BUY partial across levels and FAK zero fill; FOK and FAK BUY
sized in collateral with floor share truncation (10 O2, R7), including a
share-sized request converted at the limit price that fills below the limit
and receives more shares (D42); FAK SELL in shares; marketable orders held by
the taker delay, including a cancel inside the window (11 §6); GTD with the
3-minute lead and 60 s early expiry; off-tick, out-of-bounds, sub-minimum and
precision rejects (11 §7); post-only cross at arrival; batch of 15 and 16;
resting orders across the window end (D23); split and merge as async
operations (D25); sell gate on MINED and a FAILED reversal (10 F1, F2);
re-place of an active cid (dropped silently, diagnostics counter
`duplicate_active_cid` incremented, no event; 12 §7.6); the self-cross block,
direct and complementary (mint and merge matches, an earlier entry of the
same batch, an in-flight own order; 10 N6, 12 §7.4, D54).

### 5.10 No-oracle unit cases

Unit tests in the core (independent of the exerciser), each citing its clause:

| Area | Cases |
|---|---|
| FAK | BUY collateral partial over 3 levels; zero fill → `Killed`, filled 0; remainder never rests; SELL in shares; with taker delay; below the market-order minimum; post-only refused; fee per fill record; reservation fully released after kill; FAK under ts-compat uses realistic semantics (10 §7.1) |
| FOK | exact fill; one share short → killed with no fill; collateral sizing in realistic vs shares in ts-compat; share-sized request converted at the limit price (D42) |
| Self-cross | each N6 condition rejects with `SelfCross` in realistic, paper and live; ts-compat has no check (TC-C14); no own taker fill ever meets an own resting order (INV-15) |
| Batch | 1, 15, 16 entries per profile; per-entry independent validation and funding; `success:true` with `errorMsg` mapped to a rejection (live adapter, 11 §9) |
| Cancel | cancel during taker delay; deferred cancel of an in-flight order (10 §8.1); conflicting refs; cap 1,000 vs 3,000 per profile |
| GTD | arrival-time lead check, `floor(ms/1000)` seconds, expiry at stated − 60 s |
| cid generations | late events of an old generation never touch the new one (`cancellation.test.ts:768-958`) |

## 6. lagsnipe.v15 parity set

### 6.1 Facts (read from the oracle bundle)

The bundle `data/strategy-artifacts/304eceb3…ab8.mjs` (13,663 bytes, entrypoint
`protocols/game-overnight-opus-5-5/strategies/overnight-opus55-lagsnipe.v15.ts`,
bundle line 258) shows:

- Only FOK BUY `place_limit` (lines 227-239), client ids
  `${name}:${slug}:${seq}` (line 230), meta with `toFixed`-rounded numbers
  (line 236).
- Feeds: Binance with `tickOnUpdate: true`, Chainlink with `tickOnUpdate: true`,
  price-to-beat (lines 248-252). It reads `chainlink.receivedAtMs` (line 195),
  so the Chainlink visibility clock is decision-relevant.
- Decision inputs: book sizes summed within a price bound over the **full**
  level arrays `byAssetId[…].bids` / `.asks` (lines 183-188 for the
  imbalance, 216-221 for the depth cap). These arrays hold every recorded
  level, bids descending and asks ascending
  (`src/market/orderbook/OrderBookEngine.ts:50-70, 91-117, 186-187`); there is
  no level cap. `WEB_UI_ORDERBOOK_LEVELS` caps only the cumulative
  `bidsDepthByLevel`/`asksDepthByLevel` arrays, which lagsnipe does not read.
  Further inputs: `capital.availableCash` and `startingCapital` (lines 149-150,
  211-214; the allowance therefore changes decisions, §6.3), positions (lines
  173-174), and `f64` math with `Math.log`, `Math.exp`, `Math.sqrt`,
  `normCdf`, `normInv` (lines 61-80, 159-167, 197) and `Math.round` cent
  rounding of non-negative values (lines 206-209).
- `onAccountEvent` reads only `ev.kind` and clears a pending flag on
  `order_done` or `order_rejected` (lines 241-243). It reads no portfolio state
  in account callbacks (consistent with the one-ledger rule of 12 §9.1).

### 6.2 Port and identity

The Rust port `overnight-opus55-lagsnipe.v15.rs` (D20) is written from the
bundle (D40). It keeps the bundle's `f64` expression order and uses the
SDK's pure-Rust libm (30 §14). Like every in-repo ts-compat port it declares
no tick interest (D41, 30 §18).
Normalized params MUST equal the TS ones (30 §9). Port rules that follow
from §6.1:

- **LP-1 Book sums.** The imbalance and depth sums iterate `book(o).bids()`
  and `book(o).asks()` (30 §5.1) over every level, with no cap, in that
  order (bids descending, asks ascending, the TS order), adding sizes as
  `f64` in iteration order. `WEB_UI_ORDERBOOK_LEVELS` plays no part, and no
  depth setting exists in `ModelConfig` (21 §6). The engine's taker walk
  also uses the full book (`src/trading/execution/BacktestExecution.ts:173-185`).
- **LP-2 Number conversion.** Book prices and sizes reach the port's `f64`
  math through `to_f64_lossy()`, which MUST equal TS `Number` of the same
  decimal text bit for bit (`micros as f64 / 1e6` is correctly rounded and
  satisfies this; `micros as f64 * 1e-6` is not guaranteed to). Checked by
  LS-1. Cash and positions are `f64` sums with `round8` in TS
  (`src/trading/capital.ts:16-40`) and exact micros in Rust, so their last
  bits can differ; a lagsnipe threshold flipped by that is a CL-5 float
  boundary.
- **LP-3 Meta rendering.** The bundle builds meta numbers with
  `Number(x.toFixed(k))` (line 236), which rounds the exact binary value of
  `x` to `k` decimals with ties away from zero. The port uses a helper with
  exactly that contract, `round_dp(x, k) -> f64` (exact decimal expansion,
  `HalfAwayFromZero` as in 10 §4, result parsed to the nearest `f64`), in
  `pmb_sdk::toolkit` (30 §14) or local to the port. Rust `format!("{:.k}")`
  rounds exact ties to even and `(x * 10^k).round()` rounds an inexact
  product; neither may be used. Without this, an exact tie appears as an
  `intentMeta` mismatch of up to 1e-4 (22 §3.4 compares meta numbers within
  relative 1e-9).

### 6.3 Params and markets

- Params: the normalized params of the completed run of artifact `304eceb3…`
  with the most markets (ties: newest) among runs whose `cmd` records
  `--starting-capital`, read through `--params-from-run <id>`.
- **Allowance.** lagsnipe's decisions read `startingCapital` and
  `availableCash` (it stops when `startingCapital − availableCash ≥
  stake × maxTrades − 1`, bundle line 150, and sizes from
  `availableCash × 0.97`, line 214), so the L15 cells use the allowance
  inherited from the selected run's `cmd` (`inheritedStartingCapital`,
  `src/cli/helpers/capitalArgs.ts:26-34`, as the WIP harness already does,
  `src/cli/parity/common.ts:50-55`). This overrides the default 500 of §4.1
  for L15-0 and L15-D. The cell file `native/parity/cells/L15-*.json` records
  the run id and the allowance, and `ModelConfig.capital.startingCapitalUsdc`
  carries it to both sides. Latency is the cell's (0 or D), never inherited.
- Set SL: per §4.2, from 2026-04-02 (lagsnipe declares Chainlink, which is a
  hard error before coverage), with MS-4.

### 6.4 Specific checks

- **LS-1 Strategy-math golden.** The bundle's pure functions (`normCdf`,
  `normInv`, the as-of lookup `at`, the cent rounding of lines 206-209) are
  evaluated by a TS generator on at least 10,000 sampled inputs, including
  threshold neighborhoods. The Rust port MUST match within relative 1e-12; the
  report lists the maximum ulp distance. A larger difference is a Rust bug.
  Two exact parts: (a) `round_dp` (LP-3) equals TS `Number(x.toFixed(k))`
  bit for bit on at least 10,000 inputs for `k` in {1, 2, 3, 4}, including
  exact binary ties (0.25 at k = 1, 0.125 at k = 2, −0.125 at k = 2) and
  their neighbors; (b) `to_f64_lossy()` (LP-2) equals TS `Number(text)` bit for bit
  for every price and size of the fixture markets.
- **LS-2 Coverage.** Per cell: markets with ≥ 1 order, FOK fills, FOK kills,
  synthetic Binance and Chainlink ticks, decisions on synthetic ticks, markets
  where price-to-beat and Chainlink are both visible at a decision. Each count
  is non-zero.
- **LS-3** Float-boundary classifications (CL-5) are reported as a count per
  cell. More than 2% of SL markets masked means the port's expression order
  differs from the bundle: a Rust bug.
- **LS-4 Params.** Golden PG-1 (30 §9 rule 9: the stored params of the §6.3
  run, `stakeMinUsd` set and null) passes; the G2 report lists its result.

## 7. Golden fixtures from TS

### 7.1 Generator rules

- **GF-1** Generators are TS scripts in `native/fixtures/gen/` (the WIP
  `stats_gen.ts` and `plugins_gen.ts` under
  `native/crates/pmb-core/tests/fixtures/` move there) that import the real TS
  modules from the checkout. They write JSON to `native/fixtures/golden/<area>/`.
- **GF-2** Output is deterministic: sorted keys, no timestamps, header
  `{generator, generatorSha256, contentPin}` where `contentPin` is the pin at
  which the content last changed. Regenerating at any pin with unchanged TS
  leaves gives identical content.
- **GF-3** Goldens exist only for oracle areas (§2.1). Exchange rules, realistic
  fees, taker delay, GTD and live behavior come from spec tables and
  conformance tests (§10), never from TS.
- **GF-4** `npm run native:goldens:check` regenerates every golden and fails on
  any content diff (the header's `contentPin` is ignored). It runs in TS CI
  (§14) and at every sync (OR-13). After G2 it is the automatic detector of TS
  leaf changes on main.
- **GF-5** Where TS is classified as wrong inside a golden area, the golden
  keeps the TS value and the Rust test asserts the spec value with an
  annotation `expected_divergence = "PE-NNNN"`; the test fails if the entry is
  not `accepted` (standing entries PE-R1…R3 count as accepted).

### 7.2 Areas

| Area | TS source | Tolerance | Spec owner |
|---|---|---|---|
| Book semantics (book replace, delta set, delta before book, timestamp) | `src/market/orderbook/*` | exact | 12 §5.2 |
| Telonex row decode, crafted skip rows | `replayTelonexDeltaParquetForMarket` | exact | 15 I-V1 |
| V4 replay and coverage reasons | `replayCapturedEvents`, `inspectCaptureEligibility` | exact | 15 I-V2 |
| Feed loaders and timelines, synthetic schedule and flusher | 14 V-1, V-2 generators | exact | 14 |
| Captured-feed reducer | 14 V-4 | exact | 14 |
| Plugin math | `plugins_gen.ts` extended (14 V-5) | integers exact, floats relative 1e-9 | 14 |
| TA candles vs klines | 14 V-6 | OHLC exact, volume relative 1e-9 | 14 |
| ts-compat fee (4 dp, 0.0001 floor) | `src/trading/fees.ts:18-24` | exact; exact 4-dp ties annotated `expected_divergence = "PE-R3"` (GF-5, §3.5) | 11 §4 |
| Capital commitment | `src/trading/capital.ts:16-28` | exact | 12 §7.5 |
| Cancel reference resolution | `src/trading/cancellation.ts:61-127` | exact | 12 §7.3 |
| Stats contract, skip taxonomy, `intentMeta`, `eventsByType` | `stats_gen.ts`, `src/backtest/runSingleMarket.ts:297-337,497-567` | 1e-4 USDC, rest exact | 21 §11-16 |
| Window and slug parsing | `src/polymarket/upDownSlugWindow.ts` | exact | 10 §5 |
| `modelConfigSha256` canonical JSON (cross-language contract) | TS hasher in the producer; the default fixtures of 21 §3 CI item 6 | exact | 21 §6 |
| lagsnipe math | bundle functions (LS-1) | relative 1e-12; `round_dp` and number conversion bit-exact | §6.4 |

### 7.3 Converted TS suites

Each TS scenario is recorded by a TS harness as an event-sequence fixture
(inputs: intents, injected events, book states; outputs: emitted events and
observable snapshots) and replayed by a Rust test against the core with the
ts-compat models. Assertions on TS internals (pending-capital overlay, object
identity) become assertions on observable events only (R4).

| Suite | Milestone | Disposition |
|---|---|---|
| `src/trading/capital.test.ts` | M1 | Oracle (reservation, cid reuse guard, per-market allowance) |
| `src/trading/cancellation.test.ts` | M1 (backtest cases), M9 (live adapter cases at `:257-326`, `:433-453`, `:626-653`) | Oracle for resolution and generations |
| `src/trading/Portfolio.test.ts` | M1 | Oracle, except merge PnL (TS bug, PARITY entry) |
| `src/trading/runnerConfig.test.ts` | M1 | Reason strings oracle; drain overflow → intended change (CL-4) |
| `src/trading/StrategyRunner.{serial,clock,syntheticTicks}.test.ts` | M1 | Oracle (cascade order, `nowMs` clock, synthetic rules) |
| `src/trading/execution/BacktestExecution.postOnly.test.ts` | M1 | Oracle for ts-compat post-only |
| `src/trading/fees.test.ts` | M1 | ts-compat fee model only |
| `src/trading/restPollCapital.test.ts`, `LiveExecution.postOnly.test.ts` | M9 | Live reconciliation fixtures; not oracle for the V2 adapter |

### 7.4 Spec tables as goldens

Where the spec gives an exact table, the table is the golden: rounding cases
(10 §4 Q3), fee curves and eras (11 §5), taker-delay dates (11 §6.2), GTD
arithmetic (11 §8), batch and cancel caps (11 §9), seed vectors (10 RNG-7).
These tests are written by the conformance author (§10); the implementation
session also commits RNG-7 as a unit test (DET-13).

## 8. Invariants and property tests

### 8.1 Invariants

Checked as debug assertions in the core, as property tests, and partly as the
egress self-check (21 §19). What a violation does in a release build is fault
semantics (12 §11). Where the assertions run:

- `cargo test` (Cargo's test profile has debug assertions on): every unit,
  golden, property and fixture test.
- The **`parity-check` binary**: the canonical builder (31 §4) also builds
  each parity strategy with profile `parity-check` = `artifact` plus debug
  assertions (31 §4.2, local cache only). At every gating matrix run it runs
  the whole matrix Rust-only against the cached TS traces. Any assertion
  failure is a Rust bug, and its deterministic output and trace bytes MUST
  equal those of the `artifact` binary on every market (31 §7.6
  profile-independence). It also runs with every Rust-only matrix re-run
  after a structural optimization (VP-4); per-commit PS-50 uses `artifact`
  only.
- The shipped `artifact` binary has no debug assertions (31 §4.2). Gate
  evidence still comes from it (VP-7); the identity above proves it computes
  what the checked build computes.

| # | Invariant | Profiles | Source |
|---|---|---|---|
| INV-1 | Cash conservation: `cash = starting + Σ cash deltas` (fills, fees, splits, merges, settlement), exact in micros | both | 12 §9.8 item 1 |
| INV-2 | Every reservation ≥ 0; `reserved = Σ` outstanding reservations of non-terminal orders and pending operations; `available ≥ 0` at acceptance except `reservation_dust` | both | 10 C1, 12 §9.8 item 2 |
| INV-3 | Reservations released on every terminal path (filled, canceled, expired, killed, rejected, reversal); zero reserved at session end when all orders are terminal | both | 10 C3 |
| INV-4 | Σ fill qty ≤ size (shares) or Σ spent ≤ amount (collateral) per order, and ≤ the authoritative final quantity | both | 10 S2, 12 §9.8 item 3 |
| INV-5 | Exactly one terminal event per `OrderKey`; nothing after it except flagged late fills | both | 10 S1, S5 |
| INV-6 | At most one non-terminal order per cid | both | 10 S4 |
| INV-7 | PnL identity: cash-based pnl = cost-basis decomposition, and `pnl = cashEnd − cashStart + winningShares` in micros | both | 10 C4, 21 §11 |
| INV-8 | Quantity ≥ 0 (both); `qty = 0 ⇒ basis = 0`, SELL and merge never exceed sellable inventory (realistic) | see text | 10 §9.3, F2, 12 §9.8 item 4 |
| INV-9 | Liquidity conservation: our taker fills at a level never exceed the displayed size minus what we already consumed (depletion overlay) | realistic (RF07) | 13 §6.4 |
| INV-10 | Every fill's fee equals the rules' fee for that fill; maker fee 0; fee ≥ 0 | both | 10 §9.1 |
| INV-11 | A `Failed` reversal restores position, cash, fee and realized PnL exactly | realistic | 10 F1 |
| INV-12 | Engine `now` is monotone; event times non-decreasing in delivery order | both | 12 §9.8 item 7 |
| INV-13 | No strategy callback outside the window rule of the profile | both | 12 §5.4, D23 |
| INV-14 | `tradeAsMaker + tradeAsTaker = tradeCount`; `eventsByType` sums to `eventsProcessed`; `intentMeta` entries = distinct filled cids with meta | both | 21 §15-16, §19 |
| INV-15 | No own taker fill meets an own resting order (the `self_cross` counter stays 0) | realistic | 12 §7.4, 13 §6.12 |

### 8.2 Property tests

- Generators: random intent scripts against synthetic books (testkit, 30 §15);
  random event streams with anomalies (duplicate rows, exchange time going
  backwards, `price_change` before the first book, crossed and locked books,
  empty sides, mid-market `tick_size_change`); random latency configurations;
  random candidate orders for groups.
- Every property asserts §8.1 plus DET-1 on the generated case.
- CI runs with a fixed seed and a bounded case count; the nightly run (§14)
  uses fresh seeds. Shrunk failures are committed as regression cases.
- Generators use only the testkit's public API, so the conformance author can
  reuse them.

### 8.3 Fuzzing

- Decoders (Telonex rows, V4 frames, journal records, `EngineJob` JSON) MUST
  never panic: every malformed input yields the documented error class
  (15 §9, 20 §4). Covered by property-based fuzzing on the pinned toolchain in
  CI; coverage-guided fuzzing MAY run nightly under a separate nightly
  toolchain, outside the pinned build.
- Fuzzed journals (reordered, duplicated, truncated) fail with precise errors
  (15 I-V5).

### 8.4 Approved snapshots (realistic)

Realistic has no TS oracle. Its traces for the realistic exerciser and for
lagsnipe on the fixture markets (§12) are committed as approved snapshots.
A change to a snapshot needs a commit that names the RF id (13 §7.1) or the
02 decision that explains it; CI fails on an unexplained change.

## 9. Determinism, protocol and group-equivalence tests

| # | Test | Where | Source |
|---|---|---|---|
| DET-1 | Same job twice → identical deterministic section (`resultDigest`, 21 §10) and identical decompressed trace bytes; `diagnostics` differs by design | CI, every parity market | 01 M1 proof |
| DET-2 | `run` vs `serve` at 1 and 8 threads with 16 interleaved jobs | CI (fixtures), local | 20 §8 item 1 |
| DET-3 | Candidate in a group = alone; shuffled candidate order; both layouts | CI, M4 proof | 20 §8 item 2, 41 §10 |
| DET-4 | Cold vs warm day cache; prefetch on and off | CI | 14 V-7 |
| DET-5 | Junk `BACKTEST_*`, `MAX_EVENTS_PER_DRAIN`, `DRY_RUN` env → identical bytes | CI | 20 §8 item 4 |
| DET-6 | Same jobs on every M6 native host (D55) → identical `resultDigest` | fleet canary | 40 §12, 20 §8 item 3 |
| DET-7 | Cross-architecture: Linux x86_64 CI reproduces the digests committed from worker-1 for every fixture job | CI | R7 |
| DET-8 | Traced = untraced `resultDigest`; untraced hot path benchmarked against a no-trace build | CI, benchmark | 22 §2 |
| DET-9 | ts-compat with jitter 0: any two seeds give identical output; realistic with zero-variance latency models: seed has no effect | CI | 10 I1 |
| DET-10 | Changing `idx`, job order or machine changes nothing | CI | 10 I1 |
| DET-11 | Journal replay gives identical decisions and output | M8 | 50 §13, 22 §6.6 |
| DET-12 | Reproducible build of the same source gives the same sha | M6 | 31 §7.6 |
| DET-13 | The RNG-7 golden vectors, including the `md_row` and feed rows, pass in Rust and in `selftest` | CI | 10 RNG-7, 14 V-10 (f), 21 §3 CI item 7 |
| DET-14 | Derived tape vs canonical v1 input: identical deterministic bytes and traces | CI (fixtures), LG-1, DP-6 | 16 NT-6, 15 I-V6, D46 |
| DET-15 | Declared interests (event flags, tick interest) = all interests | CI (fixtures), `strategy:check` | 30 §4.1, D41 |

Binary protocol tests (20 §8): items 1–4 are DET-2, DET-3, DET-6 and DET-5.
Items 5–9 and 12 are CI-1 tests `BP-5` to `BP-9` and `BP-12` (bad paths,
unknown fields and foreign schema versions exit 2; parent death ends the
binary within 1 s; deadline, cancel and poison-job isolation; `describe`
idempotence and batch equality; `contractSha256` equals the checked-in
bundle; deep recursion identical under `run` and `serve`), each from the
milestone that delivers its subcommand. Item 11 (flag matrix, exit 2 before
anything is enqueued) is CI-2 test `BP-11` from M3a. Item 10 (`paper` and
`live` refusals, `standard` build) is part of LV-9.

Candidate-group tests (41 §10, M4 proof), on at least 20 candidates × 200
markets (01 M4):

| # | Test |
|---|---|
| CG-1 | Group rows equal standalone rows on persisted data (`npm run backtest:verify-diff` with the exclusions of 41 §10.1) |
| CG-2 | Shuffled candidate order, `T = 1` vs `T = max`, both layouts: byte-identical (DET-3) |
| CG-3 | Standalone `--extend` of one candidate over more markets equals a fresh standalone run over the union |
| CG-4 | Fault injection with a test-only strategy `panic-probe.rs` (param: slug and `seq` to panic at): only that candidate's failure rows appear; every other candidate equals the clean group |
| CG-5 | Throughput at 1, 10 and 100 candidates, peak RSS and Redis peak are reported (16 §13), not gated |

## 10. Independent spec-conformance tests

### 10.0 Workstream C (schedule)

G2 requires the G2-scope conformance tests (§10.2) and the independent review
of money-semantics classifications (CL-10), and the implementation session
may write neither. They therefore run as a parallel workstream C next to the
milestones of 01 §6, written by Fable (D45):

| Phase | Starts | Work | Delivers |
|---|---|---|---|
| C0 | Right after G1 (tag `native-spec-g1`, D56) | The launcher creates the conformance checkout (CF-2) unless the implementation session already did (01 M1 step 1), and starts Fable there with this section as its brief | checkout and branch `native-conformance` |
| C1 | C0 | Table-driven vectors from the spec tables (§7.4) and test plans per §10.2 row, written against the SDK surface declared in 30 | `native/conformance/` data files and test skeletons |
| C2 | M1 step 5 (testkit, binary and rustdoc exist) | Executable G2-scope tests; triage (§10.3) | G2 scope committed before M2 step 3; green or triaged before M2 step 4 (the G2 report) |
| C3 | M2 step 3, after the C2 commit | Independent review of PARITY classifications (§10.4); only now is the `native/PARITY.md` read deny of CF-2 lifted | review fields in PARITY.md entries |
| C4 | M3b start, M9 start | G3 and G4 scopes | before the G3 and G4 reports |

Inputs: `native/spec/` at the G1 tag without `research/` (read with
`git show native-spec-g1:native/spec/<file>` until the branch carries the
spec), the Polymarket docs (`docs/polymarket/`), the rustdoc of `pmb-sdk` and
its testkit, the binary protocol (20) and canonical binaries for black-box
runs. `native-conformance` starts from `origin/main`; from C2 it merges
`native-engine` to build the testkit. The implementation session merges
`native-conformance` into `native-engine`; those merges bring only
`native/conformance/`. If Fable is not running when M1 step 5 ends, the
session records it under "Waiting on user" in STATUS.md and continues with
work that does not need it.

### 10.1 Authorship and isolation

- **CF-1** Written by Fable (D45), a different model than the implementation
  session, from the inputs of §10.0.
- **CF-2** The checkout is a separate clone on worker-1,
  `/Users/worker-1/Sites/polymarket-bot-conformance` (01 §8.1 H1), never the
  native clone or the fleet copy; data and `node_modules` follow 01 §8.1 H2.
  After C2 starts it contains the engine sources (cargo needs them to build
  the testkit), but the checkout's own `.claude/settings.local.json` denies
  reading and searching `native/crates/*/src/**`, `native/strategies/**`,
  `native/spec/research/**`, `native/PARITY.md` (until C3) and
  `native/STATUS.md`, and the author MUST NOT open them by any other means.
  Tests are black-box: through the testkit API or the binary (`EngineJob` in,
  `EngineResult` and trace out). cargo runs only as
  `cargo test -p pmb-conformance` and `cargo doc --no-deps -p pmb-sdk`.
- **CF-3** Tests live in `native/conformance/`. Each test names its clause
  (`// spec: 11 GT2`) or doc URL. Conformance commits touch nothing outside
  `native/conformance/` and start their subject with `conformance:`. The G2,
  G3 and G4 reports list `git log --format='%h %an %s' -- native/conformance/`
  so any other commit touching it is visible; no CI check is needed.
- **CF-4** The implementation session MUST NOT edit, skip or weaken
  conformance tests.

### 10.2 Scope by gate

| Gate | Clauses |
|---|---|
| G2 (profile-independent and ts-compat) | Order state machine (one test per row of 10 §8.2), account event ordering and cascades (12 §6), capital C1–C4, cid generations, dedupe (12 §7.6), output quantization (10 §4), skip taxonomy (21 §13), contract vocabularies (21 §17), `ModelConfig` hash, seed vectors (10 RNG-7), ts-compat rule values (11 §4) |
| G3 (realistic) | Fee curves, eras and rounding (11 §5), taker delay (11 §6), tick, bounds, precision, minimum sizes (11 §7), GTD (11 §8), caps (11 §9), post-only (11 §11), FOK and FAK incl. collateral sizing and the conversion of share-sized market BUYs (10 §7, D42), the self-cross block with one case per N6 condition (same outcome both sides, mint, merge, batch entry, in-flight own order; 10 N6, D54), settlement statuses and FAILED reversal (10 §9.2), window end (D23), async split and merge (D25) |
| G4 (live) | V2 order struct and signing vectors from the docs, heartbeat (D30), 425/503/cancel-only handling, user-WS mapping incl. FAILED and maker identity (50), real-order gate and `standard`-build refusals (20 §7, §8 item 10; D44), journal redaction (22 §6.7); the calibration analysis harness: Modes A, B, C on both input modes and the self-tests of 51 §11.4 (51 §11) |

### 10.3 Triage

A failing conformance test is triaged by the conformance author against the
cited clause: (a) implementation bug → the implementation session fixes it;
(b) test misreads the clause → the author fixes the test and records why;
(c) spec ambiguity → a clarification or a new 02 entry (00 §3.2). A test is
never deleted to make a build green.

### 10.4 Independent review of classifications

The conformance author (or another independent session) reviews every PARITY
entry of class TS bug or intended model change: reads the clause, the repro
and the patch, re-runs the counterfactual, and records agree or disagree.
Disagreements go to the user at G2.

### 10.5 Clause traceability

Not required for G2 (the G2 scope is the explicit list of §10.2). From M3b,
`npm run native:spec-coverage` extracts clause ids (`T1`, `S1`, `GT2`, `CL-3`,
…) from the MUST statements of documents 10–15 and 20–22 and lists those with
no test tag (`spec:` in conformance, unit and property tests). The list is
part of the G3 and G4 reports. It is not blocking, but each uncovered clause
is explained.

## 11. Realistic A/B reports (M3b)

The fix list (RF01–RF15), the A/B procedure (rule fixes as commit pairs, axes
as arms, leave-one-out and the profile pair at the end of M3b), the command
`npm run native:ab`, the report path (`native/reports/ab/RFnn-<name>.md` plus
`.json`) and the report content are owned by 13 §7. This section adds the
verification rules around them.

- **AB-1 Market set ("the M3 set").** S15 (and S5 once filled, D38) for the
  realistic exerciser, SL for lagsnipe.v15.rs (§4.2). S15 covers every fee
  era F0–F3 (MS-2); SL starts at the Chainlink coverage (2026-04-02), so it
  covers F2 and F3 only. RF09 in prints mode uses the V4 sets of M7
  (13 §7.2). Both arms use the same markets, run seed and per-market seeds;
  axis arms run on one engine commit, rule-fix arms compare the parent
  commit's build with the fix commit's build (13 §7.2). Every report breaks
  its metrics down per fee era (11 FT2, D51) and shows separately the subset
  that can count for gate 3: markets starting at or after
  2026-08-17T11:00Z (11 TD6, D52) in a fee era the study verified (11 FS1,
  D53). If that subset holds fewer than 100 markets, the M3 set is extended
  with the next seeded markets from that period.
- **AB-2 Pre-registration.** Before fix *k* runs, its report skeleton with the
  expected direction of every metric 13 §7.1 requires (for example RF01: no
  fee before 2026-01-05, fees only on taker fills) is committed. The report
  then shows expectation vs outcome per metric. A failed expectation stops
  that fix until it is explained; the explanation is part of the report.
- **AB-3 Checks on both arms.** Invariants (§8.1) hold, the determinism
  re-run is byte-identical, and the realistic exerciser hits the features of
  §5.9 that the fix touches.
- **AB-4 ts-compat unchanged.** After each fix the parity subset (PS-50, §4.5)
  passes, and the full matrix is re-run Rust-only before the fix's commit
  lands (13 §7.2).
- **AB-5 Approved snapshots.** The snapshot update (§8.4) that comes with a
  fix cites its RF id.

## 12. Committed fixture markets

- **FX-1** `native/fixtures/markets/<slug>/` holds at least four markets:
  three BTC 15m from three different fee eras (11 §5.3) and one edge market
  (crossed book or clock going backwards), plus two BTC 5m when local 5m
  files exist (D38; otherwise after a Telonex renewal, with BTC 5m covered by
  the V4 fixtures of FX-4 from M7). Each has the Telonex file, Binance
  and Chainlink excerpts trimmed per FX-2 (Chainlink only for markets inside
  its coverage, from 2026-04-02, 14 F-19), the price-to-beat value, the job,
  the TS ts-compat traces of the exerciser and of the feed exerciser (markets
  with Chainlink coverage only) at the pin, approved realistic snapshots
  (§8.4) and expected digests (DET-7). At least two 15m fixture markets lie
  inside Chainlink coverage, so lagsnipe and the feed exerciser have fixture
  runs.
- **FX-1a Job paths.** The committed `job.json` uses fixture-relative input
  paths; `npm run native:fixture-job -- <slug>` renders the absolute-path
  `EngineJob` that 21 §5.1 requires (it is what the 01 M1 proof runs).
- **FX-2 Trimming rule.** For each feed, keep one file per covered day
  (14 F-12, F-20) in the dataset schema (same columns, types and row order),
  holding exactly the rows inside the membership range (F-13, F-21) plus the
  seed row (F-14, F-22) in the day file that holds it. The job records each
  trimmed file's byte size and sha256. The fixture generator runs TS on the
  full and on the trimmed inputs and commits only when both TS traces are
  byte-identical, which proves the trim changed nothing visible. Loaders
  MUST accept trimmed files. Total fixture size at most 25 MiB in git.
- **FX-2a No TA in fixtures.** TechnicalIndicators needs about 160 h of
  aggTrades (14 P-12), which cannot fit. Fixture runs use `ta: false`; TA is
  covered by cell F15-TA on local data and by committed candle and indicator
  fixtures for unit tests (14 V-6).
- **FX-3** TS traces of fixtures are regenerated at each pin change that
  touches engine paths; the regeneration commit cites the pin.
- **FX-4** V4 fixture packages for M7 follow 15 I-V2 (normal, gaps, invalid
  frames, control resets, second bootstrap, multi-market frames).
- **FX-5** With these, CI runs complete jobs without R2, MySQL or Redis
  (01 M1 step 5).

## 13. Live verification (M8, M9)

| # | Test | Gate | Source |
|---|---|---|---|
| LV-1 | Paper sessions totaling ≥ 24 h, 5m and 15m: every journal replays to identical decisions, fills and `EngineResult` bytes. Agent-run sessions run on worker-1, load no secrets and use strategies that request no Chainlink (engine exerciser, feed exerciser with `chainlink: false`); lagsnipe sessions are launched by the user (01 M8, 50 §8.1) | M8 proof | 50 §13, 22 §6.6 |
| LV-2 | Drills in those sessions: market-WS reconnect, restart mid-market (D29), rotation with a pending order, injected strategy panic (D32), kill switch, GTD expiry, journal soft-bound stall | M8 proof | 50 §13.4 |
| LV-3 | Cross-artifact: the `standard` build replays a journal written by the user's `real-orders` build of the same source hash with identical decisions (the user builds that variant on the chosen live host and runs a short `paper` session with it; the agent only replays the journal); repeated on the first real-order journal in M10 | G4 | 50 §13.3, 31 §5.5 |
| LV-4 | Live-vs-backtest decision parity on worker-2 V4 recordings of the paper markets (reported, not gated) | M8 (SHOULD), G4 report | 50 §13.5 |
| LV-5 | Mock exchange: a deterministic in-process CLOB (REST + user WS + market WS) driven by scripts built from documented payloads and recorded paper fixtures | M9 | 01 M9 |
| LV-6 | Fault injection on the mock: one case per cancel-cause row of 50 §8.2.4, per cap (batch, cancel ids; 50 §8.2.3) and per journal bound (soft and hard, 50 §12); ambiguous POST (timeout, 5xx, reset) → `Unknown` then reconciliation, no double placement; 429 and 425 with `Retry-After`; 503 post-only window; cancel-only; heartbeat miss → exchange cancels all → `order_done(HeartbeatLoss)`; trade MATCHED then FAILED → reversal; late fill after cancel; fill before ack; duplicate fill via WS and REST; user-WS reconnect resync; clock-offset jump; journal disk stall (intents stop, cancels go out); lockfile held by another process | G4 | 50 §19, 10 §8, 22 §6.4 |
| LV-7 | Signing vectors from the docs for every domain of 11 §10 and the signature type chosen at G4 (01 §12.1 item 4) | G4 | 11 §10 |
| LV-8 | Shadow mode during a paper session: orders built and signed with a throwaway key, never sent | G4 | 01 M9 |
| LV-9 | Safety: a `standard` build (D44) has no order-sending code, reports `realOrders: false`, refuses `live` (exit 2) and cannot reach a trading endpoint; `live` refuses without each gate condition (20 §7); `DRY_RUN` and other env never enable sending; a redaction scan of test journals finds none of the fixture secrets | G4 | R10, 20 §8 item 10, 22 §6.7, 50 §19 |
| LV-10 | The live runtime crates, the adapter and its mock-exchange and golden-vector tests pass on `aarch64-unknown-linux-gnu` and `x86_64-unknown-linux-gnu`, in CI or by a local cross build | every milestone from M8 | 50 §4.4 |

The agent never runs `live`, never loads real keys, never runs
`strategy:build-live` and never builds or runs the real-order feature
against production (R10, 31 §5.5). The adapter's tests compile that feature
only in `cargo test` against the mock exchange and recorded fixtures, with
throwaway keys.

## 14. CI and local gates

| Id | Runs on | When | Blocking | Contents |
|---|---|---|---|---|
| CI-1 `native-quality` | GitHub `ubuntu-latest` | every push to a PR | yes | `cargo fmt --check`; `clippy -D warnings` with the engine's determinism lints (30); `cargo test --locked` (unit, goldens, converted suites, property tests with fixed seed, conformance, approved snapshots, fixture-market parity against committed TS traces, DET-1/2/4/5/7/8/9/10/13/14/15 and BP-5 to BP-9, BP-12 on fixtures); the contract CI items of 21 §3 (schema re-export diff, contract fixtures, default `ModelConfig` sha, RNG-7); `cargo deny` (31 §3); from M8, LV-10 on `x86_64-unknown-linux-gnu`; version check: a commit that changes any approved snapshot or expected fixture digest MUST bump `engineVersion` and add a CONTRACT changelog entry for it (30 §17) |
| CI-2 `root-quality` (existing) | GitHub `ubuntu-latest` | every push to a PR | yes | existing checks, plus parity tooling tests (diff v2 rules, matchers, coverage), generated TS contract diff, ajv fixtures (21 §3), `native:goldens:check` (GF-4), BP-11 from M3a |
| CI-3 `parity-rule` | GitHub | PRs to main after G2 | yes | OR-14 |
| LG-1 `npm run native:verify:local` | worker-1 | before every milestone proof, before each merge after G2 (result in the PR body) | by rule | canonical `artifact` and `parity-check` builds for `aarch64-apple-darwin` (31 §4.2, §7.6; §8.1), `selftest` (20 §5.3), fixture parity on both, DET suite, digests equal to CI-1 (DET-7) |
| LG-2 parity matrix | worker-1, `--concurrency 4` (01 §8.1 H4) | every sync with engine-path changes, before G2, after structural optimizations (Rust-only) | gate | §4 |
| LG-3 parity canary | worker-1 | every sync; nightly in the D47 window | no | OR-16 |
| LG-4 fleet canary | the M6 native hosts (D55, 40 §2) | before enabling native dispatch; every engine minor release | blocks enabling | 40 §12, DET-6 |
| LG-5 nightly extras | worker-1 | nightly in the D47 window (01 §8.1 H5) | no | property tests with fresh seeds, fuzzing, `smoke-50` benchmark (16 §13.1, only under the quiet-host conditions of 16 §13.5) |

- No GitHub macOS runner runs per PR (D48). The macOS target is verified by
  LG-1 and LG-4, because the logic is platform-independent (R7) and DET-7
  proves cross-architecture identity on every push.
- `native-engine` has the draft PR "DO NOT MERGE before gate 2" from M1
  step 1 (D48), so GitHub CI checks every push
  (`.github/workflows/quality.yml:3-15` triggers on `pull_request`). The
  session still runs `npm run native:ci:local` before each commit and records
  the result in STATUS.md (R12).

### 14.1 Verification tooling: owner and schedule

Every script below is a `package.json` entry on the implementation branch,
created by the implementation session in the listed step (01 §6) and listed
in that step's STATUS.md plan.

| Script | Contents | Created in | Needed by |
|---|---|---|---|
| `native:ci:local` | `cargo fmt --check`, `clippy -D warnings` and `cargo test --locked` in `native/` and `native/strategies/` (whichever exist yet), `npm run lint`, `npm run code:typecheck`; grows with each step until it equals CI-1 plus CI-2 | M1 step 1 (first commit) | every commit (R12) |
| `native:verify:local` | LG-1; starts as `native:ci:local`, gains the canonical builds, `selftest`, fixture parity and the DET suite in M1 steps 5–6 | M1 step 1 | milestone proofs; merges after G2 |
| `native:goldens:check` | GF-4 | M1 step 2 (with the first goldens) | CI-2, every sync |
| `native:fixture-job` | FX-1a | M1 step 5 | 01 M1 proof, CI fixtures |
| `native:oracle:env-audit` | OR-7 (a grep of `process.env` under the OR-2 paths against the OR-7 table and an allowlist) | M1 step 6 (with HR-3) | every sync, every gating run |
| `native:parity:summary` | renders the PARITY.md matrix status and the gate evidence tables from manifests (HR-7, §15.2) | M1 step 6 (T15 cells) | PARITY.md, gate reports |
| `native:oracle:sync-report` | OR-11 | M2 step 1 (the first pin change after M1; before it, the OR-11 line is the raw `git log` output) | every sync |
| `native:spec-coverage` | §10.5 | M3b | G3, G4 reports |
| `native:ab` | A/B runs and reports (13 §7.2, §11) | M3b, before the first fix | every fix's report |

There is no separate gate-report generator (§15.2) and no CI check of
conformance commits (CF-3); both were cut to keep tooling off the path to G2.

## 15. Gate evidence and presentation

### 15.1 Gate report

Each gate produces `native/reports/gate-<n>-<YYYY-MM-DD>.md` (01 §7), in
English (R15), with this structure:

1. **Verdict** (fits one screen): a table with one row per required criterion
   (PASS, FAIL, n/a, evidence link), then the **decisions requested**,
   numbered, each with the recommendation and its consequence.
2. **Money-semantics classifications** (G2): one row per entry with
   `money = yes`: what differs, why, the counterfactual result, independent
   review, Σ\|Δpnl\| and max \|Δpnl\| over the parity sets, and won/lost/flat
   flips. The user confirms or rejects each row.
3. **Evidence tables** for every layer the gate requires (§1).
4. **Deviations**: new 02 entries since the last gate, spec clarifications,
   masked markets (PM-4), non-gating cells and why (for example BTC 5m,
   §4.1, D38), uncovered clauses (§10.5; G3 and G4 only).
5. **Reproduce**: exact commands, oracle pin, engine commit, binary sha256s
   (`artifact` and `parity-check`), manifest paths and sha256, and the
   conformance commit list (CF-3).
6. **Known gaps and risks.**

### 15.2 Generation

The session writes the report by hand around tables rendered by
`npm run native:parity:summary -- <manifest>…` (§14.1), pasted verbatim with
the sha256 of each manifest they come from (VP-2); A/B numbers come from the
`native:ab` reports (13 §7.2) and benchmark numbers from the 16 §13.8
reports. The session writes only the decisions, explanations and risks.
Hand-edited numbers are forbidden.

### 15.3 Required content per gate

| Gate | Criteria in the verdict table |
|---|---|
| G2 | Every gating BTC 15m cell passes §4.4 (E5 non-gating, D38; other non-gating cells listed with the reason); PARITY.md has zero unclassified and zero open Rust bugs; money-semantics rows independently reviewed (CL-10); coverage (§5.6, LS-2); LS-4; L1, L2, L4, L5, L8 green; G2 conformance scope green or triaged (§10.2); oracle self-check (OR-9); TS self-parity (OR-17); harness validation (H-1); `parity-check` identity (§8.1); benchmark and derived-tape numbers so far for the fleet-wide tape decision (16 §13.8, M-20; D46); merge plan (01 §8) |
| G3 | The calibration report of 51 §15, per input mode with C9/C10 as headline if accepted at G4 (51 §12.4); one A/B report per fix (§11); historical evidence counted only from markets starting at or after 2026-08-17T11:00Z (11 TD6, D52) in fee eras verified by the fee study (11 FS1, D53), earlier markets flagged; G3 conformance scope green; ts-compat matrix unchanged since G2 or re-run and passing |
| G4 | LV-1 to LV-10; G4 conformance scope green; the safety checklist of 01 §7; the calibration runbook, probe rehearsal and frozen thresholds (51); the questions of 01 §12.1 |

### 15.4 Presentation to the user

At a gate the session commits the report, sets STATUS.md "Waiting on user"
(01 §7), and sends the user a short message: the verdict in one line, the
numbered decisions requested, and the report path. Details stay in the
report. The session MAY also publish the report as a private page for reading
on a phone. Gated work stops until the user answers; independent work may
continue on the branch (01 §6). G1 has no report (delegated, D56).

## 16. WIP salvage (verification tooling)

| WIP item | Verdict |
|---|---|
| `src/backtest/parity/{trace,diff,coverage,marketJob,runJob,report,cliArgs}.ts`, `src/cli/parity/*`, `scripts/parity/*` | Keep. Apply HR-1 to HR-9, trace v2 (22 §3), diff v2, coverage v2 (§5.6). Keep the allowance inheritance from the params run (`common.ts:50-55`, §6.3); remove the `STARTING_CAPITAL` and default fallbacks (`common.ts:53-55, 80-86`, OR-7) and the whole-environment pass-through (`run-parity.ts:291`) |
| `src/strategies/testing/engine-exerciser.ts` | Keep; extend to schedule v2 (§5.3, §5.4) |
| `native/crates/pmb-core/tests/fixtures/{stats_gen,plugins_gen}.ts` and goldens | Move to `native/fixtures/` (GF-1); add headers (GF-2); annotate the merge-PnL divergence (GF-5) |
| `pmb-core/src/stats/tests.rs:142-162` (asserts JS rounding) | Rewrite to half away from zero (10 R-1) |
| `pmb-core/src/portfolio.rs:884-1153` tests ported from the TS capital suite | Keep as vectors for §7.3 and the live reconciliation layer |
| `native/EXERCISER.md`, `native/TRACE.md` | Superseded by §5 and 22 |

## Gate-4 questions

None owned here (list: 01 §12.1). Two answers select test content: the
wallet type (item 4) fixes the signature type of LV-7, and the live host
(item 3) is where LV-4 and the latency reports are measured.

## Open questions

None. Settled at gate 1 (D56): no GitHub macOS runner and a draft PR before
G2 (D48, §14); Fable as the conformance author, started by the launcher
right after G1 (D45, §10.0); unattended nightly jobs on worker-1 in the
01:00–07:00 window (D47, OR-16, LG-5). Settlement updates are traced in both
profiles (22 §3.2), so status-driven decisions are verified directly.
