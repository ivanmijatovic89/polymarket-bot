# RESCUE-025 — the SCR-025 rescue program (operator FINAL RUN v2 directive, 2026-07-12)

_Authority: STATE.md operator update "FINAL RUN v2: the SCR-025 rescue"
(2026-07-12). One full attempt to save the E22 reversal mirror
(BATCH-005 SCR-025 — the only both-samples-positive screen of the FINAL
RUN batch: A q̂=+0.0410 t=+1.83 clears the bar, B q̂=+0.0246 t=+1.10
sub-bar). The ENTIRE program below — variant grid, winner-selection
rule, success bar, confirmation sample — is frozen in this commit
BEFORE the first sweep submission. Nothing here may change after any
sweep result is read; pre-results amendments (before ANY sweep read)
are permitted with the standard disclosure._

## Structure (two stages, one shot)

1. **SWEEP (in-sample, selection only):** 40 variants of the mechanism,
   each run once on the fleet over the FULL discovery window
   (`--random --limit 2000 --to-ms 1772323199999` — E18-safe exclusive
   bound; the same window that produced E22 and the SCR-025 numbers).
   Sweep readouts are winner's-curse-inflated BY DESIGN (40 looks) and
   license nothing beyond selecting one variant.
2. **CONFIRMATION (anti-curse, the only belief-carrying read):** the
   selected winner runs ONCE, exact frozen winner params, on the
   pre-committed reserve draw below. The confirmation bar decides
   SAVED vs DEAD FOR GOOD. There is no second confirmation attempt, no
   re-selection, no seed change, no "one more variant" — whatever the
   confirmation says is the terminal verdict of this program.

The holdout (market_start_ms ≥ 1777237200000) stays locked regardless
of outcome. CONFIRM-010 stays frozen and untouched (it draws on
post-freeze data only; this program draws on discovery + reserve).

## Mechanism (unchanged from SCR-025 / E22)

Big UP-mid up-segment (t0→t1) then down-segment (t1→t2) ⇒ the UP ask is
stale-high (E22: ≈4.4c gross, z=−3.47); buy DOWN taker at t2, default
hold to settlement. Strategy: `strategies/screens/RESCUE-025.ts`
(`fable-rsc-025`), which with all-default params reproduces the SCR-025
cell of `fable-scr-stm shape=updn` exactly (same offset convention,
same one-shot evaluation-at-t2, same E6 guards, depth-clamped FOK).

## The frozen variant grid (40 cells; batchUid `RSC-025-Vnn`)

Non-default params only; everything else at RESCUE-025.ts defaults
(t0Sec=450 t1Sec=600 t2Sec=750 segThresh1=0.02 segThresh2=0.02
ratioMin=0 entryDelaySec=0 exit=settle minAsk=0.03 maxAsk=0.97
shares=100).

| variant | axis | params (non-default) |
|---|---|---|
| V01 | baseline (= SCR-025 cell) | — |
| V02 | shape strength | segThresh2=0.03 |
| V03 | shape strength | segThresh2=0.04 |
| V04 | shape strength | segThresh1=0.03 segThresh2=0.03 |
| V05 | shape strength | segThresh1=0.03 segThresh2=0.04 |
| V06 | shape strength | segThresh1=0.04 segThresh2=0.04 |
| V07 | shape strength (looser) | segThresh1=0.015 segThresh2=0.015 |
| V08 | shape strength (looser up-leg) | segThresh1=0.015 |
| V09 | bigger-down ratio | ratioMin=1.0 |
| V10 | bigger-down ratio | ratioMin=1.5 |
| V11 | bigger-down ratio | ratioMin=2.0 |
| V12 | clock placement (early) | t0Sec=300 t1Sec=450 t2Sec=600 |
| V13 | clock placement | t0Sec=375 t1Sec=525 t2Sec=675 |
| V14 | clock placement (late) | t0Sec=525 t1Sec=675 t2Sec=825 |
| V15 | clock placement (latest, 120s segs) | t0Sec=600 t1Sec=720 t2Sec=840 |
| V16 | segment length (125s, same end) | t0Sec=500 t1Sec=625 |
| V17 | segment length (100s) | t0Sec=550 t1Sec=650 |
| V18 | segment length (200s) | t0Sec=350 t1Sec=550 |
| V19 | entry band (DOWN still underdog) | maxAsk=0.50 |
| V20 | entry band (DOWN favorite) | minAsk=0.50 |
| V21 | entry band (mid) | minAsk=0.35 maxAsk=0.65 |
| V22 | staleness persistence | entryDelaySec=15 |
| V23 | staleness persistence | entryDelaySec=30 |
| V24 | staleness persistence | entryDelaySec=60 |
| V25 | exit reshape | exit=tp tpDelta=0.03 |
| V26 | exit reshape | exit=tp tpDelta=0.05 |
| V27 | exit reshape | exit=sl slDelta=0.03 |
| V28 | exit reshape | exit=sl slDelta=0.05 |
| V29 | combo | segThresh2=0.03 ratioMin=1.5 |
| V30 | combo | segThresh2=0.03 entryDelaySec=30 |
| V31 | combo | segThresh2=0.03 maxAsk=0.50 |
| V32 | combo | segThresh1=0.03 segThresh2=0.03 ratioMin=1.0 |
| V33 | combo | t0Sec=525 t1Sec=675 t2Sec=825 segThresh2=0.03 |
| V34 | combo | ratioMin=1.5 entryDelaySec=30 |
| V35 | combo | segThresh2=0.03 exit=tp tpDelta=0.03 |
| V36 | combo | minAsk=0.35 maxAsk=0.65 segThresh2=0.03 |
| V37 | combo | t0Sec=500 t1Sec=625 segThresh2=0.03 |
| V38 | shape strength (extreme) | segThresh2=0.05 |
| V39 | combo | ratioMin=2.0 segThresh2=0.03 |
| V40 | combo | entryDelaySec=30 maxAsk=0.50 |

