# E-043 / E-044 / E-045 readout runbook (prepared s33, 2026-08-01)

Executable literals for the 7-row readout. Bars and decision mappings
are FROZEN in pair-v17.md §8 (E-043), §9 (E-045) and pair-v17m.md §4
(E-044) — this file adds nothing to them; it only removes
query-writing latency from the readout session. All SQL literals here
were syntax-verified in s33 (the S-split literal reproduced the s29
baseline on run 1008 exactly: lose 1,969,100 sh @ 0.418 / win
1,434,600 @ 0.503 = 57.85/42.15).

Standing references: g0 = 1008 (neutral), g1 = 1011 (taker tilt
bps 10), g3 = 1009 (taker tilt bps 40). Bar B_full = 0.74 on paired
ev delta over the common intersection (expected 10,651).

## Step 0 — confirm drain

```
npx tsx protocols/pair-fable/tools/fleet.ts 2>&1 | tail -12
```

`active batches: 0` required. If > 0: do NOT resubmit, do NOT poll
per-batch (rows land together at full drain — s32 model).

## Step 1 — map batchUid → run id

```
npx tsx protocols/pair-fable/tools/results.ts --last 8 2>&1 | grep -v "FAILURE btc-updown"
```

Fill in: h80=__ h160=__ p92=__ p94=__ p98=__ m10=__ m40=__
(batchUids in STATUS table; prefix pf-e043/e044/e045).

## Step 2 — integrity (failure rule: identical 96-slug outage set)

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT run_id, COUNT(*) AS n, SUM(reason LIKE '%priceToBeat%') AS ptb FROM backtest_run_failures WHERE run_id IN (<7 ids>) GROUP BY run_id"
```

Expect n = 96 and ptb = 96 for every run. Identical-set check vs g0:

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT f.run_id, COUNT(*) AS common_with_1008 FROM backtest_run_failures f JOIN backtest_run_failures g ON g.run_id = 1008 AND g.slug = f.slug WHERE f.run_id IN (<7 ids>) GROUP BY f.run_id"
```

Expect common_with_1008 = 96 everywhere. Then pairwise common played
markets (spot-check at least one run per experiment):

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT COUNT(*) AS common FROM backtest_run_markets a JOIN backtest_run_markets b ON a.slug = b.slug WHERE a.run_id = <X> AND b.run_id = 1008"
```

Expect 10,651.

## Step 3 — paired per-market deltas (the verdict numbers)

Template (A = new cell, B = reference; delta = ev(A) − ev(B) on the
common intersection; se = paired SE):

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT COUNT(*) AS n, ROUND(AVG(a.pnl - b.pnl), 3) AS d_ev, ROUND(STDDEV_SAMP(a.pnl - b.pnl) / SQRT(COUNT(*)), 3) AS se FROM backtest_run_markets a JOIN backtest_run_markets b ON a.slug = b.slug WHERE a.run_id = <A> AND b.run_id = <B>"
```

Frozen comparison pairs (run each; bar ±0.74 unless noted):

| # | A | B | frozen verdict term |
|---|---|---|---|
| 1 | h80 | 1009 (g3) | DOSE-CONT (>+0.74) / DOSE-PEAKED (<−0.74) / DOSE-FLAT |
| 2 | h80 | 1008 (g0) | TILT-EV-REAL retest (>+0.74) |
| 3 | h160 | 1008 (g0) | expected \|Δ\| < 0.74; breach = ANOMALY, escalate |
| 4 | m10 | 1011 (g1) | MAKERTILT-BETTER (>+0.74) |
| 5 | m40 | 1009 (g3) | MAKERTILT-BETTER (>+0.74) |
| 6 | m10 | 1008 (g0) | TILT-EV-REAL (>+0.74) |
| 7 | m40 | 1008 (g0) | TILT-EV-REAL (>+0.74) |
| 8 | p92 | 1008 (g0) | P*-LIVE (either direction beyond ±0.74) |
| 9 | p94 | 1008 (g0) | P*-LIVE |
| 10 | p98 | 1008 (g0) | P*-LIVE; else P*-FLAT-FULL across 8–10 |

E-045 monotonicity: read d_ev across p92 → p94 → g0(0.96) → p98.
Also record per-cell headline ev / p/100 / invested from results.ts
(E-045 frozen mechanism metrics: invested/played, C vs D fill
counts/$, resid-mkt count).

## Step 4 — E-044 mechanism metrics (before applying its mapping)

Residue win% (MAKERTILT-DEAD needs ≤ 60%; NULL if ≥ 70% but ev flat):

```
npx tsx protocols/pair-fable/tools/anatomy.ts --run <m10>
npx tsx protocols/pair-fable/tools/anatomy.ts --run <m40>
```

S-split engagement vs the 58/42 neutral baseline (verified literal;
zsh: keep the `\$` escapes exactly as written):

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT CASE WHEN CONVERT(jt.side USING utf8mb4) COLLATE utf8mb4_unicode_ci = brm.final_outcome THEN 'win' ELSE 'lose' END AS grp, ROUND(SUM(jt.s),0) AS shares, ROUND(SUM(jt.s*jt.p)/SUM(jt.s),3) AS avg_p, COUNT(*) AS fills FROM backtest_run_markets brm JOIN JSON_TABLE(brm.intent_meta, '\$[*]' COLUMNS (side VARCHAR(8) PATH '\$.side', m VARCHAR(2) PATH '\$.m', s DOUBLE PATH '\$.s', p DOUBLE PATH '\$.p')) jt WHERE brm.run_id = <m-cell> AND jt.m = 'S' GROUP BY grp"
```

Baseline (run 1008): lose 1,969,100 sh @ 0.418 (57.85%), win
1,434,600 @ 0.503. Tilt engaging ⇒ the m-cells' split moves toward
the winner. (s30 finding: toxicity is price-uniform, so if the
m-cells do NOT move the split, the asymmetry axis has no band-level
fallback.)

## Step 5 — verdicts → decisions (frozen mappings, verbatim)

- E-043: DOSE-CONT ⇒ extend dose + persistence cell at best width.
  DOSE-PEAKED/FLAT and no TILT-EV-REAL ⇒ width axis closed at ev;
  signal-(b) taker-tilt value rests on E-044.
- E-044: MAKERTILT-BETTER ⇒ iterate (dose, persistence, size-of-tilt).
  MAKERTILT-DEAD (both cells ±0.74 of g0 AND residue win% ≤ 60%) ⇒
  maker-acquisition axis closed. MAKERTILT-NULL ⇒ record
  capacity-bound with maker-tilt fill counts.
- E-045: P*-LIVE ⇒ v17t Branch B (re-center base P* at the winner);
  P*-FLAT-FULL ⇒ P* axis closed in [0.92, 0.98] at this center,
  v17t Branch A.

## Step 6 — v17t grid (AFTER applying E-045's branch)

Freeze pair-v17t.md (DRAFT → FROZEN, stamp the E-045 verdict + date),
then fire the three prepared literals in pair-v17t.md §4 for the
matching branch (k ∈ {0.03, 0.06, 0.12}; k=0 reference = g0 1008 for
Branch A, the winning E-045 cell's row for Branch B — code identity,
no k=0 re-run). Pre-submit guards: clean tree pushed to origin/main;
do not touch pair.v17.ts / pair.v17m.ts semantics (pins f107234 /
18ce0a43 are released once the queue is drained, but v17t is
params+new-file only anyway).
