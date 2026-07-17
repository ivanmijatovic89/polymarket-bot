# LEADERBOARD — gate-passers ranked by SCORE (EVALUATION §6)

SCORE = EL(140) × f_stab × f_lat × f_tail. Hard gates (§5) are entry
tickets — SCORE never overrides a gate. Every row cites: window,
latency arm of EL, selection width (max-of-N), and fill-model caveat
(worst_queue: maker fills are the adverse subset; sim size lies).

## Champions / candidates (gate-passers)

| # | variant (exp/arm) | EL(140) | t | f_stab | L-500 | PF | SCORE | sel-width | window |
|---|-------------------|---------|---|--------|-------|-----|-------|-----------|--------|
| — | (none yet)        |         |   |        |       |     |       |           |        |

## Reference lines (NOT candidates; context for every judgment)

| line | EL(140) | EL(0) | EL(500) | EL(1000) | f_stab | PF | pairRate | notes |
|------|---------|-------|---------|----------|--------|-----|----------|-------|
| E002-baseline (L1 reference) | **−4.3904** (t −43.5) | −0.4207 | −5.0288 | −5.3047 | 0/9 wk (every arm) | 0.22 @ 140 | 0.644 @ 140 (0.291 @ lat0 — the honest one) | archetype-faithful shallow ladder, runs 675/678/676/677, 5,856 mkts, Apr 1–May 31, sel-width 1; exempt from gates (TAIL_K calibration source, D-007); judged LEDGER §E002 |
| E004-cfree (axis-grade, NOT a candidate) | −3.4665 h1 / −3.3541 h2 (t −43.5/−49.2) | — | — | — | not run (axis) | — | 0.860/0.848; imb p90 0.335 (all other arms 1.000) | free completion on the shallow ladder, runs 694/695, 2,880+2,976 mkts, Apr/May halves, sel-width 4, lat140 only; completed pairs locked ABOVE $1 (S 1.0207/1.0188) — wins via inventory removal (LS-7); no latency battery, no gate vector; judged LEDGER §E004 |
| E005-rc deep ladder (axis-grade, NOT a candidate) | −2.7093 h1 / −2.3622 h2 (t −19.8/−18.9) | — | — | — | not run (axis) | — | 0.576/0.558; imb p50 0.270/0.273, p90 1.000 | rungOffsets [0.02,0.13] maker-only, runs 698/699, Apr/May halves, sel-width 4, lat140 only; S(pair) 0.9427/0.9374; outlay 35.14/31.13 (≈60% of ref); ADVANCE RULE HELD (first axis to pass); sub-judged LEDGER §E005 |
| E005 rc+cap0.96 (best measured cell; axis-grade, NOT a candidate) | **−2.2884 h1 / −2.0229 h2** (t −16.6/−16.2) | −0.1175/−0.0136 | −3.1803/−3.1313 | −3.4644/−3.4688 | not run (axis) | — | 0.527/0.514; imb p50 0.332/0.333, p90 1.000 | deep ladder [0.02,0.13] + placement pairCostCap 0.96, maker-only, runs 708/703 + battery 709–714, Apr/May halves, sel-width 4 per sub-axis; S(pair) 0.9150/0.9110; CVaR5 −15.49/−14.61; outlay 29.12/26.54 (52% of ref); BATTERY READ (§E005 u42): depth advantage latency-robust (+1.8–2.2 vs shallow at every lat) but lat140 EL is ~all conversion-channel (lat0 ≈ −0.07 at 0.5 fills/mkt; taker 37→56%); candidate assembly BLOCKED pending a conversion-closing axis; L-ratios undefined (EL<0) |

The reference to beat: **EL(140) −4.39/market; frictionless bound
−0.42** (worst_queue adverse-subset caveat on both). Best measured
cell so far: E005 rc+cap0.96 ≈ **−2.16** avg maker-only (axis-grade,
sel-width 4 per sub-axis — shrinkage expected on confirmation;
~51% of the reference loss removed by depth + placement cap;
battery-characterized u42: chassis robust, EL conversion-dominated;
candidate path BLOCKED until quote-stability / fair-value /
completion closes the conversion channel; E005b + interactions in
backlog).

## Dead regions (closed with numbers; do not re-enter without new cause)