Axis rationale (mechanism-faithful, recorded pre-sweep): shape
strength/ratio sharpen the reversal event E22 measured (bigger reversals
→ more staleness, monotone in the CAL-003 pair table); clock placement
and segment length test where the staleness lives (E21 continuation was
coherent from 300s on); entry bands test price-context concentration
(the E22 flag was not price-partitioned — this is exploratory within
the mechanism); persistence delays test whether the stale ask decays
slower than 15-60s (if the mirror's edge needs instant execution it is
live-fragile anyway); exit reshapes are included because the directive
names them, with the E31 friction findings as the stated prior AGAINST
them. Combos pair the individually most mechanism-faithful gates.

## Frozen winner-selection rule (mechanical)

From the 40 sweep runs, judged on the standard results.ts convention
(q̂/t over all N):

- **eligible(v)** = run completed ∧ failures = 0 ∧ played ≥ 100 ∧ q̂ > 0.
- **winner** = the eligible variant with the highest t, REQUIRING
  t ≥ +1.5. Ties (same t to 4dp): higher q̂, then lower variant number.
- **If no eligible variant reaches t ≥ +1.5:** the rescue FAILS at the
  sweep stage — verdict DEAD FOR GOOD, reserve unspent. (The sweep is
  in-sample with 40 looks; a family whose best in-sample cell cannot
  even match SCR-025-A's single-look t=1.83 region has nothing to
  confirm.)
- Exactly ONE winner proceeds. No runner-up gets a confirmation ride
  under any outcome.

## Frozen confirmation

- **Sample (pre-committed, outcome-free):** seeded uniform draw of
  4,000 slugs from the eligible reserve window
  (market_start_ms ∈ [1772323200000, 1777237199999], 5,460 eligible),
  seed `RESCUE-025-draw-1`, via the committed `tools/rescue-draw.ts`
  (seeded Fisher-Yates, same mechanism as the SCR-009 draw). Drawn
  2026-07-12 pre-sweep;
  sha256(drawn slugs joined by ',') =
  `b77ba0cbf26a4c854d919992aff2eb2c262dd79d04c10ceacbb5d87b3f51e6b3`;
  shard files `logs/RESCUE-025-shard[0-7].slugs` (500 each,
  round-robin; logs/ is gitignored — the committed seed + tool are the
  pre-commitment and any regenerated draw must reproduce the sha).
  DISCLOSURE: 1,473 of the 4,000 overlap the SCR-009 spent draw
  (expected ~1,465 under uniform draws — consistent with chance). The
  SCR-009 read exposed only pooled maker-fill aggregates of an
  unrelated mechanism (gated at-touch quoting); no per-market outcome
  was read, and the rescue winner is selected on discovery data only,
  so the overlap does not let outcomes select the winner.
- **Execution:** 8 fleet runs (`--slug` per shard file), batchUids
  `RSC-025-CONFIRM-S0..S7`, winner's exact frozen params, latency
  pinned per D8, `--detach`, committed+pushed code. Pooled read over
  all 8 via the scr009-pool.ts pattern (pooled q̂/t over all 4,000).
