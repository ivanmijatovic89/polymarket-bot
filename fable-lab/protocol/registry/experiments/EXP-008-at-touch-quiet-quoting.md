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

- 2026-07-10 — probe (touch), `tools/results.ts --batch EXP-008-probe-touch`, verbatim:

```
=== results: run 357  batch EXP-008-probe-touch ===
strategy fable-exp-006  params {"offset":0.01,"shares":10,"maxPrice":0.95,"minPrice":0.05,"maxInventory":50,"requoteDelta":0.01,"minElapsedSec":60,"quietRangeMax":0.08,"quietWindowSec":60,"stopBeforeEndSec":120}
status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
N=500  played=392  skipped=108  failures=0
pnlTotal=-216.5  EV/market=-0.433  CI95=[-1.034, 0.168]
std=6.8565  q=-0.0632  t=-1.4121
winRate(played)=0.4209 (wins/losses=165/223)
fees=0  fee/grossWins=0  maker/taker=1324/0 (makerShare=1)
days=141  positiveDayFrac=0.4255  best=2025-12-24:34.1  worst=2025-12-29:-44.8
worst5: btc-updown-15m-1769042700:-29.4  btc-updown-15m-1767037500:-25.1  btc-updown-15m-1771227000:-21  btc-updown-15m-1766847600:-20.3  btc-updown-15m-1767744000:-19
best5:  btc-updown-15m-1769157000:33.8  btc-updown-15m-1769250600:29.3  btc-updown-15m-1765191600:26.8  btc-updown-15m-1766389500:25  btc-updown-15m-1766219400:23.5
```

- Pre-verdict checks (pre-registered in the audit amendments, performed
  before judging, 2026-07-10):
  - D18 hook line confirmed in the run log (`logs/touch-probes.log` line
    2009: `makerFillMode=touch_or_better`; end-of-run summary line 25235:
    `484 BacktestExecution instance(s) forced to touch_or_better`).
  - (audit 4.2 / E18) Boundary market btc-updown-15m-1777237200: NOT drawn
    (0 occurrences in the EXP-008 section of the run log).
  - (audit 2.3) Phantom-fill tripwire: top-5 |PnL| markets inspected via
    the run log's [trade] lines. All fills at plausible mid-range prices
    (0.10–0.78), 3–6 trades per market, two-sided quiet quoting pattern;
    winners = low-priced side that settled in; losers = high-priced side
    that settled out. No fill explainable only by a crossed book state →
    tripwire does NOT fire; diag fixture not required.
  - (audit 4.3) EV(played) = pnlTotal/played = −216.5/392 = −0.552.

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->

- 2026-07-10 — probe verdict (fresh-context Judge, verbatim):

