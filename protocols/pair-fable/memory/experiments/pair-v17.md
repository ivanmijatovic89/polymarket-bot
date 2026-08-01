# pair-v17 — directional controller, signal (b): spot-vs-priceToBeat (E-042)

Mission priority 2 continuation. Pre-registered as the next lever at s26
(pair-v16.md §11 decision mapping + STATUS next-step 2): when E-041 closes the
acquisition-ceiling question, the next directional lever is a NEW information
source for the leader — the resolution-relevant price signal — replacing the
book-implied leader. Mechanism registered before this file; implementation
(strategies/pair.v17.ts) and this grid freeze happened session 27, grid frozen
BEFORE any E-042 submission (M2; design-ts = the commit adding this file).

## 1. Relationship to v16 (exact delta; one substitution)

pair.v17.ts = pair.v16.ts (v16.2 at d204df35) with the LEADER SIGNAL replaced:

- v16 (signal a): leader = side whose bestBid ≥ other bestBid + leadGap.
- v17 (signal b): leader = UP when `spot − priceToBeat ≥ θ`, DOWN when
  `≤ −θ`, none inside the dead zone; `θ = spotLeadBps` basis points of the
  strike. Feeds absent (either sub-feed) ⇒ no leader ⇒ neutral that tick.
- Feeds via `ExternalFeedsRequestPlugin` (`binanceWsSpotPrice` +
  `polymarketPriceToBeat`); both are backtest-fulfilled from historical data
  (aggTrades as-of with measured latency; Gamma strike with ~2.7 s
  availability latency). Coverage: BTC-15m strike epoch 2026-02-18, spot from
  2025-11-29 — the FULL universe (floor 2026-04-01) is fully covered; a
  missing day file / unbackfilled strike is a HARD ERROR, not silent
  neutrality (docs/datasets/data-coverage.md).
- `leadGap` (book units) is replaced by `spotLeadBps` in the schema. ALL
  other machinery — signed target T, band guard on e_s, graded lag pricing,
  FOK completion toward target, tiltUnitMax gate on the tilt component,
  leadPersistTicks streak (now on the feed leader), RAW VWAP ceiling + RAW
  capital reservation, grid/cooldowns/TTL/doom/end-of-window — byte-identical
  to v16.2. τ = 0 reduces exactly to v15.4 neutral.

Why signal (b) can beat signal (a) (causal mechanism, falsifiable): the book
leader is the crowd's posterior — tilting toward it buys accuracy at the
crowd's price (E-038/E-039 showed those completions are ~fair-priced; the
>0.90 slice was toxic). Spot-vs-strike is the PHYSICAL state the market
settles on, observable ~continuously and slightly ahead of the book's
adjustment (binance leads the Chainlink round the market resolves with, and
leads book repricing on fast moves). If the feed leader identifies the
winning side earlier or with fewer false flips than the book leader at the
same tilt dose, the same completions execute at cheaper prices ⇒ higher ev.
If the book already embeds the signal ≥ as fast as we can act on it (140 ms
latency), the cells are null — that is the honest kill.

## 2. Non-equivalence vs prior kills

- E-035 (ask-side region-entry taker REJECT) — same three-axis argument as
  pair-v16.md §2: maker-priced, path-dependent, marginal-inside-controller.
  Unchanged by the signal swap.
- E-028/E-034 measured spot-vs-strike as a MARKET-SELECTION / entry gate
  (which markets to play), not as a leader signal steering tilt inside the
  controller; no equivalence.
- E-018 worst-queue adverse selection remains the negative prior for any
  unpaired maker inventory; the dose–response measures the net.

## 3. v17.0 schema (delta over v16.2)

- `spotLeadBps` ∈ [0, 200], default 10: dead-zone half-width in bps of the
  strike. Scale anchor: BTC 15-min realized σ ≈ 20–30 bps, so 10 bps ≈
  0.3–0.5 σ_remaining mid-window; 40 bps ≈ decisive-move territory.
- `leadGap` removed (book signal gone). Everything else identical, incl.
  `tiltUnitMax` (default 1) and `leadPersistTicks` (default 0, feed-leader
  streak).

## 4. Integrity evidence (session 27, before submission)

- protocol:check PASS (typecheck + eslint).
- Smoke run 1001 (τ+160, bps 10, doom .99, B500, q100, I160): PASS, 5/5
  markets, 0 failures, maker/taker 14/39, invested $2,228.
- Activation check run 1002 (same cells, τ = 0): taker 23, invested $1,284 —
  the feed-driven tilt materially changes behavior on identical markets
  (39 vs 23 taker fills), proving the feed path is live (both sub-feeds
  fulfilled; a broken feed would have been a hard error or T ≡ 0 ⇒ identical
  runs).

## 5. E-042 grid (FROZEN before submission)

Instrument: FULL-universe single pairs (pair-v16.md §10 binding rule),
identical pin to E-041 — from-ms floor 1775088000000, `--to-ms 1785196800000`,
latency 140/20, B = 500, center params = E-040 e0 (q100 I160 P*.96 γ0
doom.99 cool5 ttl90 persist0), τ = +160. Label pf-e042.

