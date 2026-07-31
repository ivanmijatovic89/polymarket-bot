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

## 6. E-038 readout (runs 978–983, 2026-07-31; verdict TILT-LIVE)

All 6 cells completed, 0 failures, pinned 800 @ 140/20, SHA ceae123.

| cell | run | τ | gap | ev/mkt | p/100 | win% | pairsPnl | residuePnl | resid win-side |
|---|---|---|---|---|---|---|---|---|---|
| v15.4 | 970 | – | – | −11.77 | −5.56 | 27.9 | | | |
| c0 | 978 | 0 | .10 | −12.30 | −5.77 | 28.3 | −8,369 | +45 | (24 mkts only) |
| c1 | 979 | +40 | .10 | −12.53 | −4.94 | 38.0 | −16,026 | +7,880 | 671/705 = 95.2% |
| c2 | 980 | +80 | .10 | −11.98 | −4.06 | 50.0 | −19,256 | +11,693 | 645/704 = 91.6% |
| c3 | 981 | +160 | .10 | −12.54 | −3.58 | 58.4 | −25,021 | +17,480 | 616/704 = 87.5% |
| c4 | 982 | −80 | .10 | −16.54 | −7.16 | 15.9 | +8,327 | −18,653 | 56/683 = 8.2% |
| c5 | 983 | +80 | .20 | −13.08 | −4.52 | 43.1 | | | |

- **BRIDGE PASS**: |c0 − 970| p/100 = 0.21 ≤ 0.54. Caveat, recorded:
  ev Δ = −0.53 exceeds the SECONDARY ev bar 0.30. τ = 0 code paths
  are formula-identical to v15.4 (T ≡ 0), trades 5,460 vs 5,485,
  maker/taker split near-identical — attributed to latency-jitter
  non-determinism (the sim is not bit-deterministic); the governing
  per-$100 bar passes. Future v16 comparisons use c0 = run 978.
- **TILT-LIVE**: c1 +0.83, c2 +1.71, c3 +2.19 per-$100 vs c0 — all
  > 0.54, monotone in +τ up to the full band. c4 (anti-leader) is
  the control: −1.39 p/100 and −4.24 ev vs c0 — sign confirmed
  empirically. c5: leadGap 0.20 at τ +80 is mildly worse than 0.10
  (−0.46 p/100 vs c2, inside noise) — 0.10 stays.
