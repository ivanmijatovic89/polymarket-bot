# pair-v17o — state-conditioned quote ceiling (DRAFT, s34; design before code)

Status: **DRAFT — not frozen.** Sequenced AFTER the E-043/E-044/E-045 readout
and the v17t grid (same P*-recentering dependency on E-045 as v17t). Do not
submit from this file until it is marked FROZEN with final params and gates.

## 1. Mechanism (falsifiable)

Measured prior (pair-v17.md §11/§11.1, run 1008): the ENTIRE −110k S-flow
adverse selection is concentrated in markets whose matched-pair pace is low
early — early_matched < 150 by minute 5 ⇒ subsequent S flow destroys −42.2k
(61/39 lose-ward at widening prices); early_matched ≥ 150 ⇒ whole-window S
flow is fair (−1.6k over 2,680 mkts). The regime is flagged by the
controller's OWN state (completion pace), no external signal, and ~40% of
the group's toxicity accrues after the flag is up.

Hypothesis: conditioning the maker quote-cap concession on the realized
completion deficit suppresses (or prices correctly) exactly the flagged
regime's post-flag S flow while leaving fair-flow markets untouched, raising
neutral ev. The −42.2k first-order headroom is NOT the expected net (removal
interacts with R/C/D flow and pairing value in false-flagged markets); this
experiment measures the net.

## 2. Exact delta over pair.v17.ts (one substitution + three schema adds)

Same insertion point as v17t (per-share concession on `pHat`, applied AFTER
the VWAP projection — the target-routed form is amplified by `Qs2/q`, defect
proven in runs 1015/1016). Replace the clock ramp with a deficit term:

```ts
const elapsedMin = endMs !== null ? Math.max(0, 15 - (endMs - nowMs) / 60_000) : 0
const matched = Math.min(qty.UP, qty.DOWN)
const def =
  elapsedMin >= cfg.oGraceMin
    ? Math.min(1, Math.max(0, 1 - matched / (cfg.oRefRate * elapsedMin)))
    : 0
const pHat = ((cfg.pairTarget - vOProj) * Qs2 - cost[side]) / q - cfg.oTighten * def
```

Params: `oTighten` ($/share at full deficit, `min(0).max(0.2)`, default 0 ⇒
exact v17), `oRefRate` (matched shares/min reference pace, default 30 —
150 @ min 5, the §11.1 cut; swept, since that cut was chosen in-sample),
`oGraceMin` (no throttle before this, default 5 — the state is not
informative earlier; pre-flag damage is structurally unreachable by this
trigger). `pLock`/doom stay on base P* (C/D completions ~fair, §10). τ = 0.

Dose currency: post-flag S flow in the flagged regime nets ≈ −4.5 ¢/sh
(−42.2k / 942.6k sh), so k ∈ {0.03, 0.06, 0.12} brackets the measured
toxicity, matching v17t's grid currency.

## 3. Non-equivalence vs prior kills and siblings

- **vs v17t (clock ramp):** v17t concedes in EVERY market including the
  2,680 fair-flow ones (whose S net is −1.6k ≈ 0 — nothing to save there);
  v17o concedes only where the deficit flags. Different conditioning
  variable (state vs clock); if both turn out live they are additive at the
  same insertion point but are tested separately.
- **vs start-minute gating (E-027, minuteev):** binary clock participation
  cut; this is state-conditioned continuous pricing, zero effect in
  on-pace markets by construction.
- **vs pLock / doom trending halt (v15.4 band):** those trigger on
  IMBALANCE breach; the losing regime often keeps imbalance bounded (R
  repairs) while completions stop — matched-pace is a different state
  variable than unmatched excess.
- **vs market selection (mission §3 boundary):** no entry gate — the
  controller enters every market and adapts within the window from its own
  fills. This is controller math, not universe selection.

## 4. Proposed grid (freeze after E-045 verdict + v17t readout)