- **Success bar (SAVED):** pooled q̂ > 0 ∧ pooled t ≥ +1.5 ∧ played
  ≥ 100 ∧ (if winner winRate > 0.9: minority-outcome count ≥ 30, E14).
  Prediction: q̂ > 0 with shrinkage from the sweep value expected
  (the sweep number is max-of-40).
- **Anything else → DEAD FOR GOOD.** Expected shrinkage is stated now:
  under the global null the confirmation passes with p ≈ 0.07
  (one-sided t ≥ 1.5); under a true effect at SCR-025's pooled scale
  (q̂ ≈ +0.03, incidence ~11%) power at N=4,000 is moderate (~60-70%,
  scan-se convention). A marginal true effect can die here; that is
  the accepted cost of the anti-curse design and will be stated in the
  terminal verdict if it plausibly applies.
- **SAVED consequence:** the winner is written up as a CANDIDATE for
  the full confirmation lifecycle (registration + CONFIRM-grade
  pre-registration on future post-freeze data; the holdout stays
  locked until that lifecycle's own final-confirmation rules fire).
  SAVED does not license edge language beyond "screen + one fresh
  confirmation at t ≥ 1.5".

## Integrity requirements (frozen)

- Every submission `--detach` on committed+pushed code; latency pinned
  per D8/D51 (env export recorded in the submit script + log, per the
  BATCH-005 checker finding 1 convention).
- E28 parity discipline: after the sweep completes and BEFORE winner
  selection, one sweep run gets a 12-market local pinned re-run
  byte-compared across the results fields (the worker fleet
  self-updates to the NEW commit containing RESCUE-025.ts — the
  BATCH-005 parity proof does not carry over to new code).
- Pre-verdict checks per run: completed, failures=0, no duplicate
  batchUids, window integrity (sweep: all slugs < 1772323200000;
  confirmation: all slugs ∈ the frozen shard lists).
- One fresh-context checker over the program verdict (sweep table +
  winner derivation + confirmation read) before the terminal verdict is
  ledgered.
- Smokes (pre-submission, counts only, no PnL): V01 baseline
  equivalence vs `fable-scr-stm shape=updn` on 10 pinned oldest
  discovery slugs (fill counts must match exactly), plus one tp, one
  sl, one delay variant plumbing smoke on the same slugs.

## Pre-submission smokes (counts only, no PnL — E15 discipline)

_Run 2026-07-12 session 67, local `--sequential`, the 40 oldest eligible
discovery slugs (superset of the BATCH-005 10-slug smoke set; more slugs
because the updn shape fires only ~12% of markets), latency pinned
in-log. Counts via fills.ts only._

| run | batchUid | cell | filled markets | maker fills | taker fills | reading |
|---|---|---|---|---|---|---|
| 537 | RSC-025-smoke-stm-eq | (SCRATCH — zsh non-word-splitting dropped `--param shape=updn`; ran shape=dn; counts only, superseded) | 9 | 0 | 9 | void, replaced by 539 |
| 539 | RSC-025-smoke-stm-eq-r2 | fable-scr-stm shape=updn (reference) | 5 | 0 | 5 | reference |
| 538 | RSC-025-smoke-v01 | fable-rsc-025 defaults (V01) | 5 | 0 | 5 | EQUIVALENCE HOLDS (5/5 = 5/5 exact) |
| 540 | RSC-025-smoke-v25 | exit=tp tpDelta=0.03 | 5 | 3 | 5 | TP leg fires (3 maker TP fills) |
| 541 | RSC-025-smoke-v27 | exit=sl slDelta=0.03 | 5 | 0 | 9 | SL leg fires (5 entries + 4 stops) |
| 542 | RSC-025-smoke-v23 | entryDelaySec=30 | 4 | 0 | 4 | delayed entry works (one entry lost to the one-shot attempt at t2+30 — expected semantics) |

Submission script: `logs/rsc025-submit.sh` (latency pin as a single
`export`, per the BATCH-005 checker finding 1 convention; the enqueue
log is `logs/rsc025-submit.log`).

## Sweep results (append-only after runs complete)

_To be appended: 40-row table (variant, run, N, played, q̂, t, EV/mkt,
winRate), winner derivation line, parity check result._

## Confirmation result (append-only, after the one read)

_To be appended: pooled table, bar evaluation, terminal verdict
SAVED / DEAD FOR GOOD._
