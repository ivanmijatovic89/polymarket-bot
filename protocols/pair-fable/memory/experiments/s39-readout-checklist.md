# s39 readout checklist — 13 rows vs reference 1029 (compiled s39 ~02:05Z, pre-drain)

Pure execution distillation of the frozen bars (pair-v17t.md §4/§5,
pair-v17o.md §4/§10 + §7 literal, pair-v17.md §12 E-045b, pair-v17m.md §6).
NOTHING here changes a bar; if this file and a frozen section disagree, the
frozen section wins. Delete after the readout is recorded.

Reference = run 1029 (v17 τ0 P*0.92). Bar B_full = 0.74 (paired ev delta,
common intersection expected 10,651). Universe 10,747; expect the identical
96-slug priceToBeat outage set per row.

## Step 1 — map batchUid → run id

`npx tsx protocols/pair-fable/tools/results.ts --last 14` (or query
backtest_runs.batch_uid). Batches (STATUS table): v17t k003/k006/k012,
v17o k003/k006/k012/k006s, e045b p90, e046 t40 (primary …011803-2irtuw),
t40dup (…011853-xaiyd1, noise check ONLY), t80, t160, t160p.

## Step 2 — integrity (every row)

- failures: n=96, ptb=96, identical set vs 1008 (runbook step-2 literals).
- pairwise common vs 1029 = 10,651 (spot-check ≥1 run per grid).

## Step 3 — paired deltas (template = runbook step 3; B = 1029)

Readout order: p90 FIRST, then v17t/v17o, then E-046.

| A | verdict terms |
|---|---|
| p90 | P*-CONT (> +0.74) / P*-PEAK (< −0.74) / P*-EDGE-FLAT |
| v17t k003/k006/k012 | LATE-TIGHTEN-LIVE iff any > +0.74 (read monotonicity); DEAD iff best < 0.74 AND late-window S suppressed (engaged); engagement unclear ⇒ 200-mkt diagnostic |
| v17o k003/k006/k012/k006s | STATE-GATE-LIVE iff any > +0.74; DEAD iff best < 0.74 AND post-5 flagged S shares suppressed ≥20% at k012; engagement absent ⇒ 200-mkt diagnostic |
| e046 t40/t80/t160/t160p | TILT-EV-REAL-92 (any > +0.74) / TILT-HARMS-92 (any < −0.74); DOSE-MONO/PEAK/FLAT over t40/t80/t160; PERSIST t160p−t160 (paired ±0.74); ALL-NULL+ENGAGED vs ENGAGEMENT-STARVED (below) |
| t40dup vs t40 | noise model only (E-041 precedent dup |Δev| 0.21) |

Secondary (context): t160 vs 1026 paired — expect ≈ +5.4 if P* re-center
and tilt compose additively.

## Step 4 — mechanism metrics (calibrated 1029 baselines)

- **E-045b p90**: invested/played, S/C/D fills+$, resid count, noActivity.
  1029 baselines: S 18,308 fills/$772.4k; C+D 26,127 fills/$687.3k;
  played 8,764; invested 166.
- **v17t**: S-fill minute histogram (pair-v17t.md §6 method/known-answer).
  1029: min0–4 914.5k sh (50.0%), min5–11 889.8k (48.6%, −4.36¢/sh),
  min12–13 26.5k (1.4%). Engagement = late-window S share visibly down.
- **v17o**: §7 literal per cell (low/high_early × pre/post5 S net).
  1029 values (§13): low pre5 −32.4k / post5 −38.7k (880.4k post5 sh);
  high pre5 +3.4k / post5 −1.1k. Engagement bar: post-5 low_early S shares
  ≤ 80% of 880.4k at k012. C/D watch: C+D spend vs $687.3k — a material
  rise = suppressed maker flow leaking into taker completions (E-042
  anatomy failure) — read BEFORE celebrating S-toxicity cuts.
  High-early completion counts ~unchanged (false-flag check).
- **E-046**: S-split query (STATUS guards literal) vs baseline
  **61.6/38.4** (moved ≥ ~2 pts toward winner = engaged); residue-mkt
  count vs expectation **≈1,226** (≪ ⇒ ENGAGEMENT-STARVED); residue win%
  (74.4% at m10/0.96 was the E-044 anchor); D-fill $ vs $596.7k.
  anatomy.ts --run <id> for residue win%.

## Step 5 — decisions (frozen mappings, verbatim pointers)

- p90 P*-CONT ⇒ schema-floor touch needed for a lower sweep (record; the
  E-046 winning cell would be re-verified at any new center before
  promotion — pair-v17m.md §6). P*-PEAK/EDGE-FLAT ⇒ center stays 0.92.
- v17t LIVE ⇒ iterate slope at winner; DEAD ⇒ clock-ramp axis closed.
- v17o LIVE ⇒ iterate (oRefRate/oGraceMin/oSticky at winner); DEAD ⇒
  state-gate axis closed.
- E-046 REAL-92 ⇒ hold for center, re-verify, then iterate (laggard-side
  quoting asymmetry, size-of-tilt split). ALL-NULL+ENGAGED ⇒ directional
  acquisition program CLOSED under frozen bars pending a NEW conditioning
  signal (mission §3 evidence rule). STARVED ⇒ one bounded follow-up only
  with a concrete quote-count starvation mechanism.
- Cross-cutting: if BOTH v17t and v17o read LIVE they are complementary
  (different covered flow — pair-v17o.md §9 note), candidate combination
  test AFTER re-center question settles.