- **Shallow-requote parity ladders** (rungs [−1c,−3c], requoteDelta
  0.02, parityTol ≈ 2 clips): EL −0.42 (lat0) to −5.30 (lat1000),
  0/36 arm-weeks positive, N = 5,856/arm, t ≤ −8.5. Dies twice over:
  adverse selection eats the fee-free stream at lat0, and requote
  churn converts 34–55% of fills to taker under latency (E002,
  LEDGER). Re-entry only with a structurally different quoting policy
  (standing ladders / requote bans — E005 scope) or a fair-value
  suppression gate (E008).
- **Loose parity tolerance on the shallow ladder** (parityTolPct ∈
  {20, 40} of total shares, same cell otherwise): strictly worse than
  the floor in BOTH halves — ΔEL −0.25 to −1.01/mkt, CVaR5 deepens to
  −32.0, imbalance p50 up to 0.289, monotone across arms (E003, runs
  681–690, N = 2,880+2,976, lat140, sel-width 5). Mechanism: the
  loose gate admits adverse one-sided fills (~−21c each at tol 40)
  with zero pairing gain — taker share flat, pairRate FALLS. The
  whole parity axis is payability-dead at this cell (best arm = floor
  = E002 reference −4.39); tolerance is a risk cap, not an edge
  source. Re-entry only after some OTHER knob makes the cell pay,
  and then only to re-tune the cap (LEDGER §E003).
- **Cost-capped completion on the shallow ladder** (completionMode=
  cap, cap ∈ {0.97, 0.99}, fee-aware projected-pair test): both caps
  statistically indistinguishable from no-completion in BOTH halves
  (|ΔEL| 0.10–0.25 vs 2·se_diff 0.35–0.42; c990 point-estimates
  WORSE: −0.10/−0.38), while free completion is DISTINCT better
  (+1.10/+0.87) — E004, runs 691–696 vs 682/683, N = 2,880+2,976,
  lat140, sel-width 4. Mechanism (decomposed): caps cross only when
  the projected pair is already cheap and hold exactly the adverse
  inventory; their pair volume prices at break-even (c990 Δpair
  +9.96 vs Δcost +9.25 + fees). Re-entry only for cap values ≥ ~1.00
  (which converge to free) or state-aware caps (E-completion-
  selective seed); plain price caps on completion are closed
  (LEDGER §E004, LS-7).
- **The A17 4-rung archetype package at archetype sizing**
  (rungOffsets [0.01,0.02,0.05,0.13], 24 sh/side/cycle at clip 6):
  indistinguishable from the shallow reference in BOTH halves and
  point-NEGATIVE both (ΔEL −0.41/−0.28 vs 2·se_diff 0.46/0.42), with
  reference-like pair economics (S 0.9802/0.9752) at the LARGEST
  outlay of all shape arms (59.97/54.82) — adding shallow rungs back
  at 2× resting size cancels the measured depth benefit (E005 shape
  sub-axis, runs 700/701 vs 682/683, lat140, sel-width 4). The
  incumbent's documented edge does not come from this ladder shape at
  this sizing; re-entry only with the archetype's OTHER properties
  (fee tier, completion, timing) layered in (LEDGER §E005).
- **Quote-freezing (requoteDelta ∈ {0.05, 0.10, 0.20, 0.45}) on the
  deep chassis** (rc+c960, lat140): every arm at-or-worse than the
  delta-0.02 reference in BOTH halves (E006, runs 715–722 vs
  708/703, N = 2,880+2,976, sel-width 5). h1 −2.5978/−2.3103/
  −2.2897/−2.3015 vs ref −2.2884; h2 −2.5887/−2.3715/−2.3681/
  −2.3428 vs ref −2.0229; q05 distinguishably worst in both halves;
  advance rule FAILED (top-2 set mismatch). Mechanism (exact
  settlement decomp): freezing quotes collapses the winner-remainder
  term ($2.2–2.4 → $0.85–1.1/mkt) while saving only ~$0.3 in taker
  fees — the requote engine's price-chasing carries the winner-
  tracking payload (LS-11). Participation never chokes (played
  99.5%; delta gates re-anchoring only). Real side effect: tails
  improve ~45% (CVaR5 −15.5 → −8.7). Re-entry only as a RISK lever
  after some other knob makes the cell pay, or with an
  information-based anchor that preserves winner-tracking (E008
  fair-value re-anchoring — the seeded successor) (LEDGER §E006).