New file `pair.v17o.ts` (params-only impossible); protocol:check + local
`--sequential` smoke + activation check before submission. Activation
evidence: k>0 vs k=0 on the same ~20 mkts must show S suppression
CONCENTRATED in low-early markets (split fills by early_matched at min 5),
with early-window (min < 5) activity identical everywhere.

Center: E-042 center (P* per the E-045 branch, as v17t), τ0, B=500, 140/20,
FULL. Cells: oTighten k ∈ {0.03, 0.06, 0.12} at oRefRate 30 / grace 5;
k=0 reference by code identity (Branch A: g0 = 1008; Branch B: the winning
E-045 cell — no k=0 re-run). Bars: B_full = 0.74. **STATE-GATE-LIVE** iff
any cell − reference > 0.74 (read dose monotonicity). **STATE-GATE-DEAD**
iff best cell − reference < 0.74 AND the mechanism metric shows engagement
(flagged-regime post-5 S share suppressed ≥ 20% at k=0.12) ⇒ axis closed.
Engagement absent ⇒ escalate to a 200-mkt diagnostic, not a verdict.
Mechanism metrics (frozen): §11.1 settle-value S-net split (low/high-early ×
pre/post-5) recomputed per cell; completion counts in high-early group must
be ~unchanged (false-flag damage check); resid-mkt count.

## 5. Implementation + activation evidence (s34)

Code: `protocols/pair-fable/strategies/pair.v17o.ts` (copy of pair.v17t.ts
with the concession term swapped; grace gate guards `elapsedMin > 0` so
oGraceMin=0 means throttle-from-start, no 0/0). protocol:check PASS.

- Smoke: run 1018 (5 mkts, k=0.06) PASS — completed, 0 failures, 12/8
  maker/taker fills.
- Activation pair on the SAME 20 markets (slug-verified): 1019 (k=0) vs
  1020 (k=0.06, oRefRate 30, grace 5): pre-min-5 S fills 39 vs 47 (mechanism
  inactive by construction; diff = latency jitter, known non-determinism);
  post-min-5 S fills 43 → 30 (−30%), shares 1,075 → 750, S avg price
  0.480 → 0.451 — suppression only post-grace, surviving fills at a ~3¢
  larger concession. ACTIVATION PASS. 20-mkt ev numbers are noise — do not
  cite them.
- **Watch-metric promoted to frozen FULL mechanism metric:** taker fills
  rose 46 → 77 at k=0.06 (fees 8.81 → 14.92 on 20 mkts) — suppressing maker
  starts shifts flow into C/D FOK completions. Per E-042's anatomy lesson
  (acquisition spend ate the residue value), each FULL cell must report
  C/D fill counts + $ spend vs its reference; STATE-GATE-LIVE requires the
  ev bar, not just S-toxicity reduction.

### Prepared submit commands (fire only after FROZEN; same branch logic as v17t)

