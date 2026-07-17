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
| E004-cfree (best measured cell; axis-grade, NOT a candidate) | −3.4665 h1 / −3.3541 h2 (t −43.5/−49.2) | — | — | — | not run (axis) | — | 0.860/0.848; imb p90 0.335 (all other arms 1.000) | free completion on the shallow ladder, runs 694/695, 2,880+2,976 mkts, Apr/May halves, sel-width 4, lat140 only; completed pairs locked ABOVE $1 (S 1.0207/1.0188) — wins via inventory removal (LS-7); no latency battery, no gate vector; judged LEDGER §E004 |

The reference to beat: **EL(140) −4.39/market; frictionless bound
−0.42** (worst_queue adverse-subset caveat on both). Best measured
cell so far: E004-cfree ≈ **−3.41** avg (axis-grade, sel-width 4 —
shrinkage expected on confirmation; D-008 path only).

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
