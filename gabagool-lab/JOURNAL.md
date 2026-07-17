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
