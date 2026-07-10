# EXP-007 — loud-regime countertrend liquidity provision

<!-- SPEC — frozen after the first non-smoke run exists. Fill every field.
     "Runs" and "Verdicts" below are append-only forever. -->

## Spec

- **Registered:** 2026-07-10 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 8 "Loud-regime countertrend liquidity provision"
  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `spread-capture`
- **Direction note (DECISIONS D14, LESSONS E16):** second maker-side
  experiment. EXP-006 established that in QUIET regimes worst-queue
  punch-throughs are informative (the move continues). E16's transfer point:
  the only maker shape the worst-queue simulator tests honestly is one where
  being filled by a continuing move IS the claim — quote INTO loud moves and
  get paid for catching overshoot. The maker fee in the model is zero
  (CAPABILITIES §4), so the cost structure that killed EXP-001..005 does not
  apply.
- **Hypothesis (who loses and why):** Momentum takers and stop-outs sell
  into fast moves — they pay for immediacy at cascade prices. A passive bid
  resting δ below fair on the FALLING side is their counterparty. Under
  worst-queue a fill requires the cascade to punch strictly through the bid;
  the hypothesis is that a loud move that has already travelled ≥ jumpSize
  AND continues through a bid δ below the post-move fair has overshot — the
  filled price is below the true settlement probability and reverts by
  settlement. Honest prior is low-moderate: E10/E12 measured
  continuation-not-reversion AT THE ASK (deficits ≈ 0 and ≈ 1.2c gross);
  this wins only if the passive discount (halfSpread + δ, plus the 156 bps
  fee that is NOT charged to makers) exceeds the conditional continuation
  beyond the fill. If loud punch-throughs are informative like quiet ones
  (E16), fills are toxic and the mechanism is contradicted.
- **Falsifiable prediction:** Conditional on a trailing `jumpWindowSec`
  signed UP-mid displacement with |move| ≥ jumpSize (both books uncrossed —
  LESSONS E6, episode clock inside [minElapsedSec, 900−stopBeforeEndSec]),
  a GTC bid on the falling side at floor((fair − offset)·100)/100 that gets
  punched through wins more often than its fill price implies: gross
  EV/market > 0 on played markets — and since the model's maker fee is
  zero, gross = net, so the standard q/t readout IS the prediction check.
  If EV(played) < 0, loud punch-throughs are informative and the mechanism
  (as backtestable) is contradicted. **Design-failure clause:** worst-queue
  cannot observe at-touch fills; if fewer than ~3% of markets get any fill,
  the probe is a design failure (the simulator cannot see the mechanism),
  NOT evidence against it — outcome is iterate/park with the measured
  punch-through frequency recorded as the transferable number.
  **Model-conditional kill (D14):** a kill closes the backtestable
  (punch-through) version only; at-touch liquidity provision live remains
  unmeasured by construction.
- **Strategy:** `fable-lab/strategies/spread-capture/EXP-007.ts`, id `fable-exp-007`
- **Fill-feasibility (E15 discipline, measured BEFORE freezing the cell —
  30 random exploration markets per cell, batchUid EXP-000-debug, maker-fill
  COUNTS only, PnL never read, so lineage_cells stays 1):**
  - (offset 0.01, jumpSize 0.10) → run 337: 12/30 markets filled, 26 maker fills
  - (offset 0.02, jumpSize 0.10) → run 338: 6/30 markets filled, 11 maker fills
  - (offset 0.03, jumpSize 0.10) → run 339: 3/30 markets filled, 3 maker fills
  - (offset 0.02, jumpSize 0.05) → run 340: 7/30 markets filled, 17 maker fills
  - Primary chosen: (0.01, 0.10) — the maximum-fill cell (~40% of markets),
    for statistical power on the prediction check; deeper offsets are covered
    by the robustness neighborhood. Zero taker fills in all cells confirms
    pure-maker construction. Counts read via `tools/fills.ts` (PnL never
    selected).
- **Primary parameter cell:** `--param offset=0.01 --param jumpSize=0.1 --param jumpWindowSec=10 --param requoteDelta=0.01 --param minElapsedSec=60 --param stopBeforeEndSec=120 --param shares=10 --param maxInventory=50 --param minPrice=0.05 --param maxPrice=0.95`
- **Robustness neighborhood:** offset ∈ {0.01, 0.02, 0.03} × jumpSize ∈
  {0.05, 0.10}, minus the primary; other params fixed; judged on
  sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Maker-fill dominated BY
  CONSTRUCTION, so per DECISIONS D6/D14 this experiment is
  **`simulator-favored` on the size axis from the start**: worst-queue fills
  are always the FULL remaining size regardless of traded volume. Mitigation:
  shares=10 (tiny vs typical book depth), maxInventory=50/side (max ~$47.5
  at risk per market at mid prices, far inside maxLossStop 500). Pessimistic
  side: no fill at touch — every fill requires the ask to cross strictly
  below the bid, i.e. maximal adverse selection; zero maker fee matches
  Polymarket's actual maker fee. Contamination risk: self-crossed recorded
  books (E6) can grant phantom fills into stale crossed states; the strategy
  cancels quotes on crossed ticks but CANNOT prevent a same-tick phantom
  fill — composition diagnostics at judging must consider whether PnL is
  dominated by implausible fills. Pre-commitment: even a full advance chain
  cannot confirm on backtest evidence alone; the required next step of any
  advance is live paper validation (D6 escalation).
