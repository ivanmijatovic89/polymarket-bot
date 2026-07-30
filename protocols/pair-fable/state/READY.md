# READY — Mission 01 (pair-fable) completion report

Date: 2026-07-30 · Session 12 · All 9 PLAN items passes:true with evidence ·
Repo @ 5538f6c (origin/main)

## Verdict

The research loop runs end-to-end with no unknowns: design a variant →
smoke locally (`--sequential`) → push → submit to the fleet → read results →
evaluate through staged gates → record in memory. Every leg was executed on
real runs this mission (19 runs, ids 852–870, all re-verified in MySQL this
session: completed, correct market counts, 0 failures, provenance set).
Mission 02 can start.

## Delivered

**Tools** (`tools/`, all run-verified; contracts in `tools/README.md`):
`run-backtest.ts` (canonical launcher — RULES pins injected, unknown flags
fatal, unique-batchUid run recovery, `--sweep-latency` fan-out, full-universe
limit injection), `smoke.ts` (mandatory pre-fleet gate), `results.ts`,
`compare.ts` (slug-intersection compare + daily-pnl Pearson + sweep
auto-detect), `evaluate.ts` (executable evaluator: stage verdicts),
`fleet.ts` (queues/workers/batches), `sql.ts` (read-only ad-hoc),
`refresh-capabilities.ts` (capability self-upgrade), shared
`lib/runQueries.ts` (one code path for all numbers).

**Memory** (`memory/`): `INDEX.md` entry point + binding conventions
(evidence tags, time-scoped negatives, per-note `verified:`+`watches:`
headers, update-after-every-step); 6 capability notes (backtest CLI, fleet,
metrics/storage, parity, simulator, strategy system — all CURRENT at
origin/main per a clean `refresh-capabilities` run this session);
`process/evaluator.md` (complete evaluation spec), `process/
capability-refresh.md` (human-triggered engine-change fold-back),
`process/team-workflow.md` (parallel-loops proposal, NEW this session);
`experiments/LEDGER.md` + `experiments/pair-v0.md` (E-001..E-005).

**Parity boundary** (`capabilities/parity.md`): shared core vs simulated
boundary per intent/event, 8 binding strategy conventions, and the 8-point
live-trust evidence bar. Headline facts: worst-queue maker model UNDERSTATES
maker fill rates (safe bias); cost==invested verified to the cent for
no-sell strategies; taker fee = 0.07·p·(1−p)·size verified; maker-only
intent streams still leak taker fills that GROW with latency (1.4%→9.1% at
140→1000ms — E-003).

**Evaluator** (`process/evaluator.md` + `evaluate.ts`): stages S0 smoke →
S1 screen (±max(2×noise, 0.05) gate; measured noise floor 0.0008 ev/mkt for
the passive-maker family) → S2 full universe + weekly walk-forward → S3
upward latency sweep (RULES gate) → S4 future-as-holdout OOS (design-ts
split — un-cheatable; ≥400 OOS markets ≈ 4–5 days of new markets);
capital-aware units with exact SQL; capPerMarket sweep grid 25/50/100/200;
independence r<0.6/≥14d; overfitting guards (pre-registration, ≤6 params,
stopping rule, time-scoped kills). Executed end-to-end on real data (runs
863–870): every stage produced the correct verdict, including the correct
"wait for OOS markets" answer.

**Baseline** (`strategies/pair.v0.ts`, id `pair-fable-v0`): honest RULES
implementation, mechanically sound (imbalance ≤ increment, cap binding,
zero sells/merges, meta convention). NOT profitable — and that is the
mission's most valuable strategy finding: on all 10,747 protocol-floor
markets the loss is stationary (monthly ev −2.21..−2.26 across all 4 months,
0/16 positive weeks — run 870). The baseline loses by mechanism (unpaired
residue: pairs earn ≤$0.02 while unfilled completion legs strand full
increments), not by regime. Consequence for research: any variant turning
even one week positive is signal, not luck. Six concrete variant axes are
recorded in `experiments/pair-v0.md`.

**Proposals**: P-001..P-008 filed in `state/PROPOSALS.md` (all engine
findings recorded; none silently forgotten — re-checked this session).
Protocol-side mitigations exist for P-001 (extends refused), P-003 (batchUid
recovery), P-008 (explicit limit injection); P-005/P-006 are strategy
conventions; P-004 and P-007 need nothing from us to proceed.

## Remaining unknowns / risks

1. **The live side is code-verified only.** No live process was ever
   started (mission scope). Evidence-bar point 8 (DRY_RUN=true live windows)
   is deliberately future work for the first live candidate; live merge
   execution/timing is out of backtest scope by RULES. P-006/P-007 cancel
   semantics are code-read, not live-observed.
2. **Worst-queue conservatism** can make genuinely profitable passive
   variants look unprofitable (RULES acknowledges). Mitigation is judgment
   (family-file notes near ev 0), not measurement — residual risk of burying
   a viable idea remains.
3. **Noise floor is family-specific** — 0.0008 measured for passive-maker
   only; taker-heavy families must re-measure (evaluator.md rule) or the
   0.05 default may under/over-gate.
