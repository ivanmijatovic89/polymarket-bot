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

The reference to beat: **EL(140) −4.39/market; frictionless bound
−0.42** (worst_queue adverse-subset caveat on both).

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
