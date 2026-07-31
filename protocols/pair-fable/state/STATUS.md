# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 19 close)

## Current work

**Session 19 executed E-032 + E-033** (both designed, frozen, run, and
concluded this session; designs BEFORE code/submission per M2:
8daa2a4 → 4a5982e for E-032, b790964 → submission for E-033). 12 fleet
runs total (947 diagnostic, 948–954 E-032 grid, 955–958 E-033 grid),
0 failures, recon clean everywhere, SHA uniform 4a5982e. Full evidence:
pair-v15.md §11.5/§12.2, LEDGER E-032/E-033. Headlines:

- **E-032 (in-band lag maker aggression, v15.3): LEVER-DEAD.** Clean
  dose–response in R fills (0/4/19/35) but the 1-tick-quantized
  improvement intercepts only 2.4% of completion dollars — best pair
  Δev +0.18 < 0.30 bar. Two frozen amendments en route (§11.3 grid
  rounding after smoke R=0; §11.4 S0-bar escalation to a 200-mkt
  Stage B after probe-verified placement).
- **v15.3 guard-2 swap validated:** debtCap removed (E-031b
  indistinguishable), lagAggr in; γ=0 baselines reproduce v15.0/v15.2
  behavior (948 −3.27 ≈ 929; 952 −1.80 ≈ 943/940).
- **E-033 (per-fill size 25→100, band:q held): SCALE-NEUTRAL.**
  Per-$100 pinned ≈ −5.7 at every size/cap; invested scales linearly;
  S-fill count size-invariant; M mean reaches 231 at q=100 with mean P
  unchanged — scale does not unlock cross-subsidy; caps bind without
  masking a frontier. Guard-7 optimism noted (neutrality = upper
  bound).
- **Guard-4 stopping rule TRIGGERED for the v15 HOW-axes:** 19
  consecutive configs since E-030 without a >bar improvement.
  Completion policy, maker aggression, and size/cap are ALL converged
  at per-$100 ≈ −5..−6. The loss is the doom-completion premium of
  one-way markets. Family-axes verdict recorded (NOT a class kill;
  identity names untested levers).

## Next step

**Move to the WHICH/WHEN/tilt axes, analysis-first (no strategy code
until a measured signal exists):**

1. **E-034 — market-selection by liquidity structure** (ruling
   8758567d axis 6, never tested): regress/stratify per-market pnl of
   the existing v15 runs (948/952 rows, 800 mkts, per-market pnl +
   cost in backtest_run_markets) against START-observable features
   from telonex parquet (opening spread, displayed depth, early
   oscillation/range, book churn in minutes 0–2). Local analysis
   (bookscan/calib machinery, checkpoint+time-budget chunking). Bar to
   proceed to a gated variant: a feature split with ≥ 2 SE pnl
   separation that survives a train/validate split of the 800.
2. **Tilt signal firm-up** (§5 gate): E-028's favorite region (ask ≥
   0.90, min 0–9) is the only measured point-positive region,
   unresolved at n=800. A larger-n calibration rescan (calib.ts over
   more history, local) can settle the ≥ 2 SE requirement without
   fleet runs. If it firms: directional v15 (I* ≠ 0) per §5.
3. Only after 1 or 2 produces a measured signal: new grid (design
   frozen first). Stage D cap sweep stays gated on a positive config.
4. Review gate M1–M5: ALL IMPLEMENTED (4809a8e). E-029 stays PARKED.

## Blockers

None. Fleet idle after E-033 (all 12 runs read and archived).

## Needs human

- **P-012**: convert eth/sol/xrp 15m telonex datasets (still 0
  conversions) — gates cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s19: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); an uncommitted STATUS edit blocks
  submission (hit in s19 — commit state snapshots before submitting).
- **Do not push strategy-semantics changes while that strategy's jobs
  are queued/running** — workers track origin/main; serialize push →
  submit.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 SAME-SHA (4a5982e) baselines from s19: **948** (center doom-only)
  and **952** (corner doom-only) on the pinned 800 — prefer these over
  the cross-SHA 929/942/943 for future v15 comparisons. **v15 noise
  floor 0.15 ⇒ ev bar 0.30, per-$100 bar 0.54** (937v938).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config its OWN command with LITERAL args,
  verify queue depth with fleet.ts after every detached submit batch.
- Class kills need an identity argument (evaluator.md §Kill standards);
  N failures kill a family only. Verdict bars must name comparison
  PAIRS, not "any config vs one baseline" (E-031 lesson §10.4.5).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  Guard-7 whole-size fill optimism: larger-q results are
  depth-optimistic (E-033 measured under it — name the bias in claims).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s19: still only pair-fable has memory.
- Smoke cannot catch latency-race bugs (CAP-BREACH check) AND cannot
  demonstrate RARE fill modes (E-032: R ≈ 1/200 mkts — a 10-mkt smoke
  zero is uninformative; escalate to a 200-mkt Stage B instead).
- Anatomy/results tooling understands fill modes S/R/A/C/V/D. v15.3
  redefined R = maker rest placed strictly above bestBid (§11.1).
- Schema refines can invalidate a frozen grid corner (E-030 A1) — when
  freezing a grid, check every cell against the schema refines first.
- The backtest sim is NOT bit-deterministic (latency jitter): identical
  configs differ run-to-run — noise floors come from duplicate pairs.

## Inbox processed through

2026-07-31T13:44:57.732Z-93482fcb (pair-v15 approval with amendments;
executed as E-030 s17, E-031/E-031b s18, E-032/E-033 s19).