**Ceiling parameter c\*** is fixed by E-041's verdict per its frozen §11
mapping, recorded here BEFORE E-041's readout: CEIL-NULL/HARMFUL ⇒ c* = 1.00;
CEIL-REAL ⇒ c* = 0.90; FINE-MOVE ⇒ c* = 0.95. The matched signal-(a)
reference cell is the E-041 run at that same ceiling (f1 / F0 pair / f2
respectively).

| # | cell | spotLeadBps | τ | ceil | vs (named pair) | question |
|---|---|---|---|---|---|---|
| g0 | neutral | – | 0 | c* | f-reference, g1–g3 | FULL neutral reference: does ANY tilt add absolute ev vs neutral? (E-038's flat-ev finding, finally at a decisive instrument) |
| g1 | tight | 10 | +160 | c* | matched f-cell, g0 | signal (b) at ~0.3–0.5 σ dead zone |
| g2 | mid | 20 | +160 | c* | g1 | dose |
| g3 | wide | 40 | +160 | c* | g2 | dose extreme (only decisive moves tilt) |

Schema check: bps 10/20/40 ∈ [0, 200] ✓; τ 160 ≤ I_b 160 ✓; ceil c* ∈
{0.90, 0.95, 1.00} ⊂ [0.5, 1] ✓; ttl 90 ≥ 61 ✓; q 100 ≤ I_b ✓. Engine check:
no new order types; params-only over smoked code.

Cross-SHA note (M4): E-041 f-cells ran at d204df35; E-042 runs at the commit
adding pair.v17.ts + docs. Identity argument: the diff is additive only (new
strategy file, protocol docs) — src/ and pair.v16.ts untouched; verify with
`git diff --stat d204df35..<e042-sha>` at readout and record it.

**Frozen metrics.** Per cell: ev (governs), p/100, win%, median, invested,
trades, D-fill count/$, resid-mkt count, residue win-side fraction; integrity:
failures = 0, pairwise common slug set = total on all 4 cells + the matched
f-cell, 140/20 in every cmd.

**Frozen bars.** B_full = the E-041-measured bar: max(0.30, 2×SE_pair,
|Δev(f0a,f0b)|) — one instrument constant for both experiments. If E-041
returns INSTRUMENT-FAIL (B_full > 0.8), E-042 is NOT submitted as single
cells; re-plan per E-041's mapping (duplicate-triplet means).

- **SIGB-BETTER** iff best of g1–g3 beats the matched f-cell ev by > B_full ⇒
  the resolution signal beats the book signal; iterate signal (b) (threshold
  refinement, feed-leader persistence, time-scaled dead zone σ√t).
- **SIGB-WORSE** iff the matched f-cell beats ALL of g1–g3 by > B_full ⇒ the
  book already embeds the signal better than we can act on it; close
  signal (b) at these doses, record the dose curve.
- **SIGB-NULL** otherwise ⇒ signals equivalent at this instrument; parsimony
  keeps signal (a) (no feed dependency); tilt-signal axis closed at ev level.
- **TILT-EV-REAL** iff (matched f-cell or best g) − g0 > B_full ⇒ the tilt
  adds ABSOLUTE ev over neutral at FULL — first ev-level confirmation of the
  directional program.
- **TILT-EV-NEGATIVE** iff g0 beats every tilt cell (f matched included) by
  > B_full ⇒ the tilt COSTS absolute ev; the directional program's current
  acquisition machinery is re-examined (maker-only tilt next), and the
  neutral controller's FULL baseline becomes the standing reference.
- **TILT-EV-NULL** otherwise ⇒ E-038's "flat ev" stands at FULL resolution;
  per-$100 remains the only measured tilt benefit.

Dose read: g1 vs g2 vs g3 by the same bar; monotone widening ⇒ dead-zone
size matters (false-flip cost real); flat ⇒ threshold insensitive in this
range.

**Decision mapping.** SIGB-BETTER ⇒ iterate signal (b) levers at FULL.
SIGB-NULL/WORSE + TILT-EV-REAL ⇒ keep signal (a), iterate acquisition
(maker-only tilt, persistence at FULL). SIGB-NULL/WORSE + TILT-EV-NEGATIVE ⇒
directional tilt closed at ev on both signals; program returns to the
neutral controller's remaining FULL-instrument levers (P* corner) and the
priority-2 backlog (time-varying τ, imbalance-adaptive tilt). Deviations
require a written amendment here BEFORE the affected submission.

## 6. Pre-submission amendments (s27, recorded BEFORE the E-042
## submission per §5's deviation rule)

1. **c\* = 1.00** — E-041 verdict CEIL-NULL (pair-v16.md §12): center
   reverts to no ceiling; matched signal-(a) reference cell = f1 =
   run 1005 (ev −14.83). B_full = 0.74 (measured: 2×SE_pair 0.739
   governs; SE_pair 0.369 from f0a/f0b paired sd 38.29, n 10,747).
2. **Strike-outage failures are EXPECTED, not integrity breaks.**
   The 200-mkt fleet diagnostic (run 1006, batch pf-e042-diag) proved
   worker-side feed fulfillment (198/200 ran; maker+taker fills; on
   the same 198 slugs v16 run 1005 has 94 no-activity vs v17's 96 —
   slice property, not v17 behavior) and surfaced the known data
   hole: ~1.36% of markets since Apr 2026 have NO priceToBeat
   anywhere (Polymarket outage days; the engine hard-errors those
   markets and continues the batch). Amended integrity bar: per cell,
   failures must be MISSING-priceToBeat outage errors ONLY (any other
   failure class = integrity break); expected ~146/10,747; the
   outage set is deterministic so all four v17 cells fail
   identically. All E-042 comparisons run on the COMMON PLAYED
   intersection: g-vs-g pairs share the same universe; g-vs-f1
   comparisons recompute f1's ev on the intersection (drop the same
   outage slugs from run 1005) and record the delta vs its headline.
