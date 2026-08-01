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