- **Honest decomposition (the finding that matters):** absolute ev is
  FLAT across +τ (−12.30/−12.53/−11.98/−12.54) — the per-$100 gain is
  largely the same neutral-controller loss diluted over more invested
  capital (170k → 280k). Marginal pairs-pnl cost per marginal residue
  dollar ≈ 0.95–1.0 at every dose (e.g. c3 vs c0: pairs −16.7k,
  residue +17.4k). Anatomy: S-fill counts are FLAT across cells
  (~2.4–2.6k) while D-mode FOK fills grow 1,478 → 3,090 → 3,788
  ($51k → $118k → $156k) — the tilt is acquired almost entirely via
  doom-backstop TAKER buys of the leader at ask ≈ 0.90+, which is
  FAIR-PRICED for its ~90% win-side accuracy. The signal has real
  information (c4's asymmetric collapse proves it), but the current
  acquisition path pays the full price for it.
- Median market at c3 is now POSITIVE (+2.79 p/100); the mean is
  dragged by the leader-flip tail (p10 −25.3, residue-lost mkts
  −$57 avg — chasing a flipping leader buys both sides high).
- Guard-7 applies: all D/C fills whole-size at ToB; depth optimism
  unquantified at q = 100.

Conclusion: directional axis LIVE on per-$100; the ev-neutral
decomposition points the next increment at the ACQUISITION PRICE of
the tilt, not the dose. E-039 frozen below.

## 7. E-039 (v16.1): tilt acquisition-price ceiling + leader
## persistence (FROZEN before code, M2)

**Hypothesis.** E-038's marginal directional ev ≈ 0 because tilt
shares are acquired predominantly via D-mode FOK at ask ≈ 0.90+,
fair-priced for their accuracy. Bounding the unit price at which the
TILT COMPONENT of FOK completions may execute (and/or requiring the
leader to persist before tilting) shifts acquisition to cheaper
prices/earlier leads, where price-conditional accuracy can exceed
price + fee — converting the tilt into positive marginal ev. The
leader-flip tail (median +2.79 vs p10 −25.3 at c3) is the second
target: persistence suppresses flip-chasing.

**v16.1 params (delta over v16.0; defaults = exact v16.0):**

- `tiltUnitMax` ∈ [0.5, 1], default 1 (= off): the FOK completion
  amount includes the tilt component `T_s` only when
  `ask + fee ≤ tiltUnitMax`; the raw match component
  `qty_o − qty_s` is NEVER gated (v15 doom/lock semantics preserved
  exactly). Maker-side tilt (band guard / lag pricing) is not gated —
  maker buys sit at bid and are the cheap path by construction.
- `leadPersistTicks` int ∈ [0, 200], default 0 (= off): T ≠ 0 only
  after the SAME side has been the ≥ leadGap leader for this many
  consecutive ticks; any flip or no-leader tick resets the streak.

**Metric amendment (recorded BEFORE submission):** ev/mkt (bar 0.30,
vs named pair) GOVERNS E-039; per-$100 is secondary and reported.
Reason: E-038 proved per-$100 moves with the invested denominator
(growth diluted losses); a ceiling shrinks invested, biasing per-$100
the opposite way. Absolute ev is the mission target and is
denominator-free.

**Grid (center = c3: τ +160, gap 0.10, q100 I160 B500 P*.96 γ0
doom.99 cool5 ttl90; pinned 800 @ 140/20; label pf-e039):**

| # | tiltUnitMax | persist | vs | question |
|---|---|---|---|---|
| d0 | 1.00 | 0 | run 981 | v16.1 code bridge (defaults ≡ v16.0) |
| d1 | 0.90 | 0 | d0 | exclude only the most expensive chases |
| d2 | 0.80 | 0 | d0 | dose |
| d3 | 0.70 | 0 | d0 | dose extreme |
| d4 | 1.00 | 20 | d0 | persistence alone (flip-tail suppression) |
| d5 | 0.80 | 20 | d2/d4 | interaction |

Schema check: tiltUnitMax 1/.9/.8/.7 ∈ [0.5,1] ✓; persist 0/20 ∈
[0,200] ✓; center params all bridged ✓. Engine check: no new order
types; FOK sizing only shrinks ✓.

Frozen readouts: §6 table columns + D-fill count/$ + invested +
residue win-side fraction per cell.

Frozen verdict bars (ev governs, bar 0.30; p/100 bridge bar 0.54):

- **BRIDGE-STOP**: |d0 − 981| p/100 > 0.54.
- **CEIL-LIVE** iff some d1–d5 beats d0 ev by > 0.30 ⇒ iterate
  around the winner (finer ceiling, persistence dose, ceiling on
  maker tilt too).
- **CEIL-DEAD** iff all within ±0.30 ev of d0 ⇒ acquisition price is
  not the binding cost at these doses; next lever is signal (b)
  spot-vs-priceToBeat or maker-only tilt.
- **CEIL-HARMFUL** iff ev degrades monotonically as the ceiling
  drops ⇒ the tilt's value lives precisely in the late expensive
  completions (accuracy premium dominates price); record, close the
  ceiling lever, pivot to signal (b).

Interpretive note recorded AFTER submission, BEFORE readout (not a
grid deviation): the engine tick rate is ~138/s (623,627 events / 5
markets / 900 s, smoke 984), so persist = 20 ticks ≈ 0.15 s — d4/d5
measure FLICKER suppression (single-tick leader flaps), not
minutes-scale persistence. If d4 ≡ d0, the verdict is "flicker
margin ≈ 0", NOT "persistence dead"; a real persistence dose needs
~10³–10⁴ ticks. Also: c3's D fills are spread across ALL minutes
(anatomy 981: 79/182/330/…/278 per minute), so tiltUnitMax filters
by leader PRICE level, not by time — the cells measure
price-conditional accuracy as intended.

Deviations require a written amendment here BEFORE the affected
submission.

## 8. E-039 readout (runs 986–991, 2026-07-31; verdict CEIL-LIVE)

All 6 cells completed, 0 failures, pinned 800 @ 140/20, SHA 9f3e9cd.
Read across sessions 24 (d0/d1) and 25 (d2–d5).

| cell | run | ceil | persist | ev/mkt | p/100 | win% | med p/100 | pairsPnl | residuePnl | resid win-side | D fills / $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d0 | 987 | 1.00 | 0 | −12.74 | −3.63 | 61.4 | +3.56 | −24,896 | +17,149 | 616/705 = 87.4% | 3,817 / $155.6k |
| d1 | 986 | 0.90 | 0 | −10.83 | −3.16 | 60.8 | +3.85 | −23,539 | +17,289 | 615/700 = 87.9% | 3,534 / $142.2k |
| d2 | 988 | 0.80 | 0 | −10.58 | −4.65 | 44.9 | −7.70 | −11,390 | +4,146 | 195/233 = 83.7% | 1,097 / $34.9k |
| d3 | 989 | 0.70 | 0 | −10.53 | −4.88 | 44.6 | −8.57 | −11,953 | +4,648 | 177/201 = 88.1% | 1,030 / $34.8k |
| d4 | 990 | 1.00 | 20 | −11.37 | −3.20 | 59.4 | +3.05 | −21,074 | +14,423 | 595/677 = 87.9% | 3,808 / $156.0k |
| d5 | 991 | 0.80 | 20 | −12.27 | −5.47 | 43.1 | −9.29 | −11,330 | +2,782 | 141/180 = 78.3% | 1,145 / $37.1k |

Δev vs d0 (common 800, compare.ts): d1 +1.91, d2 +2.16, d3 +2.20,
d4 +1.37, d5 +0.47.

- **BRIDGE PASS** (read s24): |d0 − 981| p/100 = 0.05 ≤ 0.54; ev
  Δ −0.20 within 0.30. v16.1 defaults ≡ v16.0.
- **CEIL-LIVE** (governing ev bar 0.30): every cell beats d0 by
  > 0.30. **Winner: d1 (ceiling 0.90).** The dose SATURATES at 0.90:
  0.90→0.80 adds +0.25 (< bar), 0.80→0.70 adds +0.05. d1 keeps the
  whole residue program (700 resid mkts, D-spend −9% vs d0) — the
  +1.91 ev comes from removing ONLY the >0.90 chases. On secondary
  metrics d1 dominates the tighter cells outright: p/100 −3.16
  (family best on record), win% 60.8 vs 44.9, median +3.85 vs −7.70.
- **Structural confirmation of the E-038 decomposition, from the
  removal side:** below ceiling 0.90 the tilt program collapses
  (resid mkts 700→233, D-spend $142k→$35k, residuePnl +17.3k→+4.1k)
  yet ev barely moves — the 0.80–0.90 D completions were ~fair-priced
  for their accuracy, exactly as E-038 inferred. The >0.90 slice was
  the only outright-toxic slice.
- **Persistence (flicker scale):** d4 vs d0 = +1.37 > bar —
  suppressing single-tick leader flaps (~0.15 s) has real value when
  expensive chases exist. Interaction is NEGATIVE at a tight ceiling:
  d5 is −1.69 vs d2 and −0.90 vs d4 — with the >0.80 completions
  already blocked, the persist filter only delays/kills the remaining
  cheap tilt (resid mkts 233→180). Flicker persist at the WINNER
  ceiling 0.90 is untested (d5's confound); real-dose persistence
  (10³–10⁴ ticks, §7 note) untested — schema bound was 200.
- Guard-7 carried: all D/C fills whole-size at ToB; depth optimism
  unquantified at q = 100.

Best absolute state after E-039: d1 ev −10.83 at B = 500
(p/100 −3.16, up from neutral best −5.19); still far below the ≥ +2
mission bar. The lever ladder continues: fine ceiling + persistence
at the winner ceiling ⇒ E-040.

## 9. E-040 (v16.2): fine ceiling dose + persistence at the winner
## ceiling (FROZEN before code, M2)

**Hypothesis.** (a) E-039's ceiling step 1.00→0.90 is coarse; if the
toxic slice is concentrated above 0.95, ceiling 0.95 keeps more
fair-priced accurate completions and beats 0.90. (b) Leader
persistence adds ev when it can veto expensive flip-chasing (d4), and
harms when it vetoes cheap tilt (d5 at ceil 0.80); at the winner
ceiling 0.90 the flicker dose is untested and the real dose
(~10 s of sustained leadership — genuinely different information
than a 0.15-s flap filter) has never been reachable (schema cap
200 ticks). A leader that has held ≥ leadGap for ~10 s should have
higher win-side accuracy at the SAME acquisition price, making the
gated completions positive-ev rather than fair.

**v16.2 delta (schema-only; no behavior change at old param
values):** `leadPersistTicks` max 200 → 20000. Defaults unchanged
(persist 0 = off). Tick-rate caveat FROZEN: persist is in ticks
(~138/s measured on active markets, §7 note) — wall-clock varies
with market activity; 1400 ticks ≈ 10 s at the measured rate.

**Grid (center = d1: τ +160, gap .10, q100 I160 B500 P*.96 γ0
doom.99 cool5 ttl90, ceil .90; pinned 800 @ 140/20; label pf-e040):**

| # | tiltUnitMax | persist | vs | question |
|---|---|---|---|---|
| e0 | 0.90 | 0 | run 986 | v16.2 code bridge (≡ d1) + duplicate noise point |
| e1 | 0.95 | 0 | e0, 987 | fine dose: toxicity concentrated above 0.95? |
| e2 | 0.85 | 0 | e0 | fine dose below the winner |
| e3 | 0.90 | 20 | e0, 990 | flicker persist at winner ceiling (fixes d5 confound) |
| e4 | 0.90 | 1400 | e0, e3 | real persistence (~10 s) at winner ceiling |
| e5 | 1.00 | 1400 | 990, 987 | real dose vs flicker dose, no ceiling |

Schema check: ceil 0.85/0.90/0.95/1.00 ∈ [0.5, 1] ✓; persist
0/20/1400 ∈ [0, 20000] (new bound) ✓; ttl 90 ≥ 61 ✓. Engine check:
no new order types; persist only delays the FOK tilt component — no
OrderManager interaction.

Frozen readouts: §8 table columns + D-fill count/$ + resid-mkt count
+ residue win-side per cell.

Frozen verdict bars (ev GOVERNS, bar 0.30, per §7 metric amendment;
p/100 bridge bar 0.54; cross-SHA comparisons to 986/987/990 valid
only if the bridge passes):

- **BRIDGE-STOP**: |e0 − 986| p/100 > 0.54 (ev reported as
  secondary).
- **CEIL-FINE-MOVE** iff e1 or e2 beats e0 ev by > 0.30 ⇒ center
  moves to the better ceiling; else the ceiling lever is saturated
  at 0.90 (closed at this resolution).
- **PERSIST-LIVE** iff e3 or e4 beats e0 by > 0.30, or e5 beats run
  990 by > 0.30 ⇒ iterate the persistence dose around the winner.
- **PERSIST-DEAD** iff e3 and e4 are within ±0.30 of e0 AND e5 is
  within ±0.30 of 990 ⇒ persistence closed at both ceilings; next
  lever = signal (b) spot-vs-priceToBeat tilt (ExternalFeeds
  plumbing exists) or maker-only tilt.
- **PERSIST-HARMFUL** iff e4 < e0 − 0.30 ⇒ tilt-onset delay cost
  dominates at the winner ceiling; close the lever, same pivot.

Decision mapping: any LIVE ⇒ next session iterates the winning
lever. CEIL saturated + PERSIST dead/harmful ⇒ next session designs
signal (b). Deviations require a written amendment here BEFORE the
affected submission.

### §9 amendment (recorded s25 AFTER the e-grid submission, BEFORE
### the nf submission and BEFORE reading e2–e5): noise recalibration

The e0 bridge (994 vs 986 — formula-identical, schema-only SHA
delta, persist 0) PASSES the governing p/100 bar (Δ 0.45 ≤ 0.54) but
shows **Δev −1.42** — ~9× the v15-derived 0.15 floor the 0.30 ev bar
was built on. compare.ts anatomy: the delta is per-market jitter
flips (largest movers ±$160–190, daily corr 0.85, both signs) —
taker-FOK races under 140±20 ms jitter at B = 500 caps produce
discrete per-market outcome flips. The three formula-identical v16
pairs observed so far: 978v970 Δev −0.53, 987v981 −0.20, 994v986
−1.42 (p/100: 0.21 / 0.05 / 0.45).

**Action (pre-registered here):** submit TWO additional duplicate
center runs (e0 params, SHA 63fec11, labels pf-e040-nf1/nf2). The
same-SHA duplicate set {994, nf1, nf2} gives three pairwise |Δev|;
the recalibrated v16-B500 ev bar = max(0.30, max pairwise |Δev| of
that set), and the p/100 bar is re-checked the same way (currently
0.54, worst observed duplicate 0.45).

**Consequences, recorded in advance:**
- E-040 verdicts (§9 bars) are evaluated against the RECALIBRATED
  bar, not 0.30.
- E-039's CEIL-LIVE margin (+1.91 d1 v d0, same-SHA) is RE-VERDICTED
  under the recalibrated bar next session: if bar > 1.91 the ceiling
  lever downgrades to unproven-at-this-noise (its structural
  findings — win%/median/resid-mkt collapse below 0.90, which are
  param-driven and far beyond jitter — stand regardless). d4's +1.37
  and d5's +0.47 are already suspect; d2/d3's +2.16/+2.20 likely
  survive.
- E-038's TILT-LIVE rests on a monotone per-$100 dose–response with
  a sign-flipped control, not a single pairwise delta; it is not
  re-opened by this finding, but its per-$100 bar inherits the
  duplicate re-check.
- If the recalibrated bar lands near ±1.4, single-run pairwise ev
  deltas at B = 500 are no longer decision-grade; subsequent v16
  experiments must either (a) run duplicate pairs per cell and
  compare means, or (b) evaluate on paired per-market deltas
  (common-universe median/mean Δ with a sign test), which compare.ts
  already supports. Choice frozen next session with the nf data.

## 10. E-040 readout (runs 993–1000, 2026-07-31; verdict
## INSTRUMENT-BOUND — no lever resolved; noise model replaced)

Runs: e0=994, e1=993, e2=995, e3=996, e4=997, e5=998, nf1=999,
nf2=1000. All completed, failures=0, 800/800 universe identity
verified (994v986 common=800), latency 140/20 in every cmd, strategy
diff 9f3e9cd→63fec11 verified schema-only (one `max` bound + comment,
no src/ change), v16 uses no external feeds.

| cell | ceil | persist | run | ev | p/100 | win% | med |
|---|---|---|---|---|---|---|---|
| e0 | .90 | 0 | 994 | −12.25 | −3.60 | 59.3 | +2.80 |
| nf1 | .90 | 0 | 999 | −12.59 | −3.71 | 58.8 | +2.61 |
| nf2 | .90 | 0 | 1000 | −12.28 | −3.62 | 60.4 | +3.18 |
| e1 | .95 | 0 | 993 | −11.01 | −3.15 | 60.4 | +3.15 |
| e2 | .85 | 0 | 995 | −12.74 | −3.78 | 58.0 | +2.38 |
| e3 | .90 | 20 | 996 | −13.14 | −3.86 | 59.6 | +2.34 |
| e4 | .90 | 1400 | 997 | −11.97 | −3.52 | 59.5 | +2.38 |
| e5 | 1.00 | 1400 | 998 | −12.17 | −3.42 | 60.3 | +2.63 |

**§9-amendment recalibration (the headline result).** Duplicate set
{994, 999, 1000} pairwise |Δev|: 0.34 / 0.03 / 0.31 ⇒ the literal
frozen formula gives bar = max(0.30, 0.34) = 0.34. But the paired
per-market measurements refute that bar as a decision instrument:

- Paired per-market sd(Δpnl) ≈ 32–36 in EVERY pair — duplicates
  included ⇒ run-mean SE at n=800 is ≈ 1.2 ev.
- 986 (formula-identical to the triplet) sits +1.42/+1.76/+1.45
  above ALL THREE duplicates (z 1.18/1.45/1.27, sign tests flat
  296/285, 301/296, 296/295): a plausible 1–1.5σ draw under SE 1.2,
  a ≥5σ impossibility under the 0.34 bar. Code, universe, feeds all
  verified identical — the excursion is jitter-tail, not drift.
- e1 sits +1.24/+1.58/+1.27 above the same triplet (z 1.01/1.37/
  1.04, signs 326/290, 309/295, 300/305) — the SAME signature as the
  986 excursion. Indistinguishable from tail noise.

**Replaced noise model (binding for v16-family evidence):** at
pinned-800 / B=500, a single-run pairwise ev delta has SE ≈ 1.2
(2σ ≈ 2.4). Small duplicate sets under-sample the tail (three
duplicates clustered at ≤0.34 while a fourth formula-identical run
sat 1.4–1.8 away). Per §9's pre-registered instrument clause, ev
verdicts now require (a) FULL-universe run pairs (SE ≈ 34/√10747 ≈
0.33) or (b) duplicate-triplet means per cell. Pinned-800 single
runs remain the STRUCTURE screen (param-driven signatures ≫ jitter:
trades, invested, fills, resid-market counts, win% at big doses).

**Cell verdicts under the replaced model:**
- BRIDGE: p/100 |Δ| 0.44 ≤ 0.54 PASS; ev bridge void (1.42 ≈ 1.2σ —
  single-pair ev bridges are no longer meaningful at this scale).
- CEIL-FINE: UNRESOLVED. e1's +1.3 is exactly the demonstrated tail
  magnitude; mechanical FINE-MOVE under the 0.34 bar would repeat
  the E-039 mistake. → E-041 f2 (FULL) decides.
- PERSIST: UNRESOLVED at ev level (e3 −0.89, e4 +0.29, e5 v 990
  −0.80: all ≪ 2.4). Structural fact (real, param-driven): persist
  1400 (~10 s) barely binds — invested/trades ≈ unchanged vs
  persist 0 (997: 7,585 trades, $272k vs 994: 7,194, $272k) ⇒
  leaders at leadGap 0.10 are already ~always ≥10 s persistent when
  the tilt wants to fire. The flicker-filter hypothesis space is
  empty at this gap; deprioritized, not ceiling-dependent.
- e2 structural fact (param-driven, stands): tilt D-spend mass
  executes at unit cost 0.80–0.85 (invested cliff sits between 0.85
  and 0.80, not at 0.90).

**E-039 RE-VERDICT (pre-registered §9 consequence): CEIL-LIVE →
CEIL-UNRESOLVED.** The +1.91 winner margin (986 v 987) is z ≈ 1.6
under the replaced model; the E-039-era triplet-mean of the same
config is −12.37 (994/999/1000) — the "winner" absolute state
−10.83 and family-best p/100 −3.16 did NOT replicate (triplet p/100
−3.60/−3.71/−3.62). d2/d3's +2.16/+2.20 are z ≈ 1.8 — suggestive
only. What STANDS from E-039 (param-driven, ≫ jitter): dose
structure — win% collapse 61→45 and median flip below ceiling 0.90,
resid-mkt collapse 700→233, D-spend collapse $142k→$35k at 0.80.
What is WITHDRAWN: any ev-level ceiling benefit claim, "family-best"
label, and the E-039 LEDGER verdict line's ev numbers as evidence.
E-038's TILT-LIVE is NOT re-opened (monotone dose–response + sign-
flipped control, structure not a single pair), but its flat-ev
reading gains a caveat: ±1–2 ev differences among tilt doses were
never resolvable.

## 11. E-041: FULL-universe instrument + ceiling re-test (FROZEN
## before submission, M2; design-ts = this commit)

**Hypothesis.** (a) FULL-universe (~10.9k mkts) run pairs at B=500
have SE ≈ 0.33 (√n scaling of the measured per-market sd ≈ 34),
making 1-ev-scale lever effects decidable with single pairs. (b)
E-039/E-040's ceiling question — does gating the tilt FOK at
acquisition price ≤ 0.90/0.95 improve ev over no ceiling — is
answerable at that resolution: the D-fill price mix shifts are large
(structural), so a real effect of the size E-039 claimed (+1.9)
would be ≈ 4–6σ at FULL; a null localizes the E-039 signal as tail
noise.

**Cells (label pf-e041; FULL universe: from-ms floor 1775088000000,
--to-ms 1785196800000 (2026-07-28T00:00Z) pinned identically on all
four cells, submitted back-to-back; latency 140/20; SHA = this
commit; center params = E-040 e0 except tiltUnitMax):**

| # | tiltUnitMax | role |
|---|---|---|
| f0a | 0.90 | duplicate pair member A (noise + reference) |
| f0b | 0.90 | duplicate pair member B |
| f1 | 1.00 | ceiling OFF (v16.0 tilt center) |
| f2 | 0.95 | fine dose; e1 confirmation |

Schema/engine check: ceil values ∈ [0.5,1] ✓, persist 0 ✓, ttl 90 ≥
61 ✓; params-only, no code change, no OrderManager interaction.

**Frozen metrics.** Per cell: ev (governs), p/100, win%, median,
invested, trades, D-fill $; noise: |Δev(f0a,f0b)| AND paired
per-market sd → SE_pair = sd/√n; integrity: failures=0, identical
slug sets across all four cells (pairwise common = total; if a sync
grew the universe mid-submission, compare on the common intersection
and record the delta), 140/20 in cmd, within-run SHA consistency.

**Frozen bars.** ev bar B_full = max(0.30, 2×SE_pair,
|Δev(f0a,f0b)|). Reference F0 = mean(f0a, f0b).
- **CEIL-REAL** iff F0 − f1 > B_full (ceiling 0.90 beats OFF) ⇒
  ceiling lever confirmed; fine dose read from f2 vs F0 by the same
  bar; iterate ceiling/dose at the FULL instrument.
- **CEIL-HARMFUL** iff f1 − F0 > B_full ⇒ ceiling hurts at FULL;
  remove (center reverts to 1.00).
- **CEIL-NULL** otherwise ⇒ E-039's ceiling ev effect refuted at
  FULL resolution; center reverts to tiltUnitMax 1.00 (parsimony);
  ceiling axis closed at ev level (structural dose facts stand).
- **FINE-MOVE** iff CEIL-REAL AND f2 − F0 > B_full ⇒ center 0.95.
- **INSTRUMENT-FAIL** iff B_full > 0.8 (FULL pairs no better than
  ~2× pinned-800) ⇒ duplicate-triplet means become the standing
  instrument; record and re-plan.

**Decision mapping.** CEIL-REAL ⇒ next lever iterates acquisition
price at FULL. CEIL-NULL/HARMFUL ⇒ ceiling closed; next lever =
signal (b) spot-vs-priceToBeat tilt (new information source, v17,
designed for effect sizes ≥ 2 ev) with FULL pairs as the verdict
instrument. Deviations require a written amendment here BEFORE the
affected submission.