3. The E-042 noise reference reuses E-041's B_full = 0.74 (same
   controller family, same universe, same caps). If the g-vs-g
   duplicate-free grid shows any pairwise anomaly beyond it, escalate
   per the standing instrument rule instead of re-deriving bars
   post-hoc.

## 7. Result E-042 (session 28 readout; runs g0=1008, g1=1011, g2=1010,
## g3=1009; reference f1=1005)

**Integrity (all PASS).** Failures 96/cell, slug sets identical across
all four cells (96 common), reason class 100% MISSING-priceToBeat
(outage set; amendment §6.2 — the ~146 estimate was the since-Apr rate
applied to the whole universe; the true universe-wide outage count is
96/10,747 = 0.89%). Pairwise common universe = 10,651 on every g-pair
and on every g-vs-1005 pair. Cross-SHA identity (M4): `git diff --stat
d204df35..4b5047c4` touches protocols/ only (pair.v17.ts added; src/
and pair.v16.ts byte-identical) — verified session 28. 140/20 in every
cmd (results.ts header). All numbers below on the 10,651 intersection;
f1's intersection ev −14.841 vs headline −14.825 (delta +0.016,
recorded per amendment 2).

**Paired deltas (SQL, per-market join; bar B_full = 0.74):**

| pair | Δev | paired sd | 2×SE |
|---|---|---|---|
| g3 − f1 | **+1.869** | 65.3 | 1.27 |
| g2 − f1 | +1.216 | 59.7 | 1.16 |
| g0 − f1 | **+1.333** | 66.3 | 1.28 |
| g1 − f1 | +0.552 | 56.1 | 1.09 |
| g1 − g0 | −0.781 | 52.8 | 1.02 |
| g2 − g0 | −0.117 | 35.4 | 0.69 |
| g3 − g0 | +0.535 | 21.9 | 0.42 |

**Verdicts (frozen §5 bars):**

- **SIGB-BETTER** — best signal-(b) cell g3 beats the matched
  signal-(a) cell f1 by +1.87 > 0.74 (also > its own 2×SE 1.27).
  The spot-vs-strike leader outperforms the book leader at equal τ.
  Honest decomposition: most of the gap is HARM AVOIDANCE — pure
  neutral g0 also beats f1 by +1.33 > 0.74, i.e. the signal-(a)
  book-leader tilt was actively COSTING ~1.3 ev at FULL; signal (b)
  at wide dead zone wins mainly by tilting rarely and less wrongly.
- **TILT-EV-NULL** — best tilt cell vs neutral: g3 − g0 = +0.54
  < 0.74 (not REAL); g0 does not beat g2 (+0.12) or g3 (−0.54) by
  the bar (not NEGATIVE). E-038's flat-ev finding stands at FULL.
  Note: g3 − g0 = +0.54 with paired 2×SE 0.42 is 2.5σ by its OWN
  pair noise — suggestive, below the frozen instrument bar; treated
  as motivation for E-043's dose extension, not as a verdict.
- **Dose: monotone in dead-zone width** — g1 −14.29 → g2 −13.63 →
  g3 −12.97; end-to-end g3 − g1 = +1.32 > 0.74. False-flip cost is
  real; wider = better throughout the tested range.

**Mechanism anatomy (anatomy.ts, per cell):**

| cell | resid mkts | resid win% | resid PnL | pairs PnL | D fills | D $ |
|---|---|---|---|---|---|---|
| g0 | 339 | 30% | −1.4k | −120.2k | 21,440 | 734k |
| g1 | 6,980 | **88%** | +161.9k | −281.0k | 45,695 | 1,868k |
| g2 | 3,844 | **90%** | +92.1k | −209.7k | 33,721 | 1,360k |
| g3 | 1,152 | 79% | +19.3k | −134.6k | 23,185 | 858k |

THE SIGNAL IS PREDICTIVE — tilted residue wins 88–90% of markets at
bps 10–20 (base-rate 30% for neutral accidental residue) — but the
ACQUISITION SPENDS MORE THAN THE RESIDUE EARNS: g1 gains +163k
residue vs g0 while losing −161k more on pairs (doom-FOK + taker
completion chasing the signed target; D-spend 734k → 1,868k) plus
+11k fees. Net ≈ wash. The lever is not the signal, it is the cost
of buying the tilt ⇒ E-044 (maker-only tilt acquisition).

