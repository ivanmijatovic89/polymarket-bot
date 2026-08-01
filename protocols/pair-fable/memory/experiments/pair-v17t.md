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

**Candidate next mechanism (recorded, NOT designed/frozen s40):**
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

## 13. E-050 READOUT (s40, 2026-08-01 ~07:50Z; drain 07:47Z)

Mapping: p88k012=1049, k028=1050, p90k020=1051, p86k012=1052.
Integrity: all rows 96 failures (the identical priceToBeat set), every
pair n=10,651; latency 140/20 recorded in cmd; commitSha f0f87f19.
M4 note: compare.ts flags the strategy-SHA change vs 1046/1047 — the
diff is the §11 schema-bounds-only edit (two zod literals); behavior at
previously-valid params is identical by code inspection, so cross-SHA
pairs are valid.

| cell | run | ev | p/100 | played | noActivity | C+D $ |
|---|---|---|---|---|---|---|
| p88k012 | 1049 | −3.83 | −5.04 | 6,172 | 4,479 | $492.9k |
| p86k012 | 1052 | **−3.17** | −5.05 | 5,343 | 5,308 | $417.6k |
| p90k020 | 1051 | −4.00 | −5.22 | 6,128 | 4,523 | $503.0k |
| k028 | 1050 | −4.23 | −5.24 | 6,339 | 4,312 | $522.2k |

**Verdicts (frozen §11 bars, B_full 0.74, paired on 10,651):**

- **P*-CONT-88:** p88k012 − 1046 = **+0.998 ± 0.170** > 0.74 — the P*
  axis continues below the old schema floor. Curve read: the second
  step p86k012 − p88k012 = +0.660 ± 0.161 is BELOW the bar (though
  ~4σ by its own SE) — per-step gains are decaying; the floor axis is
  approaching saturation, not accelerating. p86k012 − 1046 total
  +1.657 ± 0.170.
- **COMPOSE-MAX-ADD:** p90k020 − 1047 = +0.975 ± 0.165 AND p90k020 −
  1046 = +0.821 ± 0.167, both > 0.74 — P* step and k step each add at
  the other's max. Cross-read: p90k020 − p88k012 = −0.177 ± 0.164 —
  the composed corner at P*0.90 does NOT beat the deeper floor at
  k012; the P* lever is currently worth more than the k extension.
- **LIFT-CONT (marginal) + degeneracy PASS:** k028 − 1047 = **+0.744
  ± 0.161** — exactly at the bar (0.7444). Degeneracy check passes
  decisively: min-4–11 S fills 2,702 = 72.7% of k020's 3,716 (bar
  25%); min-12+ 3 fills. The ramp is still repricing, not gating. The
  k axis stays open but its marginal step is at the noise bar —
  further k extensions are low-priority vs the P* floor and the §12
  early-window mechanism.
- No C/D leak anywhere (max $522.2k ≪ $687.3k rule). Fees 7.2–11.6k.

**NEW BEST FULL: 1052 (P*0.86 k012) ev −3.17, p/100 −5.05.** Chain:
1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046 (−4.83). Two-session
arc: −8.07 → −3.17 (61% of the per-market loss removed). Running
cost: noActivity 5,308 = 50% of the universe unplayed at 1052; the
mission's absolute target still requires making the remaining flow
profitable, not only smaller.

**Decisions applied (frozen mappings + priority):** (1) the next
neutral increment is the §12 early-window mechanism (earlyTighten
design + freeze — the residual loss is 57% early-window and neither
live lever touches it; P*/k dose-grinding has decaying steps); (2) a
small composition probe (p86/p88 × k020) MAY ride along in the same
grid if fleet capacity allows, bars frozen at design time; (3) P*
floor below 0.85 and k above 0.28 stay open but unscheduled (both
at/below bar per step). Loss identity on 1052 owed at its first use
as a reference (§8 rule).

## 14. E-051 — earlyTighten: entry-window maker concession
## (FROZEN s41, 2026-08-01, BEFORE implementation/submission)

### Hypothesis and causal mechanism

The §12 anatomy on 1046 localizes 57% of residual gross S loss to
minutes 0–4 (m0 alone −$10.1k at −3.5¢/sh on 29% of S volume;
m1–m4 −2.7..−3.9¢/sh), while §10 showed the lateTighten ramp already
prices toxicity from ~minute 5 onward. Neither live lever touches the
entry window: lateTighten·frac ≈ 0 there, and P* lowers the cap
uniformly at all ages. Mechanism: demand an extra per-share concession
on maker quotes near the open, where informed flow against a fresh
book is most adverse, decaying to zero as the book matures.

**Shape decision (deviation from the §12 sketch, with reason):** §12
sketched a full-window mirror k_e·(1 − elapsed/15m). Rejected at
design: two linear terms sum to a LINE from k_e to k_l — no interior
minimum — which overcharges the measured least-toxic mid-window
(m3–6) by several cents and prices out exactly the fills that are
fine. Frozen shape instead: concession = earlyTighten · max(0, 1 −
elapsed/EARLY_MS) with EARLY_MS = 5 min, a measurement-pinned design
constant (m0–4 carry 57% of the loss; the §10 ramp covers ~m5+).
Composed total concession is then genuinely V-shaped: k_e at open → ~0
at m5 → k·frac late, matching the §12 U-shaped conditional toxicity
curve. EARLY_MS is a design constant, not a tunable (M5 discipline —
no second free knob).

