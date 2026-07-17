# Gabagool Lab — JOURNAL

Append-only narration. Newest at the bottom.

---

## 2026-07-17T03:17Z — session 1, unit 1: bootstrap

First working session. `gabagool-lab/` contained only CHARTER.md, the
pre-commit write-scope guard (wired via core.hooksPath), and launcher logs.
No STATE.md → I am session 1 in the relay.

Created the resumability skeleton: STATE.md (status + queue), this journal,
DECISIONS.md, OPERATOR-FEED.md. Verified: branch is `gabagool-lab`, tree was
clean, hook blocks writes outside `gabagool-lab/` + `src/strategies/gabagool-lab/`.

Plan for this session: Phase 0 in parallel (subagents digest the KB,
fable-lab, and strategy-research-protocol while I verify engine footguns in
code myself), then write the lab's design docs (EPISTEMOLOGY.md,
EVALUATION.md), then minimal tools, then an end-to-end smoke. L0 is the
target rung.

## 2026-07-17T04:15Z — session 1, unit 2: Phase 0 complete → INHERITANCE.md

Ran four parallel digests (KB, fable-lab, SRP, root docs + data/feeds)
while verifying engine facts first-hand in code. Everything distilled
into INHERITANCE.md with citations. The load-bearing findings:

- The sim's worst_queue shows only the adverse ~half of real fills (D2:
  44–49%). Doctrine: sim-negative is non-fatal for the maker leg,
  sim-positive is extraordinary evidence, and RANKINGS across variants
  sharing the maker-fill stream are trustworthy. The lab's evaluation
  is built around this, not around raw EV alone.
- The live edge exists NOW on btc-15m (b55f +2.31% fee-inclusive,
  on-chain audited) and its shape is measured: deep ladders, cheap-side
  rests, ~62% taker completion, back-loaded minutes 10–13, loose parity.
  Completion aggressiveness separates +2.31% from +0.31% (H6) — and
  completion-policy ranking is exactly what the sim CAN decide.
- Rebate income is exactly computable post-hoc (A22). Trading line and
  subsidy line will be reported separately, always.
- Sim taker fee is era-wrong in shape (156bps·min(p,1−p) vs real
  0.07·p(1−p)) — the lab re-prices taker fills per-fill from
  intent_meta, validated against the sim's own fees_paid column.
- Evaluation window: 2026-04-01→06-14 (fee shape certain); June 1–14 is
  the ONLY post-taker-rebate-era slice and becomes the untouchable
  confirmation holdout. Telonex coverage ends 2026-06-14 (G9).
- Fable's spread-capture death does NOT close my concept: it never
  tested parity-driven pair accumulation, pair-cost caps, deep ladders,
  time-weighting, or completion policy. That's the opening.
- Engine traps verified and listed (ambient 140ms .env latency!,
  maxOpenOrders=20, never-merge, fill-event gating, crossed books,
  intent_meta as the only per-fill channel).

Next unit: EPISTEMOLOGY.md + EVALUATION.md (the frozen scoring rule).

## 2026-07-17T04:45Z — session 1, unit 3: the rulebook

Wrote EPISTEMOLOGY.md v1 and EVALUATION.md v1 (frozen before any
experiment). The design departures from the old protocol, in short:

- Three experiment types (axis / candidate / probe) instead of
  everything facing a go/kill gate — sweeps produce curves, not
  verdicts; only candidates face championship gates (D-001).
- Era-partitioned evaluation: search Apr 1–May 31, one-shot holdout
  Jun 1–14 (the only post-taker-rebate slice), transition band labeled,
  no cross-era pooling (D-002).
- The headline number is EL = corrected trading line + rebate line,
  with taker fees re-priced per-fill at the on-chain-verified curve and
  the reconstruction validated against the sim's own fees column
  (D-003). Trading and subsidy lines always reported separately.
- Championship = hard gates (stability across weeks, tails, latency
  500/1000ms, pairing health, sample size) then a transparent SCORE for
  ordering only (D-004). Tail thresholds get calibrated from the L1
  baseline then frozen (D-005, pre-declared amendment path).
- Honesty machinery: frozen specs in LEDGER.md (git-timestamped),
  two-disjoint-halves screening, max-of-N labeling, paste-the-numbers
  rule, nothing-to-run → stop.

LEDGER.md created with the entry template. Next unit: tools
(submit.ts, results.ts) — port fable patterns, write against
backtest_run_segments/_markets directly.

## 2026-07-17T05:00Z — session 1, unit 4: tools built and tested

tools/: lib.ts (fee math, windows, per-market corrected economics,
settlement revalidation, DB loaders), results.ts (the canonical readout:
lines/weekly/tails/pairing/capital/sample/validation + gate table +
latency-battery mode), submit.ts (guarded launcher: latency pins,
batchUid grammar, holdout guard, clean-tree rule), runs.ts (lister).

Tested against the live DB: runs.ts lists; results.ts read foreign run
658 correctly — segments cross-check matched my per-market recompute
(−0.350 vs −0.347, rounding), and the validators correctly flagged a
foreign sell-strategy as not lab-checkable. submit.ts guards fire:
non-holdout windows touching June are refused; holdout suffix requires
the exact holdout window; --to-ms inclusivity handled (searchTo =
Jun1−1ms — the fable E18 trap, carried mechanically).

Next: E001 smoke — scripted probe strategy through the full pipeline.

## 2026-07-17T05:30Z — session 1, unit 5: E001 smoke green → L0 COMPLETE

E001 ran twice (662, 663 — identical, determinism confirmed). Every
frozen criterion passed: sequential persistence works; settlement
recheck exact on all markets (maker fill = own px/sz proven on data);
fee reconstruction VALID vs the sim's own fees column; meta coverage
100%; and the big one — the shared accumulator survives to the DB BY
REFERENCE, so the lab has an exact per-fill export channel (realized
taker prices, per-leg docked shares) with zero engine changes. The sim's
share-docking was directly observed (35.91 = 36 − 0.09).

L0 exit criteria (charter): engine facts verified ✓ (INHERITANCE §1),
EPISTEMOLOGY + EVALUATION written and frozen ✓, tools working ✓
(submit/results/runs/inspect-meta), end-to-end smoke proven ✓.

**L0 COMPLETE. Moving to L1: the baseline.**

L1 plan: E002-baseline (AXIS-flavored reference, exempt from tail gates
per EVALUATION §7) — archetype-faithful parity ladder: two-sided GTC
rungs, parity-driven side selection (bid the lagging leg), never-overpay
guard (projected pair cost cap), band limits, hold to settlement. Run at
S1-screen scale first (two disjoint 400-market halves, lat 140), then
full search window + latency battery. Its distribution calibrates
TAIL_K and the capital floor (frozen as EVALUATION v1.1 before any
candidate runs).

## 2026-07-17T06:25Z — session 1, unit 6 (in progress): E002 battery submitted

E002-baseline spec frozen and committed; smoke at 140ms exposed a real
phenomenon: 59/176 fills were rungs CONVERTING to taker when the book
collapsed into them during the latency window. This is realistic (D2:
the live wallets show 29–45% at/above-ask fills) — fixed the accounting
(acc now classifies by realized liquidity + tracks per-leg docked
shares; correction triggers on realized taker economics). Corrected
smoke: TRADE_sim −5.08 → TRADE_corr −5.50/market at 140ms on 10 markets
(probe scale, not evidence).

Four full arms submitted detached (lat 0/140/500/1000) on a local
4-child worker from this worktree (commit-SHA-gated, pushed). Caught a
coverage bug at submit: the producer defaults to LIMIT 1000, so each
arm covers only ~Apr 1–11 for now; submit.ts fixed (explicit limit) and
an --extend mode added (latency pin verified against the run's --lat
label in the DB). Plan: when the 1,000-market chunks land, --extend
each run to the full search window, then judge.

KB updates folded (INHERITANCE A-1): the sibling shift saturated, wrote
LAB-HANDOFF (3 seeds; seed 1 = my program with sweep priors), got
re-tasked for Phase 2 (variant atlas — future seed source). A24
corrects b27bc932 to ~3–4% pool share (fragmented pool, softer
competition story) and gives a LIVE existence proof of the concept:
pair cost p50 0.993, 1.6% parity, 50% taker completion, running today.

## 2026-07-17T07:05Z — session 1: first latency mechanism discovered

Comparing E002 arms on identical 1,000 markets (Apr 1–11):
- lat0:   2,846 fills (0 taker), EL −0.64/market, pairRate 0.33
- lat500: 25,412 fills (12,478 TAKER conversions — half!), EL −5.04,
  pairRate 0.71 (conversions "complete" pairs at bad prices)

Mechanism: with cancel latency, every requote cycle leaves the old rung
exposed in flight AND the replacement converts to taker when the book
moves through it before arrival. Churn × latency = toxic conversion
volume. The archetype's standing-ladder fingerprint (P21: burst fills,
no chase-the-mid) reads as the direct counter to exactly this.

Consequence: REQUOTE DISCIPLINE (standing ladders / requote bans /
wide requote deltas) is promoted to a first-class axis — plausibly THE
latency-robustness lever the charter demands. Added to the E005 ladder
axis scope. E003's smoke also validated the completion machinery
(pairRate 0.73 vs baseline 0.33 on the same 10 markets).

## 2026-07-17T07:45Z — session 1: extension dead end → fresh full-window arms

The documented --extend path failed on E002: the pipeline re-validates
the parent's PERSISTED (post-transform) params, and E002's rungOffsets
schema only accepts the pre-transform string → array input rejected.
E002 is frozen (four evidence runs), and I will not edit frozen files
on a "it's just a compat shim" rationalization — the freeze rule's
value is that it is absolute. Resolution: the four chunk runs are
superseded; four fresh full-window arms (5,856 markets each) submitted
at d5574428; E003's schema (unfrozen) now round-trips its own output so
extensions work for everything downstream. Lesson recorded: param
schemas must accept their own persisted form.

Worker self-updated (exit-75 → pull → relaunch at d5574428) and is
draining ~23.4k jobs. Judgment + TAIL_K calibration when arms land.

## 2026-07-17T04:40Z — session 2, unit 7: worker resurrected as a daemon

Timestamp correction first: session 1's journal/feed stamps drifted ~2h
ahead of true UTC from unit 5 on (local CEST written as Z). True submit
time of the fullwin arms was ~03:40Z, not 07:40Z. From now on stamps
come from `date -u` output only.

Found on resume: the 4-child markets worker died at 04:13Z — SIGTERM,
killed as a child of session 1's shell the moment that session ended.
Nothing was wrong with the jobs: 8 orphaned actives (locks expire, the
stalled-checker reclaims them), ~20.5k waiting, zero failed. The
operator's own aggregate worker (polymarket-bot-worker, main branch)
can't touch my aggregates — the commit gate wants d5574428's ancestry.
The four fullwin aggregate parents sit correctly in waiting-children;
the 3 failed aggregate jobs in the queue are old imbalance-hold
duplicates, not mine.

Fix that outlives me: relaunched run-worker.sh (markets+aggregate,
concurrency 4) via `nohup caffeinate -is ... &` in a subshell — it
reparents to launchd, so session death can't SIGTERM it anymore.
caffeinate follows the operator's own precedent (their worker runs
under it). Verified consuming within seconds. Measured drain:
~5.9 jobs/s → ~50 min to empty the market queue, then 4 heavy
aggregate jobs persist the runs. Much better than the 2.8h estimate;
judgment likely lands THIS session. New tool: tools/queue.ts (BullMQ
depths + samples via the repo's own queue module — needed env-loader
import, the same lesson lib.ts already encodes).

KB re-read (A25/A26 folded as INHERITANCE A-2): the "failed
challenger" −$542k casualty was a World Cup blow-up, not
crypto-updown; the class has NO known large-loss casualty on this
meta. Softens the competition-risk prior; my TAIL_K plan is unchanged
(my tails are backtest-measured, not borrowed). origin/main: no
price-to-beat / Chainlink feed code yet — strike proxy stays
window-open spot.

Disk note: volume at 98% (9.7Gi free). Worker logs ~26MB/30min are
fine; keeping lab artifacts lean regardless.

