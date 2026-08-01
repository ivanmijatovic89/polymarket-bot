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
(readout in §7)

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

## 7. READOUT (s39, 2026-08-01 ~05:10Z; rows landed at full drain 05:02Z)

Mapping: k003=1031, k006=1032, k012=1043 (batchUids in §5 submission
record / STATUS). Integrity: all rows 96 failures, 100% priceToBeat,
identical set to 1008; every pair vs 1029 n=10,651. Bar B_full=0.74.

**Verdict: LATE-TIGHTEN-LIVE, dose-monotone to the grid edge.**

| cell | d_ev vs 1029 | se | headline ev | p/100 | played | S fills/$ | C+D $ | resid mkts |
|---|---|---|---|---|---|---|---|---|
| k003 (1031) | +0.653 | 0.206 | −7.41 | −5.74 | 8,391 | 16,126/$676.6k | $699.3k | 110 |
| k006 (1032) | +1.223 | 0.207 | −6.84 | −5.53 | 8,175 | 14,502/$608.6k | $707.2k | 105 |
| k012 (1043) | **+2.179** | 0.204 | **−5.89** | **−5.39** | 7,621 | 11,951/$491.2k | $667.2k | 92 |

(1029 reference: ev −8.07, p/100 −5.91, played 8,764, S 18,308/$772.4k,
C+D $687.3k.)

- k006 and k012 clear the bar; k003 does not. Monotone in dose with no
  interior peak — k012 sits at the GRID EDGE (schema max is 0.20).
- **Per-dollar improves too** (−5.91 → −5.39), unlike E-045's
  exposure-only gain — the first axis on record that improves p/100 at
  FULL.
- Mechanism engaged as designed: post-min-5 S share falls 48.6% →
  ~29.0% at k012 (minute hist in anatomy; early min-0 S fills RISE
  ~2.7k → 3.6k — suppressed late flow partially re-allocates early).
- **No C/D taker leak** (the E-042 anatomy failure mode): C+D spend
  $667.2k ≤ baseline $687.3k at k012 — completions MIGRATE from doom
  (D $596.7k → $478.4k) into cheap C-locks (C $90.6k → $188.7k, fills
  9,755 → 15,329). Residue ~gone (92 mkts, pnl ≈ 0). Fees up 1.0k
  (more taker C fills), absorbed by the ev gain.
- Remaining loss at k012: pnl −62.7k = pairs −49.5k + fees −13.2k.

**Cross-reads (s39, paired):** v17t k012 vs v17o k012 (1043 vs 1040) =
−0.138 ± 0.188 — statistically identical at this dose, consistent with
the near-universal deficit flag at this center (pair-v17o.md §11): the
clock ramp and the state gate converge on the same behavior at FULL.

Frozen §4 mapping applied: LIVE ⇒ iterate slope at the winner ⇒ E-049
(§8, frozen before submission).

## 8. E-049 — tighten dose extension + P*/tighten composition + max-dose
## redundancy (FROZEN s39, 2026-08-01, BEFORE submission; params-only)

No code changes this session; pair.v17t.ts / pair.v17o.ts / pair.v17.ts
untouched since their pins (git log empty over strategies/). All cells
params-only within schema bounds (lateTighten ≤ 0.20, oTighten ≤ 0.20,
pairTarget ≥ 0.90 = schema floor).

Motivating verdicts (this file §7, pair-v17o.md §12, pair-v17.md §15):
both tighten axes LIVE and dose-monotone at the 0.12 grid edge;
E-045b = P*-CONT (+1.62 at 0.90); v17t ≡ v17o at k012. Three open
questions, one cell each + one interior point:

| # | cell | strategy | params (rest = 1029 center) | label | question |
|---|---|---|---|---|---|
| 1 | k016 | pair-fable-v17t | P*.92 lateTighten .16 | pf-e049-k016 | interior point (locates a peak if k020 overshoots) |
| 2 | k020 | pair-fable-v17t | P*.92 lateTighten .20 | pf-e049-k020 | dose at schema max |
| 3 | p90k012 | pair-fable-v17t | P*.90 lateTighten .12 | pf-e049-p90k012 | do the P* level and the tighten slope compose? |
| 4 | ok020 | pair-fable-v17o | P*.92 oTighten .20 | pf-e049-ok020 | does v17t ≡ v17o survive at max dose? |

