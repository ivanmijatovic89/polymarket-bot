# SIGNAL-MAP — where gross predictive signal exists (and where it does not)

_Registered session 59 (U78), 2026-07-11. Motivating evidence (governor):
the operator's exploration mandate and hit-rate refinement (STATE.md
operator updates, 2026-07-11; charter §Data reality) — "MEASURE where any
gross predictive signal exists at all … aim ideas at measured signal,
record dead zones so nobody digs there again."_

This document is the lab's aiming map. §1 consolidates what the nine
experiments and four CAL scans already measured (all dead — the map's
seed). §2 registers SIGNAL-001, the scan over the feature axes those
instruments could NOT express. §3 (append-only, written after the one-shot
read) holds the results.

## 0. Epistemic grade of everything in this file

**Map-grade = hypothesis-generating, gross of costs, uncitable.** A
SIGNAL-MAP candidate zone licenses AIMING a screening strategy at it —
nothing more. It does not clear the EDGE-SPACE §4 registration bar by
itself, does not touch the reserve-confirmability envelope (U45), and is
never a confirmation citation. Survivor-grade rigor (frozen specs, reserve
or fresh-window confirmation, the locked holdout) is untouched (operator
mandate, same paragraph). Conversely a SIGNAL-MAP dead zone is a
power-scoped statement — "no signal above the stated resolution", not "no
signal".

## 1. The map's seed — already-measured dead zones (E9-E23)

From EDGE-SPACE §1 (full citations there):

- Fixed-time top-of-book state (7 offsets × 9 price buckets × both sides):
  dead (CAL-001/E20).
- Single-segment preceding move, sign × size (60 cells): dead for the
  buyer; the one significant structure is buyer-ADVERSE continuation
  (CAL-002/E21).
