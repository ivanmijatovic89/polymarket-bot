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