**Decision (frozen mapping):** SIGB-BETTER ⇒ iterate signal (b) at
FULL. Combined with the anatomy, the follow-ups are: E-043 (dose
extension — where does the width curve peak), E-044 (maker-only tilt
acquisition — the cost side; new §, own file pair-v17m.md), E-045
(neutral P* sweep at FULL — priority-1 lever, runs in parallel).
Standing references: g0 = run 1008 is the FIRST FULL neutral at the
E-040 e0 center (ev −13.51, p/100 −5.93) — the standing neutral
baseline; g3 = run 1009 the best directional cell on record at FULL.

## 8. E-043 — dead-zone dose extension (FROZEN before submission,
## session 28)

Params-only on pair.v17.ts (unchanged since 4b5047c4). Same
instrument, pin, latency, center as E-042 (§5); τ = +160, c* = 1.00.
Reuse B_full = 0.74 (amendment §6.3 grounds).

| # | spotLeadBps | batch label | question |
|---|---|---|---|
| h80 | 80 | pf-e043-h80 | does the width curve keep rising past 40? |
| h160 | 160 | pf-e043-h160 | asymptote check: near-never tilt ⇒ ev → g0? |

Schema: 80/160 ∈ [0, 200] ✓. Named comparisons and bars:

- **DOSE-CONT** iff ev(h80) − ev(g3) > 0.74 ⇒ threshold still
  improving; extend further / add persistence at the best width.
- **DOSE-PEAKED** iff ev(g3) − ev(h80) > 0.74 ⇒ interior max ≈ 40 bps.
- **DOSE-FLAT** otherwise.
- **TILT-EV-REAL (retest)** iff ev(h80) − ev(g0) > 0.74 or
  ev(h160) − ev(g0) > 0.74 ⇒ first ev-real tilt, at rare-decisive
  doses.
- h160 vs g0 expected |Δ| < 0.74 (tilt near-never engages at 160 bps
  ≈ 5–8σ of a 15-min window); a breach either way = anomaly, escalate
  per instrument rule.

Decision mapping: DOSE-CONT ⇒ extend dose + persistence cell at best
width. DOSE-PEAKED/FLAT and no TILT-EV-REAL ⇒ width axis closed at
ev; signal-(b) taker-acquired tilt value rests on E-044's outcome.

## 9. E-045 — neutral P* price-gate sweep at FULL (FROZEN before
## submission, session 28)

Priority-1 (neutral controller) work, running concurrently with the
directional follow-ups. P* (pairTarget) is the core price gate: it
caps every maker quote via the VWAP-ceiling projection AND sets the
C-lock trigger pLock = P* − 0.01. E-030 swept it {0.94, 0.96, 0.98}
at pinned-800 where SE ≈ 1.2 resolved nothing; STATUS has carried
"P* needs the FULL instrument" since. Params-only on pair.v17.ts at
τ = 0 (exact v15.4-neutral semantics), bps 10 (inert at τ 0),
otherwise the E-042 center; reference = g0 (run 1008, P* 0.96).

| # | pairTarget | batch label |
|---|---|---|
| p92 | 0.92 | pf-e045-p92 |
| p94 | 0.94 | pf-e045-p94 |
| p98 | 0.98 | pf-e045-p98 |

Schema: all ∈ [0.90, 0.99] ✓. Bars (B_full = 0.74): **P*-LIVE** iff
any cell − g0 beyond ±0.74 (direction recorded; monotonicity across
0.92→0.94→0.96→0.98 read alongside); **P*-FLAT-FULL** otherwise ⇒
the P* axis closes at ev in [0.92, 0.98] at this center and the
neutral controller's FULL backlog moves to structural mechanisms
(P-013 sell-side ruling, time-varying τ). Mechanism metrics per
cell: invested/played, C vs D fill counts and $, resid-mkt count,
p/100. Failure rule: identical 96-slug outage set only.

## 10. Session-29 pre-readout analysis: the g0 loss identity
## (exploratory, run 1008; recorded BEFORE E-043/044/045 results)

Per-share fill economics on run 1008 (JSON_TABLE over intent_meta;
sql.ts, session 29):

| mode | fills | shares | $ | avg $/share |
|---|---|---|---|---|
| S (maker start) | 34,037 | 3,403,700 | 1,545,139 | 0.454 |
| C (cheap FOK completion) | 20,651 | 403,205 | 191,298 | 0.474 |
| D (doom completion) | 21,440 | 892,700 | 733,908 | 0.822 |
| R | 2 | 200 | 2 | 0.010 |

Pair-type reconstruction (each C/D leg pairs an S leg at ~0.454;
remaining pairs are S–S at ~0.908):

- S–S pairs ≈ 1.05M × (1 − 0.908) ≈ **+96k**
- C pairs ≈ 0.40M × (1 − 0.928) ≈ **+31k**
- D pairs ≈ 0.89M × (1 − 1.276) ≈ **−246k**
- Sum ≈ −119k ✓ (measured pairsPnl −120.2k; identity closes)

