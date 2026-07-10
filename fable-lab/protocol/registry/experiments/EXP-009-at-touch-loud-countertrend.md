# EXP-009 — at-touch loud countertrend (touch_or_better bound on the EXP-007 cell)

<!-- SPEC — frozen after the first non-smoke run exists. Fill every field.
     "Runs" and "Verdicts" below are append-only forever. -->

## Spec

- **Registered:** 2026-07-10 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 9 "At-touch maker bracket"  **Parent lineage:**
  EXP-007 (killed at probe under worst_queue, run 342)
- **lineage_cells:** 1 — the parameter cell is inherited FROZEN from
  EXP-007's registered primary (chosen there via E15 fill-feasibility
  counts, never via PnL); no cell was chosen after seeing any touch-mode
  outcome.
- **Mechanism class:** `spread-capture`
- **Instrument note (DECISIONS D18, EDGE-SPACE §3.1):** runs under
  `--fill-mode=touch_or_better` — the engine's own at-touch fill model,
  unlocked in-lab in U35: a resting BUY at P fills FULL remaining size the
  moment bestAsk ≤ P (always first in queue, zero maker fee). OPTIMISTIC
  BOUND on at-touch provision; real economics lie in [worst_queue,
  touch_or_better]. D18 rules binding: outcomes are KILL or
  OPERATOR-ESCALATION only — no advance, no holdout, no live-EV claim.
- **Hypothesis (who loses and why):** as EXP-007 (momentum takers and
  stop-outs pay for immediacy into fast falls; whoever rests a bid below
  the falling book catches overshoot that reverts by settlement), measured
  at the favorable end of the bracket. EXP-007's worst-queue kill (E17)
  established that punch-throughs during loud moves are informative; it
  could not observe fills at the touch during the cascade. If even with
  maximal queue priority the caught overshoot does not revert enough to
  pay for the adverse selection, at-touch loud countertrend provision is
  dead in-model conclusively (bound dominance).
- **Falsifiable prediction:** under touch_or_better, conditional on a
  trailing 10s |UP-mid move| ≥ jumpSize, a GTC bid on the falling side at
  fair − δ produces played markets with gross EV/market > 0 (zero maker
  fee ⇒ gross = net; standard q/t readout IS the prediction check). If
  EV(played) ≤ 0, the at-touch version is contradicted conclusively —
  the bound dominates every intermediate fill model. No design-failure
  clause: touch-mode fills are dense by construction (U35: 8/8 vs 2/8
  markets filled on the sibling cell; E15 measured 12/30 under worst_queue
  for THIS cell, and touch fills strictly dominate worst-queue fills).
- **Strategy:** `fable-lab/strategies/spread-capture/EXP-007.ts`, id `fable-exp-007`
  (reused UNCHANGED from the killed parent — zero new code, zero new
  tuning freedom; only the fill model differs)
- **Primary parameter cell:** `--param offset=0.01 --param jumpSize=0.1 --param jumpWindowSec=10 --param requoteDelta=0.01 --param minElapsedSec=60 --param stopBeforeEndSec=120 --param shares=10 --param maxInventory=50 --param minPrice=0.05 --param maxPrice=0.95`
- **Robustness neighborhood:** none at probe (bracket bound, not tuning).
  On escalation, EXP-007's feasibility-measured neighbors (offset ∈
  {0.01, 0.02, 0.03} × jumpSize ∈ {0.05, 0.10}) may be run under touch
  mode for the operator memo, sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** `simulator-favored` BY
  DESIGN on the queue axis (always first) and size axis (full remaining
  size per fill) — that is the instrument: this experiment measures the
  optimistic end of the D14 bracket. Mitigations kept from the parent:
  shares=10, maxInventory=50/side. Contamination risk: E6 self-crossed
  books are WORSE under touch mode (bid at P fills whenever ask ≤ P,
  spuriously satisfied by crossed states); the strategy cancels quotes on
  crossed ticks but same-tick phantom fills remain possible — composition
  diagnostics at judging. Additional touch-specific caveat: during a
  cascade the falling side's ask sweeps down THROUGH the bid ladder, so
  touch and worst-queue fill sets converge in fast moves; the
  discriminating fills are the ones where the ask touches fair − δ and
  reverts without trading through — exactly the at-touch flow the parent
  could not see. Pre-commitment (D18): NO outcome can advance toward
  holdout or support a live-EV claim.
