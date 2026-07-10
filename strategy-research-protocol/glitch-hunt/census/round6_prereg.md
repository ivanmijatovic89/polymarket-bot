# Round 6 pre-registration — gabagool adjudication probes (memo 006)

Written 2026-07-10, BEFORE any query below is run (mtime = birthtime per the
round-4/5 precedent). Scope: adjudicate the single full-stack survivor of the
round-6 frozen gate stack (`round6_probe.sql` → `round6_gatestack_cells.csv`):
**UP, t=300, band 82** — n=324, dev +4.51c, margin +2.22c, z=2.42, 7/8 months.

The gate stack itself was frozen in round 3 and run by the surveyor with no
interpretation; nothing here re-tunes it. These probes are adjudication-only:
they either corroborate structure the gates could not see, or kill the
survivor. No new cell may be promoted from these probes.

## Data allowed

- `midwindow_checkpoints.parquet` (holdout, already consumed by the scan) —
  probes G1–G3.
- `round6_gatestack_cells.csv` (scan output, arithmetic only) — probe G4.
- Published aggregates (`friction_map_midwindow.csv`, `midwindow_taxonomy.csv`,
  CENSUS.md) — citation only, no queries.

**Explicitly NOT touched: `census/checkpoints.parquet`** (the 2,000-episode
census sample, disjoint from the holdout, 15s grid). It is the ONLY disjoint
episode set in existence for these t values and is reserved as the
replicator's sample if mantis says SURVIVES. Consuming it here would leave the
replication step with nothing (K-004 trap b: sample-overlap confirmation).

## Region under adjudication

R := t_sec=300, both tokens, token two-sided (bid>0, ask<1, ask>bid, same
filters as `round6_probe.sql` `tok` view), token ask in [0.82, 0.86)
(= bands 82+84). Rationale, fixed before G1 runs: the four (token × band)
cells in R are DISJOINT episode sets (an episode's favorite is one token; a
token lands in one band per t), all four are positive in the published dump
(+4.51/+4.03/+2.31/+3.64c), and token symmetry + the near-equal b84 flank are
exactly the structure the single-cell gates could not credit. b86 flanks are
negative in the dump (−1.85/−1.00) and b80 near zero (+0.65/+0.17), so R's
boundaries are taken from the dump as-is — this is measured, not derived; the
boundary choice is confessed as such in the memo.

## Probes and pre-declared decision rules

- **G1 — token-symmetry + pooled month vector.** Pooled over R: n, P(win),
  avg ask, dev, z; split by token; per (month, token) n_m and dev_m; count of
  months with pooled dev_m > 0 (months with n_m >= 10 only).
  Rules: (a) if the DOWN arm (episodes where DOWN is the favorite — disjoint
  from the UP survivor's episodes) shows dev >= +1.5c, the survivor is NOT
  UP-specific and the DOWN arm counts as same-extraction corroboration on
  disjoint episodes; if DOWN dev <= 0, the survivor is UP-only and inherits a
  lone-cell discount. (b) pooled months positive must be >= 6/8 or the region
  claim falls back to the lone gated cell.
- **G2 — spread-width split (S-001 discriminator).** R split by favorite
  spread: one-tick (ask − bid <= 0.011) vs wider. Rule: if dev(one-tick)
  > = +2.3c (the region friction: p25 spread 1c + 156bps × 0.83 ≈ 1.3c), the
  > MID itself is miscalibrated and the S-001 maker-sink label is refuted for
  > this cell; if dev(one-tick) < friction and the pooled deviation is carried
  > by wide-spread rows, label S-001-shaped and the memo's verdict is negative
  > regardless of G1.
- **G3 — 2026-02 diagnosis.** From G1's month table: n_m(2026-02) and the
  deviation of that month's dev_m from the pooled dev in month-level SE units
  (SE_m = sqrt(p̄(1−p̄)/n_m)). Rule: |dev_m − dev_pooled|/SE_m < 2 → the
  negative month is within sampling noise of a constant effect; >= 2 →
  genuine regime miss, evidence component docked accordingly in the memo.
- **G4 — comparison-debt arithmetic (scan output only, no market data).**
  Under H0 "every ask is fair" (p_true = avg_ask per cell): per-cell
  P(gate1) = 1 − Φ(thr/SE0), thr = (dev − margin) i.e. the cell's friction
  bar, SE0 = sqrt(ask(1−ask)/n). Report: (i) Σ P(gate1) = expected gate-1
  passers vs observed 38; (ii) expected full-stack survivors bracketed as
  Σ P(gate1) × 0.25 × [0.145, 0.45] — flank-sign 1/4 under H0; month gate
  bracketed between unconditional P(>=6/8 | p=0.5)=0.145 and an
  approximation conditional on sitting at the gate-1 threshold (~0.45);
  (iii) expected count of cells with z >= 2.42 = 371 × (1 − Φ(2.42)).
  Φ via logistic approximation Φ(z) ≈ 1/(1+exp(−1.702z)) (±1% abs, stated).
  These numbers go into the memo verbatim, favorable or not. Mirror-token
  double-counting (each episode appears once per token; UP band b and DOWN
  band ~98−b at the same t are the same books) means the ~371 token-cells
  are ~2x-correlated; the debt numbers are quoted both raw and halved.

## What is NOT pre-registered (and therefore not claimable)

Any cell, band, t, or conditioning axis not named above. No
prev-window-outcome axis (K-004 ban). No fair-value anchor at t=0 (T-001).
Cross-t decay numbers for R at t ∈ {450,600,690} are arithmetic on the
published dump (cells already public) and are quoted as descriptive context
only, never as an independent confirmation.