Branch A — E-045 = P*-FLAT-FULL (defaults center; reference g0 = 1008):

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17o --param oTighten=0.03 --to-ms 1785196800000 --label pf-v17o-k003 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17o --param oTighten=0.06 --to-ms 1785196800000 --label pf-v17o-k006 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17o --param oTighten=0.12 --to-ms 1785196800000 --label pf-v17o-k012 --detach
```

Branch B — E-045 = P*-LIVE: add `--param pairTarget=<winning P*>` to each;
reference = the winning E-045 cell's run row (code identity, no k=0 re-run).

Sequencing: v17t grid submits first (its readout may also inform k
currency); v17o follows. Both may be in the fleet queue concurrently —
they are independent cells against the same reference.

## 6. Flag-timing sensitivity (s34, run 1008; grid guidance)

Same 30 sh/min pace cut read at different minutes (flagged avg pnl vs
unflagged): m3 −15.94 vs −12.35 (Δ 3.6, weak); m5 −16.97 vs −6.37 (Δ 10.6);
m7 −17.22 vs −1.78 (Δ 15.4, unflagged ~breakeven but only ~19% of mkts
unflagged and 8 min left to act). Discrimination grows with observation
time while actionable window shrinks ⇒ supports the CONTINUOUS deficit
form (throttle deepens automatically as low pace persists past grace) over
any one-shot gate, and keeps oGraceMin grid interest at {3, 5}, not 7+.

Robustness: the §11.1 concentration replicates on run 1009 (g3, tilt bps 40
— semi-independent config): low-early S net −104.1k (2.0M sh) vs high-early
−3.1k (1.39M sh, ≈ fair). Not a 1008 artifact.

## 7. FULL-cell readout literals (verified this session on 1008/1009)

Per-cell S-net split (replace <RUN>; settle-value attribution, k units):

```
npx tsx protocols/pair-fable/tools/sql.ts "SELECT CASE WHEN low.slug IS NOT NULL THEN 'low_early' ELSE 'high_early' END AS grp, CASE WHEN (jt.ts - CAST(SUBSTRING_INDEX(brm.slug,'-',-1) AS UNSIGNED)*1000)/60000 < 5 THEN 'pre5' ELSE 'post5' END AS phase, ROUND(SUM(CASE WHEN CONVERT(jt.side USING utf8mb4) COLLATE utf8mb4_unicode_ci = brm.final_outcome THEN jt.s ELSE 0 END)/1000 - SUM(jt.s*jt.p)/1000, 1) AS s_net_k, ROUND(SUM(jt.s)/1000,0) AS s_shares_k FROM backtest_run_markets brm LEFT JOIN (SELECT brm2.slug FROM backtest_run_markets brm2 JOIN JSON_TABLE(brm2.intent_meta, '\$[*]' COLUMNS (side VARCHAR(8) PATH '\$.side', s DOUBLE PATH '\$.s', ts DOUBLE PATH '\$.ts')) j2 WHERE brm2.run_id = <RUN> GROUP BY brm2.slug HAVING LEAST(COALESCE(SUM(CASE WHEN j2.side='UP' AND j2.ts < CAST(SUBSTRING_INDEX(brm2.slug,'-',-1) AS UNSIGNED)*1000 + 300000 THEN j2.s END),0), COALESCE(SUM(CASE WHEN j2.side='DOWN' AND j2.ts < CAST(SUBSTRING_INDEX(brm2.slug,'-',-1) AS UNSIGNED)*1000 + 300000 THEN j2.s END),0)) < 150) low ON low.slug = brm.slug JOIN JSON_TABLE(brm.intent_meta, '\$[*]' COLUMNS (side VARCHAR(8) PATH '\$.side', m VARCHAR(2) PATH '\$.m', s DOUBLE PATH '\$.s', p DOUBLE PATH '\$.p', ts DOUBLE PATH '\$.ts')) jt WHERE brm.run_id = <RUN> AND jt.m = 'S' GROUP BY grp, phase"
```

Reference values on 1008 (k=0 ≡): low_early pre5 −66.7k / post5 −42.2k;
high_early total −1.6k. Engagement bar (§4): flagged-regime post-5 S shares
suppressed ≥ 20% at k=0.12 vs reference. C/D flow check: taker counts + $
per cell vs reference from results.ts / anatomy.ts (§5 watch-metric).

## 8. Grid-corner verification (s34; runs 1021/1022 + 1019/1020, same 20 mkts)

S-fill minute split per cell (pre3 / min3–5 / post5):
k=0 → 30/9/43; k=.06 g5 → 31/16/30; k=.12 g5 → 30/12/11; k=.06 g3 → 30/3/24.
Pre-grace identical in EVERY cell (no contamination); post-5 monotone in dose
(43→30→11 — max dose strong but not a shutdown, 19/20 played); grace 3 moves
suppression into min 3–5 (9→3) exactly as specified. All drafted grid corners
verified live; schema bounds hold. Corner runs are activation evidence only —
20-mkt ev is noise.
