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