FULL universe --to-ms 1785196800000, 140/20, B=500. Integrity: the
identical 96-slug priceToBeat set; pairwise common 10,651.

**Frozen bars (B_full = 0.74, paired on common intersection).**

- **DOSE-CONT** iff k020 − 1043 > +0.74 ⇒ dose still rising at schema
  max; a lateTighten schema lift requires an E-027 identity-guard
  analysis FIRST (k→∞ approaches binary late-participation gating —
  the family boundary must be argued before extending).
- **DOSE-SAT** iff |k020 − 1043| ≤ 0.74 ⇒ dose curve saturated; pick
  operating k in [0.12, 0.20] by ev (p/100 + noActivity reported);
  dose axis closed at this center.
- **DOSE-OVER** iff k020 − 1043 < −0.74 ⇒ interior peak; k016 − 1043
  and k020 − k016 locate it.
- **COMPOSE-ADD** iff p90k012 − 1039 > +0.74 ⇒ tighten still adds on
  the 0.90 center; with E-045b's P*-CONT this makes a pairTarget-floor
  schema touch the next neutral increment. Read p90k012 − 1043
  alongside (the P* step at fixed k012). **COMPOSE-REDUNDANT** iff
  p90k012 − 1039 ≤ +0.74 AND p90k012 − 1043 ≤ +0.74 ⇒ the two levers
  overlap; center stays 0.92 and the P* axis folds into tighten.
- **REDUNDANT-AT-MAX** iff |ok020 − k020| ≤ 0.74 ⇒ carry v17t alone
  forward (simpler; no state machinery); v17o stays on file for
  grace-window variants only. **STATE-ADDS** iff ok020 − k020 > +0.74
  ⇒ iterate v17o (oRefRate / oGraceMin) next.

**Frozen mechanism metrics per cell:** anatomy (S/C/D fills+$, S
minute hist, resid count), noActivity (watch participation collapse —
k012 already 3,030/10,651), C+D $ vs the $687.3k leak rule, fees.

