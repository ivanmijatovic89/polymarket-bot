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