**Reading.** The neutral controller is gross-profitable on 62% of its
pairs (maker–maker and cheap-completion); the whole loss is the doom
premium: 38% of pairs are D-completed at avg locked loss −0.276 each.
BUT the D completion itself is ~EV-neutral vs holding the doomed
share (complete at leading price q: locks q − 0.55; hold: expected
0.55 − q — identical modulo fees/spread). This explains E-041
CEIL-NULL mechanically. The loss therefore lives UPSTREAM: adverse
selection on S inventory in trending markets — the S legs that end up
on the doomed side were bought at 0.454 and are worth ~0.18 by doom
time. Levers on the identity: (i) hold S legs on the WINNING side
more often ⇒ the tilt program (E-043/E-044 in flight measure exactly
this); (ii) more C-share of completions (C pairs profitable) ⇒
oscillation harvesting / completion cadence; (iii) cheaper S ⇒ lower
quotes, fill-rate tradeoff. NOT a lever: doom completion price
policy (EV-neutral; E-041 confirmed).

Also recorded (minuteev.ts on 1008, exploratory): no start-minute
region is EV-positive for v17 either; "forbid starts before m" never
goes positive (best −7.5 ± 4.6 at m=11, n=15). Start-timing is not a
neutral-controller lever — matches E-027 (v1 family). Constraint for
the time-varying-τ backlog item, not a verdict.

**Sharper identity (same session, leg-vs-outcome instead of pair
type; JSON_TABLE join on final_outcome, run 1008):**

| mode | outcome | shares | avg $ | net value |
|---|---|---|---|---|
| S | lose | 1,969,100 | 0.418 | −823k |
| S | win | 1,434,600 | 0.503 | +713k |
| C | lose | 223,350 | 0.403 | −90k |
| C | win | 179,855 | 0.564 | +79k |
| D | lose | 168,312 | 0.818 | −138k |
| D | win | 724,388 | 0.823 | +128k |

Net by mechanism: **S −110k**, C −11k, D −9.5k, fees −22k (sum ≈
−153k vs measured −143.9k; residual ≈ rounding + R + flat rows).