## 2026-07-17T05:00Z — session 2, unit 8: judgment tooling complete + TAIL_K logic pre-registered

Rehearsed the full judgment path on the superseded chunk runs:
`--gates s2` renders every line EVALUATION §3–§5 needs at 1000-market
scale (chunk lat140: EL −4.71, t −17.2, PF 0.22, pairRate 0.678,
EL/$100 −8.05); `--battery` renders the latency table (EL −0.64 →
−4.71 → −5.04 → −5.52 across 0/140/500/1000ms; fills 2.8k → 20.7k →
25.4k → 27.6k — latency MANUFACTURES toxic fills out of requote churn,
now visible across the whole battery). Added `--export` (per-market
econ CSV → logs/exports/, gitignored, regenerable) for TAIL_K
calibration; tested on run 670.

Pre-registering the TAIL_K calibration LOGIC before the fullwin
numbers exist (form now, numbers later — so the numbers can't pick the
form; chunk preview seen, disclosed): G7's frozen form is
CVaR5 ≥ −(TAIL_K × EL). Direct K from baseline's own CVaR5/EL is
degenerate (baseline EL < 0) and EL-relative K explodes near EL→0
(G4's t≥2 partially guards). The economically meaningful anchor is the
TAIL-TO-OUTLAY shape: chunk lat140 CVaR5/avgOutlay ≈ −0.37 (a worst-5%
market burns ~37% of typical outlay — leg-risk realized). Calibration
plan: from fullwin lat140 distribution, set TAIL_K so that a candidate
carrying the baseline's tail-to-outlay shape at baseline sizing passes
G7 iff its EL clears an explicit floor (target ~$0.5–1.0/market —
final number written with rationale in DECISIONS at calibration). This
couples the tail gate to a minimum-edge-per-tail-risk requirement and
yields the capital-efficiency floor from the same arithmetic.

Queue: 16.7k waiting at ~3.3/s → market queue empties ~06:20Z, then 4
aggregate jobs persist runs. Judgment this session if the pace holds.

## 2026-07-17T05:35Z — session 2, unit 9: E003 completion-path defects fixed; a self-inflicted queue incident

Fresh-eyes review of E003 (unfrozen until first evidence submission)
found two real defects in the taker-completion path — dormant for
axis-1 (maker-only arms) but poisonous for E004 and any latency
battery on completion variants:
1. A completion cross that misses under latency (ask moves before
   arrival) rested as a stale GTC order FOREVER: not tracked in
   quotes[], so no requote path cancels it; pendingCompletion never
   clears → every later completion is blocked for the market; and the
   gate-close branch canceled rungs but not the cross → it could fill
   deep in the final-minute adverse window (A17/A20).
2. order_done(canceled) deliberately skips removeOrderId, so even an
   explicit cancel would not have released pendingCompletion.
Fix: completionTtlSec param (default 10s; sweepable later), TTL cancel
each tick, cancel-at-gate-close, and clear-tracking-at-issue semantics
(mirrors cancelSide), so the canceled-guard never matters.
Fill-before-cancel remains possible under latency — realistic, and the
acc accounting classifies it by realized liquidity.

The incident: I ran the verification smoke via `npm run backtest`
directly WITHOUT --sequential — which is a DISTRIBUTED submission, not
a local run. It enqueued a bare-UUID 1-market flow at my tip SHA,
which (a) sat behind 13.6k queued jobs, (b) forced my worker into an
exit-75 self-update mid-drain when it reached it. EPISTEMOLOGY §3
exists precisely to prevent this (submit.ts is the only launch path) —
I bypassed my own rule and it bit within the hour. Cleanup: killed the
submitter, removed the market child from the queue; the de-blocked
parent aggregated to a no-op (succeeded=0, no run row — verified);
worker relaunched itself at 24d0dcd and is draining again. Lesson
recorded here and in LEDGER: EVERY backtest invocation goes through
submit.ts, including 1-market code smokes (--sequential flag exists
there for exactly this).

## 2026-07-17T05:55Z — session 2, unit 10: calibration tool built + dry-run

tools/calibrate.ts reads a results.ts --export CSV and prints the §7
decision table: for each candidate EL floor, the implied TAIL_K
(=|CVaR5|/floor) and capital-efficiency floor (=floor/avgOutlay).
Dry-run on the chunk lat140 export (superseded data, tool-proof only):
CVaR5 −21.70, avgOutlay 58.51, tail-to-outlay −0.37 → floor $0.50
would imply TAIL_K 43.4 / cap-floor 0.85%; floor $1.00 → K 21.7 /
1.71%. The v1.1 freeze will re-run this on the FULLWIN lat140 export
and pick a row with written rationale. Queue ~12.4k waiting.

## 2026-07-17T06:20Z — session 2, unit 11: E003 launch plan frozen-ready + determinism proven

LEDGER's E003 section now carries the freeze-ready text: precise
advance rule (trend-direction agreement + same top-2 SET across
halves), finalized success criteria (per-arm/per-half readout incl.
conversion share as the churn lens), the sizing rationale (clip 6 for
same-code comparability; §2 rebate-realistic sizing binds at the
candidate confirmation stage, not the axis), and the exact 10
submit.ts commands (suffix encoding p### = pct*10; half-windows end
23:59:59.999Z to clear the holdout guard).

Determinism of the patched E003 code proven the E001 way: identical
2-market sequential runs (673, 674) → byte-identical per-market econ
exports (EL −7.157, fills 15m/13t, era fee re-priced −0.407); run 672
(same params, pre-probe) matches too — three-way agreement including
the completion path and its new TTL logic.

Queue reality check: drain slowed to ~1.2 jobs/s in this stretch
(11.5k waiting at 06:15Z) → market queue empties ~08:00–08:45Z, then
four aggregates persist the runs. Judgment falls to this session only
if it lives unusually long; otherwise the successor resumes from
STATE's checklist with the worker daemon still draining.

## 2026-07-17T06:30Z — session 2, unit 12 (in progress): hands-off drain watch

Added tools/watch-drain.ts (exits on DRAINED / WORKER-DEAD / TIMEOUT /
AGG-FAILURES) and backgrounded it: this session gets woken exactly
when the four fullwin runs are persisted — or immediately if the
worker dies — and judgment starts with context intact. If the session
is killed anyway, STATE's checklist covers the successor. Unit 12 =
watch → judge E002 → calibrate → freeze v1.1; feed entry lands when
the unit completes.

## 2026-07-17T04:58Z — session 3, unit 13: pickup — lat0 arm done, preview read; KB A27–A31 folded

Session 3 pickup (real time 04:47Z; session-2 stamps above ran ahead of
the clock — its "06:30Z" unit-12 entry was written ~04:45Z real).
Handoff state: worker daemon alive at tip (6de8fa0), watch-drain died
with session 2 as designed, 9.4k market jobs left at pickup. The 3
failed aggregate jobs are stale `imbalance-hold` duplicates from an old
campaign (attempts exhausted, already persisted as runs 286–288) — not
mine. Added tools/agg-inspect.ts to see this in one command.

Surprise: the lat0 fullwin arm was ALREADY persisted (run 675 — its
aggregate ran before session 2 died; the parent job auto-removed on
completion, which is why only 3 waiting-children parents remained).
First fullwin readout, 5,856 markets, validators all green:

  lat0: EL −0.4207 (t −8.52), 0/9 weeks positive, PF 0.75,
  CVaR5 −6.81, maxLose −12.54, pairRate 0.291, imbalance p50=p90=1.00,
  avg outlay 6.33, EL/$100 −6.65, 13,486 maker fills, 0 taker, played
  84.7%, REB 0 (raw 0.0403 — under the $1/market floor as sized).

Two readings, both mechanism-level:
1. The frictionless baseline LOSES steadily — every week negative.
   worst_queue doctrine says these fills are the adverse subset, so
   this is the conservative floor, but the sign and stability of the
   bleed are the reference number L1 exists to produce.
2. pairRate 0.291 with median imbalance 1.00: at lat0 the shallow
   ladder [−1c,−3c] almost never completes the pair — the median
   played market ends FULLY one-sided. Chunk lat140 showed pairRate
   0.678 — so the "pairing" seen at 140ms is manufactured by
   stale-quote churn fills, not by genuine two-sided oscillation
   capture. The archetype's pairing engine needs deeper/other
   placement, not latency accidents. This connects directly to KB A30
   (new since my last fold): 0x04b6d7e9, the ONLY trading-profitable
   parity wallet at scale today, pairs 78% of shares at pair cost
   0.964–0.976 — deep pairs, patient completion. Backlog E005 gains a
   deep-pair cell (pairCostCap {0.96,0.97,0.98}); INHERITANCE A-3
   records A27–A31 (A28 rebate curve → cheap-side ~2×; A27/A31 exit
   style = swappable module; A31 class predates archetype).

Feed check (session obligation): price-to-beat/Chainlink backtest
replay still absent on origin/main ("no backtest source yet" in
wireBacktestExternalFeeds.ts). Strike proxy = window-open spot stands.

Drain rate recovered to ~7.7 jobs/s (2,311 jobs in 301s) — market
queue empties ~05:10Z, aggregates a few minutes after. Judgment lands
this session. Next: watch-drain → full E002 judgment → TAIL_K
calibration → EVALUATION v1.1 freeze → E003 launch.

## 2026-07-17T05:35Z — session 3, unit 14: E002 judged (L1 reference set), EVALUATION v1.1 frozen

All four fullwin arms landed (675/678/676/677 = lat0/140/500/1000;
5,856 markets each, 0 failures, validators green across the board).
The E002 judgment is in the LEDGER with the full battery table; the
short version:

- EL: −0.42 (lat0) → −4.39 (lat140) → −5.03 (500) → −5.30 (1000).
  All 36 arm-weeks negative. Steady bleed, no regime story.
- The 0→140ms jump is 10× the 140→1000 jump. Latency doesn't degrade
  this design, it REPLACES it: fills go 13.5k → 112k, and 34–55% of
  them are taker conversions from the requote stream. The frozen
  "maker-only confirmed: taker fills = 0" criterion FAILED on every
  latency arm — recorded verbatim as the central mechanism finding,
  not excused. Quote-stability is now a first-class design axis.
- Pairing at lat0 is 0.291 with median imbalance 1.00 — shallow rungs
  don't pair; the 0.64–0.69 pairRate under latency is churn buying
  both sides at bad prices. Genuine pair-discount capture must be
  engineered at depth (A30/A33's 0.95–0.976 region), exactly what
  E003/E005 probe.
- Verdict: AXIS-CLOSED, region dead at all latencies. LEADERBOARD
  opens its dead-regions section with it. The reference to beat:
  EL(140) = −4.39, frictionless bound −0.42.

EVALUATION v1.1 discharged §7 exactly as pre-registered (form fixed
s2-u8 before numbers existed): floor $0.50/market → TAIL_K = 41,
capital floor EL/$100 ≥ 0.92 (new G11). F=$0.50 is anchored on the
best observed live parity wallet (A30: ≈0.8–0.9% all-in of turnover ≈
$0.45–0.52/market at baseline sizing) — the alternative F=$1.00 would
have demanded 2× anything ever observed and pre-killed the deep-pair
region three wallets print in. Full table + rejected options in D-007;
results.ts gate table now renders v1.1 (G7 TAIL_K clause + G11).

Also folded KB A26/A32/A33 (INHERITANCE A-4): cold-start tier moat
only taxes taker completion (maker-only cells tier-immune; TRADE_corr
full-curve assumption validated within 3%); the class has NO large-loss
casualty (A23 withdrawn — downside is slow bleed, not blow-up); vidarx
is the third independent deep-pair existence proof. The deep-pair cell
is now the best-evidenced region in the variant space.

L1 is CLOSED. Next: E003 freeze + launch (10 arms, parity axis,
halves × lat140 — exact commands frozen in LEDGER §E003 and
tools/launch-e003.sh).

## 2026-07-17T05:45Z — session 3, unit 14a: stray DONE incident (external), purged + guarded

Incident, fully disclosed: an EMPTY `gabagool-lab/DONE` appeared in the
worktree at 05:17Z — not created by me or by any lab tool (audited:
tools/, .hooks/, no writer). My unit-14 `git add -A` swept it into
commit 6b8c0c5 and pushed it. Minutes later the file was DELETED from
the worktree, again externally (I never removed it). Best hypothesis:
neighboring automation (the KB shift's session wound down ~05:20Z and
its relay uses DONE sentinels) touched the wrong worktree and
self-corrected; the operator doing a manual test is also possible.
Cannot be determined from here.

Why this matters: DONE is this mission's end-signal — a stray one at
the branch tip could kill the relay loop. Actions taken: (1) committed
the (external) deletion so the tip carries no DONE; (2) pre-commit
hook now BLOCKS adding gabagool-lab/DONE unless GLAB_L3_DONE=yes is
set — the L3 mission-end commit sets it deliberately; removal stays
allowed; (3) session pickup ritual (STATE) gains a DONE-absence check;
(4) stopped using bare `git add -A` — staging is now explicit
(`git add gabagool-lab/ src/strategies/gabagool-lab/` still sweeps,
so the hook guard is the real protection).

If the operator DID intend to end the mission: say so in a way a
session can read (a note in DONE itself or OPERATOR-FEED); an empty
sentinel that vanishes 3 minutes later reads as an accident, and the
charter says L3 is the only legitimate creation point.

## 2026-07-17T06:05Z — session 3, unit 15: E003 frozen + launched; a double-submit incident, contained

E003 (parity axis: parityTolPct {0.1,2,10,20,40}% × halves h1/h2,
lat140, ~5,856 markets total) is frozen (commit 3d70785 — strategy
file untouched since 45a2e32, which the determinism smokes ran) and
LAUNCHED: 10 detached flows, submissionUids in the LEDGER.

The incident, honestly: after the clean launch I "verified" with a
lazy one-liner that RE-RAN the launch script with a stray flag.
submit.ts silently tolerated the unknown flag → 10 duplicate flows,
~29k duplicate market jobs. Cleanup: new tools/dedupe-flows.ts
(keep-oldest-per-batchUid). First attempt removed CHILDREN first —
wrong: emptying a parent's dependency set promotes it out of
waiting-children, and the operator's always-on aggregate worker locked
it within seconds and aggregated an empty flow → run 679 is a
labeled-failed tombstone (m=0, f=2976; pipeline-written row, stays per
charter). Fixed order (parent-first cascade) removed the other 9
cleanly. Hardening in the same unit: submit.ts refuses unknown flags;
launch-e003.sh accepts only --dry-run and refuses when E003 flows are
already queued. Queue verified sane after cleanup: 10 parents, ~27.4k
market jobs, 0 new failures.

Two lessons for the lifecycle doc (both are variants of one rule —
side-effectful scripts must be idempotent-or-refuse): verification
must never share a code path with submission; and BullMQ flow removal
is parent-first, never children-first.

Drain ETA ~1h (watch-drain armed, 3h timeout). Judgment path when it
lands: per-arm readouts → advance rule AS WRITTEN (direction agreement
across halves + top-2 set match) → LEADERBOARD → next axis freeze.

## 2026-07-17T06:25Z — session 3, unit 16: drain-window work — LESSONS.md, axis-table.ts, E004 re-smoke

While E003 drains: (1) LESSONS.md started (LS-1..LS-4: churn×latency,
depth-not-noise pairing, idempotent-or-refuse scripts, parent-first
flow removal). (2) tools/axis-table.ts — renders the arms×halves
matrix and evaluates E003's advance rule MECHANICALLY (trend-sign
agreement + top-2 set match, adjacent-arm distinguishability at
2·se_diff); smoked on the old E003 smokes, correctly skips tombstone
679, refuses duplicate cells. Judgment becomes a render, not an
improvisation. (3) E004's completion path re-smoked (run 680,
sequential, NOT evidence): cap-mode crosses issue/fill/record, rej=0,
validators green — the u9 TTL/gate-close code is functional; E004 can
freeze after E003's judgment. Also pinned E004's fee basis note (A32
cold-start tier-0) into the draft before freeze.

