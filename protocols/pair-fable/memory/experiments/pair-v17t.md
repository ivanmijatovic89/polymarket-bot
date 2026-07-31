# pair-v17t — time-varying quote ceiling (DRAFT, s31; freeze pending E-045)

Status: **DRAFT — not frozen.** The final grid center (base P*) waits on the
E-045 verdict (pair-v17.md §9). Do not submit from this file until it is
marked FROZEN with final params and integrity gates.

## 1. Mechanism (falsifiable)

Measured prior (pair-v17.md §10, run 1008): S-fill adverse selection is
price-uniform (−3.0 ± 0.5 ¢/sh across bands 0.2–0.8) but grows with
window age — −2.2..−3.3 ¢/sh in minutes 0–4 → −2.6..−5.0 in minutes 5–11 →
−6.4..−9.7 in minutes 12–13. The neutral controller's whole loss is this
S-flow term (leg-vs-outcome identity). Start-minute gating is dead
(minuteev on 1008; E-027), so the lever is PRICE, not participation:
demand a bigger concession per share as the window ages, so late fills
either happen at prices that compensate their higher toxicity or don't
happen.

Hypothesis: tightening the maker VWAP ceiling linearly with window age
raises neutral ev by pricing late S fills at or below their conditional
fair value, at an acceptable loss of completion/pairing value (§10's
caveat: the −47k gross toxicity after minute 5 is NOT the net value of
suppressing those fills — this experiment measures the net).

## 2. Exact delta over pair.v17.ts (one substitution + one schema add)

New param `lateTighten` (dollars per share, `min(0).max(0.20)`, default 0
⇒ exact v17). In the quote-pricing block:

```ts
const frac = endMs !== null ? Math.min(1, Math.max(0, 1 - (endMs - nowMs) / WINDOW_MS)) : 0
const pHat = ((cfg.pairTarget - vOProj) * Qs2 - cost[side]) / q - cfg.lateTighten * frac
```

`WINDOW_MS = 900_000`. The concession is applied to `pHat` AFTER the
VWAP projection, NOT by tightening `pairTarget` inside it: through the
target the dose is amplified by `Qs2/q` (d pHat/d pTgt = Qs2/q — with 300
held shares and q=100 a 1¢ target shift moves the cap 4¢), decoupling the
knob from the per-share toxicity it prices (verified on the first
implementation: runs 1015 vs 1016, k=0.12-via-target suppressed S fills
hard from minute 1). Per-share form: quote cap at minute m is lowered by
exactly k·(m/15) $ per share — k=0.06 ⇒ −2¢ at m 5, −4¢ at m 10, −5.6¢
at m 14, the shape and scale of the measured toxicity ramp.

Everything else untouched — in particular `pLock = pairTarget − 0.01`
(C-lock trigger) stays on the BASE P*: C/D completions are ~fair (§10),
so the delta touches only the S-quote price cap, the identified loss
term. τ = 0 (neutral; priority-1 axis).

## 3. Non-equivalence vs prior kills

- Start-minute gating (minuteev, E-027): binary participation cut; this
  is a continuous price concession — late fills still allowed when paid
  for. k→∞ limit approaches gating; the grid stays far from that limit.
- E-045 P* sweep: uniform ceiling shift over the whole window; this is
  slope-only with the m=0 ceiling unchanged. If E-045 returns P*-LIVE
  (level matters), re-center base P* first; if P*-FLAT-FULL, the level
  axis is closed and slope is the genuinely untested df.
- v9/v12 price-band families: absolute entry ceilings on price bands,
  not VWAP-projection ceilings, and not time-varying.

## 4. Proposed grid (to freeze after E-045 readout)

Params-only impossible (needs the code delta above) ⇒ new file
`pair.v17t.ts`, protocol:check + local `--sequential` smoke + activation
check (k=0 vs k>0 must differ ONLY in maker quote prices; per-market
S-fill count at k>0 ≤ k=0 late-window) before submission.

Center: E-042 center, τ0, B=500, 140/20, FULL universe. Cells:
k ∈ {0.03, 0.06, 0.12} vs g0-equivalent (k=0 ≡ v17 τ0 by code identity
— reuse run 1008, no re-run). Bars: B_full = 0.74;
**LATE-TIGHTEN-LIVE** iff any k-cell − g0 > 0.74 (read monotonicity);
**LATE-TIGHTEN-DEAD** iff best cell − g0 < 0.74 AND late-window S share
measurably suppressed (mechanism engaged, no ev) ⇒ axis closed;
inconclusive-engagement escalates to a 200-mkt diagnostic instead.
Mechanism metrics: S-fill minute histogram + ev/share by minute
(pair-v17.md §10 method), completion counts, resid-mkt count.