### Exact code delta (pair.v17t.ts, one param + one term)

- Schema add: `earlyTighten` ∈ [0, 0.12] default 0 (max = one step of
  headroom above the largest frozen dose 0.09, M5 bound).
- In the §8.3 maker-cap computation, alongside the late term:
  `fracEarly = clamp(1 − (nowMs − (endMs − 15m))/EARLY_MS, 0, 1)`
  (0 when endMs unknown, same convention as the late term), and
  `pHat −= earlyTighten · fracEarly`. Applies ONLY to the maker
  quote cap; pLock and the doom backstop stay on base pairTarget
  (completions are ~fair — §10 identity, unchanged).
- earlyTighten = 0 ⇒ bit-identical behavior to current v17t.

### Non-equivalence (required at freeze)

1. **vs E-027 (start-minute participation gating, pair-v13.md):**
   price rule, not a participation rule — quotes stay live in m0–4 at
   a lower cap; a fill at any minute remains allowed when the
   counterparty crosses carrying the concession; participation is
   never keyed on minute. Same §10 structure. The degeneracy boundary
   is frozen below: if the dose extinguishes the early window instead
   of repricing it, the axis closes.
2. **vs P* (uniform floor):** time-shaped and entry-local vs uniform
   at all ages; P* moves played-count strongly through the projection
   cap at every minute, earlyTighten leaves mid/late quotes untouched
   by construction.
3. **vs lateTighten:** opposite slope AND disjoint support (late term
   ≈ 0 in m0–5; early term = 0 from m5) — it prices the entry-window
   term the ramp leaves unpriced by design.
4. **vs v1-family entry-discipline kills (E-018 axes):** those were
   absolute price ceilings / relative-to-bid placement on a different
   family with no VWAP projection cap; the human ruling 8758567d
   withdrew the class kill regardless. No exact-equivalence claim
   exists.

### Cells (center = best cell 1052: orderSize 100, imbalanceBand 160,
### doomUnitMax 0.99, P* 0.86, k012; FULL --to-ms 1785196800000,
### 140/20, B=500; integrity: identical 96-slug failure set, pairs on
### 10,651 common)

| # | cell | params (rest = center) | label | question |
|---|---|---|---|---|
| 1 | e03 | earlyTighten 0.03 | pf-e051-e03 | dose 1 ≈ mean m0–4 toxicity (−3¢/sh) at m0, half at m2.5 |
| 2 | e06 | earlyTighten 0.06 | pf-e051-e06 | dose 2 — mean concession over m0–5 ≈ 3¢/sh |
| 3 | e09 | earlyTighten 0.09 | pf-e051-e09 | dose 3 — locates peak/saturation in one batch |
| 4 | p86k020 | lateTighten 0.20, earlyTighten 0 | pf-e051-p86k020 | s40 decision 2 ride-along: does the k step still add at the deeper floor? |

### Frozen bars (B_full = 0.74, paired on the 10,651 common set)

- **EARLY-CONT** iff e03 − 1052 > +0.74; curve read with e06 − e03 and
  e09 − e06 alongside (decay/peak location).
- **EARLY-NULL** iff |e03 − 1052| ≤ 0.74 AND |e06 − 1052| ≤ 0.74 ⇒
  the entry-window concession does not move ev at this center; axis
  closed at this shape (a different shape needs its own freeze).
- **EARLY-OVER** iff e03 − 1052 < −0.74 ⇒ the concession is harmful
  (early fills at current caps were net-acceptable or the
  participation cost dominates); axis closed downward.
- **DEGENERATE (overrides ev on this axis, §10 precedent):** at the
  highest dose read, m0–4 S fills must remain ≥ 25% of the 1052
  (earlyTighten=0) level; below that the concession has become a
  de facto delayed start — behaviorally the E-027 object — and the
  axis closes at the largest non-degenerate dose regardless of ev.