## 2026-07-17T06:40Z — session 3, unit 17b: pre-registering E003 curve interpretation (before the table exists)

Seen so far: ONE arm's headline (681, h2-p001, EL −4.22) — and a
determinism gift: its complete weeks match E002's weekly ELs to 4
decimals, because parityTolPct=0.1% floors to 2 clips ≡ E002's
parityTolShares=12. The axis's left endpoint IS the baseline,
reproduced from an independently written file. Same-code comparability
is now demonstrated, not assumed.

Interpretation rules I commit to BEFORE seeing the other arms:
1. "Flat" vs "unresolved": if adjacent arms are indistinguishable
   (≤2·se_diff) but the ENDPOINTS (0.1 vs 40) are DISTINCT, the axis
   has a measurable direction with insufficient resolution in between
   — report endpoint direction, do not interpolate. If even endpoints
   are indistinguishable, the verdict is "parity tolerance does not
   move EL at this ladder shape/coverage" — an axis-closed NULL, not
   a failure.
2. The advance rule is evaluated EXACTLY as frozen (axis-table.ts
   renders it); if it fails, no arm seeds E004/E005 defaults — they
   run at file defaults (parityTolPct=10) with that stated.
3. Mechanism split accompanies any EL difference: parity tolerance can
   move EL via (a) fewer leading-leg quotes (less churn exposure) or
   (b) different completion pressure. Taker share and fill counts per
   arm are the tell: if EL improves WITH taker share flat and fills
   down, it is (a); if taker share moves, it is (b). Quote both.

## 2026-07-17T05:57Z — session 4, unit 18: pickup ritual + KB fold A-5 + a drift repair

Session 4 starts at 05:39Z real. Pickup findings, in order of weight:

1. **E003 is draining well** — 7,736/29,304 market jobs done at
   05:41Z (~26%), 12 active, 0 failed, my worker daemon alive.
   Watch-drain re-armed under THIS session (task bfj2qc9aq, 3h cap).
   Real launch time was 05:29Z (commit c5bc72c at 05:29Z), so drain
   pace is far better than s3's estimate — ETA ~06:15–06:45Z.
2. **Two charter drifts by session 3, both repaired here:**
   (a) OPERATOR-FEED entries for units 16/16b/17/17b were never
   written — the per-unit-feed rule was violated 4 times in a row.
   Backfilled (marked as such) and the rule re-pinned in STATE's
   pickup ritual. (b) Journal stamps drifted AGAIN (+35–60 min in s3
   — u15 says 06:05Z, the commit is 05:29Z). Every session so far
   has drifted when estimating; new pickup rule: stamp from `date -u`
   output only.
3. **Feeds not landed** (re-checked origin/main at 05:45Z): only
   `binanceWsSpotPrice` has a backtest source
   (src/backtest/feeds/wireBacktestExternalFeeds.ts — correct path;
   STATE previously cited a wrong one). H4's strike proxy stays
   window-open spot.
4. **KB delta since last fold (A-5 written):** register still tops at
   A33, but two W-stream measurement docs matter: W7 terrain — btc-15m
   book flow is DOWN ~9× from its Jan peak ($3.18M→$347k sampled
   day), class share rising 23%→37%; and W2 capital — the strongest
   wallet's whole btc-15m sleeve runs on ~$4–8k working capital,
   $896/market p50. Folded as capacity/attribution context (dossier
   capacity notes must cite terrain; monthly EL decay must be
   attributed against venue flow decline; sizing prior confirmed
   comfortable). No new axes, no strategy change.

Drain-window plan while E003 finishes: none needed if ETA holds —
next unit IS the judgment. If the watcher fires late, the E004 freeze
text (default-seeding slot pending E003) is the only prep left worth
doing before results exist.

## 2026-07-17T05:51Z — session 4, unit 19: E004 launch path pre-built; owning a fresh stamp drift

First, the confession: unit 18's journal/feed stamps (05:52–05:57Z)
were written at ~05:46Z real — I estimated forward ~9 minutes in the
very unit that pinned the no-estimates rule. LS-5 written; from now on
stamps are $(date -u) captured in the writing command itself (this
entry's is).

Drain-window work, all E003-blind (no axis numbers seen beyond u17b's
disclosed 681 peek):

1. **E004's missing pre-registration written** (LEDGER draft
   amendment 2): precise arms, success criteria, advance rule, H6
   spread-kill read, and mechanism-split rules — none of it depends
   on E003's outcome except the SEED slot (agreeing region, else 10).
   Key design decision: the maker-only CONTROL arm is not resubmitted;
   it reuses the E003 run pair at the seeded tolerance. Determinism
   was proven (673≡674, p001≡E002 to 4dp), so a re-run would burn
   ~5.8k market-jobs to reproduce known bits. Guard: the launcher
   refuses off-grid seeds (no control run would exist).
2. **tools/launch-e004.sh built + refusal-smoked**: --tol required
   and grid-checked, --dry-run only extra flag, refuses queued ax2
   flows (LS-3 pattern). Dry-run correctly bounced off submit.ts's
   dirty-tree guard pre-commit; will re-verify post-commit.
3. Health check mid-drain: 2/10 E003 runs persisted (682 h1-p020,
   681 h2-p001, both f=0), 0 failed market jobs, rate ~154/min →
   judgment ETA ~07:15–08:15Z real. Watcher armed (bfj2qc9aq).

E004 freeze after E003's judgment is now: fill SEED + record two
control batchUids + status→frozen + run launcher. Minutes, not an
improvisation.

## 2026-07-17T05:56Z — session 5, unit 20: pickup + watchers re-armed; drain at ~50%

Session 5 begins at 05:52Z (s4 ended cleanly one minute earlier —
short sessions, clean relay). Pickup ritual findings:

1. **E003 drain is healthy and fast**: markets pending 15,699 at
   05:52:30Z → 14,743 at 05:55:00Z = ~380 jobs/min measured. 0
   failed. Remaining ≈14.7k → drain ETA ~06:34Z. Aggregate:
   7 waiting-children (= 10 flows − 2 persisted (681, 682) − 1
   tombstone 679). Both s4 pace guesses were wrong in opposite
   directions (154/min vs 645/min) because BullMQ's completed count
   retains stale E002 jobs — the only honest pace metric is the
   waiting-delta between two timed readings. Noted for LESSONS if it
   bites again.
2. **Watcher hygiene**: s4's watch-drain died with its session (harness
   tasks do not survive relay). Re-armed twice deliberately: a
   harness-tracked run (task bzplf0suc — wakes this session on
   DRAINED) and a detached nohup (pid 66095, log
   gabagool-lab/logs/watch-drain-s5.log) that survives me for the
   successor. Pattern worth keeping for long drains.
3. **Worker daemon alive** (pid 68398, markets+aggregate, conc 4).
   KB STATE unchanged since u18's A-5 fold (mtime 05:05Z). DONE
   absent. Tree clean at 1755bb1.

Plan: this unit commits the pickup. Next unit is E003 judgment when
the watcher fires (~06:34Z): per-arm readouts → axis-table.ts render
→ advance rule AS FROZEN → LEADERBOARD → E004 seed+freeze+launch.
Drain window in between: re-load LEDGER §E003 + u17b interpretation
rules so judgment is mechanical.

## 2026-07-17T06:01Z — session 6, unit 21: pickup; drain ~57% done; judgment materials re-loaded

Session 6 begins (s5 lived 7 minutes — it committed its pickup and
died; short relays continue). Pickup findings:

1. **Drain healthy**: 12,494 waiting + 12 active at 05:59Z, 0 failed
   market jobs, pace ~500/min per the detached watcher log
   (survived s5 exactly as designed) → ETA ~06:24Z. Aggregate
   waiting-children 6 = one more run persisted since s5 (3 of 9 live
   flows now in DB). Worker daemon alive (pid 68398).
2. **Watcher re-armed for THIS session** (harness task bzf2435r9,
   3h cap, agg-failed baseline 3). Detached nohup 66095 still
   running as successor insurance — the two-watcher pattern from u20
   worked: s5 died and the log kept recording.