- **Windows (computed by tools/universe.ts at registration, re-verified
  2026-07-10 this session: 18,635 eligible, exploration 13,976 / holdout
  4,659):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted (subject to
    the design-failure clause above); skewed-payoff precision rule (D13)
    applies if win rate lands outside [0.1, 0.9] — verdict must state the
    minority-outcome count
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + explicit `simulator-favored` escalation per D14 (this
    experiment can never claim a clean classification)
  - holdout confirm: t ≥ 2 on holdout alone; even then the verdict is
    "confirmed-in-model", next step live paper
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0 (latency delays
  our requotes/cancels → stale quotes get picked off; expect the curve to
  slope DOWN, and record it)

## Runs (append-only)

<!-- one block per run, pasted verbatim from tools/results.ts -->

- 2026-07-10 — fill-feasibility diagnostics (EXP-000-debug runs 337-340,
  30 random exploration markets per cell, fill counts only via
  `tools/fills.ts`, PnL never read): see the feasibility block in the spec.
- 2026-07-10 — smoke (EXP-007-smoke, run 341, 10 markets): green plumbing
  (509k events replayed, 0 failures, 6 maker fills / 0 taker); never
  evidence.
- 2026-07-10 — probe (decisive), verbatim:

```
=== results: run 342  batch EXP-007-probe ===
strategy fable-exp-007  params {"offset":0.01,"shares":10,"jumpSize":0.1,"maxPrice":0.95,"minPrice":0.05,"maxInventory":50,"requoteDelta":0.01,"jumpWindowSec":10,"minElapsedSec":60,"stopBeforeEndSec":120}
status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
N=500  played=177  skipped=323  failures=0
pnlTotal=-224.9  EV/market=-0.4498  CI95=[-0.884, -0.0156]
std=4.9539  q=-0.0908  t=-2.0303
winRate(played)=0.4011 (71/106)
fees=0  fee/grossWins=0  maker/taker=342/0 (makerShare=1)
days=145  positiveDayFrac=0.2414  best=2026-01-22:42.4  worst=2026-01-14:-35.9
worst5: btc-updown-15m-1768382100:-30.1  btc-updown-15m-1768098600:-26.3  btc-updown-15m-1765269900:-22.3  btc-updown-15m-1766743200:-22.1  btc-updown-15m-1767460500:-20.1
best5:  btc-updown-15m-1769043600:27.2  btc-updown-15m-1769076000:18.3  btc-updown-15m-1774571400:17.9  btc-updown-15m-1771187400:16.3  btc-updown-15m-1764576000:14.3
```

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->

- 2026-07-10 — probe verdict (fresh-context Judge, verbatim):

- stage: probe (Stage 1)
- decision: kill
- read: N=500 q=-0.0908 t=-2.0303 EV/market=-0.4498 CI95=[-0.884, -0.0156]
- prediction check: CONTRADICTED. The spec's prediction is gross EV/market > 0 on played markets (gross = net since maker fee is zero, "the standard q/t readout IS the prediction check"). Played EV = pnlTotal/played = -224.9/177 = -1.27 per played market, winRate(played)=0.4011 (71/106) — punched-through bids lose more often than their fill price implies. The design-failure clause does not apply: 177/500 = 35.4% of markets got fills, far above the ~3% floor, so the simulator saw the mechanism clearly and rejected it.
- battery: n/a at probe (battery is a Stage 2 requirement); composition available anyway: maker/taker 342/0, fees=0, consistent with pure-maker construction, no anomaly suggesting phantom-fill contamination dominates (losses are spread across 145 days, positiveDayFrac=0.24, worst5 markets are -20 to -30, not one implausible outlier).
- simulator-bias classification: simulator-favored by spec pre-commitment (D6/D14: maker-fill-dominated by construction, makerShare=1, full-size worst-queue fills). This strengthens the kill: the strategy loses even under the size-favorable fill model; a `simulator-favored` label can block advancement, never rescue a negative read.
- lineage-adjusted bar: lineage_cells=1, so no Bonferroni adjustment — kill bar is the spec's own "q̂ ≤ 0 with t ≤ −1". Met with margin: q=-0.0908 ≤ 0 and t=-2.0303 ≤ -1; the CI95 excludes 0 on the negative side. (The advance bar t ≥ 2 at p 0.023 is moot.)
- required next step: Append this verdict to EXP-007, mark IDEAS #8's backtestable (punch-through) version dead per the model-conditional kill clause (D14) — at-touch liquidity provision live remains unmeasured — and distill the transfer lesson (loud punch-throughs are informative, extending E16's quiet-regime finding) into LESSONS.md. No further runs on this lineage.
- reasoning: The probe delivers an unambiguous negative on both decision paths in the spec. First, the kill rule as written (q̂ ≤ 0 with t ≤ −1) is met with room to spare: t=-2.03 means this is not merely "no detected edge" but active evidence of negative edge — the CI95 on EV/market lies entirely below zero. Second, the falsifiable prediction is directly contradicted: the mechanism claimed loud punch-throughs overshoot and revert, but fills won only 40% of the time and played markets averaged -1.27 each, i.e. loud punch-throughs are informative continuation, exactly the failure mode the spec named ("If EV(played) < 0, loud punch-throughs are informative and the mechanism (as backtestable) is contradicted"). The skewed-payoff precision rule does not trigger (win rate 0.4011 is inside [0.1, 0.9]), the design-failure escape hatch does not apply (35% fill rate ≫ 3%), and the simulator-favored classification only makes the loss more damning since the fill model is generous on size. Nothing here is ambiguous, but even if it were, the tie goes against advancement; here the data says kill outright, subject to D14's scope limit that only the punch-through-backtestable version is closed.