- stage: probe (touch bound)
- decision: kill
- read: N=500 (played=392, skipped=108, failures=0) q=-0.0632 t=-1.4121 EV/market=-0.433 CI95=[-1.034, 0.168]; EV(played) = pnlTotal/played = -216.5/392 = -0.552
- prediction check: CONTRADICTED. The pre-registered prediction was EV(played) > 0 under touch_or_better; measured EV(played) = -0.552 ≤ 0 at N=500. Independently, the probe KILL bar (q̂ ≤ 0 with t ≤ −1) is also met: q=-0.0632 ≤ 0, t=-1.4121 ≤ −1. Both kill branches fire.
- battery: none required at probe (spec registers no robustness neighborhood for this bound experiment). Composition diagnostics consistent with the mechanism as designed: maker/taker = 1324/0 (makerShare=1), fees=0 (gross = net as pre-specified), winRate(played)=0.4209 with 165 wins / 223 losses — D13 skewed-payoff rule NOT triggered (win rate inside [0.1, 0.9]; both outcome counts far above 30, so t is not built on a thin minority tail). Time composition: 141 days, positiveDayFrac=0.4255, best/worst days ±~40 — loss is broad-based, not a single-cliff artifact.
- simulator-bias classification: simulator-favored BY DESIGN (touch_or_better: always first in queue, full remaining size, zero maker fee) — that is the instrument, and the result is negative despite it. Per D18, this outcome set is {kill, escalate, park} only; no advance or live-EV claim is possible from this run regardless of sign.
- lineage-adjusted bar: lineage_cells = 1 (cell inherited frozen from EXP-006's registered primary; no touch-mode outcome was ever observed before this experiment), so no Bonferroni inflation applies — the plain probe bars govern, and the kill bar is met with margin on both branches.
- boundary/tripwire disclosures: (E18/audit 4.2) boundary market btc-updown-15m-1777237200 was NOT drawn (0 occurrences in the run log). (audit 2.3) Phantom-fill tripwire did NOT fire: top-5 |PnL| markets inspected via [trade] lines showed fills at plausible mid-range prices (0.10–0.78), 3–6 trades per market, two-sided quiet-quoting pattern, no fill explainable only by a crossed book state — park-with-diagnosis branch not invoked. D18 hook confirmed in the run log (makerFillMode=touch_or_better; 484 instances forced).
- required next step: none for this lineage — no extension (the ambiguous branch does not apply: the prediction is decided), no escalation memo (escalation required t ≥ 2 with EV(played) > 0), holdout stays locked per D18. Record the measured bracket for the EXP-006 cell as closed at both ends — worst_queue EV/market = −0.18 (run 336) and touch_or_better EV/market = −0.433 (run 357) — in LESSONS/EDGE-SPACE as the operator sees fit; at-touch quiet quoting on this cell warrants no §3.2/§3.3 spend.
- reasoning: The pre-registered kill rule fires twice over: the falsifiable prediction (EV(played) > 0 under the optimistic bound) is contradicted at EV(played) = −0.552, and the statistical kill bar (q̂ ≤ 0 with t ≤ −1) is met at q = −0.063, t = −1.41. Per audit amendment 4.1, this kill is stated as decisive evidence against the at-touch version under the most favorable fill assumption the engine can express — not as conclusive over all intermediate fill models — but its practical force is strong: with guaranteed queue priority, full-size fills on every touch, and zero maker fee, quiet-window two-sided quoting on this cell still loses ~0.43/market (~0.55 per played market), meaning adverse selection alone exceeds the passive discount before any realistic queue friction is added; notably the optimistic bound loses MORE than the parent's worst-queue read (−0.433 vs −0.18), consistent with the amendment's point that denser toxic fills can hurt at strategy level. All pre-registered integrity checks pass (fill-mode hook confirmed, boundary market not drawn, phantom-fill tripwire clean, payoff not skewed), so nothing rescues the run into park; the correct outcome under the spec's own rules is kill.

## Erratum (2026-07-10, post-verdict — from the fresh-context E19-chain audit, `knowledge/AUDIT-2026-07-10-E19-CHAIN.md` finding 1)

The audit-amendments header above says the amendments were "appended while
the probe was still running; no probe statistic had been read", and the D18
audit called this "mechanically checkable" via commit-vs-log timing. For
THIS experiment that mechanical check FAILS: run 357 completed and persisted
at 05:55:40Z (log UTC stamp), while the amendment commit 1aec35a is
05:57:36Z — 1m56s later. The no-peek property for EXP-008 therefore rests
on the honor system over that ~2-minute window, not on commit timing (it
holds mechanically for EXP-009, which was still running). Verified
mitigations: the decision bars were frozen at registration (30dc724,
before probe start) and the amendments changed no bar; every amendment
moved against the researcher; there is no evidence of any results.ts
invocation in the window; the kill fires on the pre-launch bars alone, so
the verdict does not depend on the amendments. Root cause of the missed
check: `tools/runs.ts` printed DB local time with a `Z` suffix (fixed in
U40 — it now labels the clock as db-local, not UTC).