- Two-segment big-move sign paths (40 cells): dead; reversal shape is the
  strongest gross staleness but its mirror is sub-bar (CAL-003/E22 →
  IDEAS #10, frozen CONFIRM-010).
- Spread state × the fixed-time grid (252 cells): dead (CAL-004/E23).
- Five taker mechanisms (tails, dutch books, post-jump, depth-imbalance
  drift at one gate, first-minute overreaction): dead (E9-E14).
- Maker punch-through both regimes, both fill-model bracket ends: dead
  (E16/E17/E19).

## 2. SIGNAL-001 registration (frozen before any outcome join)

**Instrument:** `strategies/_fixtures/diag-signal.ts` (outcome-free; U78
commit) replayed over ALL 8,516 discovery-window markets
(market_start_ms < 1772323200000 = 2026-03-01T00:00Z; reserve and holdout
untouched), 6 disjoint local shards
(`fable-lab/logs/SIGNAL-001-shard[0-5].log`, batchUids
`SIGNAL-001-discovery-s[0-5]`), latency pinned 0/0. Shard disjointness
verified at launch: loaded counts 1377+1450+1332+1445+1456+1456 = 8,516.

**Features (16, causal at capture):** l1Imb, l5Imb, l10Imb (UP-book depth
imbalance at 1/5/10 cumulative levels; DOWN book is an exact mirror,
CAL-001 amendment #12), dTot5, dTot10 (total two-sided depth), nTicks,
rate60 (activity), vol (sd of nonzero mid deltas), nz, flips (path
choppiness), range, posR (position in running range), move60, firstMid,
firstTs (opening state), crossedN (E6 artifact count). Sampled at offsets
{150, 300, 600, 750, 850}s, first uncrossed-UP-book tick at-or-after the
offset, drift-filtered at the next offset bound (diag-calib precedent).

**Trades measured:** BUY UP at the UP ask; BUY DOWN at the DOWN ask
(mirror-linked, not independent — disclosed). Sample validity: uncrossed,
ask ∈ [0.02, 0.98], resolved market (result_id ∈ {0,1}).

**Reader:** `tools/signal-scan.ts` (selftest
`tools/signal-scan-selftest.ts`, 13 assertions green pre-freeze: planted
monotone signal detected both sides with correct signs, noise feature
stays quiet, filter accounting hand-counted, G1 flipped-join abort, the
--outcomes refusal guard). One-shot read on the real logs after ALL
shards complete and the coverage accounting is clean.

**Frozen statistics:**

1. **Monotone screen (primary):** per (offset, feature, side) — Spearman
   rank-correlation of feature vs residual (won − ask) within price
   strata LO [0.02,0.35) / MID [0.35,0.65] / HI (0.65,0.98] of the bought
   side's ask (strata with n ≥ 200 only), z_p = ρ·√(n−1), combined
   Stouffer with w = √n. k = 5×16×2 = 160. **CANDIDATE |z| ≥ 4.00**
   (Bonferroni α ≈ 0.01), WARM |z| ≥ 3 (recorded, not candidate).
2. **Cell grid (shape readout):** feature quintiles (rank-based) within
   (offset, stratum, side); d = mean residual, z under the scan-se
   convention (empirical sd). k = 2,400 evaluated cells (n ≥ 30).
   **CANDIDATE |z| ≥ 4.40.** Non-monotone shapes (mid-quintile bumps) can
   appear here without a monotone flag; both bars stand independently.
3. **Seasonality:** hour-of-day (six 4h UTC bins) and day-of-week cells at
   offsets {300, 750} × strata × sides; same cell bar 4.40.

**Gates (abort before any table):** G1 join-direction (ask ≥ 0.90 must win
> 75% per side), G2 global fairness (|z| of overall mean residual < 6 per
side).

**Multiplicity honesty:** the three families are tested at family-wise
Bonferroni ~0.01 each (joint ~0.03). UP/DOWN and adjacent offsets are
positively dependent (mirror trades, shared features) — Bonferroni is
conservative under that dependence. Cross-family double-counting of the
same structure (a monotone candidate will usually also light its extreme
quintile cells) is expected and is one finding, not two.

**Power (stated up front):** monotone screen at n ≈ 8,000/side/offset
resolves |ρ| ≳ 0.045; MID-stratum quintile cells (n ≈ 550, per-sample sd
≈ 0.39 — the U45 convention) resolve |d| ≳ 7.3c at z=4.4; pooled-stratum
monotone structure is the sensitive instrument here, single cells are
coarse. Dead zones below these resolutions remain formally open (and
economically sub-envelope anyway, per U45).

**Pre-committed interpretation:**

- Zero candidates anywhere → the map's answer is "no exploitable gross
  taker signal on these axes at these times, within stated power" — the
  operator's barren-verdict branch. Idea batch then aims at
  mechanism-level gaps (order-type structure, maker cells outside E19,
  settlement/timing mechanics) instead of feature zones, and says so.
- Candidates in buyer-adverse direction only (the E21/E22 pattern:
  staleness that costs the taker) → recorded as dead zones with the sign;
  aiming value is "avoid", not "trade".
- Buyer-favorable candidates → each becomes a named zone with (offset,
  feature, stratum, sign, d, z, n) and the idea batch aims screens at the
  strongest distinct zones first.

## 3. Results (append-only; nothing above this line changes after the read)

_Read executed 2026-07-11 session 61 (U85), one shot, after all six
shards completed (runs 448/451/452/454/455/458, each with its exact
frozen market count, 0 failures) and coverage accounting came back clean
(zero cross-shard slug overlap; 8,127/8,516 markets emitted ≥1 feature
line; 36,092 deduped (slug,offset) rows; 77 drift-discarded; outcome
joined for all 8,127 emitting markets, 0 unresolved). Verbatim tool
output below (the complete durable record — the gitignored
`logs/SIGNAL-001-scan-output.log` copy is byte-identical), then the
frozen-rule interpretation._

```
parsed 36092 deduped (slug,off) rows across 8127 markets (0 malformed, 77 drift-discarded; 8127 markets emitted any line)
per-offset market coverage: o150=8117
per-offset market coverage: o300=8109
per-offset market coverage: o600=7931
per-offset market coverage: o750=7061
per-offset market coverage: o850=4874
outcome joined for 8127/8127 markets (0 missing/unresolved — excluded)
samples: UP=32670 DOWN=32679 (ask in [0.02,0.98], uncrossed)
gate G1 UP: n=3623 ask≥0.90 winRate=0.9459
gate G1 DOWN: n=3518 ask≥0.90 winRate=0.9483
gate G2 UP: mean residual -1.164c z=-5.21 (n=32670)
gate G2 DOWN: mean residual -0.071c z=-0.32 (n=32679)

=== MONOTONE SCREEN (Spearman feature vs residual, Stouffer across strata; CANDIDATE |z|≥4.00, WARM |z|≥3.00) ===
  DOWN o150 firstMid z=-3.01 [LO:1544,MID:4963,HI:1609] WARM
  UP o150 firstMid z=+2.98 [LO:1478,MID:4941,HI:1698] 
  UP o300 firstMid z=+2.92 [LO:2298,MID:3267,HI:2539] 
  UP o850 l1Imb z=+2.87 [LO:1685,MID:412,HI:1224] 
  DOWN o850 l5Imb z=-2.87 [LO:1609,MID:400,HI:1294] 
  DOWN o300 firstMid z=-2.85 [LO:2419,MID:3278,HI:2405] 
  DOWN o850 l10Imb z=-2.77 [LO:1609,MID:400,HI:1294] 
  DOWN o300 l5Imb z=-2.72 [LO:2419,MID:3278,HI:2405] 
  DOWN o300 nz z=-2.67 [LO:2419,MID:3278,HI:2405] 
  UP o300 l5Imb z=+2.62 [LO:2298,MID:3267,HI:2539] 
  UP o850 l5Imb z=+2.56 [LO:1685,MID:412,HI:1224] 
  UP o300 nz z=+2.52 [LO:2298,MID:3267,HI:2539] 
  DOWN o300 move60 z=+2.51 [LO:2419,MID:3278,HI:2405] 
  UP o300 move60 z=-2.36 [LO:2298,MID:3267,HI:2539] 
  DOWN o850 l1Imb z=-2.34 [LO:1609,MID:400,HI:1294] 
  UP o300 range z=+2.29 [LO:2298,MID:3267,HI:2539] 
  DOWN o600 l10Imb z=-2.26 [LO:3183,MID:1465,HI:2863] 
  DOWN o300 flips z=-2.25 [LO:2419,MID:3278,HI:2405] 
  UP o750 move60 z=+2.22 [LO:2597,MID:885,HI:2135] 
  UP o850 l10Imb z=+2.18 [LO:1685,MID:412,HI:1224] 
  UP o300 flips z=+2.08 [LO:2298,MID:3267,HI:2539] 
  DOWN o300 range z=-2.01 [LO:2419,MID:3278,HI:2405] 
monotone screen: 0 CANDIDATE, 1 WARM of 160 tests (|z|<2 suppressed from listing)

=== CELL GRID (feature quintiles within (off, stratum, side); CANDIDATE |z|≥4.40) ===
  UP o150 LO flips q1 d=-7.56c z=-3.28 n=294 warm
  UP o300 LO rate60 q2 d=-6.44c z=-3.85 n=460 warm
  UP o300 LO nz q1 d=-5.23c z=-3.06 n=459 warm
  UP o300 LO crossedN q1 d=-5.35c z=-3.04 n=463 warm
  UP o600 LO rate60 q1 d=-2.66c z=-3.29 n=607 warm
  UP o600 LO vol q1 d=-3.45c z=-3.18 n=600 warm
  UP o600 LO firstTs q5 d=-4.58c z=-3.62 n=491 warm
  UP o750 LO l5Imb q3 d=-4.06c z=-3.51 n=519 warm
  UP o750 LO nTicks q1 d=-3.74c z=-3.78 n=519 warm
  UP o750 HI nz q1 d=-6.02c z=-3.73 n=426 warm
  UP o750 HI flips q1 d=-7.35c z=-4.32 n=428 warm
  UP o850 LO l10Imb q3 d=-4.05c z=-3.27 n=337 warm
  UP o850 LO range q4 d=-4.89c z=-4.71 n=338 CANDIDATE
  UP o850 LO posR q2 d=-3.53c z=-10.74 n=43 CANDIDATE
  UP o850 MID vol q4 d=-15.53c z=-3.05 n=83 warm
  DOWN o150 LO posR q2 d=-7.39c z=-3.22 n=307 warm
  DOWN o300 LO l5Imb q5 d=-5.54c z=-3.16 n=484 warm
  DOWN o300 HI rate60 q2 d=5.20c z=+3.12 n=481 warm
  DOWN o600 LO rate60 q1 d=-2.41c z=-3.21 n=637 warm
  DOWN o600 LO move60 q2 d=-3.52c z=-3.89 n=607 warm
  DOWN o750 LO l1Imb q2 d=-4.34c z=-4.52 n=522 CANDIDATE
  DOWN o750 LO flips q1 d=4.21c z=+3.15 n=521 warm
  DOWN o750 LO posR q4 d=-5.29c z=-6.77 n=41 CANDIDATE
  DOWN o850 LO rate60 q3 d=-4.95c z=-4.02 n=321 warm
  DOWN o850 LO nz q4 d=-4.89c z=-3.92 n=322 warm
  DOWN o850 LO flips q4 d=-4.80c z=-3.96 n=321 warm
  DOWN o850 HI range q4 d=4.51c z=+3.10 n=255 warm
cell grid: 4 CANDIDATE, 23 warm (|z|≥3) of 2309 evaluated cells

=== SEASONALITY (hour-of-day 4h bins + day-of-week, UTC; CANDIDATE |z|≥4.40) ===
seasonality: 0 CANDIDATE

scan complete — interpretation rules are frozen in knowledge/SIGNAL-MAP.md (map-grade only)
```

### Interpretation (per the pre-committed rules in §2 — map-grade only)

**Headline: ZERO buyer-favorable candidates on any axis.** The monotone
screen (the sensitive instrument, |ρ| ≳ 0.045 resolution at pooled n)
returned 0 candidates and 1 WARM in 160 tests; the cell grid returned
4 candidates in 2,309 evaluated cells — every one buyer-ADVERSE
(negative d: the taker who buys that cell's ask loses more than fee-free
fair); seasonality returned 0 candidates in both families. This is the
pre-committed barren-verdict branch combined with the E21/E22 pattern
branch: the idea batch that follows aims at MECHANISM-LEVEL gaps
(order-type structure, settlement/timing mechanics, anything outside
this feature×offset plane), not at feature zones — and says so.

**Named dead zones (sign = buyer-adverse; aiming value "avoid", not
"trade"):**

- **Z1 — late low-ask buys in wide-range windows:** UP o850 LO range q4,
  d=−4.89c z=−4.71 n=338. After a wide intra-window range, the cheap
  side's late ask still overprices recovery by ~5c gross.
- **Z2/Z2m — cheap side against range position, late (mirror pair):**
  UP o850 LO posR q2 (d=−3.53c z=−10.74 n=43) and DOWN o750 LO posR q4
  (d=−5.29c z=−6.77 n=41). Tiny cells with near-homogeneous residuals
  (per-sample sd ≈ 2-5c — these are 0.02-0.10-ask lottery tickets that
  essentially always lose); the huge |z| reflects the homogeneity, not
  economic size. Same family as E21/E22 continuation staleness: when the
  price sits at the wrong end of the running range late, the cheap
  side's ask has not fully converged to ~0.
- **Z3 — DOWN o750 LO l1Imb q2:** d=−4.34c z=−4.52 n=522. Mid-low
  top-of-book imbalance against the cheap DOWN late — again adverse.

**Recorded sub-bar structure (not candidates, listed for the map):**
1 WARM monotone: DOWN o150 firstMid z=−3.01 (mirror UP +2.98) — early
in the window, a higher opening mid slightly favors the UP buyer's
residual; sub-bar, sign consistent with drift-momentum, economically
≤ ~1c. The 23 warm cells cluster at LO strata with negative d —
diffuse buyer-adverse staleness on cheap sides, same family as the
candidates.

**Global asymmetry note (gate G2, passed but worth the map):** pooled
mean residual UP = −1.164c (z=−5.21, n=32,670) vs DOWN = −0.071c
(z=−0.32). Buying UP at ask across all offsets/strata loses ~1.2c gross
on this discovery window while buying DOWN is flat — a small systematic
UP-side overpricing whose tradable mirror (buy DOWN) is already
measured flat, i.e. it is spread-absorbed, not capturable (the E21
lesson at global scale). Map-grade observation only.

**Power reminder (frozen in §2):** dead zones are power-scoped — "no
signal above |ρ| ≈ 0.045 pooled / |d| ≈ 7.3c per MID cell", not "no
signal". Everything here is gross of costs; nothing in this section is
a registration citation (EDGE-SPACE §4 and the U45 envelope unchanged).

**Consequence for BATCH-002:** aimed-at-zone screens are OFF the table
(no favorable zone exists to aim at); the batch draws from
mechanism-level gaps instead, with Z1-Z3 recorded as places NOT to
provide the taker side. The four adverse candidates are NOT maker
invitations either: SCR-004r/t/o (BATCH-001) just measured that at-touch
maker capture of exactly this staleness family is adversely selected
even under the touch bound.