4. **Screen-universe drift**: screens compare only against a baseline ≤7
   days old (re-run discipline, evaluator.md). A stale baseline silently
   weakens S1 — procedural risk.
5. **Single-symbol calibration**: every number (noise, speed, thresholds) is
   btc 15m. Other symbols/timeframes re-calibrate, per RULES scope.
6. **DB growth**: each FULL run writes ~10.7k market rows; a long Mission 02
   accumulates. Not blocking; flagging for human awareness (retention is an
   engine/ops decision, not ours).
7. **P-004 open**: 5 worker slots run on the producer/live-trading machine.
   Irrelevant to backtests, but it needs a ruling before live trading starts
   (core contention).

## Mission 02 review — proposed amendments

Reviewed `missions/02-research.md` against everything learned. Amendments,
each with reason (the mission file is untouched; the human applies accepted
ones):

- **A1 — Pin goal 1's unit.** "EV ≥ $2 per market" should read:
  `evPerMarketTotal ≥ 2` (SUM(pnl)/COUNT over ALL universe markets, flat
  markets included) at a stated `capPerMarket` level, on the FULL protocol
  universe AND on the S4 OOS window. Reason: the engine classifies pnl==0
  markets as "skipped", so a Played denominator flatters selective variants
  (run 870: 9,750 played of 10,747); and a screen-only $2 is multiplicity
  bait. Without a capital level the target is not comparable across variants.
- **A2 — Capital levels are strategy params, not a report toggle.** Goal 2's
  "EV at several capital levels" cannot be derived retroactively: the
  simulator has no cash model (INITIAL_CAPITAL is reporting-only, verified).
  Amend to: every variant exposes a per-market capital-cap param (binding
  convention) and capital behavior = the capPerMarket sweep grid
  (25/50/100/200), one run per level.
- **A3 — Independence is already defined; reference it.** Goal 3 asks to
  "define how independence is measured" — done and verified in mission 01
  (daily-pnl Pearson r < 0.6 over ≥14 common days; same-family variants
  measured at r=0.9989, correctly rejected). Amend the goal to reference
  `memory/process/evaluator.md` §Variant independence instead of re-deriving.
- **A4 — Codify the fleet-wait rule in Unit of work.** Never end a session
  blocked on an in-flight fleet run: record batch/run id in STATUS and
  return `continue`; the next session reads the finished run. Reason:
  session 9 failed exactly this way (headless task notifications cannot
  re-invoke; `wait` parks the loop for a human).
- **A5 — LIVE-CANDIDATE requires the evidence bar, and takes calendar
  days.** Amend the milestone to require the 8-point live-trust bar
  (`capabilities/parity.md` §6) including S4 OOS ≥400 markets past the
  param-freeze commit — structurally ~4–5 days of new markets after freeze.
  Reason: OOS-by-future is the only holdout iteration cannot leak into; the
  human should expect that latency rather than read it as stalling. The
  DRY_RUN=true live windows are the post-review step.
- **A6 — Forbid `--extend` for result accumulation.** Extensions silently
  drop the parent's simulated latency (P-001), poisoning latency-pinned
  evidence. OOS coverage grows by periodic fresh FULL runs (~13–15 min
  fleet — cheap). Reason: verified bug; the launcher already refuses extends.
- **A7 — Session-start capability guard.** When the engine may have moved
  (human announcement, rebase pulling engine commits), run
  `refresh-capabilities.ts` before relying on capability notes. One
  read-only command; keeps months-long research honest against a moving
  engine.

**Stays unchanged**: the four goals' substance and priority order (profit
first, capital-aware always, portfolio over champion, adapt forever), the
one-session/one-increment unit of work with batching, the self-check
cadence, the ending states (`continue` default, `wait` only for blockers +
the LIVE-CANDIDATE milestone), and the session-budget framing.

## Team workflow (mission goal: parallel agent loops)

Proposal written in `memory/process/team-workflow.md`. Essence: the shared
MySQL is the coordination medium (provenance columns make every run
attributable and checkable), cross-protocol READ / own-protocol WRITE,
import-by-citation instead of re-verification for engine facts, LEDGER scan
before opening a family (complement, don't duplicate), no duplicate FULL
runs (DB check first), cross-model portfolio admission by the same
independence rule. One human decision needed: confirm cross-protocol read
access between `protocols/pair-*/` workspaces.

## Needs human (for the READY review)

1. Accept/adjust the Mission 02 amendments A1–A7.
2. Confirm the team-workflow cross-protocol read convention.
3. Rule on P-004 before any live start (producer machine worker slots).
4. Optionally act on P-001/P-008 (engine fixes; protocol-side mitigations
   already in place either way).

## Why research is ready to start

Every mission goal has run-verified substance behind it: capabilities
(19 runs incl. full-universe), self-upgrade (drift-tested), tools (each
verified against direct SQL or real launches), memory (stateless across 12
sessions — this session reconstructed everything from files alone),
evaluators (executed end-to-end with correct verdicts on real data), and
proposals (8 filed). The baseline's stationary-loss anatomy plus six
pre-registered variant axes means session 1 of Mission 02 starts with
hypotheses, not a blank page.
