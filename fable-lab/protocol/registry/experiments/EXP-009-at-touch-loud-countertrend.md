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

- 2026-07-10 — probe (touch), `tools/results.ts --batch EXP-009-probe-touch`, verbatim:

```
=== results: run 358  batch EXP-009-probe-touch ===
strategy fable-exp-007  params {"offset":0.01,"shares":10,"jumpSize":0.1,"maxPrice":0.95,"minPrice":0.05,"maxInventory":50,"requoteDelta":0.01,"jumpWindowSec":10,"minElapsedSec":60,"stopBeforeEndSec":120}
status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
N=500  played=348  skipped=152  failures=0
pnlTotal=-424  EV/market=-0.848  CI95=[-1.6277, -0.0683]
std=8.895  q=-0.0953  t=-2.1317
winRate(played)=0.408 (wins/losses=142/205)
fees=0  fee/grossWins=0  maker/taker=1482/0 (makerShare=1)
days=144  positiveDayFrac=0.3819  best=2026-01-09:49.9  worst=2026-02-28:-45.5
worst5: btc-updown-15m-1765223100:-34.7  btc-updown-15m-1769438700:-31.7  btc-updown-15m-1766788200:-26.5  btc-updown-15m-1771194600:-25.8  btc-updown-15m-1774904400:-25.4
best5:  btc-updown-15m-1772860500:34.4  btc-updown-15m-1767966300:33.5  btc-updown-15m-1764461700:29.1  btc-updown-15m-1764993600:27.2  btc-updown-15m-1775598300:26.4
```

- Pre-verdict checks (pre-registered in the audit amendments, performed
  before judging, 2026-07-10):
  - D18 hook line confirmed in the run log (`logs/touch-probes.log` line
    27244: `makerFillMode=touch_or_better`; end-of-run summary:
    `485 BacktestExecution instance(s) forced to touch_or_better`).
  - (audit 4.2 / E18) Boundary market btc-updown-15m-1777237200: NOT drawn
    (0 occurrences in the run log).
  - (audit 2.3) Phantom-fill tripwire: top-5 |PnL| markets inspected via
    the run log's [trade] lines. All fills one-sided falling-side BUYs at
    plausible cascade prices (0.25–0.71), 5 trades per market, MAKER
    liquidity, feePaid=0 — the designed pattern, not explainable only by
    a crossed book. The known E6 self-crossed market
    btc-updown-15m-1764461700 IS in best5 (+29.1); its fills (DOWN
    0.37–0.51) have a normal cascade explanation, and it is a WINNER —
    even if entirely phantom, excluding it moves pnlTotal from −424 to
    −453, so crossed-tick phantom fills cannot account for the sign of
    pnlTotal; park-with-diagnosis branch cannot bind. Tripwire does NOT
    fire; diag fixture not required.
  - (audit 4.3) EV(played) = pnlTotal/played = −424/348 = −1.218.

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->

- 2026-07-10 — probe verdict (fresh-context Judge, verbatim):

- stage: probe (N=500, run 358, batchUid EXP-009-probe-touch, --fill-mode=touch_or_better, latency 0/0)
- decision: kill
- read: EV/market = −0.848 (CI95 [−1.6277, −0.0683]), q̂ = −0.0953, t = −2.1317, played = 348/500, winRate(played) = 0.408, maker share = 1, fees = 0
- prediction check: CONTRADICTED — EV(played) = pnlTotal/played = −424/348 = −1.218 ≤ 0 at N=500; the falsifiable prediction required gross EV/market > 0 on played markets under touch_or_better; no design-failure clause available by pre-registration
- battery: kill branch bindingly satisfied twice over — q̂ ≤ 0 with t ≤ −1 (t = −2.13) AND prediction contradicted; escalate branch (t ≥ 2 with EV(played) > 0) not remotely met; ambiguous branch not entered; D13 skewed-payoff rule not triggered (win rate 0.408 lies inside [0.1, 0.9]); days = 144, positiveDayFrac = 0.382 corroborates a broadly negative cell rather than a few outlier days
- simulator-bias classification: simulator-favored BY DESIGN (D18 optimistic bound: always-first-in-queue, full-size at-touch fills, zero maker fee); a loss under this instrument is the strong-direction result — per amendment 4.1, this is decisive evidence against the at-touch version under the most favorable fill assumption the engine can express, NOT conclusive over all intermediate fill models (inventory-cap path dependence, full-size toxic fills)
- lineage-adjusted bar: lineage_cells = 1 (cell inherited frozen from EXP-007's fill-feasibility-chosen primary, never selected on any touch-mode or PnL outcome), so the base probe bar applies unadjusted; the result clears the kill threshold with margin regardless
- boundary/tripwire disclosures: (4.2/E18) boundary market btc-updown-15m-1777237200 NOT drawn — zero contribution to the sample; (2.3) phantom-fill tripwire clean — top-5 |PnL| markets show one-sided falling-side maker BUYs at plausible cascade prices, and the known E6 self-crossed market (1764461700) is a +29.1 winner whose exclusion moves pnlTotal from −424 to −453, so crossed-tick phantom fills cannot account for the sign of pnlTotal and the park-with-diagnosis branch cannot bind; D18 hook confirmed active at start and end of run (485 instances forced)
- required next step: record the closed bracket for IDEAS #9 on the loud cell — [worst_queue EV/market = −0.45 (EXP-007 run 342), touch_or_better EV/market = −0.848 (run 358)] — both ends negative, so the true fill model's location within the bracket is moot; mark IDEAS #9 dead on both registered cells (with sibling EXP-008 touch kill at −0.433 on the quiet cell); no extension, no escalation memo, no live claim
- reasoning: The experiment asked whether the parent's worst-queue kill was an artifact of a pessimistic fill model, and the answer is unambiguous: under the most optimistic fill assumption the engine can express — always first in queue, full remaining size at touch, zero maker fee — the at-touch bracket end is not merely non-positive but worse than the parent's pessimistic end (−0.848 vs −0.45 per market; EV(played) −1.218 vs ≈−1.27, nearly identical per played market with roughly double the fill density, 348 vs 177 played). This is the signature of a toxic-flow mechanism rather than a queue-position problem: touch mode fills more of exactly the cascades the hypothesis wanted, and those fills lose at the same per-market rate, so overshoot is not systematically reverting by settlement at fair − 0.01 on the falling side. Both pre-registered kill conditions fire independently (t = −2.13 ≤ −1 with q̂ < 0; EV(played) ≤ 0), the win rate keeps D13 out of play, the boundary market was not drawn, the phantom-fill tripwire was inspected and demonstrably cannot flip the sign, and the corrected 4.1 wording is honored — the kill is decisive against the at-touch version under the engine's most favorable assumption, while intermediate fill models remain formally unexplored but economically irrelevant given both bracket ends are negative and the sibling quiet-cell touch probe (EXP-008, −0.433) killed the same way. KILL, consistent with D18's outcome set.
