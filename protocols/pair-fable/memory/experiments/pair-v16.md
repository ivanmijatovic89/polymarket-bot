# pair-v16 — directional two-sided inventory controller (E-038)

Mission priority 2 (binding order, missions/02-research.md): the
DIRECTIONAL version of the SAME neutral controller, entered after the
neutral controller was declared understood on every measured axis
(pair-v15.md §15.4 axis scoreboard, session 22). Pre-registered as
E-038 in STATUS at s22 close. Design frozen BEFORE code (M2).

## 1. Relationship to v15 (exact delta; no other machinery changes)

pair-v15.md §5 already designed this variant conceptually: "the SAME
controller with I* ≠ 0 … every rule reads I − I*". v16 implements it:

- Signed per-market inventory target: `T_s = +τ` for the LEADER side,
  `−τ` for the laggard, `0` when no leader is declared. Signed error
  `e_s = (qty_s − qty_o) − T_s` replaces raw surplus in the band
  guard, the graded lag pricing deficit, the leadStop rule, and the
  FOK completion amount.
- Leader signal (candidate (a), cheapest, zero new plumbing): side
  with `bestBid_s ≥ bestBid_o + leadGap`, re-evaluated every tick; no
  leader ⇒ τ(t) = 0 (neutral behavior). No hysteresis in v16.0 — the
  band bounds flip-churn, and the bridge cell measures the cost.
- **τ = 0 reduces v16 EXACTLY to v15.4** (T_s ≡ 0 ⇒ identical
  formulas). Bridge cell #0 verifies this against run 970.

Deliberate deviations from the pure `I − I*` substitution (both are
the CONSERVATIVE direction; documented here per the freeze
discipline):

1. **VWAP ceiling stays RAW** (§8.3-3 unchanged): projected deficit
   `D = max(0, Qs2 − qty_o)` still prices tilt shares as
   completable pairs at the opponent's cost. Pricing unpaired tilt
   shares as if they must be paired keeps the ≤ P* guarantee
   conservative.
2. **Capital reservation stays RAW** (§8.3-5 unchanged): reserves
   completion capital for the full raw surplus even when the target
   says part of it will ride unpaired. Conservative on capital.

Everything else — pricing grid, ceiling math, cooldowns, TTL, FOK
lock rule threshold, doom backstop trigger, end-of-window cancels —
is byte-identical to v15.4 (strategies/pair.v15.ts at 24780bf).

## 2. Non-equivalence vs prior kills (binding kill-standard check)

- **E-035 (ask-side WHEN/tilt REJECT)** killed one-shot ask-side
  REGION ENTRIES: unconditional taker value of buying the favorite at
  ask in a price×time region. v16's tilt is a different object on all
  three axes: (i) it fills at MAKER prices ($0 fee, bid side,
  worst-queue), where E-035 measured nothing; (ii) it is the residue
  of band-asymmetric CONTINUOUS accumulation (path-dependent), not a
  point entry; (iii) the estimand is the marginal value of shifting
  the completion/band target inside a hedged controller, not the
  unconditional value of a naked entry. E-035 remains binding where
  it applies: any v16 iteration that degenerates into taker-buying
  the favorite at ask re-enters E-035's kill.
- **E-018 worst-queue adverse selection** (≈ −0.06/share unpaired at
  maker) is the honest NEGATIVE prior for +τ (leader tilt held as
  unpaired maker inventory). Named here; the dose–response measures
  the net against the doom-premium savings.
- **E-031/E-031b** (completion beats holding a doomed lead) is the
  negative prior for −τ (laggard tilt = deliberately under-complete).
  Also named; cell #4 measures it anyway because the tilt changes the
  ACCUMULATION path, not just the final completion decision.

## 3. Amendment to pair-v15.md §5's calibration-first decision rule