- **Windows (tools/universe.ts, re-verified 2026-07-10: 18,635 eligible,
  exploration 13,976 / holdout 4,659):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000 —
    recorded for spec completeness only; D18 forbids this experiment from
    ever touching it.
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000
  --fill-mode=touch_or_better` via `tools/run-backtest.ts`, batchUid
  `EXP-009-probe-touch`, latency pinned 0/0 (D8). No main stage (D18);
  one extension permitted per the decision rules.
- **Decision rules (pre-registered; outcome set {kill, escalate, park},
  never advance — D18):**
  - probe KILL: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
    (EV(played) ≤ 0 at N=500). Verdict wording must state the kill is
    CONCLUSIVE for at-touch loud countertrend provision in-model (bound
    dominance), unlike the parent's model-conditional kill. Skewed-payoff
    rule (D13) applies if win rate lands outside [0.1, 0.9].
  - probe ESCALATE: t ≥ 2 with EV(played) > 0 → operator memo appended to
    EDGE-SPACE §3 recording the bracket [parent worst_queue EV/market =
    −0.45 (run 342), touch EV/market], naming §3.2/§3.3 as the
    instruments that could locate the truth inside it. Holdout stays
    locked; the experiment ends there.
  - ambiguous (−1 < t < 2, prediction undecided): ONE extension —
    `--extend RUNID --limit 1000 --to-ms 1777237200000` (RUNID = the probe run id) through the
    wrapper, REPEATING `--fill-mode=touch_or_better` (fill mode is
    process-level, not stored in the run; extending without the flag
    mixes fill models and VOIDS the run — verify the D18 hook line in the
    extension log before reading results). Re-judge at combined N, same
    bars; still ambiguous → PARK, treated as "no defined prize".
- **Latency curve points:** none at probe; on escalation, delay ∈
  {0, 150, 300} under touch mode becomes part of the operator memo (loud
  regimes are latency-sensitive — stale quotes in cascades get picked
  off; expect the touch bound to degrade fastest here).

### Audit amendments (2026-07-10, PRE-RESULTS — appended while the probes
were still running, motivated by the fresh-context audit
`knowledge/AUDIT-2026-07-10-D18-UNLOCK.md`; no probe statistic had been
read; decision BARS are unchanged, only claim strength and disclosures
move). Identical in substance to EXP-008's amendment block:

- **(audit 4.1)** a probe KILL is "decisive evidence against the at-touch
  version under the most favorable fill assumption the engine can
  express", NOT "conclusive over all intermediate fill models" — touch is
  not a strict strategy-level upper bound (inventory-cap path dependence;
  full-size toxic fills). Judge must use the corrected wording.
- **(audit 4.2 / LESSONS E18)** inclusive `--to-ms` puts the single
  boundary market btc-updown-15m-1777237200 in the sampling pool; the
  verdict must state whether it was drawn and disclose its contribution.
- **(audit 2.3)** phantom-fill tripwire: if any top-5 |PnL| market's fills
  are explainable only by a crossed book (E6), run the diag fixture on
  those slugs before the verdict; if crossed-tick phantom fills account
  for the sign of pnlTotal → park-with-diagnosis, not kill/escalate.
- **(audit 4.3)** EV(played) := pnlTotal / played, derived from the
  verbatim results block.
- **(audit 3.2)** touch-mode `--extend` now validated against the PARENT
  run (batchUid + recorded cmd) by the wrapper, making the extension rule
  executable as written.

## Runs (append-only)

<!-- one block per run, pasted verbatim from tools/results.ts -->

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->