- **K-AT-FLOOR-ADD** iff p86k020 − 1052 > +0.74 (k extension still
  adds at P* 0.86; composed corner becomes a candidate);
  **K-AT-FLOOR-REDUNDANT** iff ≤ +0.74 (levers overlap at the deeper
  floor — consistent with E-050's p90k020 cross-read).
- Watch metrics (frozen): S-minute histogram m0–4 vs 1052, noActivity
  (1052 already 5,308), C+D $ vs $687.3k, fees, per-cell anatomy.

### Decision map

EARLY-CONT ⇒ the V-shape mechanism is real; next increment composes
the winning dose with the open P*/k reads. EARLY-NULL/OVER ⇒ the
entry-window loss is not maker-cap-priceable at this center; next
mechanism from the §12 secondary candidate (quote-price-conditioned
concession) with its own freeze. DEGENERATE ⇒ record per §10 and cap
the axis. K-AT-FLOOR-ADD ⇒ p86k020-class corner joins the operating
set; REDUNDANT ⇒ k stays at 0.12 with the P* floor.

### Submit literals (whole grid up front, one per config, zsh guard)

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param earlyTighten=0.03 --to-ms 1785196800000 --label pf-e051-e03 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param earlyTighten=0.06 --to-ms 1785196800000 --label pf-e051-e06 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param earlyTighten=0.09 --to-ms 1785196800000 --label pf-e051-e09 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.20 --to-ms 1785196800000 --label pf-e051-p86k020 --detach
```

Pre-submit checklist: protocol:check PASS, smoke + activation PASS
(earlyTighten=0.06 must be ACCEPTED and trade; earlyTighten absent ⇒
behavior-identical), tree clean + pushed to origin/main, queue empty
verified, batchUid captured per submit, fleet.ts verification after.

**Submission record (s41, 07:58–08:00Z, commitSha 7e5f9276):**
e03 = pf-e051-e03-20260801T075801-31yzgb,
e06 = pf-e051-e06-20260801T075837-ep5wq3,
e09 = pf-e051-e09-20260801T075917-8asz8i,
p86k020 = pf-e051-p86k020-20260801T075955-k0szf5.
All 4 verified waiting-children at 08:00Z; workers on sha 7e5f927.
Smoke: run 1053 (protocol:check PASS, earlyTighten=0.06 accepted and
trading, 8/8 markets, 0 failures).

## 15. Loss identity + S-toxicity curve on reference 1052 (s41, owed
## per §8 at first use as reference; while E-051 drained)

**Identity (anatomy.ts, recon maxErr $0.01, 0 bad rows):** pnl
−33,743 = pairs −26,380 + residue −125 + fees −7,239. Residue is
SOLVED at this operating point: 54 markets, net −$125 (17 won +138 /
37 lost −263), median residue qty 0.56 sh. The entire loss is pair
margin + fees. Fills: S 6,658 ($246.2k) / C 6,340 ($74.7k) / D 9,128
($342.9k); doom hazard ≤0.02 every start minute except m13 (0.50 on
n=2).

**Completion regime shift (new vs 1046/k020 §10 note):** completions
are DOOM-dominant at the deep floor — C $74.7k vs D $342.9k. pLock =
P*−0.01 = 0.85 rarely triggers; most pairing arrives via the doom
backstop at unitMax 0.99. The "lock" pathway is nearly vestigial at
P*0.86 — any future pLock-side mechanism must account for this.

**S-toxicity minute curve (§6 method, share-weighted):** m0 185.3k sh
(27.8%) −3.1¢/sh −$5.7k; m1 60.3k −6.5¢ −$3.9k; m2 −2.4¢; m3 −0.7¢;
m4 −1.6¢; m5–11 between −2.8¢ and −9.1¢ (m6 worst) NET of k012;
m12+ extinct (1.2k sh). Gross S ≈ −$25.2k. **Early window m0–4 =
−$12.1k = 48% of gross S loss** (m0+m1 alone 38%) — the E-051 target
is intact at the new best cell; per-share early toxicity peaks at m1,
not m0, here. Per-start-minute EV (minuteev.ts): no positive start
region (KILL condition on start-gating unchanged); "forbid starts
before m" monotone WORSENS with m — late-only participation is not
the answer, consistent with §10.

**Phase×band addendum (s41):** on 1052 the §12 favorite-side inversion
is now LATE-only — late worst bands 0.40–0.50 (−8.1¢/sh) and ≥0.50
(−7.2¢); the early window's dollar-dominant cell is 0.30–0.40 (−4.2¢,
−$6.2k) with the favorite band only −3.4¢. If E-051 nulls and the
secondary candidate (quote-price-conditioned concession) is designed,
it should be scoped to the LATE window at this center — early it would
mis-target the measured band structure.

## 16. Late-window minute×band matrix on 1052 (s42, while E-051
## drained; calibration context only — no bars changed)

Method: §6 JSON_TABLE minute curve with a fill-price band dimension
(bands <0.30 / 0.30–0.40 / 0.40–0.50 / ≥0.50), S fills only, run 1052.
Cross-checks: band totals reproduce the s41 addendum (late 0.40–0.50
−8.13¢/sh, ≥0.50 −7.24¢); phase totals reproduce §15 (early −$12.1k =
48%, late −$13.1k of gross S ≈ −$25.2k).

**Phase×band table (shares / $ / win rate / ev¢ per sh):**

| phase | <0.30 | 0.30–0.40 | 0.40–0.50 | ≥0.50 |
|---|---|---|---|---|
| early m0–4 | 82.3k / −2.44¢ | 148.0k / −4.18¢ | 120.2k / −1.87¢ | 47.9k / −3.43¢ |
| late m5+ | 99.7k / −3.19¢ | 58.6k / −2.80¢ | 48.4k / −8.13¢ | 60.7k / −7.24¢ |

**Structural findings:**

1. **Late bands ≥0.40 carry −$8.3k of −$13.1k late loss (63%) on 41%
   of late shares** (109.1k of 267.4k). Below 0.40 the late book is
   only ~−3¢/sh — near the gross average, mostly repriceable by k.
2. **The 0.40–0.50 band's toxicity peaks at m5–6 (−14.4¢, −17.9¢/sh)
   then flattens (m7–11: +3.2 to −8.3¢)** — the OPPOSITE shape of the
   lateTighten ramp, which is smallest exactly at m5–6. ≥0.50 is
   minute-flat (−1.3 to −12.8¢, no end concentration). The late band
   term is NOT ramp-shaped: no dose of k can price it without
   overcharging the fine <0.40 flow.
3. Economics of the bad cells: ≥0.50 pays avg 0.585 for 51.2% wins;
   0.40–0.50 pays 0.443 for 36.2% wins — contested-region fills whose
   price still embeds the pre-move favorite.
4. Early-window bands confirm §15: worst dollar cell is 0.30–0.40
   (−$6.2k), per-share toxicity mild and band-flat (−1.9..−4.2¢) —
   the early term is time-shaped (E-051's premise), the late term is
   price-shaped.

**Design implication (for the §14 decision map's fallback, and as the
next open loss term under ANY E-051 outcome):** a quote-price-
conditioned concession scoped to m5+, threshold ~0.40, roughly
minute-flat — i.e. extra concession on the maker cap when the quoted
side would rest ≥0.40 in the late window. Non-equivalence sketch:
vs lateTighten (minute-shaped, band-blind — finding 2 shows the
shapes are orthogonal); vs P* (uniform floor at all ages/prices);
vs earlyTighten (disjoint support, opposite phase). Design/bars NOT
frozen here — freeze at its own session with cells and a degeneracy
tripwire (the band cap must reprice, not extinguish, late ≥0.40
participation).

## 17. P*-floor gain decomposition, 1046 → 1052 (s42, while E-051
## drained; context only — no bars changed)

Slug-joined played/inactive cross-tab (trade_count > 0 = played).
1046 (P*0.90 k012) → 1052 (P*0.86 k012), total Δpnl ≈ +$18.2k:

- **Kept flow** (4,279 mkts played in both): −$32.5k → −$25.6k =
  **+$7.0k repricing gain** (−7.60 → −5.98/mkt; trades 5.3 → 4.5).
- **Dropped flow** (2,639 mkts inactive at 1052): was −$18.9k =
  **+$18.9k avoided loss** — at −7.15/mkt, statistically the SAME
  badness as the kept flow (−7.60): the floor prunes by book price
  level, NOT by market quality.
- **Newly played at 1052** (1,064 mkts inactive at 1046): −$8.2k new
  loss at −7.68/mkt — the old unrepriced rate. Participation is NOT
  nested across P* levels: the projection cap changes the quote/fill
  path, and borderline markets churn in both directions.

Sum +7.0 + 18.9 − 8.2 = +$17.7k ≈ observed +18.2k (residual =
same-config noise, within the 21.5–38.3 paired-sd band).

**Reading:** ~72% of the P* lever's gain is participation avoidance,
only ~28% is genuine repricing, and every played segment still loses
−6.0..−7.7/mkt. The lever cannot flip played-flow economics — it can
only shrink the book toward zero (1052 already has 50% noActivity).
The absolute-profit target therefore needs repricing mechanisms
(earlyTighten E-051 in flight; §16 late band term next) rather than
further floor cuts; consistent with the §13 note that the P* curve is
decaying (p86−p88 = +0.660 sub-bar).

## 18. E-051 READOUT (s42, 2026-08-01; drain 09:09Z, rows 1054–1057)

Mapping: e03=1054, e06=1057, e09=1056, p86k020=1055 (batchUids in
§14). Integrity: common set 10,651 on all five runs, per-run extra 0,
latency 140/20 everywhere, B=500. Engine-SHA warning (f0f87f19 vs
7e5f9276) CLEARED by commit inspection: every commit between the two
SHAs touches only protocols/pair-fable/** (the earlyTighten param add
+ protocol state); engine identical, strategy behavior-identical at
earlyTighten=0 (frozen claim + smoke 1053). M4 satisfied.

**Paired deltas vs 1052 on the common set (bar B_full 0.74):**

| cell | run | ev/mkt | Δev vs 1052 | p/100 | noActivity | m0–4 S fills (deg. base 3,984) |
|---|---|---|---|---|---|---|
| 1052 ref | 1052 | −3.168 | — | −5.055 | 5,308 | 3,984 |
| e03 | 1054 | −2.888 | +0.280 | −5.122 | 5,794 | 3,037 (76.2%) |
| e06 | 1057 | −2.478 | +0.690 | −5.004 | 6,301 | 2,188 (54.9%) |
| e09 | 1056 | −2.370 | +0.799 | −5.245 | 6,649 | 1,814 (45.5%) |
| p86k020 | 1055 | −2.526 | +0.643 | −4.867 | 6,084 | 3,464 |

**Verdicts per §14 frozen bars:**

- **EARLY-NULL fires by the letter:** e03 +0.280 ≤ 0.74 AND e06
  +0.690 ≤ 0.74. EARLY-CONT (keyed on e03) does not fire.
- **Pre-registered curve read:** monotone RISING (e06−e03 +0.410,
  e09−e06 +0.109), with e09 − 1052 = +0.799 > bar at the grid edge.
  The §14 dose prior (dose 1 ≈ measured mean toxicity) was wrong —
  the ev response needs ≈3× the calibrated concession.
- **DEGENERATE tripwire PASS** at the highest dose: e09 m0–4 S fills
  45.5% of base ≥ 25% bar.
- **K-AT-FLOOR-REDUNDANT:** p86k020 − 1052 = +0.643 ≤ 0.74 — the k
  extension does not add at the deeper floor (confirms E-050's
  p90k020 cross-read). k stays 0.12.

**Gain-channel decomposition (post-readout analysis, §17 method — not
a frozen bar, labeled as such):** slug-joined played/inactive
cross-tab vs 1052:

- e06 (+$7.3k): dropped 2,311 mkts +$15.7k, new 1,318 mkts −$8.1k,
  **kept 3,032 mkts −$0.3k** — repricing channel ≈ 0.
- e09 (+$8.5k): dropped 2,552 mkts +$17.5k, new 1,211 mkts −$6.6k,
  **kept 2,791 mkts −$2.5k** — repricing channel NEGATIVE.

Every dollar of E-051's ev gain routes through participation
avoidance; the fills that survive the concession are not cheaper in
net-ev terms, and p/100 at e09 is WORSE than the reference (−5.245
vs −5.055). The within-market degeneracy tripwire passed while the
market-level channel went 100% avoidance — the tripwire policed the
wrong granularity (lesson recorded for future freezes).

**Resolution (no post-hoc bar changes):** EARLY axis CLOSED at this
shape per EARLY-NULL. The above-bar e09 does not reopen it: its gain
is an avoidance gain, a channel the (cheaper, already-measured) P*
lever provides, and avoidance cannot cross ev 0. Recorded as: the
entry-window loss is not maker-cap-priceable at this center — §14
decision map ⇒ next mechanism is the §16 quote-price-conditioned
LATE concession, with its own freeze.

**Strategic finding (binding input to future freezes):** every
ev-improving lever measured on v17t now decomposes as ≥72% (P*,
§17) or ~100% (earlyTighten, this section) participation avoidance,
and no lever has shown a materially positive repricing channel.
Avoidance levers are bounded above by ev = 0 (they can only remove
markets); the §4.1 profit target (+2) requires kept-flow Δ > 0.
Therefore every future mechanism experiment on this family must
freeze the channel decomposition (kept-flow paired Δpnl on
played-in-both markets) as a PRIMARY success bar next to ev, and an
ev gain whose kept-flow channel is ≤ 0 closes its axis regardless of
headline Δev.

**Record-keeping:** best FULL ev on record is now 1056 (e09, −2.37)
by the frozen instrument; chain 1056 (−2.37), 1057 (−2.48), 1055
(−2.53), 1054 (−2.89), 1052 (−3.17). The MECHANISM-TEST CENTER stays
1052 (P*0.86 k012, earlyTighten 0): composing new mechanisms on top
of a closed avoidance dose would entangle channels; 1056 ≡ 1052 +
e09 is reproducible at will if an avoidance operating point is ever
wanted. Standing comparison reference remains 1029.

## 19. E-052 — lateBandTighten: late-window price-conditioned maker
## concession (FROZEN s43, 2026-08-01, BEFORE implementation/submission)

### Hypothesis and causal mechanism

§16 on reference 1052: late (m5+) S fills at prices ≥ 0.40 carry −$8.3k
of the −$13.1k late gross S loss (63%) on 41% of late shares, while the
late <0.40 book is ~−3¢/sh (near the gross average). The band's
toxicity is NOT ramp-shaped (§16 finding 2: 0.40–0.50 peaks m5–6 where
the lateTighten frac is smallest; ≥0.50 is minute-flat) — no k dose can
price it without overcharging the fine flow. Mechanism: charge a flat
extra per-share concession on any maker quote that would rest at/above
0.40 from minute 5 on — reprice the contested-region flow whose price
still embeds the pre-move favorite (§16 finding 3: 0.40–0.50 pays
0.443 for 36.2% wins), leaving cheap late flow and the entire entry
window untouched.

Design constants (measurement-pinned, M5 — not tunables):
`LATE_BAND = 0.40` (band edge from the §16 matrix); the late boundary
reuses `EARLY_MS` = 5 min (§16's m5+ scope; disjoint support with the
E-051 early term by construction).

**Application-point decision (deviation from k's cap-only application,
with reason):** the concession applies to the FINAL candidate quote
price (after the bid-anchor/cap min AND the ask clamp), not to pHat
alone. The toxic object is a fill ≥ 0.40 late regardless of which
constraint produced the price; bid-anchored quotes (target = bid inside
the band) are exactly the S accumulate flow §16 measured, and a
cap-only dose would leave them unrepriced whenever pHat > bid.

### Exact code delta (pair.v17t.ts, one param + one constant + one block)

- Schema add: `lateBandTighten` ∈ [0, 0.16] default 0 (max = one step
  of headroom above the largest frozen dose 0.12, M5 bound).
- Design constant `LATE_BAND = 0.40`.
- In the §8.3 maker price computation, AFTER the ask clamp and BEFORE
  the ≥ GRID validity check:
  `if (cfg.lateBandTighten > 0 && endMs !== null && nowMs − (endMs −
  WINDOW_MS) ≥ EARLY_MS && price ≥ LATE_BAND − 1e-9) price =
  floorToGrid(price − cfg.lateBandTighten)`. A dose pushing the quote
  below 1¢ ⇒ side unquotable this tick (existing null handling).
- Maker quotes only; pLock and the doom backstop stay on base
  pairTarget (completions ~fair — §10/§15).
- lateBandTighten = 0 ⇒ bit-identical behavior to current v17t.

### Non-equivalence (required at freeze)

1. **vs lateTighten (k):** k is minute-ramp-shaped and price-blind;
   §16 finding 2 shows the band term's minute shape is OPPOSITE the
   ramp. k012 is inside the center — the band dose is measured net of
   it and prices what the ramp structurally cannot.
2. **vs P* (uniform floor):** P* acts through the projection at all
   ages and price levels; the band term is phase-scoped (m5+) and
   price-conditioned (≥0.40 only), leaving early and cheap-late quotes
   untouched by construction.
3. **vs earlyTighten (E-051):** disjoint support (m0–5 vs m5+);
   E-051 was time-shaped and price-blind, this is price-shaped and
   time-flat.
4. **vs v1-family absolute entry ceilings (E-018 axes):** those FORBADE
   buys above X at all times on a family with no VWAP projection cap;
   this REPRICES (never forbids by price alone), only late-window, on
   a projection-capped family; the class kill was withdrawn by ruling
   8758567d regardless.

### Cells (center = 1052: pairTarget 0.86, orderSize 100,
### imbalanceBand 160, doomUnitMax 0.99, lateTighten 0.12,
### earlyTighten 0; FULL --to-ms 1785196800000, 140/20, B=500;
### integrity: identical 96-slug failure set, pairs on 10,651 common)

| # | cell | params (rest = center) | label | question |
|---|---|---|---|---|
| 1 | lb04 | lateBandTighten 0.04 | pf-e052-lb04 | dose 1 ≈ measured excess band toxicity (−8.1/−7.2¢ vs ~−3¢ fine late flow ⇒ 4–5¢) |
| 2 | lb08 | lateBandTighten 0.08 | pf-e052-lb08 | dose 2 = 2× |
| 3 | lb12 | lateBandTighten 0.12 | pf-e052-lb12 | dose 3 = 3× (E-051 lesson: ev response peaked at ~3× the calibrated dose) |

### Frozen bars (paired vs 1052 on the 10,651 common set; B_full 0.74;
### §18 channel bar PRIMARY)

Freeze-time base numbers, queried this session on 1052 (known-answer
checks: S total 6,658 = §15 ✓; band shares 109.1k = §16 ✓):
late ≥0.40 S fill count **1,091**; noActivity **5,308**; flip-risk
pool (played markets whose EVERY S fill is late ≥0.40) **719**.

- **Channel bar (PRIMARY, §18):** kept-flow paired Δpnl on
  played-in-both markets (§17 method), K_bar = **+$4.0k** ≈ 2× the
  same-config channel noise scale (dup total-pnl Δ ≈ $2.2k at dup Δev
  0.21; §17 channel-sum residual ~$0.5k).
- **REPRICE-CONT** iff ∃ frozen dose with Δev > +0.74 AND kept-flow
  Δ ≥ +$4.0k ⇒ first genuine repricing lever on the family; next
  increment optimizes/composes it.
- **AVOID-CLOSE** iff some dose has Δev > +0.74 but kept-flow Δ ≤ 0 at
  EVERY above-bar dose ⇒ axis closed (§18 rule) regardless of headline
  ev.
- **AMBIG** iff the best above-bar dose has kept-flow Δ ∈ (0, +$4.0k)
  ⇒ one pre-registered confirm: duplicate that cell once; REPRICE-CONT
  iff BOTH replicates show kept-flow Δ ≥ +$2.0k vs 1052, else closed.
- **NULL** iff every dose |Δev| ≤ 0.74 AND every kept-flow Δ < +$4.0k
  ⇒ axis closed at this shape.
- **KEPT-SIGNAL** iff kept-flow Δ ≥ +$4.0k at a dose with headline
  Δev ≤ +0.74 ⇒ repricing real but offset by participation churn;
  axis stays open, next step decomposes the offsetting channel before
  any further dose.
- **OVER** iff Δev(lb04) < −0.74 ⇒ harmful; curve read alongside
  (monotonicity not assumed).
- **DEGENERATE (overrides ev; BOTH granularities per the E-051
  lesson):** at the highest dose read, (a) late ≥0.40 S fill count
  ≥ 25% of 1,091 (≥ 273) AND (b) noActivity growth vs 5,308 ≤ +360
  (50% of the structurally-at-risk 719 pool — the term cannot touch
  early quotes, so growth beyond noise can only come from that pool).
  Either failing ⇒ the term extinguishes rather than reprices; axis
  closes at the largest non-degenerate dose regardless of ev.
- Watch metrics (frozen): in-band late S fill count + avg in-band fill
  price vs 1052, noActivity, C+D $ vs $417.6k, fees, p/100, and the
  §17 3-channel decomposition (kept/dropped/new) per cell.

### Decision map

REPRICE-CONT ⇒ dose/composition increment at the operating point; the
center may move for the first time on a repricing gain. AVOID-CLOSE /
NULL / OVER ⇒ the maker-price concession family is exhausted as a
repricing channel at this center (P* ≥72% avoidance §17, earlyTighten
~100% §18, and the §16-calibrated best remaining shape failed) ⇒ next
mechanisms leave the quote-price lever family: §15 identity backlog —
doom-backstop completion price (D $342.9k at unitMax 0.99 dominates
completions) and the C/D mix, each under its own freeze with the §18
channel bar. KEPT-SIGNAL ⇒ decompose before any further dose.
DEGENERATE ⇒ record per §10 precedent and cap the axis.

### Submit literals (whole grid up front, one per config, zsh guard)

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param lateBandTighten=0.04 --to-ms 1785196800000 --label pf-e052-lb04 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param lateBandTighten=0.08 --to-ms 1785196800000 --label pf-e052-lb08 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17t --param pairTarget=0.86 --param orderSize=100 --param imbalanceBand=160 --param doomUnitMax=0.99 --param lateTighten=0.12 --param lateBandTighten=0.12 --to-ms 1785196800000 --label pf-e052-lb12 --detach
```

Pre-submit checklist: protocol:check PASS, smoke + activation PASS
(lateBandTighten=0.08 must be ACCEPTED and trade; a late in-band quote
must be observably repriced or the dose must show in fill prices;
lateBandTighten absent ⇒ behavior-identical), tree clean + pushed to
origin/main, queue empty verified, batchUid captured per submit,
fleet.ts verification after.

### §19 addendum — submission record + accidental lb04 duplicate
### (s43, 09:26–09:29Z, commitSha 94a077cd; designated BEFORE any results)

Smoke 1058 PASS (8 mkts, 0 failures). Activation A/B (local sequential,
30 latest, diagnostics NOT evidence): 1059 (lb12) vs 1060 (base) —
late S avg fill 0.337 vs 0.357, dosed late fills 0.36/0.36/0.42/0.21
(the 0.42 = pre-dose 0.54, consistent), C/D fills un-dosed as designed
(identical C fills both runs on slug …762100).

Submissions (all verified waiting-children 09:30Z, workers on 94a077c):
lb04-PRIMARY = pf-e052-lb04-20260801T092631-4q77rc,
lb04-DUP = pf-e052-lb04-20260801T092713-lc3gla (submit-output tail cut
off the batchUid line; resubmitted before checking the queue — the
first had already enqueued). **Designation, before results: 092631 is
the primary lb04 cell for ALL frozen bars; 092713 is noise-only — its
sole use is a same-config replicate measurement of kept-flow paired
Δpnl noise (validates K_bar). It is NOT a second chance at any bar.**
lb08 = pf-e052-lb08-20260801T092843-dy3e3n,
lb12 = pf-e052-lb12-20260801T092929-r0rm39.

## 20. Completion-pathway decomposition on 1052 (s43, while E-052
## drained; context only — no bars changed. Re-ranks the §15 backlog)

Method: per-market completion mix from intent_meta (S>0 markets,
5,343 = 10,651 common − 5,308 noActivity ✓; pnl sums to §15's −33,743
✓), plus D-fill price histogram and a D-leg outcome join on
final_outcome.

| mix | mkts | pnl | ev/mkt |
|---|---|---|---|
| D-only | 3,532 | −$58.8k | −16.63 |
| C-only | 1,101 | +$20.8k | **+18.87** |
| D+C mixed | 641 | +$3.3k | +5.07 |
| S-only (no completion) | 69 | +$1.0k | +14.13 |

1. **The controller is PROFITABLE on every pathway except doom.** The
   C-lock pathway (oscillating markets: both legs cheap at different
   times, pair ≤ pLock 0.85) earns +18.9/mkt on 1,101 markets. The
   entire net loss is the 3,532 doom-completed one-way markets.
2. **The D leg itself is FAIR: no completion-price headroom.** D pays
   avg 0.826/sh ($342.9k, 415.0k sh) for a side that wins 82.08%
   share-weighted → D-leg EV −$2.2k (−0.5¢/sh). Price histogram: 80%
   of D dollars at 0.80–0.85 (mechanically pinned by DOOM_BID 0.20 —
   by the time the lead bid hits 0.20 the favorite asks ~0.82); only
   $32.7k above 0.90, so a doomUnitMax cut touches ~10% of spend and
   forces holding the worst residue. An EARLIER trigger buys the
   favorite cheaper but at its own ~fair price (E-035: favorites
   exactly fair) — completion timing/price moves variance, not EV.
   **The §15 backlog item "doom-backstop completion price" is
   measured ≈ dead before design — dropped from the backlog.**
3. The doom loss is concentrated and small per market: S spend on
   D-only markets is $122.1k / 3,532 ≈ $35/mkt ≈ ONE orderSize fill
   at ~0.35 — the band (160) is not the exposure driver; the loss is
   the one overpriced start leg realized when the market never comes
   back (E-035 longshot overpricing made concrete). Mechanisms that
   reprice or refuse exactly that flow remain the only EV-positive
   attack surface; completion-side mechanics are exhausted.

## 21. Doom-hazard vs spot-disagreement anatomy on 1052 (s44, while
## E-052 drained; context only — no bars changed. New lever found)

Tool: `tools/doomhazard.ts` (new, adapted from contested.ts for v17t
pathway semantics; per-S-fill spot join on local aggTrades day files,
112 day groups, serial DuckDB scan ~3 min — not fleet-shardable, ran
foreground). Known-answer checks: §20 pathway table reproduced EXACTLY
(D-only 3,532/−58,751; C-only 1,101/+20,780; mixed 641/+3,253; S-only
69/+975); S fills 6,658 ✓ (§19 freeze base); late gross S loss
−$13,149 ✓ (§16). Fills join: 6,658/6,658 with spot+ptb (0 skipped).

### 21.1 Doom pathway is NOT (minute, price)-separable — and not
### feature-separable either

Gross S-fill EV matrix (share-weighted, win = side == final_outcome),
phase × band: the ONLY structurally toxic cells are late ≥0.40 (−8.1¢
and −7.2¢/sh — E-052's exact target, confirming §16). Every other
cell sits at −1.9 to −4.2¢/sh, ~uniform. Doom-market S dollars
concentrate 15:1 vs C-markets in p<0.30 ($28.5k vs $1.9k), but the
cheap band's own EV is only −2.4/−3.3¢/sh — cheap fills lose their
whole (small) stake in doom markets and win often enough elsewhere
that the cell is near-fair. The fill price IS the market's doom
estimate, priced ~fairly. And within every price band, doom-market
fill fraction is FLAT across spot-feature quartiles (74–78% in
p<0.30; 54–61% in 0.30–0.40). **Verdict: no quote-time rule — price,
minute, or spot feature — can isolate the doom pathway. The "refuse
the doomed start leg" framing is dead: dooms are only identifiable
ex post.** (Fill-time features overstate quote-time observability, so
this NULL kills a fortiori — same bias note as contested.ts.)

### 21.2 The NEW lever: spot-vs-book disagreement (advBps)

Definition per S fill: advBps = signed spot distance from priceToBeat
in bps, positive when spot is currently AGAINST the filled side.
FLAG = advBps ≤ 0: the book filled our bid on a side that is NOT
behind on spot — the book collapsed against the side before/without
spot confirmation (informed flow running through our resting level).

Full-run quartiles: near-monotone toxicity gradient in all 4 bands
(worst Q1: p≥0.50 −10.1¢, p<0.30 −7.6¢; best Q4: −1.3/−0.5¢).
Split-half (median market_start_ms, disjoint markets), binary FLAG at
threshold 0 — **8/8 band×half cells show FLAG worse than REST**:

| band | H1 FLAG/REST ¢/sh | H2 FLAG/REST ¢/sh |
|---|---|---|
| p<0.30 | −6.2 / −1.0 | −5.8 / −1.3 |
| 0.30–0.40 | −5.6 / −4.3 | −4.2 / −0.1 |
| 0.40–0.50 | −3.0 / −1.0 | −6.8 / −3.4 |
| p≥0.50 | −5.0 / −1.8 | −8.5 / −1.1 |

Totals at threshold 0: FLAG 3,535 fills (53%) carrying −$19.4k of the
−$25.2k gross S loss (−5.5¢/sh); REST 3,123 fills at −$5.9k (−1.9¢/sh).

Orthogonality to E-052 (the crucial check — survives in flow the late
band dose does NOT touch, both halves):
- LATE p<0.40: FLAG −7.2/−5.4¢ vs REST −1.3/−0.3¢ (H1/H2) — the flow
  §16 called "fine on average" (−3¢) splits into a toxic flagged half
  and a near-fair rest.
- EARLY p<0.40: FLAG −5.0/−4.7¢ vs REST −3.5/−1.3¢.
- EARLY ≥0.40: H1 no separation (−1.7/−1.7), H2 strong (−6.8/+3.3) —
  mixed, weakest region.
- LATE ≥0.40 (E-052's band): H1 the band's toxicity is ENTIRELY the
  flagged flow (FLAG −7.0¢ vs REST +1.0¢); H2 both toxic (−8.8/−9.8).
  Most of what E-052's price-blind dose charges is this flow.

Mechanism reading: buying the cheap side is ~fine when spot confirms
the side is losing (the price is honest); it is toxic when the book
prices a side cheap while spot says it is ahead/tied — the collapse
through our level leads the spot move. This is the family's blanket
adverse-selection cost made conditional and observable.

### 21.3 E-053 candidate design sketch (NOT a freeze — freeze in the
### implementing session, with fresh base numbers, after E-052 verdict)

`disagreeTighten`: extra maker concession (or unquotable) on any S
quote whose side is not currently behind on spot (advBps ≤ 0 at tick
evaluation, from the binanceWsSpotPrice feed + priceToBeat the
strategy ALREADY declares and uses for spotLeadBps — zero new feed
plumbing). Open design choices for the freeze: threshold (0 vs −5),
flat vs magnitude-graded dose, S-only vs all maker quotes.
Constraints for the freeze:
- compose with the E-052 verdict (if lateBandTighten survives, the
  late ≥0.40 flagged flow is double-dosed — measure net of it);
- §18 channel bar PRIMARY (kept-flow paired Δpnl) + BOTH-granularity
  degeneracy tripwires — the flag covers 53% of S fills, so
  participation-extinction risk is the dominant failure mode; dose,
  don't forbid, and consider the −5 threshold (31% of fills, −$12.1k
  gross) as the conservative first cell;
- quote-time vs fill-time bias: the measured separation is at FILL
  time; a quote conditioned per tick with 140ms latency captures only
  part of it (fast collapses hit the stale quote) — expect partial
  capture, size the bars accordingly;
- the E-046 directional closure ("pending a new conditioning lever")
  may also reopen on this feature later — but quote-side dosing comes
  first (neutral controller, priority 1).