**Reading (supersedes the pair-type frame above as the causal
story).** C and D fills are ~fair at their prices (D buys the leader
at 0.823 and it wins 81.1% — EV ≈ fees). The ONLY structurally
biased flow is S: maker starts fill 58/42 toward the eventual LOSER
at −3.2¢/share adverse selection, ≈ the entire strategy loss. The
neutral controller has no completion-side lever (efficient market at
completion time); the loss is decided when the passive quote is
lifted. Levers, restated: (i) steer the S split — the tilt program
(E-043/E-044 measure exactly this; baseline S split 58/42 is the
engagement metric for E-044's m-cells); (ii) quote so the fills are
less adversely selected (price/persistence/side-asymmetry of maker
quotes); (iii) sell-side mirror (P-013, needs human). Start-timing
is measured NOT a lever (minuteev above).

**S-fill toxicity by minute-of-fill (run 1008, same method):**
evPerShare ≈ −0.022..−0.033 in minutes 0–4 (2.17M shares, ≈ −59k),
−0.026..−0.050 in minutes 5–11 (1.11M shares, ≈ −47k), −0.064..−0.097
in minutes 12–13 (26k shares). Maker fills grow ~1.6–3× more
adversely selected as the window ages. Measured prior for the
time-varying-quote axis (tighten/stop S accumulation late) — distinct
from start-minute gating, which minuteev measured dead. Any experiment
here must account for the completion/pairing value the late S fills
also carry; the −47k after minute 5 is gross toxicity, not the net
value of suppressing those fills.

**S-fill toxicity by price band (run 1008, session 30, same
JSON_TABLE method; ev/share = shares-weighted win_rate − avg fill
price):**

| band | shares | avg p | win rate | ev/share |
|---|---|---|---|---|
| 0.0x | 30,900 | 0.065 | 0.045 | −0.020 |
| 0.1x | 129,400 | 0.151 | 0.136 | −0.015 |
| 0.2x | 281,600 | 0.251 | 0.221 | −0.030 |
| 0.3x | 605,900 | 0.352 | 0.313 | −0.038 |
| 0.4x | 1,085,500 | 0.447 | 0.414 | −0.033 |
| 0.5x | 785,400 | 0.538 | 0.508 | −0.031 |
| 0.6x | 318,700 | 0.637 | 0.607 | −0.030 |
| 0.7x | 114,200 | 0.737 | 0.699 | −0.038 |
| 0.8x | 42,800 | 0.837 | 0.808 | −0.028 |
| 0.9x | 9,300 | 0.923 | 0.839 | −0.085 |

**Reading.** Maker adverse selection is PRICE-UNIFORM: −3.0 ± 0.5
¢/share across bands 0.2–0.8 (95% of S volume). Neither the cheap
(book-laggard) side nor the expensive (book-leader) side is
systematically less toxic at the band level. Constraint for lever
(ii): an UNCONDITIONED quote-side/price-level asymmetry has no edge
to harvest — side asymmetry must be conditioned on an external
signal (spot-vs-strike lead = exactly E-044's mechanism). If E-044's
m-cells fail to move the S split, there is no band-level fallback
for the asymmetry axis. (Bands ≤0.1 look ~1.5¢ milder but carry 5%
of volume and sit at fee scale; 0.9x is a 9,300-share tail.)

## §11 Mission-metric baseline report on g0 = 1008 (s34, 2026-08-01, analysis-only)

Mission §2 requires reporting final pair VWAP fractions below 0.98/0.95/0.90.
Computed from intent_meta fills (all buys; per-market UP VWAP + DOWN VWAP),
run 1008, 10,148 markets with both-sides fills (of 10,152 with any fill):

- avg matched 225.4 sh; avg final |imbalance| 12.1 sh (imbalance controller works).
- per-market pair VWAP: mean 1.1015 (equal-weight); aggregate share-weighted
  1.0512; matched-share-weighted mean 1.0545.
- fractions of markets below target: <0.98 = 21.2%, <0.95 = 7.6%, <0.90 = 0.34%.

**Structure — matched volume, pair cost, and pnl are monotone together:**

| matched bucket | mkts | avg pair VWAP | avg pnl | total pnl |
|---|---|---|---|---|
| <100 | 164 | 1.2151 | −18.25 | −3.0k |
| 100–250 | 6,374 | 1.1519 | −19.96 | −127.2k |
| 250–500 | 3,163 | 1.0144 | −6.80 | −21.5k |
| 500+ | 447 | 0.9580 | **+17.41** | **+7.8k** |

The 500+ bucket meets the $0.98 target AND is ev-positive. The whole loss sits
in the 100–250 bucket (−127k of −144k): trending / low-oscillation markets where
completions don't arrive and S fills skew to the loser (the known 58/42
S-toxicity identity, now localized by market regime).

Caveats (binding on any use of this table):
- Bucketing by matched shares conditions on an OUTCOME — this is a diagnostic
  correlation localizing the loss, NOT proof that high-matched markets are
  identifiable ex ante or that ev there is causal.
- Guard-7 / E-036: fill optimism grows with size; the d-bucket's +17.41 is the
  most depth-optimistic cell here.
- Consistent with inbox d904e17d (best live operator ≈700 trades/window): our
  highest-activity regime is our only profitable one.

Backlog candidate derived (NOT scheduled; v17t queue first): **v17o —
state-conditioned quoting**: throttle/tighten S quotes when realized completion
rate so far is low (trending state), release when oscillation delivers
completions. Genuinely different axis from v17t (time-based tightening) and
from E-044 (signal-side tilt): conditions on within-market realized controller
state, not clock or external signal. Would attack the b-bucket −127k directly.

### §11.1 Early-detectability of the losing regime (s34, run 1008)

Early matched pairs (fills in the first 5 min of the window, min(UP,DOWN))
predict the final regime: early<50 → avg pnl −17.61 (2,635 mkts), 50–150 →
−16.62 (4,837), 150–300 → −9.04 (2,022), 300+ → **+1.85** (658).

S-fill settle-value attribution (exact under held-to-settle accounting:
pnl contribution of a fill set = win shares − cost; merges value-neutral):

- **low-early (early_matched < 150, 7,472 mkts):** pre-min-5 S net −66.7k
  (622.9k lose sh @ .446 vs 424.8k win @ .503); post-min-5 S net **−42.2k**
  (576.1k lose @ .378 vs 366.5k win @ .521 — skew worsens to 61/39 at more
  adverse prices). Total −108.9k.
- **high-early (≥ 150, 2,680 mkts):** S net **−1.6k ≈ ZERO** (643.3k win @
  .493 vs 770.1k lose @ .426).

⇒ The whole −110k S-flow adverse selection (s29 identity) is CONCENTRATED in
the low-early regime, and ~40% of it (−42k, ≈ −5.6/mkt over those markets)
accrues AFTER the regime is already flagged by the controller's own
completion rate at minute 5. First-order throttle headroom: +42k on the
−144k baseline, before (a) interaction with R/C/D flow triggered by the
removed S fills, (b) loss of post-5 completions in false-flagged markets.

Caveats: the 150-at-min-5 threshold was chosen looking at this table
(in-sample cut — a v17o grid must sweep it fresh); attribution is
first-order (no re-simulation). This is the measured prior for v17o
(state-conditioned quoting), analogous to §10's ramp prior for v17t.

## §12 E-043 + E-045 readout (s34, 2026-08-01; rows landed 00:54Z)

Mapping: h80=1024, h160=1030, p92=1029, p94=1028, p98=1027 (m-cells in
pair-v17m.md §5). Integrity: all 7 rows n=96 failures, 100% priceToBeat,
identical set to 1008; every pair n=10,651. Bar B_full = 0.74.

**E-043 (width dose at τ160): DOSE-FLAT + TILT-EV-REAL retest FAIL.**
h80−g3 = −0.173 ± 0.211; h80−g0 = +0.362 ± 0.189 (< 0.74 again — E-042's
+0.54 did not strengthen); h160−g0 = −0.149 (no anomaly). Per frozen
mapping: width axis CLOSED at ev; signal-(b) taker-tilt value rested on
E-044 (see pair-v17m.md §5: MAKERTILT-BETTER at bps10, still no
TILT-EV-REAL).

**E-045 (neutral P* level): P*-LIVE, strongly, monotone.**
p92−g0 = **+5.443 ± 0.224** (largest confirmed ev delta on record);
p94−g0 = +3.476 ± 0.216; p98−g0 = −4.159 ± 0.221. Headline ev:
p92 −8.07 (NEW best FULL on record), p94 −10.03, g0 −13.51, p98 −17.67.
HONEST STRUCTURE: profit per $100 is FLAT across the sweep (−5.91 /
−5.83 / −5.93 / −6.20) while invested/played falls 292→166 — the ev gain
is exposure reduction at unchanged per-dollar toxicity (participate less
in bad flow), not per-dollar improvement. Winner 0.92 sits at the GRID
EDGE with no interior optimum found.

Decisions applied (frozen mappings): (1) v17t Branch B — grid re-centered
at pairTarget 0.92, reference = 1029 by code identity; (2) v17o Branch B
same; (3) follow-through cell E-045b pre-registered below (P* 0.90 =
schema floor).

### E-045b (pre-registered s34 BEFORE submission): P* 0.90 edge probe

One cell, params-only on pair.v17 at SHA f107234 semantics (file untouched
since): all params = 1029's recorded params with pairTarget=0.90. Universe
--to-ms 1785196800000, 140/20, B=500. Bars vs 1029 (paired, 10,651
common): **P*-CONT** iff p90−p92 > +0.74 (monotonicity continues — next
sweep must extend below the schema floor via schema touch); **P*-PEAK**
iff < −0.74 (0.92 is the interior optimum, center confirmed);
**P*-EDGE-FLAT** otherwise (0.90≈0.92 plateau — center stays 0.92).
Mechanism metrics: invested/played, S/C/D fill counts+$, resid-mkt count,
noActivity (watch for engagement collapse at tight caps). 1029 baseline
for these metrics measured s38 in §14 (S 18,308 fills/$772.4k, C+D
26,127/$687.3k).

## §13 Mission-metric report on p92 = 1029 (s36, 2026-08-01 ~01:45Z, analysis-only, PRE-READOUT)

Recorded BEFORE any of the 13 in-flight rows landed (queue verified twice this
session: aggregates all waiting-children; run-row-at-full-drain model from s32
confirmed again — k003's children fully settled at 10,651+96 yet no row).
Replicates §11/§11.1 (which were computed on the OLD center g0=1008, P*0.96)
on the NEW standing baseline 1029 (P*0.92). Same query method: intent_meta
JSON_TABLE, per-market UP VWAP + DOWN VWAP over all buys, matched =
min(ΣUP, ΣDOWN), early_matched = same but fills with ts < start+300s.
Internal consistency: bucket pnl totals sum to −85.9k ≈ ev −8.07 × 10,651 ✓.

**Mission §2 fractions at P*0.92 (run 1029; 8,759 both-sided markets):**

- avg matched 155.9 sh (was 225.4); avg final |imbalance| 4.1 sh (was 12.1).
- per-market pair VWAP: mean 1.0876 (was 1.1015); matched-share-weighted
  1.0571 (was 1.0545).
- fractions below target: **<0.98 = 30.2% (was 21.2%), <0.95 = 23.1% (was
  7.6%), <0.90 = 5.43% (was 0.34%)**. The tighter price gate moves the
  fraction metrics dramatically; the big <0.95 jump is mechanical (buys are
  capped at 0.92 per pair, so completed pairs mostly land under 0.95).

**Matched-bucket structure (monotone shape REPLICATES):**

| matched bucket | mkts | avg pair VWAP | avg pnl | total pnl |
|---|---|---|---|---|
| <100 | 140 | 1.1834 | −18.35 | −2.6k |
| 100–250 | 7,590 | 1.1001 | −11.70 | **−88.8k** |
| 250–500 | 1,003 | 0.9838 | **+4.47** | +4.5k |
| 500+ | 26 | 0.9285 | **+37.66** | +1.0k |

Whole loss again sits in the 100–250 bucket; 250+ is ev-positive at BOTH
centers. But the population reaching 250+ shrank 3.5× (1,029 vs 3,610 mkts)
— P*0.92 buys better prices at the cost of accumulation volume. Same §11
caveats bind (outcome-conditioning; guard-7 depth optimism strongest in the
profitable buckets).

**§11.1 replication — early-detectability + S attribution at 0.92:**

- Early-bucket pnl monotone replicates: e<50 → −10.96 (4,671 mkts), 50–150 →
  −9.60 (3,625), 150–300 → −0.46 (428), 300+ → +7.83 (40).
- **The ≥150-at-min-5 population collapses: 468 mkts = 4.7% (was 2,680 =
  26.4% on 1008).** The flag still separates cleanly, but at this center the
  deficit signal is near-universal.
- S-fill settle-value attribution (same exact method as §11.1):
  - low_early (<150, ~8.3k mkts): pre5 S net −32.4k (461.4k lose sh @ .407 vs
    295.7k win @ .474); post5 S net **−38.7k** (557.0k lose @ .360 vs 323.4k
    win @ .500). Total −71.1k.
  - high_early (≥150, 468 mkts): pre5 +3.4k, post5 −1.1k ⇒ total **+2.3k ≈
    fair** (replicates the 1008 finding that healthy-pace markets' S flow is
    not toxic).
- **Post-flag share of the S toxicity rose to ~54% (−38.7k of −71.1k S net;
  ~45% of the whole −85.9k baseline loss), vs ~40% on 1008.** First-order
  v17o headroom is proportionally LARGER at the new center.

Interpretive prior for the in-flight v17o cells (bars in §10 of pair-v17o.md
stand unchanged — this is context, not a rule change): with 95% of markets
under the 150 pace at min 5, v17o's concession acts nearly globally, so its
cells should read as "state-weighted global tighten" rather than selective
throttle; the false-flag cost side (suppressing S in healthy markets) is
bounded by the tiny 4.7% healthy population (whose post-5 S net is −1.1k ≈
nothing to lose). The decisive metric is whether suppressed post-5 S volume
was the toxic part — read the §7 mechanism literal (post-grace S counts) and
C/D shift before interpreting ev deltas.

## §14 Full loss identity + C/D baseline on p92 = 1029 (s38, 2026-08-01 ~01:55Z, analysis-only, PRE-READOUT)

Recorded before any of the 13 in-flight rows landed (queue verified 01:47Z:
13 aggregates waiting-children; v17t k003/k006 children fully settled at
10,651, k012 at 6,993, rows land at full drain per the s32 timing model).
Completes the 1029 loss identity: §13 covered S flow; this section adds the
C/D/R/fees terms — and pins the C/D baseline that the frozen v17o
watch-metric (pair-v17o.md §5/§7) and E-045b mechanism metrics (§12) compare
against. Known-answer check FIRST: the same query on 1008 reproduces the s29
§10 table EXACTLY (C lose 223,350 @ 0.403 / −89.9k; C win 179,855 @ 0.564 /
+78.5k; D lose 168,312 @ 0.818 / −137.6k; D win 724,388 @ 0.823 / +128.1k;
S −823.3k/+712.8k). Query = §10's leg-vs-outcome JSON_TABLE with COUNT(*)
added.

**Mode × outcome on 1029 (settle-value attribution; net = settle − cost):**

| mode | outcome | fills | shares | avg $ | cost k | net k |
|---|---|---|---|---|---|---|
| S | lose | 11,272 | 1,127,200 | 0.383 | 431.3 | −431.3 |
| S | win | 7,036 | 703,600 | 0.485 | 341.1 | +362.5 |
| C | lose | 4,876 | 128,704 | 0.350 | 45.0 | −45.0 |
| C | win | 4,879 | 87,388 | 0.521 | 45.6 | +41.8 |
| D | lose | 2,892 | 130,932 | 0.821 | 107.5 | −107.5 |
| D | win | 13,480 | 589,564 | 0.830 | 489.2 | +100.4 |
| R | both | 4 | 400 | ~0.05 | 0.0 | +0.1 |

Identity: S −68.8k + C −3.2k + D −7.1k + R +0.1k + fees −12.1k = −91.1k vs
measured pnl −85.9k — residual +5.2k, same sign and relative scale as the
known 1008 residual (+9k on −143.9k; rounding + flat rows). S net −68.8k
cross-checks §7 of pair-v17m.md (−69.4k via avg-price rounding) ✓.

**Readings (baseline facts, not rule changes):**

1. **Completion-leverless TRANSFERS to the 0.92 center.** D is ~fair at
   0.92 exactly as at 0.96: share-weighted win rate 81.8% vs avg price
   0.830 ⇒ −1.0¢/sh ≈ fees. C is now nearly EV-flat outright (−3.2k on
   216k sh, was −11.4k on 403k). No completion-side lever appeared at the
   new center; E-041's CEIL-NULL mechanism argument still binds.
2. **Loss composition at 0.92:** S adverse selection −68.8k (80%), fees
   −12.1k (14%), D −7.1k (8%), C −3.2k (4%) (sums >100% vs the +5.2k
   residual). The tilt (E-046) and quote-shaping (v17t/v17o) programs
   remain pointed at the only structurally biased term.
3. **C/D watch-metric baseline (v17o cells + E-045b compare against
   THESE):** C = 9,755 fills / 216,092 sh / $90.6k spend; D = 16,372
   fills / 720,496 sh / $596.7k spend; C+D total = 26,127 fills /
   $687.3k. Run-row cross-check: taker_fills 30,019, maker_fills 16,935,
   fees $12.1k (SUM over backtest_run_markets). A v17o cell whose C/D
   spend rises materially above $687k has shifted suppressed maker flow
   into taker completions — E-042's anatomy failure mode; read this
   BEFORE celebrating any S-toxicity reduction.
4. Scale note: total bought volume at 0.92 is 3.40M sh vs 4.70M at 0.96
   (−28%), consistent with §13's exposure-reduction story (invested
   292→166, ev gain from participating less).
