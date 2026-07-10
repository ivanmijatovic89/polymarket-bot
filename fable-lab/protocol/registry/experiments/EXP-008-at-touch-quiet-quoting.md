# EXP-008 — at-touch quiet quoting (touch_or_better bound on the EXP-006 cell)

<!-- SPEC — frozen after the first non-smoke run exists. Fill every field.
     "Runs" and "Verdicts" below are append-only forever. -->

## Spec

- **Registered:** 2026-07-10 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 9 "At-touch maker bracket"  **Parent lineage:**
  EXP-006 (killed at probe under worst_queue, run 336)
- **lineage_cells:** 1 — the parameter cell is inherited FROZEN from
  EXP-006's registered primary (post its pre-freeze amendment); no cell was
  chosen after seeing any touch-mode outcome. Touch-mode outcomes have never
  been observed for any cell of this family before this experiment.
- **Mechanism class:** `spread-capture`
- **Instrument note (DECISIONS D18, EDGE-SPACE §3.1):** this experiment
  runs under `--fill-mode=touch_or_better` — the engine's own at-touch fill
  model (`BacktestExecution.ts`), unlocked in-lab in U35. A resting BUY at P
  fills FULL remaining size the moment bestAsk ≤ P: always first in queue,
  zero maker fee. This is the OPTIMISTIC BOUND on at-touch liquidity
  provision; real at-touch economics lie in [worst_queue, touch_or_better].
  D18's interpretive rules are binding: outcomes are KILL or
  OPERATOR-ESCALATION only — no advance, no holdout, no live-EV claim.
- **Hypothesis (who loses and why):** as EXP-006 (impatient/forced takers
  cross the spread in quiet mid-episode windows and pay whoever rests
  inside it), but measured at the favorable end of the bracket. EXP-006's
  worst-queue kill (E16) established that punch-THROUGH fills in quiet
  regimes are informative; it could not observe fills by flow that does
  not move the level. If even the optimistic bound — where every touch of
  the level is a full fill with zero queue — cannot turn the passive
  discount plus pair completion into positive EV, then no queue-realistic
  model can, and at-touch quiet provision is dead in-model conclusively.
- **Falsifiable prediction:** under touch_or_better, conditional on quoting
  only in quiet windows (trailing 60s UP-mid range ≤ quietRangeMax, books
  uncrossed per E6, episode clock inside [minElapsedSec,
  900−stopBeforeEndSec]), played markets have gross EV/market > 0 (zero
  maker fee ⇒ gross = net; the standard q/t readout IS the prediction
  check). If EV(played) ≤ 0, adverse selection exceeds the discount even
  with maximal queue priority and the at-touch version of the mechanism is
  contradicted — conclusively, because the bound dominates every
  intermediate fill model. No design-failure clause is needed: touch-mode
  fills are dense by construction (U35 verification: 8/8 markets filled on
  this cell vs 2/8 under worst_queue, runs 352/353).
- **Strategy:** `fable-lab/strategies/spread-capture/EXP-006.ts`, id `fable-exp-006`
  (reused UNCHANGED from the killed parent — zero new code, zero new
  tuning freedom; only the fill model differs)
- **Primary parameter cell:** `--param offset=0.01 --param quietWindowSec=60 --param quietRangeMax=0.08 --param requoteDelta=0.01 --param minElapsedSec=60 --param stopBeforeEndSec=120 --param shares=10 --param maxInventory=50 --param minPrice=0.05 --param maxPrice=0.95`
- **Robustness neighborhood:** none at probe. This experiment exists to
  bound a channel, not to tune a strategy; if the escalation branch fires,
  the parent's neighborhood (offset ∈ {0.01, 0.02} × quietRangeMax ∈
  {0.04, 0.08, 0.12}) may be run under touch mode as part of the operator
  memo, sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** `simulator-favored` BY
  DESIGN on both the queue axis (touch_or_better = always first in queue)
  and the size axis (full remaining size per fill regardless of traded
  volume) — that is the instrument, not a flaw: the experiment measures
  the optimistic end of the D14 bracket. Mitigations kept from the parent:
  shares=10, maxInventory=50/side. Contamination risk: E6 self-crossed
  recorded books are WORSE under touch mode (a bid at P fills whenever
  ask ≤ P, which crossed states satisfy spuriously); the strategy cancels
  quotes on crossed ticks but same-tick phantom fills remain possible —
  composition diagnostics at judging must check whether PnL is dominated
  by fills at implausible prices. Pre-commitment (D18): NO outcome of this
  experiment can advance toward holdout or support a live-EV claim.
