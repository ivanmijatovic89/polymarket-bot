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

### Prepared submit commands (s32; still DRAFT until E-045 verdict applied)

Branch A — E-045 = P*-FLAT-FULL (submit exactly as drafted; center = all
schema defaults, verified equal to the E-042 center on run 1015's recorded
params). One literal command per config (zsh guard), submit whole grid up
front, capture each batchUid line, verify with fleet.ts:

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param lateTighten=0.03 --to-ms 1785196800000 --label pf-v17t-k003 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param lateTighten=0.06 --to-ms 1785196800000 --label pf-v17t-k006 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param lateTighten=0.12 --to-ms 1785196800000 --label pf-v17t-k012 --detach
```

Branch B — E-045 = P*-LIVE at some P*≠0.96: add
`--param pairTarget=<winning P*>` to each command above, and the k=0
reference becomes the WINNING E-045 cell's run row (it IS v17 τ0 at that
P* by code identity — no k=0 re-run needed in either branch; Branch A
reuses g0 = 1008).

Pre-submit checklist (unchanged): tree clean + pushed to origin/main;
no v17t jobs queued elsewhere; freeze this file (Status → FROZEN, stamp
commit) BEFORE the first submit.

## 5. FROZEN (s34, 2026-08-01) — Branch B applied: E-045 = P*-LIVE, winner 0.92

Status: **FROZEN.** E-045 verdict (pair-v17.md §12): P*-LIVE monotone,
winner pairTarget 0.92 (run 1029 = the k=0 reference by code identity).

**Correction to §4:** the "center = all schema defaults" claim was WRONG —
v17t schema defaults are orderSize 25 / imbalanceBand 40 / doomUnitMax 0
(runs 1015–1017 recorded the center because s31 passed it explicitly).
Every cell below passes the center explicitly; params must equal 1029's
recorded params except lateTighten. Final grid (k ∈ {0.03, 0.06, 0.12},
--to-ms 1785196800000, 140/20, B=500; bars per §4 vs reference 1029):

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.03 --to-ms 1785196800000 --label pf-v17t-k003 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.06 --to-ms 1785196800000 --label pf-v17t-k006 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --to-ms 1785196800000 --label pf-v17t-k012 --detach
```

## 6. Reading prior — baseline S-toxicity minute curve on the k=0 reference 1029
## (s37, 2026-08-01 ~01:47Z, PRE-READOUT; bars in §4/§5 unchanged — context only)

Recorded before any of the 13 in-flight rows landed (queue verified 01:39Z:
13 aggregates waiting-children, ~117.6k market jobs left, drain ≈04:45Z).
Method: §10 minute curve (JSON_TABLE over intent_meta, jt.m='S', minute =
floor((ts − market_start_ms)/60k), ev/share = shares-weighted win_rate −
avg fill price). Known-answer check on 1008 reproduced the s29/s30 numbers
(57.85/42.15 split, lose avg 0.418) before running on 1029.

**Run 1029 (P*0.92 neutral, the v17t k=0 reference):**

| minute | shares | avg p | win rate | ev/share |
|---|---|---|---|---|
| 0 | 272,700 | 0.432 | 0.403 | −0.0287 |
| 1 | 170,700 | 0.434 | 0.394 | −0.0408 |
| 2 | 152,600 | 0.429 | 0.389 | −0.0401 |
| 3 | 150,100 | 0.429 | 0.408 | −0.0208 |
| 4 | 168,400 | 0.442 | 0.413 | −0.0295 |
| 5 | 151,500 | 0.428 | 0.386 | −0.0417 |
| 6 | 134,500 | 0.420 | 0.393 | −0.0278 |
| 7 | 123,700 | 0.409 | 0.349 | −0.0597 |
| 8 | 119,600 | 0.414 | 0.372 | −0.0420 |
| 9 | 134,500 | 0.423 | 0.380 | −0.0430 |
| 10 | 117,300 | 0.410 | 0.373 | −0.0377 |
| 11 | 108,700 | 0.399 | 0.342 | −0.0565 |
| 12 | 17,600 | 0.264 | 0.205 | −0.0595 |
| 13 | 8,900 | 0.208 | 0.213 | +0.0058 |

Window aggregates (gross S toxicity): min 0–4 ≈ −$29.0k over 914.5k sh
(−3.17¢/sh, 50.0% of S volume); min 5–11 ≈ −$38.8k over 889.8k sh
(−4.36¢/sh, 48.6%); min 12–13 ≈ −$1.0k over 26.5k sh (1.4%). Sum −68.8k ≈
the S net −69.4k measured by the split query ✓, and post-min-5 ≈ −39.8k
matches pair-v17.md §13's independent pace-bucket attribution (−38.7k low
+ −1.1k high) ✓.

**Reading prior for k003/k006/k012 (context, not a rule change):**

- vs 1008, the late window carries MORE of the flow at this center (min
  5–11 = 48.6% of S shares vs 35.5% on 1008) and the toxicity gradient is
  gentler (late −4.36 vs early −3.17¢/sh; 1008's min-12–13 tail was
  −6.4..−9.7¢ where 1029's is −6.0/+0.6 on tiny volume). lateTighten's
  target window holds ~46% of the whole −85.9k baseline loss in GROSS
  terms — but that flow also carries ~half the pairing volume, so the net
  lever is much smaller than −39.8k; expect the ev read to be dominated by
  how much completion value the tighten sacrifices.
- Min-12–13 volume is already near-zero at P*0.92 (1.4% vs 0.77% —
  both tiny): the "stop quoting at the very end" component of lateTighten
  has almost nothing left to suppress at this center; the dose cells act
  mostly on minutes ~7–11.