§5 required the tilt signal to first show ≥ 2 SE unconditional value
in an E-028-style calibration readout. That rule is unsatisfiable as
written: E-035 measured exactly that space (ask-side unconditional
value) and found NO positive region anywhere — under a literal
reading, no directional variant could ever be tested, contradicting
the later binding mission text (priority 2: "directional version …
using a measured, risk-bounded non-zero inventory target"). The
maker-side, path-dependent tilt value has no offline calibration
equal — the tilt fills at controller maker prices along the
controller's own inventory path. The controller dose–response IS the
measurement; risk is bounded by |τ| ≤ I_b, the unchanged VWAP
ceiling, raw capital reservation, and capPerMarket. Recorded here as
a written amendment BEFORE any E-038 submission.

## 4. v16.0 spec (delta over v15.4 §8.3/§8.4)

New tunables (schema; 10 total after the v15.4 promotions — growth
justified: 2 params ARE the directional axis):

- `tiltShares` (τ): signed, |τ| ≤ 800. `+` = target surplus on the
  book-implied LEADER; `−` = target surplus on the laggard; `0` =
  neutral (exact v15.4). Refine: |τ| ≤ imbalanceBand (the target must
  be reachable inside the band).
- `leadGap`: min bestBid gap to declare a leader, [0.01, 0.5],
  default 0.10. No leader ⇒ T_s = 0 this tick.

Rule substitutions (per side s, opponent o, each tick):

1. Band guard: quote s iff `e_s + q ≤ (leadStop ? 0 : I_b)` where
   `e_s = (qty_s − qty_o) − T_s`. From T−180s only error-reducing
   buys (tilt is HELD through the end — the target is the point).
2. Graded lag pricing: `ι = max(0, −e_s) / I_b` (side behind its
   TARGET improves its quote; with lagAggr = 0 the knee stays at
   ι = 1 as in v15).
3. FOK completion (lock rule AND doom backstop): completion amount
   `x = min(max(0, (qty_o − qty_s) + T_s), askSize)` — complete side
   s toward its target, not toward raw match. Lock threshold, doom
   trigger, cooldowns unchanged.
4. VWAP ceiling + capital reservation: RAW (deviations 1–2 above).

## 5. E-038 grid (FROZEN; pinned 800 `--latest 800 --to-ms
## 1784762100000`, launcher-pinned 140/20, one batch, label pf-e038)

Center config = run 970's: q = 100, I_b = 160, B = 500, P* = 0.96,
γ = 0, doomUnitMax = 0.99, cool 5, ttl 90. leadGap 0.10 except #5.

| # | τ | leadGap | vs (named pair) | question |
|---|---|---|---|---|
| 0 | 0 | 0.10 | run 970 | SHA/code bridge — v16 at τ=0 must be behavior-neutral |
| 1 | +40 | 0.10 | #0 | leader tilt, ¼ band |
| 2 | +80 | 0.10 | #0 | leader tilt, ½ band (dose) |
| 3 | +160 | 0.10 | #2 | leader tilt, full band (dose extreme; laggard quotes only in deficit ≥ 60) |
| 4 | −80 | 0.10 | #0 | laggard tilt — sign question answered empirically |
| 5 | +80 | 0.20 | #2 | stronger leader threshold at the same τ |

Schema check per cell: |τ| 0/40/80/160 ≤ I_b 160 ✓; leadGap 0.10/0.20
∈ [0.01, 0.5] ✓; all v15 params at bridged values ✓; q 100 ≤ I_b ✓.
Engine check: no new order types/expiries — GTD ttl 90 ≥ 61 ✓, FOK
unchanged ✓.

Frozen readouts: §3 metrics (pair-v15.md) 1–8; per-mode fills
S/R/C/D; per-$100 and ev/mkt vs named pairs; matched M mean; final
NET residual (mean |qty_UP − qty_DOWN| at settle and its win-side
fraction — the tilt's realized direction); invested; tail min/p5;
guard-7 depth optimism named on every claim.

Frozen verdict bars (per-$100 governs, bar 0.54 = v15 noise floor
0.15 × 3.6, same as E-036/E-037; ev bar 0.30 secondary):

- **BRIDGE-STOP**: |#0 − 970| per-$100 > 0.54 ⇒ v16 code is not
  behavior-neutral at τ = 0 — halt the readout, diagnose before any
  tilt conclusion.
- **TILT-LIVE** iff some τ ≠ 0 cell beats #0 per-$100 by > 0.54 ⇒
  the directional axis is live: iterate (finer τ around the winner,
  hysteresis, signal (b) spot-vs-priceToBeat).
- **TILT-DEAD** iff every cell is within ±0.54 of #0 ⇒ the
  book-leader tilt neither helps nor hurts at these doses — the
  signal carries no marginal value inside the controller; move to
  signal (b) or record the directional axis answered-flat for
  signal (a).
- **TILT-HARMFUL** iff cells degrade monotonically in |τ| beyond
  0.54 ⇒ directional exposure at this signal is negatively priced
  (adverse selection dominates); record the dose curve, close
  signal (a), tighten priors for signal (b).

Deviations require a written amendment here BEFORE the affected
submission.