- **Windows (tools/universe.ts, re-verified 2026-07-10: 18,635 eligible,
  exploration 13,976 / holdout 4,659):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000 —
    recorded for spec completeness only; D18 forbids this experiment from
    ever touching it.
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000
  --fill-mode=touch_or_better` via `tools/run-backtest.ts`, batchUid
  `EXP-008-probe-touch`, latency pinned 0/0 (D8). No main stage exists for
  this experiment (D18: no advance path); see decision rules for the one
  permitted extension.
- **Decision rules (pre-registered; adapted from EPISTEMOLOGY to the D18
  bracket logic — the outcome set is {kill, escalate, park}, never
  advance):**
  - probe KILL: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
    (EV(played) ≤ 0 at N=500). Verdict wording must state the kill is
    CONCLUSIVE for at-touch quiet provision in-model (bound dominance),
    unlike the parent's model-conditional kill. Skewed-payoff rule (D13)
    applies if win rate lands outside [0.1, 0.9].
  - probe ESCALATE: t ≥ 2 with EV(played) > 0 → append an operator memo to
    EDGE-SPACE §3 recording the measured bracket [parent worst_queue
    EV/market = −0.18 (run 336), touch EV/market] and naming §3.2
    (trade-print recording) / §3.3 (live paper) as the ways to locate the
    truth inside it. The holdout stays locked; the experiment ends there.
  - ambiguous (−1 < t < 2 with the prediction not decided): ONE extension
    allowed — `--extend RUNID --limit 1000 --to-ms 1777237200000` (RUNID = the probe run id)
    through the wrapper, REPEATING `--fill-mode=touch_or_better` (the fill
    mode is process-level, not stored in the run; extending without the
    flag would mix fill models in one run and VOIDS the run — check the
    extension's log for the D18 hook line before reading results).
    Re-judge at combined N with the same bars; still ambiguous → PARK with
    the measured numbers, treated as "no defined prize" (no escalation).
- **Latency curve points:** none at probe (the bound is the object of
  measurement, not deployability). If the escalation branch fires, delay
  ∈ {0, 150, 300} under touch mode becomes part of the operator memo.

### Audit amendments (2026-07-10, PRE-RESULTS — appended while the probe was
still running, motivated by the fresh-context audit
`knowledge/AUDIT-2026-07-10-D18-UNLOCK.md`; no probe statistic had been read;
decision BARS are unchanged, only claim strength and disclosures move):

- **(audit 4.1) Kill-strength wording corrected:** touch_or_better dominates
  worst_queue per-order but is NOT a strict upper bound on every realistic
  queue model at strategy level (inventory caps bind on different fill sets
  under requoting; full-size toxic fills can lose more than partial
  realistic fills). A probe KILL is therefore "decisive evidence against
  the at-touch version under the most favorable fill assumption the engine
  can express", NOT "conclusive over all intermediate fill models". The
  Judge must use the corrected wording.
- **(audit 4.2 / LESSONS E18) Boundary-market disclosure:** `--to-ms` is
  inclusive, so the sampling pool contains the single boundary market
  btc-updown-15m-1777237200 (the first holdout market). The verdict must
  state whether that slug was drawn; if drawn, its contribution is
  disclosed (1 of 500 — negligible, and identical exposure existed in the
  killed parents' probes).
- **(audit 2.3) Phantom-fill tripwire, pre-specified:** if any of the
  probe's top-5 |PnL| markets shows fills explainable only by a crossed
  book state (E6), the diag fixture is run on those slugs BEFORE the
  verdict; if crossed-tick phantom fills account for the sign of pnlTotal,
  the run is contaminated → outcome is park-with-diagnosis, not kill or
  escalate.
- **(audit 4.3) EV(played) defined:** EV(played) := pnlTotal / played,
  derived from the verbatim results block (results.ts does not emit it).
- **(audit 3.2) Extension mechanics repaired:** the wrapper's touch guard
  now validates the PARENT run (batchUid contains `touch` AND recorded cmd
  contains `--fill-mode=touch_or_better`) when `--extend` is used, since
  the engine forbids `--batchUid` with `--extend`. The extension rule above
  is executable as written with this semantics.

## Runs (append-only)

<!-- one block per run, pasted verbatim from tools/results.ts -->

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->