3. **KB STATE unchanged** (mtime 05:05Z, same as s4's check). DONE
   absent, tree clean at c001671.
4. **Judgment materials re-loaded** (LEDGER §E003 advance rule +
   success criteria + u17b interpretation rules). Judgment is
   mechanical when the watcher fires: per-arm readouts, axis-table
   render, advance rule AS WRITTEN, mechanism split via taker share.

Drain-window unit next: E004 completionTtl re-smoke (E003-blind —
runs the completion path locally on a few markets; LEDGER requires
it before E004 launch since smoke 668 pre-dates the TTL amendment).

## 2026-07-17T06:06Z — session 6, unit 22: E004 pre-launch verification complete; STATE queue was stale

The planned drain-window unit ("re-smoke completionTtl — unsmoked")
dissolved on contact with the LEDGER: session 3 already ran the
re-smoke (run 680, smoke-e004path, 10 mkts seq lat140 cap-mode) and
recorded "E004 may freeze". STATE's queue line was written before
that unit and never updated — the stale-queue trap. Two lessons
folded into practice: trust LEDGER over STATE's queue when they
disagree (LEDGER is per-experiment ground truth; STATE is a digest),
and verify claims cheaply before re-doing work.

Verification done this unit (all E003-blind):
1. **Run 680 exists and matches its LEDGER claim exactly**: params
   show completionMode=cap + completionTtlSec=10; 126m/99t fills,
   pairRate 0.724, settlement recheck OK, fee-recon VALID (|Δ| 0.01
   vs tol 0.20), meta coverage 100%. The TTL-amended completion path
   is smoked. (Numbers were already disclosed in LEDGER — no new
   peeking.)
2. **launch-e004.sh --dry-run re-verified post-commit** (u19 left
   this pending): all 6 submissions render with correct batchUids
   (ax2h1/h2 × c990/c970/cfree), correct windows (Apr/May), env pins
   lat140 jitter0, params correct per arm; off-grid --tol 15 refused
   with the no-control-run explanation. Launch path is ready.
3. STATE queue repaired: E004 next-step is now "fill SEED + record
   2 control batchUids + freeze + launch" (minutes), not a re-smoke.

Drain check: still on pace (~500/min). Judgment next when the
watcher fires.

## 2026-07-17T06:10Z — session 7, unit 23: pickup; drain ~73%; watcher re-armed for this session

Session 7 begins at 06:09Z (s6 lived ~10 minutes, committed u21+u22,
died clean — the relay keeps working in short hops). Pickup findings:

1. **Drain healthy and ahead of pace**: 7,890 waiting + 12 active at
   06:09Z, 0 failed market jobs. Against the 29,280-job E003 total
   that means ~73% done; waiting-delta pace ~470/min (consistent with
   s6's ~500/min) → ETA ~06:26Z. Aggregate: 3 waiting-children left,
   i.e. 6 of 9 live flows already persisted while s6 died. The 3
   failed aggregate jobs are the known stale foreign imbalance-hold
   rows (baseline 3, not mine).
2. **Watchers**: s6's harness task died with its session as expected;
   re-armed under THIS session (task bjp0w34gz, 3h cap, agg baseline
   3). Detached nohup 66095 still alive as successor insurance —
   two-watcher pattern holding across its third relay.
3. **DONE absent, tree clean at afa1830, worker daemon alive**
   (pid 68398, conc 4). KB STATE unchanged (mtime 05:05Z, same as s4).
4. **Judgment kit re-loaded**: LEDGER §E003 advance rule (direction
   agreement + top-2 set match) + success criteria + u17b
   interpretation rules (endpoint-direction reporting, default-seed
   fallback, mechanism split via taker share). E004 launch path
   verified last unit (u22); post-judgment the E004 freeze is
   "fill SEED + record 2 control batchUids + freeze + launch".

Next unit is the E003 judgment when the watcher fires (~06:26Z). No
drain-window work left — u22 cleared the last E003-blind prep item.

## 2026-07-17T06:14Z — session 8, unit 24: pickup; drain ~79%; watcher re-armed

Session 8 begins at 06:13Z (s7 lived ~4 minutes — committed its
pickup and died; shortest relay hop yet, still clean). Pickup:

1. **Drain healthy**: 6,246 waiting + 12 active at 06:13Z, 0 failed
   market jobs, detached watcher log shows ~440/min steady → ETA
   ~06:27Z. Aggregate: 3 waiting-children (same 3 flows as s7 saw;
   6/9 persisted), 3 failed = known stale foreign rows.
2. **Watcher re-armed under THIS session** (task b7db3g0d3, 3h cap,
   agg baseline 3). Detached nohup 66095 alive — fourth relay it has
   survived.
3. **DONE absent, tree clean at ad62329, worker daemon alive**
   (pid 68398 markets+aggregate conc 4). KB STATE unchanged
   (mtime 05:05Z).
4. **Judgment kit confirmed loaded**: LEDGER §E003 advance rule
   ((a) parity-response direction agrees across halves, (b) top-2
   set identical) + success criteria (per-arm readout fields,
   adjacent-arm distinguishability at 2·se_diff) + u17b rules
   (endpoint-direction reporting; advance-rule failure → E004/E005
   at file default tol 10, stated; mechanism split via taker share
   + fill counts). E004 post-judgment path: fill SEED + record 2
   control batchUids + freeze + `launch-e004.sh --tol SEED` (u22
   verified the launcher end-to-end).

No E003-blind prep work remains, so this unit is pickup-only.
Next unit: E003 judgment when the watcher fires (~06:27Z).

## 2026-07-17T06:18Z — session 9, unit 25: pickup; drain ~86%; watcher re-armed

Session 9 begins at 06:16Z (s8 lived ~3 minutes — pickup commit, then
gone; the relay's hops keep shrinking but stay clean). Pickup:

1. **Drain healthy**: 4,064 waiting + 12 active at 06:18Z, 0 failed
   market jobs; waiting-delta pace ~425/min → ETA ~06:28Z. Aggregate:
   2 waiting-children left (one more flow persisted since s8's check),
   failed=3 = the known stale foreign rows.
2. **Watcher re-armed under THIS session** (task b3lekba6d, 3h cap,
   agg baseline 3). Detached nohup 66095 alive — fifth relay survived.
3. **DONE absent, tree clean at d2500a4, worker daemon alive**
   (pid 68398, markets+aggregate, conc 4). KB STATE unchanged —
   mtime 05:05Z UTC (raw `stat` prints 07:05 LOCAL; the box is UTC+2 —
   noted so successors don't misread it as a KB update).
4. **Judgment kit loaded fresh**: LEDGER §E003 advance rule ((a)
   parity-response direction agrees across halves, (b) top-2 set
   identical) + success criteria + u17b interpretation rules
   (endpoint-direction reporting; rule-failure → E004/E005 at file
   default tol 10, stated; mechanism split via taker share + fill
   counts). axis-table.ts interface confirmed
   (`--prefix glab--E003-pair-accumulator--ax1 --axis-param
   parityTolPct` — renders the matrix and evaluates the rule
   mechanically); G2/G3/G9 definitions re-read from EVALUATION.

No E003-blind prep remains (u22 cleared the E004 pre-launch), so this
unit is pickup-only. Next unit: E003 judgment when the watcher fires.

## 2026-07-17T06:23Z — session 10, unit 26: pickup; drain ~93%; watcher re-armed

Session 10 begins at 06:21Z (s9 lived ~3 min — pickup commit, then
gone; sixth consecutive short hop, all clean). Pickup:

1. **Drain healthy**: 1,918 waiting + 12 active at 06:23Z, 0 failed
   market jobs → ~93% done, ETA ~06:27Z. Aggregate: 1 waiting-children
   left (8/9 flows persisted), failed=3 = known stale foreign rows.
2. **Watcher re-armed under THIS session** (task b5tn9drpb, 3h cap,
   agg baseline 3). Detached nohup 66095 alive — sixth relay survived.
3. **DONE absent, tree clean at 8b68c94, worker daemon alive**
   (pid 68398, markets+aggregate, conc 4). KB STATE unchanged.
4. **Judgment kit loaded fresh**: LEDGER §E003 advance rule ((a)
   parity-response direction agrees across halves via OLS-on-rank
   sign, (b) top-2 set identical — axis-table.ts evaluates both
   mechanically) + success criteria (10 runs complete, validators
   green, per-arm readout fields, 2·se_diff distinguishability) +
   u17b rules (endpoint-direction reporting; rule-failure → E004/E005
   at file default tol 10, stated; mechanism split via taker share +
   fill counts) + G2/G3/G9 definitions from EVALUATION §5.

No E003-blind prep remains. Next unit: E003 judgment when the
watcher fires (~06:27Z), then the E004 freeze+launch path from STATE.

## 2026-07-17T06:32Z — session 11, unit 27: E003 judged — AXIS-CLOSED, tighter-is-better, floor = baseline

Session 11 started 06:24Z; the drain finished on schedule (~06:27Z,
0 failed market jobs across all 10 runs) and this unit is the E003
judgment, executed exactly per the frozen rule and u17b.

The mechanics first: all 10 runs (681–690) completed with validators
green everywhere — settlement recheck OK, fee-recon VALID (worst diff
0.26 vs tol ~58), meta coverage 100%, segments cross-check OK, G2
99.5% played, G9 pass, G3 n/a. axis-table.ts evaluated the advance
rule mechanically: trend sign −1 in BOTH halves, top-2 set {0.1, 2}
in BOTH halves → BOTH HOLD.

What the curve says:
1. EL worsens monotonically as parity loosens: h1 −4.57 → −5.57,
   h2 −4.22 → −4.87 across tol {floor, 10, 20, 40}. Endpoints are
   DISTINCT in both halves (u17b rule 1 → endpoint-direction
   reporting; only h1 20-vs-40 is adjacent-distinct).
2. Mechanism (u17b rule 3): it is (a), inventory — NOT completion
   churn. Taker share is flat (≈34% → ≈32.5%) while fills RISE and
   pairRate FALLS (0.657→0.629 h1); imbalance p50 climbs 0.175→0.264;
   CVaR5 deepens −21.5→−32.0. The loose gate admits ~13.7k extra
   fills (h1, tol 40 vs floor) that cost ≈ −21c each: adverse
   one-sided accumulation the parity brake had been refusing.
3. The determinism gift matured: p001 ≡ p020 bit-identically (both
   floored to 12 shares — LS-6: two of five arms were the same arm),
   and the p001 pair over both halves reproduces E002-fullwin-lat140
   TO THE FILL (74,111m/38,144t, EL −4.3904). The axis's tight end
   IS the L1 reference, from an independently written file.

Verdict written to LEDGER: AXIS-CLOSED. Parity tolerance has a
measured direction (tighter better) and no payable region here — the
best arm is the floor, and the floor is the baseline's −4.39. The
knob is a risk cap, not an edge source; pair creation must come from
depth (E005), completion (E004), or timing (E006). Loose parity
{20, 40} added to LEADERBOARD dead regions with numbers.

SEED decision (advance rule held): parityTolPct = 2 from the tied
top-2 — identical evidence to 0.1 at this scale, less degenerate
encoding if sizing ever grows. E004's `none` control = runs 682/683
(the p020 pair), batchUids to be recorded in §E004 at freeze, which
is the next unit: fill SEED, record controls, freeze, launch
`launch-e004.sh --tol 2`.

## 2026-07-17T06:36Z — session 11, unit 28: E004 frozen and launched at SEED tol=2

Freeze-then-launch, in the right order this time by construction:
u28a committed the frozen §E004 (SEED parityTolPct=2, control pair =
runs 682/683 with full batchUids) BEFORE any submission, so the 6
flows carry the freeze commit itself as their SHA (77195ba9 — the
enqueue metadata proves the ordering).

Launch: `launch-e004.sh --tol 2` → 6 detached flows, ax2{h1,h2} ×
{c990 cap0.99, c970 cap0.97, cfree free}, lat140, clip 6. Verified
READ-ONLY (LS-3: agg-inspect.ts + queue.ts, no launcher re-invoke):
6 waiting-children flows at SHA 77195ba9, markets queue 17,461
waiting + 12 active ≈ 17,568 expected (3 × 5,856), aggregate
failed=3 = the known stale foreign rows. No double-submit.

Watchers armed for the ~40-minute drain (pace ~430/min → ETA
~07:16Z): harness task buhv1r5qv (wakes this session, 3h cap, agg
baseline 3) + detached nohup pid 20098 →
logs/watch-drain-s11-e004.log (survives session death; the s5 nohup
exited DRAINED at 06:28Z as designed). Worker daemon pid 68398
untouched.

While it drains, the next drain-window unit is E005 prep: its spec
needs the parityTolPct default stamped to 2 (now judged) and the
shape sub-axis arms sanity-checked against LS-6 (compute EFFECTIVE
values under clip 6 / maxShares 120 so no two arms collapse into the
same policy like p001/p020 did).

## 2026-07-17T06:41Z — session 11, unit 29: E005 spec finalized (LS-6 pass), E004-blind

Drain-window unit, executed blind to ax2 partials (only the watcher's
pending counts seen: 14,794 at 06:41Z, pace ~540/min — ETA ~07:09Z).

E005's spec got the LS-6 treatment it prescribed, from the strategy
file's actual mechanics (read, not recalled):

1. **parityTolPct stamped = 2** (E003 SEED; effective value 12 shares
   at clip 6 in EVERY arm — a deliberate constant, stated as such).
2. **Shape arms pass LS-6**: four distinct rung lists on the 2-dp
   grid, no p001≡p020-style collapse. But effective behavior is NOT
   uniform: band suppression clips deep rungs on the cheap side
   (0.13-offset needs bid ≥ 0.24), soloCap 0.65 binds on rung PRICE
   so deep rungs quote at higher bids pre-pairing, and the 4-rung A17
   arm rests 24 sh/side/cycle vs 12 (it tests the archetype package,
   not pure depth — the three 2-rung arms carry pure depth). Played
   share + fills promoted to first-class shape readouts.
3. **The cap sub-axis got a pre-registered finalization rule** instead
   of a blind grid: pairCostCap binds on the running-average pair-cost
   sum, so whether {0.96,0.97,0.98} even differentiates depends on
   the winning shape's realized S = avgUp+avgDown distribution.
   Rule (frozen now, executes after the shape sub-judgment, before
   cap submission): keep the incumbent-anchored grid iff
   bind(0.96)−bind(0.98) ≥ 0.15 and bind(0.98) ≥ 0.05, else quartile
   caps {P25,P50,P75 of S} de-collided, clamped [0.90,0.99]. Bind
   table recorded in the LEDGER either way. Computable read-only from
   intentMeta (per-fill px/sz/leg — verified the schema carries it).
4. **Participation caveat pre-registered**: cap arms that choke
   played share below 20% are a measured cliff, not a dead
   experiment.

This closes the E004-blind prep queue. Next: E004 judgment when the
watcher fires (~07:09Z), then E005 shape-arm launch.

## 2026-07-17T06:47Z — session 11, unit 30: e004-table.ts built and verified (still ax2-blind)

The E004 judgment kit had a hole: axis-table.ts is numeric-axis-only
and scans ONE batchUid prefix — E004's arms are categorical
(none/c970/c990/cfree) and its control pair lives under the ax1
prefix. The frozen criteria also want completion economics (crosses,
completed-pair cost, acc taker fees) that no readout tool rendered.

Built tools/e004-table.ts: explicit arm wiring (--arm label=h1,h2),
params-vs-label cross-check that aborts on wrong-run wiring (LS-3
spirit: mislabeled evidence must die loudly, not render plausibly),
per-cell completion economics from intent metas (xN filled crosses,
x-px p10/50/90, per-meta era fee, rungConv = realized takers − xN,
acc-exact taker fee $/mkt, S = final avgUp+avgDown over both-sided
played markets, cross share of paired stock), policy spread with the
H6 0.3%-of-turnover read, adjacent distinguishability in the frozen
aggressiveness order, and the verbatim 8-cell advance rule.

Verified ax2-blind against known numbers: controls 682/683 reproduce
the E003 axis table to the digit (EL −4.5656/−4.2209, taker 33.9/34.0,
pairRate 0.657/0.632, outlay 56.82/52.49; xN=0 in none mode as it
must be); smoke 680 reproduces its recorded 44.0% taker share and
pairRate 0.724, with 39 filled crosses / 60 conversions and S 0.9869
over 9 both-sided markets.

Two useful context numbers fell out (control arms, not selection
data): final pair-cost sum S sits at 0.9767 (h1) / 0.9696 (h2) —
i.e. the E005 cap grid {0.96,0.97,0.98} has real bind-mass at the
REFERENCE shape, and the incumbent pair-cost region (0.95–0.976) is
where this design already lands on average; and conversions cost the
control ~$0.58–0.63/market in era taker fees (acc-exact).

Next: E005 shapes launcher + ref-shape control-reuse amendment
(the [0.01,0.03] shape arm at tol=2 IS runs 682/683 — same
params, same reuse logic as E004's control), then judgment on drain.

## 2026-07-17T06:50Z — session 11, unit 31: E005 shapes launcher built; ra reference reuses 682/683

Second drain-window build unit, still ax2-blind (watcher shows
10,922 pending at 06:49Z, one ax2 flow already persisted — unread).

1. **Reference-shape reuse formalized (§E005 amendment 2):** the ra =
   [0.01,0.03] shape arm at tol=2/none/lat140/clip6 is parameter-
   identical to E003 runs 682/683 — reused, not resubmitted, on the
   same determinism basis as E004's control (u17b 4-dp, u30
   to-the-digit). Shape sub-axis: 6 new runs instead of 8; E005 total
   12 new runs instead of 14.
2. **launch-e005-shapes.sh built** (LS-3 pattern: --dry-run only,
   refuses queued ax3 flows, tol/completion HARDCODED to judged
   values — no free knobs to fat-finger). First dry-run caught two
   guards doing their jobs: submit.ts kebab rule rejected uppercase
   arm codes (rB→rb), and the clean-tree guard refused the untracked
   launcher — commit-then-verify is the required order, same as
   E004's u22 flow. Codes: rb=[0.02,0.06], rc=[0.02,0.13],
   rd=[0.01,0.02,0.05,0.13]; suffixes ax3h<half>-<code>; cap arms
   later under ax4.

Post-commit dry-run verification is the next step in this unit; then
the queue is: E004 judgment on drain → launch E005 shapes.

## 2026-07-17T06:55Z — session 12, unit 32: pickup ritual; judgment kit pre-loaded; drain ETA ~07:13Z

Fresh session in the relay. Ritual results: DONE absent, tree clean
on gabagool-lab, KB register still tops at A33 (its two new commits
are an OPEN-QUESTIONS re-rank and an operator-owned stop-marker note
— nothing to fold), origin/main feed wiring unchanged (binance
sub-feed only; price-to-beat and Chainlink still not landed). The s11
harness watcher died with its session as expected; the detached nohup
watcher (pid 20098) is alive and logging — 9,194 market jobs pending
at 06:53Z, ~455/min → drain ETA ~07:13Z.

Pre-loaded the whole E004 judgment procedure while the queue drains:
re-read LEDGER §E004 frozen criteria (readout fields, H6 0.3%-of-
turnover spread read, adjacency in the frozen order none < c970 <
c990 < cfree, verbatim 8-cell advance rule, mechanism split) and
§E005 (both pre-freeze amendments incl. cap-grid finalization rule),
verified e004-table.ts arm-wiring syntax (--arm label=h1,h2; control
is none=682,683) and launch-e005-shapes.sh (--dry-run only, refuses
queued ax3). Missing inputs are only the 6 ax2 run ids, which exist
after aggregates persist. Plan: monitor drain → judge E004 (u33) →
launch E005 shapes (u34) → E005 prep/judgment as time allows.

## 2026-07-17T07:28Z — session 12, unit 33: E004 judged — H6 survives; free completion is the strongest lever yet; caps are dead

The queue drained on forecast (last watcher line 07:13Z; all 6 ax2
runs persisted by 07:12:59Z, 0 failed jobs each). Identity first:
runs 691–696's submission uids match the frozen launch uids to the
digit; control stayed 682/683. Validators green on all six (fee-recon
|recon−db| ≤ 0.27 vs tol ≥ 57.60, meta coverage 100%, settlement and
segments cross-checks OK).

The headline: completion policy MOVES this book. Policy spread is
1.99%/2.24% of turnover in the two halves — 6.6–7.5× the
pre-registered 0.3% kill line, so H6 survives: the live
b55f-vs-0xce25 gap plausibly WAS policy. And the direction is the
one nobody pre-registered: free completion (cross the lagging leg
whenever it lags, no price cap) beats control by +1.10/+0.87 $/mkt,
the only DISTINCT adjacency in both halves, while both cost-capped
arms are noise vs control (c990 point-estimates worse).

The mechanism decomposition (new tool e004-decomp.ts, exact additive
identity asserted against the canonical EL per run) explains the
paradox: cfree's completed pairs cost ABOVE $1.00 on average
(S 1.0207/1.0188 — every completed pair locks ~2c loss plus fees),
yet EL improves because completion REMOVES the bleeding channels:
maker fills drop 26.6%/23.6%, involuntary latency conversions drop
39%/38%, and tail one-sidedness collapses (imbalance p90 1.000 →
0.335). Caps are the same knob pointed backwards — they cross when
the pair is already cheap (the markets that were fine) and hold
exactly the adverse inventory. LS-7.

Also new and quantified: cfree forfeits ~$1/mkt of winner-remainder
redemptions by pairing inventory that would have won anyway. A
spot-aware completion (cross only when the HELD leg lags fair value;
binance feed is replayable now) keeps the removal and the remainders
— seeded as E-completion-selective in the backlog. Upper bound ≈
−2.4 EL, still negative: a lever, not a cell.

The frozen advance rule FAILS by the letter — top-2 sets differ
({cfree,c970} h1 vs {cfree,none} h2) because the #2 slot is a coin
flip among three statistically tied arms. Consequence applied
verbatim: no completion default; candidate confirmations run
maker-only, stated. D-008 records the interpretation boundary (a
future frozen candidate spec MAY include completion=free, citing the
instability caveat, and then faces the full gates + one-shot
holdout); LS-8 records the rule-design lesson (test the
decision-relevant partition, not rank order within noise). E005
stays maker-only by design.

Ladder position: best measured cell is now cfree −3.47/−3.35
(sel-width 4, lat140 only, no gate vector) vs reference −4.39. The
gap to zero narrowed ~24% and the strongest single lever so far is
identified — but the concept still pays ~6% of outlay per market to
trade. Next: launch E005 shapes (launcher verified, worker free).

## 2026-07-17T07:33Z — session 12, unit 34: E005 shapes frozen + launched at 7355c21a

Freeze-then-launch, same ritual as E004: §E005 status flipped to
frozen (spec + both pre-freeze amendments verbatim, nothing filled at
freeze — tol=2 and completion=none were stamped by prior judgments),
freeze commit 7355c21 pushed, THEN the launcher ran. Dry-run showed
all six cells correct (windows Apr/May, rungOffsets per code, env
pins lat140/jitter0); real launch enqueued 6 flows, every one at
commitSha=7355c21a — the freeze commit is the run SHA, as it should
be. agg-inspect confirms 6 waiting-children flows and 17,446+12
market jobs ≈ the expected 17,568; markets failed=0. Watcher: nohup
pid 87197 → logs/watch-drain-s12-e005-shapes.log. At the E004 pace
(~450–540/min) the drain lands ~08:05–08:10Z.

This axis reads pure placement depth on the 2-rung arms (rb
[0.02,0.06], rc [0.02,0.13]) against the reused reference ra
[0.01,0.03] = runs 682/683, plus the archetype 4-rung package rd
[0.01,0.02,0.05,0.13] (size × depth, per the LS-6 effective-grid
notes: rd rests 24 shares/side/cycle and its parity floor binds
mid-sweep). Deep arms have asymmetric band suppression (a 0.13 rung
quotes only when bid ≥ 0.24), so played share and fills are
first-class readouts, not just EL. The target region is where the
only profitable parity wallets live: pair cost 0.95–0.976.

While it drains: E004 aftermath is fully banked (judgment, LS-7/8,
D-008, LEADERBOARD rows, backlog seed). Next unit is the shape
sub-judgment on drain; axis-table.ts should handle the ax3 prefix
natively (numeric-axis tool — but shapes are categorical codes, so
the E004 lesson applies: check whether e004-table's explicit-wiring
pattern is needed for ra reuse before leaning on axis-table).

## 2026-07-17T07:38Z — session 12, unit 35: E005 judgment kit built ax3-blind (e005-table.ts); ra + bind machinery verified

Drain-window build, same discipline as u30: the ax3 queue is ~15.4k
jobs deep (zero ax3 runs persisted — provably blind; this commit
predates the first ax3 aggregate by ~25 min).

The frozen criteria name axis-table.ts for adjacency, but the shape
arms are categorical codes with the reference reused under the ax1
prefix — the exact wiring problem E004 hit. Built e005-table.ts:
explicit --arm wiring with LS-3 guards (rungOffsets-vs-label exact
match, parityTolPct must be 2, completionMode must be none/absent,
any 'x' meta in a maker-only run aborts, non-completed runs abort),
per-cell readout per frozen criteria (2) incl. played share
(first-class per the LS-6 asymmetric-band note), imb p50/p90, CVaR5
(convention aligned to results.ts after the first check came out
4c off — same estimator now, mean of worst floor(5%·n)), S(pair)
mean, fills. Adjacency runs on the pure-depth chain ra<rb<rc with
endpoints, rd reported separately as the A17 package vs ra (the
sub-judgment must say which comparison it reads — LS-6). Advance
rule rendered verbatim: endpoint depth-direction agreement +
top-2-of-4 set match across halves.

Verification (all blind): ra=682,683 reproduces the E003 table to
the digit (EL −4.5656/−4.2209, taker 33.9/34.0, pairRate 0.657/
0.632, imb p50 0.175/0.199, outlay 56.82/52.49, S 0.9767(2304)/
0.9696(2317), CVaR5 −21.46/−19.75); wrong-shape wiring (682 as rb)
and completion-run wiring (694 as ra) both abort with the right
message.

The pre-registered cap-grid bind table is a subcommand (--bind
h1,h2): pooled per-market S, quantiles, bind(0.96/0.97/0.98), and
the frozen KEEP/REPLACE rule with the quartile fallback (de-collide
±0.01, clamp [0.90,0.99]). Machinery check on the ra pair: n=4621,
S p25/50/75 = 0.9571/0.9786/0.9909, bind spread 0.2541, bind(0.98)
0.4713 → KEEP at the reference shape (context only — the decision
input is the WINNER's pair, run after the sub-judgment is written).

Drain at 15,421 pending (07:36Z), ~450/min → judgment ~08:10Z.

## 2026-07-17T08:22Z — session 12, unit 36: E005 shapes judged — the first axis to PASS its advance rule; depth is the real lever; caps launched on the winner

All 6 ax3 runs landed clean (uids verified to the digit, validators
green across the board, G2 97.2–99.5% played). The result is the
strongest and cleanest signal the lab has produced:

Depth pays, hugely and stably. Both deep 2-rung arms beat the
shallow reference DISTINCT in both halves: rb [0.02,0.06] by +1.75,
rc [0.02,0.13] by +1.86. rc wins both halves outright (−2.7093 h1,
−2.3622 h2) — the best measured cell yet, maker-only, no completion
machinery — and it does it on 60% of the reference outlay with the
best tails so far (CVaR5 −16.70/−15.30 vs −21.46/−19.75). Its pairs
complete at S ≈ 0.9427/0.9374 — BELOW the 0.95–0.976 region where
every known profitable parity wallet lives. The advance rule held:
endpoint direction + in both halves, top-2 = {rb, rc} in both
halves. First time.

Equally informative: the A17 4-rung archetype package (rd) is
indistinguishable from the reference and point-worse in both halves.
Adding shallow rungs back at 2× resting size buys reference-like
pair economics at the largest outlay of any arm. Whatever makes the
live archetype print, it is NOT this ladder shape at this sizing —
consistent with A32's tier/completion/timing hypotheses. Dead-region
row added.

Mechanism: exactly LS-2 inverted. Fewer, better fills — maker fills
−40%, outlay −40%, pairRate FALLS to 0.576/0.558, imbalance p50
RISES to 0.270 — and EL still improves 1.9: the fills depth sheds
were the adverse ones. Notably imb p90 stays 1.000 in every arm:
the fully one-sided tail market survives depth. That residual tail
is where E004's completion lever (which crushed p90 to 0.335 on the
shallow ladder) might compose; deep × free-completion interaction
is in the backlog, unmeasured.

Then the two pre-registered follow-ons, in order: (1) bind table on
the winner pair 698/699 — n 4,135, S p25/50/75 = 0.9125/0.9567/
0.9803, bind(0.96/0.97/0.98) = 0.4663/0.3599/0.2544 → rule says
KEEP {0.96,0.97,0.98}, recorded and committed before any launcher
existed; (2) built launch-e005-caps.sh (hardcoded rc + kept grid,
LS-3 pattern; submit.ts's push-guard caught my unpushed HEAD on the
first dry-run attempt — the guard rail worked), dry-run verified,
launched 6 ax4 flows at d8f5be2b, verified via agg-inspect (17,459
waiting ≈ 17,568 expected, 0 failed), watcher pid 44081. Drain ETA
~09:00Z; cap sub-judgment (criteria 5: pairRate/EL trade-off curve)
when drained.

## 2026-07-17T08:26Z — session 12, unit 37: e005-table extended for the cap sub-axis, ax4-blind

Drain at 15,410 pending — zero ax4 runs exist; this extension is
blind like u30/u35. Added cap mode to e005-table.ts: labels
{c960,c970,c980,c990} with their own guards (every cap arm must be
the winning shape [0.02,0.13]; pairCostCap must match the label,
with absent-param = 0.99 file default so the reused c990 ref wires
cleanly; shape labels now also assert cap 0.99 for tightness),
mode detection that refuses mixed shape/cap wiring, the criteria-(5)
pairRate/EL trade-off block, the pre-registered participation
caveat (played < 20% → "cap chokes participation", flagged inline),
and the E003-style advance rule on the cap chain c960<c970<c980<
c990-ref.

Blind verification: shape mode regression intact (ra rows exact);
cap mode c990=698,699 reproduces the rc rows to the digit; guards
abort on 682-as-c990 (offsets), 698-as-c960 (cap), and ra+c990
(mixed). Judgment on drain is now a fill-in-the-run-ids exercise.

## 2026-07-17T09:08Z — session 12, unit 38: E005 caps judged, axis CLOSED — tighter placement caps are monotone better; best cell −2.29/−2.02; E005 done end to end

All 6 ax4 runs clean (uids to the digit, validators green, max
segment drift 0.0045). The cap sub-axis answered its pre-registered
question crisply: forcing deeper pairs RAISES EL, it does not just
lower fill count. The curve is monotone tighter-better in BOTH
halves (every adjacent sign −), the advance rule held AGAIN (top-2
{c960, c970} both halves, endpoint direction stable, endpoints
DISTINCT in h1), and the participation caveat never armed — played
share is constant across caps because pairCostCap binds pair
assembly, not quoting eligibility.

Two things worth saying plainly. First, the composition: reference
−4.57/−4.22 → deep shape −2.71/−2.36 → deep + cap0.96 −2.29/−2.02.
Half the reference loss is gone, maker-only, at half the outlay,
with the best tails the lab has measured. Both E005 sub-axes passed
their advance rules — the lab's first two passes — so this is
stable structure, not noise-mining. Second, the honesty caveat: the
curve was still improving AT the grid edge, so the optimum is
unbracketed below 0.96. Per the frozen kill/stop the axis closes at
planned resolution; the extension {0.92, 0.94} is seeded as E005b
in the backlog, not silently bolted on (LS-9 corollary).

LS-9 recorded: the placement-side cap and the completion-side cap
are the same knob on opposite sides of the pair lifecycle with
OPPOSITE value — guard placement, free the rescue. Backlog also
gains E-deep×completion (E004's removal lever is unmeasured on the
deep book, where imb p90 is still 1.000 and one-sidedness is the
residual loss channel).

Next per the frozen §E005 coverage clause: the latency battery
(0/500/1000) on the surviving region before any candidate talk.
Plan u39: launcher for rc+c960 at lat {0, 500, 1000} × halves
(6 runs; lat140 cells already exist), LS-3 pattern, then judgment
of the battery against G-gate latency requirements (EVALUATION:
edge must survive 500–1000 ms).

## 2026-07-17T09:13Z — session 12, unit 39: latency battery launched on rc+c960 (pre-registered addendum first)

The §E005 coverage clause mandates the battery before any candidate
talk, so it goes now, by the book: battery addendum pre-registered
in §E005 and committed BEFORE submission (readout fields, the E002
comparison curve to beat, the explicit statement that L-ratios are
undefined at EL(140)<0 and this is characterization + the LS-1
standing-ladder hypothesis test, not a G6 evaluation). Launcher
dry-run caught a suffix bug (bath${half} rendered "bathh1" — double
h vs the pre-registered bath1/bath2 grammar); fixed and committed
BEFORE launch, then 6 flows enqueued at c19e1365 and verified
read-only (17,463+12 ≈ 17,568 jobs, 0 failed). Watcher pid 1994.
Drain ETA ~09:52Z.

The battery question that matters: E002's shallow ladder lost
−4.88/mkt going lat0→lat1000 (its entire economics were latency
artifacts). If the deep standing ladder's degradation is small, the
−2.16 avg cell is real structure that survives execution reality —
and the family earns candidate assembly. If it degrades like E002,
depth was another latency mirage. Either answer is decisive.

## 2026-07-17T09:15Z — session 12, unit 40: battery readout path verified + interpretation framework pre-registered (0/6 battery runs persisted — blind)

Readout path: results.ts --battery reproduces the E002 curve to the
digit (−4.3904/−0.4207/−5.0288/−5.3047, fills matching the L1
record), so the battery judgment uses it per half; S(pair)/pairRate/
imb per lat come from per-lat e005-table invocations (one c960 label
per call — no duplicate-cell collision; its param guards are
lat-agnostic by design). No new tooling.

Interpretation framework, written BEFORE any battery number exists
(program-prioritization guide, not an evidence rule — the evidence
readout is the pre-registered addendum):
- Family REAL (small degradation, roughly: EL(1000) − EL(140)
  shallower than about −1 $/mkt and taker share not exploding
  toward E002's 55%): candidate assembly path opens; priority
  E005b bracket (4 cheap runs) → E006 timing → candidate spec
  (D-008 decides whether completion=free joins).
- Family MIRAGE (E002-like collapse, Δ(140→1000) around −1 $/mkt or
  worse on a −2.16 base, taker share inflating toward 50%+): the
  lat140 numbers are execution artifacts; block candidate talk;
  E008 fair-value gate becomes the priority (quote-stability alone
  is insufficient), and the dead-region record gets the latency
  column.
- In-between: judge by whether the DEPTH ordering (rc+c960 vs ra
  reference at matching lats) survives — the axis conclusion, not
  the absolute EL, is what must be latency-robust for the family to
  keep its structure claim.

## 2026-07-17T10:27Z — session 12, unit 41: battery landed with one stalled market; my bare --extend nearly polluted the run — caught, recovered, LS-10

The battery drained at 10:00Z but run 714 (lat0 h1) came back
PARTIAL: 2,879/2,880, one BullMQ stall ("job stalled more than
allowable limit") on btc-updown-15m-1776879000 — infrastructure, not
code. My waiter sat blind on it for 17 minutes because it counted
only status=='completed' rows (LS-10 second half).

Then the real mistake: I ran `--extend 714` bare to retry the
failure. Without a window, extend means "add EVERYTHING eligible the
run lacks" — it enqueued 9,024 foreign-window markets (Dec–Mar +
May–Jun) against a battery cell whose identity is "April at lat0".
Caught it at ~500 jobs processed, before any merge: killed the
producer, paused the markets queue, drained the 12 locked actives,
removed the extension flow PARENT-first (LS-4 held up), resumed,
verified run 714 still had exactly 2,879 in-window rows (extension
rows persist only at the merge transaction — the design saved me),
cleared the stuck `extending_at` per the documented recovery, then
re-extended WITH `--from-ms/--to-ms` = the April window. That
enqueued exactly the 1 failed market; run 714 is now completed,
2,880/2,880, zero failure rows, all rows in-window (verified by
count + min/max market_start_ms). The retried market ran at SHA
79c414cf vs the battery's c19e1365 — no src/ change between them
(docs/tools commits only), so the cell's economics are unchanged;
stated for the record. LS-10 written. Total cost ~25 min. The
battery evidence set is whole; judgment next.

## 2026-07-17T10:31Z — session 12, unit 42: battery judged — the chassis is real, the P&L is not; conversion is the whole game

All six battery runs verified (uids to the digit, validators green;
714's extension preserved its identity). The pre-registered readout,
quoted:

EL by latency (h1/h2, E002 shallow fullwin in parens): lat0
−0.1175/−0.0136 (−0.42) · lat140 −2.2884/−2.0229 (−4.39) · lat500
−3.1803/−3.1313 (−5.03) · lat1000 −3.4644/−3.4688 (−5.30). Taker
share 1.7/0 → 37 → 50 → 56% — the same inflation slope as the
shallow ladder (34→48→55). Δ(140→1000) −1.18/−1.45.

Two conclusions, both decisive. First, the good one: depth's
advantage is latency-ROBUST — the deep chassis beats shallow by
+1.8 to +2.2 $/mkt at EVERY latency arm. The axis conclusion
survives execution stress; the chassis claim stands. Second, the
sobering one: the lat0 cells show the deep book barely trades at
zero latency (35–37% played, ~0.5 fills/mkt, taker ≈ 0, pairRate
0.11, and EL ≈ −0.07 — the sparse organic pairs are cheap, S
0.80–0.82). About 95% of lat140 fills exist only because quotes sit
exposed in the latency window. The −2.16 avg at realistic latency
is not adverse selection on resting depth — it is the
requote-conversion channel, full stop. LS-1's hope that a deep
standing ladder would churn less: refuted at this grid
(requoteDelta 0.02 re-anchors the whole ladder on every 2c move).

The u40 blind framework fires on its MIRAGE branch (Δ ≤ −1, taker
→56%) with the in-between clause holding (ordering robust), and I
applied it as written: the family keeps its structure claim,
candidate assembly is BLOCKED until an axis closes the conversion
channel. The program's next move is now measurable-mechanism-driven
rather than taste-driven: quote-stability (requoteDelta grid on the
deep chassis — never tested, LS-1 named it, and the channel it
attacks is 100% of the residual loss) → then E008 fair-value
suppression → then compositions. E006-quote-stability draft is the
next unit: read the strategy's requote code first (LS-6
effective-grid pass), then the proposal.

## 2026-07-17T10:36Z — session 12, unit 43: E006-quote-stability proposed (requoteDelta grid on the deep chassis)

The proposal writes itself from the battery: the residual loss is
~100% requote-conversion, requoteDelta has sat untested at 0.02
since E002, and LS-1 called quote-stability a design axis on day
one. Grid {0.02 ref (= runs 708/703 reused), 0.05, 0.10, 0.20,
0.45} on the rc+c960 chassis, halves, lat140 — 8 new runs. The
schema bounds requoteDelta below 0.5, so 0.45 is the effective
"never re-anchor within a window" arm; a true never-requote needs a
code change and is explicitly out of scope this axis. LS-6 pass:
the knob is an absolute price distance — no sizing floor to
collapse arms; all five are behaviorally distinct by construction.
Participation is pre-declared as a measured output with the E005
choke-caveat language (high deltas SHOULD trade less; that is the
trade-off being bought). Old E006 (time-weighting) re-ranked to
backlog as E-timing, reason recorded in the proposal.

Prediction pre-registered in the mechanism block: EL climbs toward
the lat0 economics (≈ −0.1) as delta grows, participation falls;
the curve's shape decides whether a standing deep ladder keeps
enough flow to matter. Next: launcher + q-mode table extension
(blind), then freeze-at-submit and launch.

## 2026-07-17T10:35Z — session 12, unit 44: E006 frozen + launched at 35a6f5de (8 flows, ~23.4k jobs)

Freeze-at-launch ritual held: proposal committed u43, launcher
committed u44, dry-run verified all 8 cells (chassis params
verbatim, delta per code, windows right), real launch enqueued 8
flows all at the launcher SHA, verified read-only (23,296+12 ≈
23,424 jobs, 0 failed), uids recorded in §E006, watcher pid 94585.
Drain ETA ~11:26Z at the standing ~450/min pace.

While it drains, the judgment kit needs a q-mode in the family
table tool (labels q05..q45 + the 0.02 reference; guards on
requoteDelta-vs-label with chassis params pinned; the delta chain
adjacency + advance rule; participation flagging already exists).
Same blind-build discipline as u30/u35/u37.

## 2026-07-17T10:37Z — session 12, unit 45: q-mode added to the family table, ax5-blind

Third label family in e005-table.ts: deltas {q02-ref, q05, q10,
q20, q45} with chassis pins (offsets rc, cap 0.96, tol 2, none) and
requoteDelta-vs-label guards (absent = 0.02 default so the reused
ref pair wires clean); the EL-vs-participation trade-off block adds
taker% and fills/mkt (the two numbers the conversion story lives
in). Blind verification: q02=708,703 reproduces the c960 rows to
the digit; wrong-cap (698 as q02), wrong-delta (708 as q05), and
mixed-family wiring all abort; shape and cap modes regress clean.
Judgment on drain is again fill-in-the-ids.

## 2026-07-17T12:01Z — session 13, unit 46: pickup + early verification of the 4 landed E006 runs; drain slowed, ETA revised ~12:35Z

Session 13 pickup at 11:56Z. Ritual: DONE absent, tree clean at
3b95fdf, KB unchanged since my A33 fold (its new top commit is an
operator process note — stop markers are operator-owned; nothing to
fold), feeds still binance-only (wireBacktestExternalFeeds.ts:91
says rtds/priceToBeat have "no backtest source yet" — checked
origin/main after fetch), telonex coverage unchanged.

E006 drain is behind the u44 ETA: the watcher log has a 42-minute
flat stretch (11:08→11:50, ~170 jobs) and the pace since is
~170/min, half the launch-time ~450/min. Cause visible in ps: the
operator's tmux markets worker (concurrency 5) is no longer
running; only my nohup worker (markets+aggregate, mc=4) and the
operator's aggregate-only worker survive. Not mine to restart —
noted and continued. Revised ETA ~12:35Z.

Meanwhile 4 of the 8 flows are already terminal and I verified
them now rather than sitting blind (LS-10 spirit): 715=ax5h2-q05,
716=ax5h1-q10, 717=ax5h2-q10, 718=ax5h1-q20 — submission uids
match the frozen LEDGER uuids to the digit, market counts right
(2976/2880), 0 failures, validators green on all four (settlement
OK, fee-recon VALID, meta 100%, segments OK). The uid check is now
a permanent tool (tools/uids.ts) instead of a per-judgment tmp
script.

Early peek, stated honestly and NOT a judgment: q05 h2 EL −2.5887
vs ref −2.0229 (WORSE by 0.57); q10 h1 −2.2527 vs ref h1 −2.2884
(flat, hair better); q10 h2 −2.3324 vs −2.0229 (worse); q20 h1
−2.2460 (flat). Taker fill share collapsed as designed (715: 11%
of fills vs ref 37%) — so conversions ARE being removed, but the
money is not coming back; the loss appears to morph into
stale-quote adverse selection. The frozen prediction (EL climbs
toward lat0 economics ≈ −0.1) is in trouble. Judgment only on the
complete 8-run table per the frozen §E006 criteria. Next: waiter
on the remaining 4 (terminal-state poll, 90-min hard timeout),
then fill-in-the-ids.

## 2026-07-17T12:05Z — session 13, unit 47: run 719 (ax5h2-q20) verified on landing; terminal-state waiter up for the last 3

Fifth flow terminal: 719 = ax5h2-q20, uid matches the frozen
LEDGER uuid to the digit, 2976 markets, 0 failed, validators green
(settlement OK, fee recon |0.20| vs tol 59.52, meta 100%, segments
OK). Honest peek, still not a judgment: EL −2.3681 vs ref h2
−2.0229 (worse by 0.35). Taker share is down to 4.8% of fills
(1296/27173) vs ref ~37% — the delta lever removes conversions
exactly as designed, and the money still does not come back. Same
shape as u46's four: the loss morphs into stale-quote adverse
selection instead of vanishing.

Remaining 3 flows (ax5h1-q05, ax5h1-q45, ax5h2-q45) match the 3
waiting-children aggregates in the queue. Drain pace ~174/min with
~5.2k jobs at 12:03Z → ETA ~12:33Z. LS-10 waiter launched in
background: polls runs for terminal state (completed OR partial OR
failed) every 60s, 90-min hard timeout, branches on partial per
the u41 windowed --extend recovery. Judgment stays fill-in-the-ids
on the complete 8-run table per frozen §E006 criteria.

## 2026-07-17T12:08Z — session 13, unit 48: E008 blind-window scoping (read-only) while E006 drains

Used the blind window (last 3 E006 flows draining, ETA ~12:36Z) to
scope the fair-value axis so its proposal can move fast if the
E006 judgment points there. Findings, all read-only:

- E003-pair-accumulator.ts has NO feed wiring today. The pattern
  (from readExternalFeedsExample.v1.ts): register
  `ExternalFeedsRequestPlugin({ binanceWsSpotPrice: {} })` in
  create()'s pluginSet, read
  `ctx.plugins['externalFeeds'].binanceWsSpotPrice.value` per tick.
  ~15-line change; pair follows the market slug in backtests.
- Strike proxy per H4 = first spot value at/after window open; the
  backtest feed is seeded with the last pre-window trade, so a
  value exists at open (as-of lookup, ~110 ms measured offset).
- Data: 61/61 BTCUSDT aggTrades day files on disk for Apr+May
  2026 — the whole search window. Missing days would be a hard
  error; there are none. E008 is unblocked on data.

Design itself (suppression rule, threshold grid) stays unwritten
until proposal time per the experiment lifecycle — this unit only
established that the machinery is a small, known change. Drain at
12:08Z: ~4.3k jobs, ~153/min.

## 2026-07-17T12:11Z — session 14, unit 49: pickup + waiter re-established for the last 3 E006 flows

Session 13 ended at u48 (12:08Z); this session started 12:09Z —
two minutes of gap, nothing lost. Ritual: DONE absent, tree clean
at fc2ed1c, KB unchanged since A33 (top commit is the operator
process note s13 already saw), origin/main gained only a docs
commit (operator-feed runbook note), my worker (mc=4) + the
operator's aggregate worker + the nohup drain watcher all alive.
Drain at 12:09:50Z: 4,007 market jobs, ~190/min → ETA ~12:30Z.

s13's LS-10 waiter was a session-scoped background shell and died
with the session — re-established here as id bpv5csxwx. One
sharpening while rebuilding it: the 3 remaining flows (ax5h1-q05,
ax5h1-q45, ax5h2-q45) have NO backtest_runs rows yet — the
aggregate job creates the row when its market children finish, so
run ids are unknowable pre-landing. The waiter therefore counts
terminal ax5 rows (need 8) instead of polling named ids. On fire:
uids + validators on the 3 new rows, then the full 5-arm × 2-half
table, then judgment per frozen §E006 criteria only.

## 2026-07-17T12:14Z — session 14, unit 50: blind-window mechanism decomposition + peek-line correction

Two findings while the last 3 flows drain (3,415 jobs at 12:14Z),
both from landed runs only — judgment still waits for the full
table.

**Correction first (honesty): the u46/u47 "early peek" quoted the
wrong line for three runs.** results.ts prints TRADE_sim and then
the era-corrected EL headline; the peeks for 716/717/718 quoted
TRADE_sim (−2.2527/−2.3324/−2.2460) instead of canonical EL
(−2.3103/−2.3715/−2.2897). 715/719 were quoted correctly. The
u46 phrase "q10 h1 flat, hair better" is therefore wrong: q10 h1
is WORSE than ref (−2.3103 vs −2.2884). Corrected picture: all 6
landed non-ref cells are at-or-worse than reference. Rule for
future peeks: quote only the line labeled "<- headline".

**Mechanism (e004-decomp.ts runs unchanged on ax5 — the identity
holds, asserts green): raising requoteDelta kills the
winner-remainder term, and that term was load-bearing.** h2 chain
(703→715→717→719): rem$ 2.37 → 1.11 → 0.99 → 0.86/mkt while fee
savings are only +0.21..0.28. h1 partial (708→716→718): same rem
collapse (−1.18/−1.22) offset by slightly better pair economics →
flat EL. Reading: the requote engine chases price, so the side
being accumulated tracks the eventual winner — unpaired remainder
at ref is worth ~$2.2–2.4/mkt at settlement. Freeze the quotes and
stale bids fill on the side price is leaving: remainder becomes
outcome-adverse. Conversion-fee removal (the E006 bet) recovers
~$0.3; remainder adverseness costs ~$1.2–1.5. That asymmetry is
why EL does not climb toward lat0 economics. Also: played stays
99.5% at q10 — the participation-choke caveat looks unlikely to
trigger even at q45 (first anchor always quotes; delta only gates
RE-anchoring).

Both facts go into the judgment as mechanism evidence; the verdict
itself stays fill-in-the-ids on the frozen §E006 criteria.

## 2026-07-17T12:19Z — session 15, unit 51: pickup + runs 720/721 verified on landing (7/8 terminal)

Session 14 ended at u50 (12:14Z); this session started 12:17Z.
Ritual: DONE absent, tree clean at 0c76f9c, KB unchanged (top
e4157b8, seen s13), origin/main docs-only (e988131, seen s14), my
worker + operator aggregate worker + nohup drain watcher all
alive. Drain at 12:18Z: 2,652 market jobs → ETA ~12:32Z.

Two more flows landed since u50 and I verified them on landing:

- **721 = ax5h1-q05**: uid matches frozen LEDGER uuid to the
  digit, 2880 markets, 0 failed, settlement OK, fee recon |0.11|
  vs tol 57.60 VALID, meta 100%, segments OK. Headline EL
  **−2.5978** vs ref h1 −2.2884 → worse by 0.31.
- **720 = ax5h1-q45**: uid matches, 2880 markets, 0 failed, all
  validators green. Headline EL **−2.3015** vs ref h1 −2.2884 →
  flat (hair worse, 0.013).

Honest peek update (headline lines only, per the u50 rule): the h1
chain ref→q05→q10→q20→q45 reads −2.2884 → −2.5978 → −2.3103 →
−2.2897 → −2.3015. Non-monotone: q05 dips hardest, then the chain
recovers toward ref and plateaus AT ref — never above. 7/8 cells
at-or-worse than reference. The frozen prediction (EL → lat0
economics ≈ −0.1 as delta grows) looks dead on h1: the plateau is
at ref level, nowhere near the frictionless bound.

s14's waiter died with its session; re-established as background
id blehtrhfn (60s poll, counts terminal ax5 rows, needs 8, 45-min
timeout — drain is ~14 min out). On fire: verify ax5h2-q45
(uid + validators), then the full 5-arm × 2-half table via
e005-table.ts, then judgment strictly per frozen §E006 criteria.

## 2026-07-17T14:06Z — session 16, unit 52: E006 JUDGED — AXIS-CLOSED, prediction refuted, chassis keeps delta 0.02

Session 15 died mid-wait (last commit u51 at ~12:19Z; the LS-10
waiter died with it). Pickup at 14:03Z: DONE absent, KB/origin
unchanged since s15's check, queue fully drained (markets 3,000
completed / 0 waiting; the 3 failed aggregate jobs are the known
stale foreign duplicates).

**Pickup incident: the pre-commit hook had an UNCOMMITTED local
modification that stripped the entire DONE guard** (the block added
after the s3 stray-DONE incident). I did not make this edit; no
session journaled it. Restored with `git checkout --
gabagool-lab/.hooks/pre-commit` before doing anything else — the
guard only blocks unauthorized `DONE` additions and costs nothing,
so restoring is the conservative move regardless of origin. If the
operator removed it deliberately: say so in a note and I'll drop it.

**Run 722 = ax5h2-q45 landed and verified:** uid matches the frozen
LEDGER uuid to the digit (009f6334…), 2,976 markets, 0 failed,
settlement OK, fee recon |0.21| vs tol 59.52 VALID, meta 100%,
segments OK. Headline EL **−2.3428**. That completes 8/8 — E006
fully landed with zero failures.

**Full table + judgment (LEDGER §E006, criteria applied verbatim):**

- h1 chain ref→q05→q10→q20→q45: −2.2884 → −2.5978 → −2.3103 →
  −2.2897 → −2.3015. h2: −2.0229 → −2.5887 → −2.3715 → −2.3681 →
  −2.3428. Every cell at-or-below reference. Taker share collapses
  37% → 5–7% exactly as the mechanism said it would — and EL does
  not recover. The frozen prediction (EL → lat0 economics ≈ −0.1)
  is REFUTED: the plateau sits at ref level (h1) or below it (h2).
- Advance rule: endpoint direction agrees (both −) but top-2 sets
  differ (h1 {q02,q20}, h2 {q02,q45}) → FAILS → chassis keeps
  requoteDelta 0.02 per the frozen consequence.
- Participation caveat never armed: played 99.5% everywhere. Delta
  gates re-anchoring only; the first anchor always quotes.
- Completed the u50 decomp on the 3 late runs (both chains now
  full, identity asserts green): Δrem −1.08..−1.53 $/mkt in every
  arm vs Δfee only +0.21..+0.29 and net pair improvement ≤ +0.93.
  The remainder collapse outweighs everything, everywhere. u50's
  reading is confirmed at full resolution.
- One genuine effect: CVaR5 improves ~45% (−15.5 → −8.7) as churn
  disappears. Quote-freezing is a TAIL lever, not an EV lever
  (LS-11 corollary).

**What this means for the program:** the battery's "loss is ~100%
requote-conversion" conflated a ~$0.3 fee term with a ~$1.3–1.5
information term — the requote engine's price-chasing keeps the
accumulating side on the eventual winner, and that remainder payload
is load-bearing. A conversion-closing lever must keep winner-
tracking while avoiding the cross. Mechanical freezing can't
(measured); an EXTERNAL fair-value anchor might — re-anchor quotes
on binance spot (replayable now, wiring scoped u48) instead of
own-book chasing: the quotes follow the mover without standing
stale on the leaving side, and without cancel-in-flight churn
against our own fills. E008-fair-value is next; E005b bracket and
completion composition rank behind it (neither touches the loss
channel). Candidate assembly stays BLOCKED per the u40 framework.

LS-11 recorded; dead region on LEADERBOARD; LEDGER §E006 filled.
Next unit: E008-fair-value proposal draft (arms, criteria,
freeze-ready) from the u48 scoping + this mechanism evidence.

## 2026-07-17T14:10Z — session 16, unit 53: KB fold A34–A39 — forensics independently confirms the LS-11 mechanism; (offset × requote) is a joint axis

Ritual completions from pickup: origin/main has NO new feed code
(docs-only e988131, already seen) — price-to-beat/Chainlink still
not landed, E008 designs against binanceWsSpotPrice only. KB moved
A33 → A39 since my s13 read; folded as INHERITANCE A-6.

The two load-bearing amendments, in my terms:

- **A36/A39 are the wallet-forensics twin of LS-11.** The KB
  measured (from fills, independently of my sim) that living
  winners' unpaired lean tracks the eventual winner (excess leg
  wins 60–81%) and that fill-selection quality — post-fill drift —
  is what separates profitable from breakeven twins. My E006
  decomp found the same object from the other side: the
  winner-remainder payload is the load-bearing term. Two
  independent methods, one mechanism. E008's target ("track the
  mover without paying the churn") is now confirmed from both
  directions.
- **A37 reframes E006's result.** Fast requoting helps at the
  touch, hurts at depth; my chassis shares ONE requoteDelta across
  rungs [0.02, 0.13]. E006 measured the shared knob and found fast
  (0.02) best NET — consistent with A37 if the touch rung's speed
  benefit dominates the deep rung's patience benefit at my sizing.
  Per-rung requote policy (fast touch / patient deep) is a
  mechanistically-seeded variant; needs a schema addition to the
  strategy — backlogged as E006b unless E008's design subsumes it.

Also folded: A38's January stub-parquet flag (Apr/May halves are
clean; guard any future Jan extension), A35 capacity context.
Backlog additions (tools, dossier-grade): post-fill-drift
diagnostic from intent_meta; session stratification in results.ts.

Next unit: E008-fair-value proposal draft, freeze-ready.

## 2026-07-17T14:13Z — session 16, unit 54: E008-fv-gate DRAFTED (adverse-side suppression; grid from pre-registered calibration)

LEDGER §E008 written as DRAFT — freeze happens at submit, after
the calibration fills the grid. The design in one paragraph: keep
the ref chassis exactly as-is (fast 0.02 requote = the
winner-tracking engine E006 proved load-bearing) and add ONE
information gate — no new rungs on the side the spot has left
(|spot−strike| > θ bps against it, strike = window-open spot per
H4). The E006 failure mode is guarded structurally: criteria (5)
requires the winning arm to PRESERVE the remainder term (Δrem ≥
−0.3 vs ref); an arm that wins by killing the payload again does
not advance regardless of EL.

Design choices worth recording (DECISIONS gets the fork):

- Level-form signal (distance from strike) over drift-form
  (momentum over lookback): simpler, no buffer state, H4-scoped,
  and the E006 mechanism sentence — "stale bids fill on the side
  price is LEAVING" — is about where price IS relative to where
  it opened, which the level form captures. Drift-form remains
  available as a refinement if the level gate shows signal.
- Gate blocks NEW placement only; standing rungs cancel via the
  existing requote/parity paths. Simplest honest v1; a
  cancel-on-adverse variant would add a second cancellation
  channel and muddy the decomp attribution.
- Plugin registered ONLY when the gate is on → gate-none stays
  bit-identical to refs 708/703 by construction; plus a ~20-market
  local A/A on the new SHA before launch (cheap insurance; if it
  fails, the reuse basis is broken and refs get resubmitted).
- Grid from data, rule pre-registered NOW (E005 CAP-GRID pattern):
  {p40,p60,p80} of pooled |distance| bps over the quoting window,
  h1-only calibration (h2 untouched by selection), plus θ0
  sign-only endpoint and ref. 8 new runs.
- Fail-open on missing feed values (side treated as not-adverse):
  fail-closed would silently turn the whole strategy off and look
  like a participation result.

Next unit: the calibration measurement (aggTrades → pooled |d|
quantiles, read-only, no DB), then implementation + A/A smoke,
then freeze + launch.

## 2026-07-17T14:17Z — session 16, unit 55: E008 calibration — grid = {5, 9, 15} bps (primary rule fired)

Built tools/e008-calibrate.ts (read-only: run 708's market rows →
epochs; one DuckDB aggregate over 32 day-parquets → per-second
last price; forward-fill; strike = as-of at open). 2.25M pooled
samples, zero markets skipped, full day-file coverage confirmed
(2026-03-31..2026-05-01 present for the seed edge).

Numbers: pooled |spot−strike| p40/p60/p80 = 4.88/8.56/14.92 bps →
rounded grid {5, 9, 15}; p40 ≠ 0 so the primary rule applies, no
fallback. Bind fractions: sign-only 99.9%, θ5 59%, θ9 38%, θ15
20% — a well-spread suppression ladder. One profile fact worth
having on the record: median |d| grows 3.9 → 9.2 bps over the
window, so the gate binds hardest LATE — exactly where the E006
mechanism located the stale-side damage. θ0 (sign-only) will
suppress one side almost always; that's the deliberate
max-suppression endpoint, and it is the arm most likely to choke
pairing (criteria already carry the played<20% caveat language —
though E006 taught us the first-anchor path keeps played high;
here the gate blocks placement itself, so participation CAN
genuinely fall. Good: that's the trade-off curve the axis exists
to measure).

Next unit: implementation (fvGateMode/fvGateBps + conditional
plugin registration) + the A/A smoke against run 708.