**Post-readout mandatory analysis (recorded now):** recompute the loss
identity on the best cell. At k012 the largest surviving loss term is
PRE-grace S toxicity (−26.6k on 736k sh at 1040) — the emerging next
frontier; neither current mechanism prices it (v17o by grace design,
v17t's ramp is ~flat early). Not designed here; needs its own
non-equivalence argument vs E-027 before any build.

**Submit literals (whole grid up front):**

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.16 --to-ms 1785196800000 --label pf-e049-k016 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.20 --to-ms 1785196800000 --label pf-e049-k020 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.90 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --to-ms 1785196800000 --label pf-e049-p90k012 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17o --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param oTighten=0.20 --to-ms 1785196800000 --label pf-e049-ok020 --detach
```

## 9. E-049 READOUT (s39, 2026-08-01 ~06:30Z; rows landed 06:22–06:23Z)

Mapping: k016=1044, k020=1047, p90k012=1046, ok020=1045. Integrity:
all rows 96 failures (100% priceToBeat, identical set); every pair
n=10,651. Bars per §8.

| cell | run | ev | p/100 | played | noActivity | d vs 1029 |
|---|---|---|---|---|---|---|
| k016 | 1044 | −5.51 | −5.48 | 7,361 | 3,290 | (+2.55 implied) |
| k020 | 1047 | −4.98 | −5.38 | 6,923 | 3,727 | +3.086 ± 0.200 |
| p90k012 | 1046 | **−4.83** | −5.33 | 6,917 | 3,733 | **+3.240 ± 0.202** |
| ok020 | 1045 | −5.00 | −5.33 | 6,776 | 3,875 | (≈ k020) |

**Verdicts (frozen §8 bars):**

- **DOSE-CONT:** k020 − 1043(k012) = **+0.907 ± 0.177** > 0.74 — dose
  still rising at the schema max. Curve: k016 − k012 +0.371, k020 −
  k016 +0.535 (mildly convex, no interior peak). Per the frozen
  mapping, a lateTighten schema lift requires the E-027 identity-guard
  analysis FIRST (at k=0.20 the cap at minute 14 is −18.7¢/sh below
  base — S fills in min 12–14 are already near-zero: 9/9,786; the
  lift analysis must argue where price-concession ends and banned
  binary gating begins).
- **COMPOSE-ADD:** p90k012 − 1039(p90) = **+1.620 ± 0.196** > 0.74 —
  the tighten adds fully on the 0.90 center. The P* step also still
  adds at full dose: p90k012 − 1043 = +1.061 ± 0.179 (E-045b's +1.620
  shrinks to +1.061 at k012 — partial overlap, both levers remain
  independently live). ⇒ a pairTarget schema-floor touch is the next
  neutral increment.
- **REDUNDANT-AT-MAX:** ok020 − k020 = **−0.024 ± 0.177** — the state
  gate duplicates the clock ramp at max dose too. **v17t is the sole
  carrier of the tighten axis; v17o iteration is dropped** (v17o
  remains on file; any revival needs a new reason, e.g. a center where
  the deficit flag is NOT near-universal).

Mechanism (1047/1046 anatomy): no C/D leak (k020 C+D $588.0k, p90k012
$573.5k, rule $687.3k); doom→lock migration continues (k020 C 13,549
fills vs D 11,135); S volume roughly halves again vs k012 (9.8k fills /
$390k vs 12.0k/$491k); residue eliminated (73/69 mkts, pnl ≈ 0);
min-12+ S fills ≈ extinct at k020 (9 fills). Loss identity on the best
cell 1046: pairs −40.7k + fees −10.7k = pnl −51.4k. noActivity 3,733
(35% of universe unplayed — participation shrink is the price of every
gain so far; the absolute-profit mission target needs the REMAINING
flow made profitable, not just smaller).

**Decisions applied:** next increments in priority order — (1) E-027
identity-guard analysis for lateTighten > 0.20; (2) pairTarget
schema-floor touch (both are pair.v17t.ts schema edits — pins released
at drain 06:26Z; protocol:check + smoke + activation per new-code
rule); (3) mandatory loss-identity/next-frontier analysis on 1046
(pre-grace S toxicity — needs non-equivalence vs E-027 before any
build). s40 does the five-session audit FIRST (mission §7.2).

## 10. E-027 identity-guard analysis for lateTighten > 0.20 (s40, 2026-08-01)

Required by the frozen §8 DOSE-CONT mapping before any schema lift.
Question: at what dose does the continuous price concession become
behaviorally equivalent to the killed binary participation gate, and is
a k=0.28 test legitimate?

**What E-027 killed (pair-v13.md):** start-minute participation gating
on the v1 family — "restrict STARTS to minute region M" — because
per-start-minute EV had no positive region to select. Its object is a
selection rule keyed on minute alone, prices untouched, scope
v1/pinned-800/gates {0.95, 0.98}.

**What lateTighten is:** a price rule. The maker quote cap is lowered
by k·(m/15) $/sh; a fill at ANY minute remains allowed when the
counterparty crosses to a price carrying that concession, and every
fill that does occur is better-priced by construction. Participation is
never keyed on minute.

**Non-equivalence at the doses tested so far (behavioral, not
intent-based):**

1. Different object: E-027 gates first-S starts; lateTighten reprices
   every maker quote (S and repair) continuously.
2. Different gain signature: if the k gains were pure late-participation
   subtraction, p/100 would stay ~flat (E-045's exposure-only pattern).
   Instead p/100 improves monotonically (−5.91 → −5.38 at k020) and the
   anatomy shows REPRICING structure: doom→lock migration (k020 C
   13,549 fills vs D 11,135; 1029 was C 9,755 / D dominant), C+D spend
   falling, residue eliminated. That structure cannot be produced by a
   start-minute filter.
3. Different evidence base: E-027's kill is family-scoped (v1) and its
   universe/center differ; the tighten axis has its own FULL-universe
   dose-monotone evidence (E-047/E-049) — precisely the "new evidence"
   that mission §3 says reopens nothing by default but here supports a
   genuinely different mechanism.

**Where the equivalence boundary actually lies:** at k=0.20 the
concession is −6.7¢ (m5) / −10.7¢ (m8) / −14.7¢ (m11) / −18.7¢ (m14)
vs measured conditional toxicity ≈ −4.4¢/sh (min 5–11) — the cap is
already past mean toxicity everywhere from ~minute 5, and min-12+ S
fills are extinct (9/9,786 at k020). Raising k further can only act on
minutes ~4–11. If a lift's entire effect is driving min-4–11 fills to
≈ zero, the ramp has degenerated into a binary late-window no-quote —
at that point it IS behaviorally a minute-keyed participation cut and
further lifts are illegitimate without a new mechanism argument.

**Ruling: k=0.28 test is LEGITIMATE, with a frozen degeneracy check.**
Schema lift bounded to max 0.32 (one step of headroom, M5 discipline —
no unbounded knob). Integrity metric frozen in §11: at k028, S fills
in minutes 4–11 must remain ≥ 25% of the k020 level, else verdict
**DEGENERATE** — the k axis closes at ≤ 0.28 by ev regardless of the
ev delta, and any further late-window work must be a new mechanism
with its own non-equivalence argument.

## 11. E-050 — P* floor dose, P*×k composition at max dose, k lift
## (FROZEN s40, 2026-08-01, BEFORE submission)

Code delta: schema-bounds-only edit to pair.v17t.ts — pairTarget
`.min(0.9)` → `.min(0.85)`, lateTighten `.max(0.2)` → `.max(0.32)`.
No logic touched; for every previously-valid param vector the strategy
is behaviorally identical (M4 note: cross-SHA comparisons vs 1043/1046/
1047 remain valid by that code-identity argument; git diff is the
evidence). New-code rule applies anyway: protocol:check + local
`--sequential` smoke + schema-activation check (pairTarget=0.88 and
lateTighten=0.28 must now be ACCEPTED and trade; both were schema
rejections before).

Open questions from §9, one cell each (center = 1029 center: orderSize
100, imbalanceBand 160, doomUnitMax 0.99; FULL universe --to-ms
1785196800000, 140/20, B=500; integrity: the identical 96-slug
priceToBeat failure set, pairs on 10,651 common):

| # | cell | params (rest = center) | label | question |
|---|---|---|---|---|
| 1 | p88k012 | P*.88 k.12 | pf-e050-p88k012 | P* dose below the old floor, at the 1046 operating k |
| 2 | p86k012 | P*.86 k.12 | pf-e050-p86k012 | second dose point (locates saturation/peak) |
| 3 | p90k020 | P*.90 k.20 | pf-e050-p90k020 | do the P* floor step and max tighten compose? |
| 4 | k028 | P*.92 k.28 | pf-e050-k028 | dose beyond the old schema max (guarded by §10) |

**Frozen bars (B_full = 0.74, paired on common intersection):**

- **P*-CONT-88** iff p88k012 − 1046 > +0.74 (curve read with p86k012 −
  p88k012 alongside). **P*-SAT** iff |p88k012 − 1046| ≤ 0.74 AND
  |p86k012 − 1046| ≤ 0.74 ⇒ P* axis closed at k012, operating floor
  0.90. **P*-OVER** iff p88k012 − 1046 < −0.74 ⇒ interior peak at
  0.90 (p86 confirms direction).
- **COMPOSE-MAX-ADD** iff p90k020 − 1047 > +0.74 (P* step still adds
  at max k); read p90k020 − 1046 alongside (the k step at P* 0.90).
  Both > bar ⇒ best-cell candidate is the composed corner.
  **COMPOSE-MAX-REDUNDANT** iff p90k020 − 1047 ≤ +0.74 AND p90k020 −
  1046 ≤ +0.74 ⇒ the levers overlap at max dose; operating point picked
  among existing cells by ev.
- **LIFT-CONT** iff k028 − 1047 > +0.74 AND the §10 degeneracy check
  passes (min-4–11 S fills at k028 ≥ 25% of k020's) ⇒ one further step
  may be frozen later. **LIFT-SAT** iff |k028 − 1047| ≤ 0.74 ⇒ k axis
  closed at this center, operating k ∈ [0.12, 0.20] by ev. **LIFT-OVER**
  iff k028 − 1047 < −0.74 ⇒ interior peak in [0.12, 0.28].
  **DEGENERATE** (overrides ev on the lift axis): min-4–11 S fills at
  k028 < 25% of k020 level ⇒ k axis closed at ≤ 0.28 regardless of ev;
  record per §10.
- Watch metrics per cell (frozen): anatomy (S/C/D fills+$, S minute
  hist), noActivity (participation collapse — 1046 already 3,733/
  10,651), C+D $ vs the $687.3k leak rule, fees, resid-mkt count.

**Submit literals (whole grid up front, one per config, zsh guard):**

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.88 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --to-ms 1785196800000 --label pf-e050-p88k012 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --to-ms 1785196800000 --label pf-e050-p86k012 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.90 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.20 --to-ms 1785196800000 --label pf-e050-p90k020 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.92 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.28 --to-ms 1785196800000 --label pf-e050-k028 --detach
```

Pre-submit checklist: protocol:check PASS, smoke + activation PASS,
tree clean + pushed to origin/main, no v17t jobs queued elsewhere
(queue verified empty at s39 close), batchUid captured per submit,
fleet.ts verification after.

**Submission record (s40, 06:35–06:38Z, commitSha f0f87f19):**
p88k012 = pf-e050-p88k012-20260801T063559-1o7z86,
p86k012 = pf-e050-p86k012-20260801T063640-4ipedk,
p90k020 = pf-e050-p90k020-20260801T063726-dae5h7,
k028 = pf-e050-k028-20260801T063816-3skass. All 4 verified
waiting-children on the fleet at 06:39Z; workers on sha f0f87f1.

## 12. Residual S-toxicity anatomy on best cell 1046 (s40, analysis
## while E-050 drained; mandatory per §8)

Method: §6 minute curve + a phase×price-band cut (JSON_TABLE over
intent_meta, S fills only, BINARY side=outcome compare). Gross S
toxicity on 1046 ≈ −$31.8k (vs pnl identity pairs −40.7k + fees
−10.7k; R/C/D flows carry the difference between the two
decompositions).

**Minute curve (share-weighted ev/sh):** m0 −3.5¢ on 286.3k sh (29% of
all S volume, −$10.1k — the single largest cell); m1–m4 −2.7..−3.9¢
(m3 +1.2¢, noise-scale); m5–m11 −1.5..−5.9¢ NET of the k012 concession
(−$14.1k, −4.0¢/sh avg); m12–13 tiny and positive (fills that paid the
full ramp are no longer toxic). Early window (m0–4) now carries ~57%
of the residual gross S loss (−$18.1k of −$31.8k) — the frontier
moved to the FRONT of the window, as §8 predicted.

**Phase × band cut:** toxicity is NOT longshot-concentrated. The
favorite-side band (fill p ≥ 0.50) is the WORST per share in both
phases (early −4.0¢, late −6.2¢); the 0.30–0.40 band is mildest early
(−1.65¢). Conditioned on being FILLED, our maker flow inverts the
E-035 unconditional market fact (longshots overpriced, favorites
fair): adverse selection is strongest where we bid high. Mid-window
minutes 3–6 are the least toxic cells ⇒ the residual conditional
toxicity curve is U-SHAPED in time.

**Candidate next mechanism (recorded, NOT designed/frozen here):**
`earlyTighten` — a decaying concession k_e·(1 − elapsed/15m) on the
maker quote cap, the time-mirror of lateTighten, composing to a
V-shaped total concession with minimum mid-window, matching the
measured curve. Non-equivalence sketch (to be argued properly at
design freeze): vs E-027 — price rule, never keys participation on
minute (same §10 argument); vs P* — time-shaped, not uniform; vs
lateTighten — opposite slope, targets the now-dominant entry-window
term that the ramp leaves unpriced by design. Secondary candidate:
quote-price-conditioned concession (extra concession on high-priced
quotes), motivated by the favorite-side inversion above; needs care —
it interacts with the projection cap differently per side. Decide
between them AFTER the E-050 read (if P*-CONT continues, the uniform
level may absorb part of the early term first).
