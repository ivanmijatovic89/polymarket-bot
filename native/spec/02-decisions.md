# 02 — Decision log

"user" = decided by the owner, binding. "lead" = decided by the lead, binding
unless the owner changes it. A change is a new entry; the old entry gets one
line "Amended by E<n>". Carried decisions from the previous attempt are listed
in E06 by their old number and are binding as summarized here; the old log is
reference only (03 §3).

## E01. Recorder V4 first; Telonex later with measured feed timings

**Decision (user, 2026-10-09):** `recorder-v4` is the only backtest input until
N7. Telonex replay is added in N7, reusing the engine, with feed visibility
timings measured in N2/N4. Reason: V4 carries real receive times and trade
prints for every feed, so version one needs no feed-latency models; Telonex
has the history (27,614 BTC 15m markets on worker-1) that research needs
later.

## E02. The exchange is the oracle; the TS engine only generates decode goldens

**Decision (user, 2026-10-09):** no ts-compat profile, no parity matrix, no
classification ledger against the TS engine. The TS engine's readers generate
goldens for V4 and Telonex decoding (N1, N7). Execution behavior is measured
against Polymarket CLOB V2 with small owner-run probes (N2) and modeled from
the measurements (N3). The lagsnipe difference report of N5 explains
divergences by model, it is not a gate.

## E03. Minimal exchange adapter and probes early; full live runtime last

**Decision (user, 2026-10-09):** the adapter, journal and probe runner are N2,
right after the V4 reader. The production live runtime (discovery, rotation,
guards, alerts, launchd, trust chain) is N9, after the backtest path is merged.
The first real strategy run is gate D and needs the owner.

## E04. Probe session P0: budget $20, within days of N2

**Decision (user, 2026-10-09):** P0 runs on BTC 15m at minimum sizes with a
hard $20 cap, within a few days of the adapter being ready. The owner builds
the `real-orders` binary, holds the keys and launches; the agent prepares the
script and runbook and analyzes the journal.

## E05. Base of the branch: main plus the reviewed leaf crates

**Decision (user, 2026-10-09):** the branch starts from `origin/main`. Only
input-independent, reviewed leaf crates are carried into the tree (`domain`,
`orderbook`, `job-contract`, `telonex-replay`, about 16k lines incl. tests).
Everything else from the previous attempt stays on branch `native-engine` as
reference and is copied only after review when a milestone needs it (03).
The carried crates still contain copy-mode remnants (profile enums, a flat
fee model, a compat latency model, old feed constants, a ts-compat rule set);
N0 strips them before N1 builds on the crates (01 §1).
Reason: the owner must be able to tell what is what; architecture is rebuilt
measurement-first.

## E06. Decisions carried from the previous attempt

**Decision (lead, 2026-10-09, confirmed by the owner's direction):** these
old entries stay binding with the meaning given here. Anything not listed is
not carried.

| Old | Carried meaning |
|---|---|
| D06 | BTC 5m and 15m only in v1. |
| D08 | Per-market money quantized to 2 dp half-away-from-zero at the output; internal math at 1e-6. |
| D09 | Run provenance: indexed `engine`, `engine_version`, binary sha, versioned `model_config` JSON incl. the calibration id; the binary never reads env for behavior. |
| D10 | Dashboard Market Simulator blocks native runs with a clear message until a sink exists. |
| D11 | Opt-in fill ledger as gzipped JSONL in R2; live and paper windows stored as `backtest_runs` rows with `input_mode` `live` / `paper`. |
| D12 | Separate native fleet queue gated on shim version, schema version and target triple. |
| D13, D14 | Candidate groups: `--candidates <file.json>`, one `backtest_runs` row per candidate, group equals standalone; seed per (run seed, slug). |
| D17, D18 | Artifact identity = sha256 of a reproducible build (path remap, pinned toolchain, `--locked`, ad-hoc codesign); fastest-running profile for shipped binaries, a fast profile for local checks. |
| D20 | A Rust port of a TS strategy gets a distinct id (`….rs`). |
| D22 | Charged fee amounts win over docs. |
| D21 | Per-market rules snapshot table keyed by condition id, filled from the rules capture and V4 `rawJson`; dated fallback flagged `rulesSource = fallback`. |
| D23 | Window gate: strategy only inside the window; orders match until the window end, then expire; identical in backtest, paper and live. **Hypothesis until probe R15 confirms.** |
| D24 | Books are decontaminated of our own orders before any replay used for calibration; markets we traded are excluded from research universes by default. |
| D25 | Split, merge and redeem transactions go through the TS relayer sidecar; the engine models them as async operations. |
| D26 | Live journal = the V4 envelope extended with account, REST, timer and operator sources plus an execution sidecar. |
| D27 | `ctx.now` = local receive time; exchange timestamps exposed separately; expiry checked against estimated exchange time. |
| D28 | Paper mode simulates fills with the measured models; decisions-only as a flag. |
| D29 | On restart: cancel the market's orders, adopt positions read-only, flag them. |
| D30 | Heartbeat only in `real-orders`, one owner per API key enforced by a lockfile. |
| D31 | Live available cash = min(per-market allocation, collateral minus reservations); session guards that survive rotation. |
| D32 | Strategy panic live: cancel_all, halt until rotation, alert. |
| D33 | Alerts on kill switch, loss stop, WS gap, heartbeat failure, reconciliation mismatch, panic, reject bursts; channel is an owner question at gate D. |
| D36 | Host for engine work, builds and backtests is worker-1. The owner's own Mac is used only to build and run `real-orders` sessions (P9). |
| D40 | The lagsnipe v15 port is made from the built TS artifact `304eceb3…` in the fleet's strategy artifact cache. |
| D37 | The pre-start rules capture runs on worker-1; its files are imported in N5. |
| D42 | FOK/FAK BUY sized in collateral at the limit price. **Hypothesis until P0 confirms.** |
| D44 | Two builds from one source: `standard` cannot send orders; `real-orders` is built and launched by the owner only. |
| D47 | Unattended benchmarks only 01:00–07:00 with the fleet paused; until the owner confirms the pause procedure, benchmarks run alongside and are labeled `non-idle`. |
| D50 | Only additive migrations; the agent applies each after its PR merges. |
| D51, D52, D53 | Telonex replay only (N7): mixed fee eras allowed with per-era statistics; taker-delay rows for dates before our own measurements flagged `hypothesis` (the exchange changed the delay on 2026-08-17 and 2026-09-04); the free Data API path first for historical fee ground truth. |
| D54 | Orders that would cross our own resting orders are rejected before sending, identically in backtest, paper and live. |
| D55 | Fleet hosts for native jobs: worker-1, worker-2 (about 3 slots), milan-m1 if available; the owner's MacBook only produces. |

Not carried: D01–D05, D07, D15, D16, D19, D21, D24, D34, D35, D38–D41, D43,
D45, D46, D48, D49, D56–D71 (process of the previous attempt, ts-compat, the
calibration plan as a $100 strategy-level run; the probe-based calibration of
N2/N3 replaces it; D35's pass marks are adapted in 01 §4).

## E07. Spec size cap

**Decision (lead, 2026-10-09):** 00–03 together stay under 2,500 lines; 10 and
11 are reference and stay under 300 lines each. Detail beyond that is cited
from the previous attempt's documents by section (03 §3), never copied in.

## E08. Milestone proofs name commands the lead defines in N1

**Decision (lead, 2026-10-09):** binary subcommands, flags and script names in
01 are the lead's to define in N1 and are recorded here as E-entries when
defined; 01 is then corrected to the final names in the same commit.

## E09. Cascade order

**Decision (lead, 2026-10-09; design, not a TS fact):** account events produced
while handling a callback are delivered breadth-first FIFO within the same
tick; each callback may return intents; a cascade budget per tick raises a
fault when exceeded. Rationale: simplest deterministic rule; matches what the
previous attempt verified against its converted test suites.

## E10. Capital reservation

**Decision (lead, 2026-10-09; design):** a placement reserves its full cost
(BUY: size × price plus the fee the fee model predicts; SELL: the shares) at
submission; reservations are released on every terminal state and adjusted on
each fill; a reservation can never go negative; the ledger applies every event
as it is emitted. Property tests in N1 enforce this.

## E11. Crate names describe their content; no project prefix

**Decision (user, 2026-10-09):** crates are named for what they hold, without
the previous attempt's `pmb-` prefix. In tree: `domain` (money math, ids,
seeds, market identity, exchange rules, order types and state machine),
`orderbook`, `job-contract`, `telonex-replay`. Planned: `v4-replay` (N1),
`engine` (N1), `execution` (N3 models), `exchange-clob` (N2 adapter),
`runtime` (N1 binary), `sdk` (N1/N5), `feeds` (N7), `plugins` (N5). Module
paths use the underscore form (`domain::rules`). The reference tables in 03 §2
keep the old names because they are paths on branch `native-engine`.
Layout: `native/crates/<role>/<crate>` with roles `core`, `inputs`, `exchange`
and `interface`; the map is `native/crates/README.md` and is updated whenever
a crate is added.
