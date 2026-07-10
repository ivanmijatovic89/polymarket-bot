# EDGE-SPACE — the measured map, its limits, and what would extend it

_Written session 6 (U31), after EXP-007's kill resolved the last open idea.
Motivating decision: DECISIONS D15. This is a knowledge artifact: it states
what eight experiments proved, what they cannot prove by construction, and
what instrumentation (operator decisions, outside this lab's write scope)
would extend the measurable space. It also sets the binding bar any future
registration must clear._

## 1. The measured map

Every strategy expressible in this engine draws PnL from exactly three
channels (engine/CAPABILITIES.md §4): taker fills (cross the spread, 156 bps
fee), maker fills (worst-queue punch-through, zero fee), and settlement
arithmetic. There is no fourth channel. All three are now measured on the
operator-fixed universe (Polymarket BTC 15m up/down, Telonex replay):

| channel | mechanism tested | experiment | verdict | lesson |
|---|---|---|---|---|
| taker | expiry certainty discount (tails) | EXP-001 | kill at main, N=13,977 | E14 |
| taker | UP+DOWN dutch books | EXP-002 | kill (0 entries — none exist net of fees) | E9 |
| taker | post-jump stale ladder | EXP-003 | kill (jumps priced exactly fairly) | E10 |
| taker | depth-imbalance drift | EXP-004 | kill (prediction contradicted) | E11 |
| taker | first-minute overreaction | EXP-005 | kill (prediction contradicted) | E12 |
| maker | quiet-regime two-sided quoting | EXP-006 | kill (model-conditional, D14) | E16 |
| maker | loud-regime countertrend bids | EXP-007 | kill (model-conditional, D14) | E17 |
| maker (touch bound) | at-touch quiet quoting (frozen EXP-006 cell) | EXP-008 | kill (decisive under the engine's most favorable fill assumption) | E19 |
| maker (touch bound) | at-touch loud countertrend (frozen EXP-007 cell) | EXP-009 | kill (decisive under the engine's most favorable fill assumption) | E19 |
| — | expiry-tail maker capture | IDEAS #7 | dead unexamined (park clause, EXP-001 kill) | — |
| taker (plane scan) | fixed-time top-of-book, both sides, 126-cell offset × price grid | CAL-001 | null-confirmed (0 candidates, 0 neg-flags at z ≥ 3.565) | E20 |

Summary of the map:

- **Taker side: fairly priced everywhere tested — now as a systematic
  plane, not just five points (E20, 2026-07-10).** Five independent
  probes measured gross edge ≈ 0 at the achieved entry prices (win rate
  ≈ mean entry ask to 3-4 decimal places in three of them). The 156 bps
  taker fee therefore makes every tested taker strategy strictly
  negative. The fee floor is ~1.5c/share gross at mid-range prices
  (E10). CAL-001 then scanned the full fixed-time plane (7 offsets × 9
  price buckets × both sides, 8,516 discovery markets): zero cells clear
  the candidate bar in either direction; the extreme-price tails — where
  power beat the fee floor by 15× — are clean on both sides. Within
  stated power (mid-range resolves only |d| ≳ 3.8c; 750s/850s cells
  conditional on a book event at coverage 0.87/0.60), fixed-time
  top-of-book state carries no taker-exploitable signal.
- **Maker punch-through side: adversely selected at both regime extremes.**
  Under worst-queue, a fill IS a move through the level; that move is
  informative whether the tape is quiet (E16: −0.79/played market) or loud
  (E17: −1.27/played market), at zero maker fee, with fill size simulated
  in the strategy's favor. No regime gate between those extremes has any
  evidence of flipping the sign.
- **Maker at-touch bound: worse, not better (E19, 2026-07-10).** The
  U35/D18 `touch_or_better` instrument re-ran both frozen cells at the
  optimistic end of the fill bracket. Measured brackets, EV/market:
  quiet [worst_queue −0.18, touch −0.433] (runs 336/357), loud
  [worst_queue −0.45, touch −0.848] (runs 342/358). Negative at BOTH
  ends in both regimes — touch mode roughly doubles fill density at the
  same negative EV per played market. The real queue model's location
  inside the brackets is economically moot.
- **Settlement: arithmetic, not an edge.** Merge/split/redeem are modeled
  costless and priceless; no channel there.

## 2. What this does and does not prove

Proved (in-model, on 2025-11-30 → 2026-04-26 exploration data): no strategy
expressible in this simulator has durable positive EV on this universe.
The two model conditionals doing the work:

1. **Worst-queue maker fills** (CAPABILITIES §4): no fill at touch — every
   simulated maker fill is the maximally informed counterparty. This makes
   maker KILLS model-conditional by construction (DECISIONS D14): E16/E17
   close the punch-through-backtestable versions only.
2. **Flat 156 bps taker fee** — a hardcoded model assumption, not a live
   schedule. Taker kills are robust to this only because measured gross
   edges were ≈ 0, not merely below fee.

The at-touch question, previously listed here as NOT proved, is now
measured at both ends of the fill-model bracket (E19, EXP-008/009): even
under the engine's MOST FAVORABLE assumption (always first in queue,
full-size fills at touch, zero maker fee), both frozen cells lose more
than under worst-queue. Formally this remains "decisive under the most
favorable fill assumption the engine can express" (audit 4.1 — touch is
not a strict strategy-level upper bound because of inventory-cap path
dependence), but with both bracket ends negative in both regimes, no
intermediate queue model has a defined prize. What remains genuinely
unmeasured in-model: fill triggers on cells OUTSIDE the two tested
(different offsets/gates), and anything requiring trade prints or queue
data the dataset lacks.

## 3. Instrumentation that would extend the measurable space

All three are operator decisions. They require writing outside `fable-lab/`
or live activity, both forbidden to this lab (charter hard constraints 1
and 4). Ordered by cost:

1. **In-model optimistic bracket — UNLOCKED IN-LAB (U35, DECISIONS D18).**
   The engine already contains an at-touch fill model: `touch_or_better`
   (`BacktestExecution.ts:62,90`), hardcoded unreachable
   (`runSingleMarket.ts:133`). Originally classified operator-side; U35
   found the D7 wrapper can force it in-process (prototype hook on
   `onMarketTick`) with zero `src/` writes. Now available as
   `tools/run-backtest.ts --fill-mode touch_or_better` (batchUid must
   contain `touch`; mechanically enforced). Verified on 8 fixed markets,
   EXP-006 primary cell: worst_queue 2/8 filled (5 maker fills) vs touch
   8/8 (19 maker fills) — runs 352/353. Decision value is real in both
   directions: if even touch_or_better is ≤ 0, at-touch maker economics
   is dead in-model conclusively and no live measurement is worth
   funding; if > 0, the truth lies in [worst_queue, touch_or_better] and
   live measurement (§3.3) has a defined prize. BINDING (D18): touch
   results support only kill or operator-escalation decisions — never an
   advance toward holdout, never a live-EV claim.
   **RESOLVED (E19, 2026-07-10): EXP-008/009 measured both frozen cells
   under this instrument; both killed with the prediction contradicted
   (quiet −0.433, loud −0.848 EV/market — worse than their worst-queue
   parents). The ≤ 0 branch fired: no live measurement of THESE cells is
   worth funding. §3.2/§3.3 remain relevant only for mechanisms outside
   the tested cells or after a cited venue regime change (§4).**
2. **Trade-print ingestion (medium; sync/converter extension — and
   HISTORICALLY BACKFILLABLE, measured U42).** A queue-realistic fill
   model (fill when printed volume at your price exceeds the queue ahead
   of you) is the standard midpoint between the two bounds, but it needs
   executed-trade events, which the current replay stream lacks
   (`byType: book, price_change` — verified on every run). The earlier
   claim here that "historical data cannot be backfilled" was WRONG:
   Telonex offers a `trades` channel upstream (plus `quotes` and
   `onchain_fills`; docs/datasets/telonex/sync-design.md — "additional
   channels, gated by a CLI flag, no schema change required"), the synced
   catalog already records per-market availability
   (src/db/schema.ts:379 trades_from/trades_to), and
   `tools/trades-coverage.ts` (U42) measured coverage on the lab's
   eligible universe: 17,878 / 18,635 markets (95.9%) have trades data,
   spanning 2025-11-29 → 2026-06-14 (quotes 100%, onchain_fills 91.6%).
   The engine's live decoder already parses `last_trade_price` with
   price+size (src/market/marketChannelDecoder.ts:37,
   OrderBookEngine.ts:149) — the missing pieces are operator-side:
   extend download-raw-files to the trades channel and teach a converter
   to emit trade events the replayer forwards. This is the highest-value
   instrumentation on the list: it would replace both bracket ends with
   one queue-realistic measurement on HISTORICAL data, no live activity
   needed.
3. **Live paper at the touch (most direct; needs authorization).** Rest
   tiny GTC quotes at touch on a funded account and measure: fill rate per
   quoted hour, realized fill-to-settlement PnL, adverse-selection decay
   after fills, effective queue time. DRY_RUN=true cannot produce this —
   unplaced orders get no fills — so it requires real (tiny) orders, which
   is outside this lab's charter. The measured numbers would replace the
   worst-queue conditional in every maker verdict.

## 4. Binding bar for future registrations (idea-generation discipline)

Recorded here so a fresh session cannot un-know it. Per D15, an idea may be
registered only if one of these holds:

- **Taker:** the mechanism argues, from recorded-data evidence, a gross
  edge ≥ ~1.5c/share at its entry prices (the E10 fee floor) AND is not a
  re-skin (D5) of the six measured classes. Five direct measurements of
  ≈ 0 make this a high bar — the argument must name who pays and why they
  were invisible to EXP-001..005. E20 raises it further: CAL-001 scanned
  the full fixed-time top-of-book plane (126 cells, both sides) and found
  nothing, so the argument must ALSO explain why the edge is invisible to
  a fixed-time state scan — i.e. it must live in conditional/path
  structure within the window, not in price level × time alone.
- **Maker, in-model:** the fill trigger must NOT be "the book moves
  through my level" under worst_queue. §3.1 has landed (D18, U35): the
  touch_or_better OPTIMISTIC bound is registrable — full pre-registration
  (frozen cells, prediction, kill bar, N), batchUid containing `touch`,
  and the D18 interpretive rules apply (outcomes are kill or
  operator-escalation only; the holdout stays locked regardless).
  Worst-queue punch-through variants, whatever their gate, re-test
  E16/E17 and stay auto-dead at dedupe. Touch-mode re-runs of the two
  measured cells (EXP-006/007 primaries) re-test E19 and are likewise
  auto-dead at dedupe; a NEW touch registration must argue why its cell
  or gate escapes the E19 mechanism (denser at-touch fills were MORE
  toxic, not less, in both regimes).
- **New data regimes:** the universe accrues ~96 markets/day. A
  structural change in the venue (fee schedule change, new market maker
  program, visible microstructure shift in recorded books) is evidence
  that can reopen a measured question — cite the observed change in the
  idea entry. This clause now has an instrument: `knowledge/VENUE-DRIFT.md`
  (D17) holds the measured monthly baseline and the pre-specified numeric
  bar for "visible microstructure shift". A citation under this clause
  must point at a VENUE-DRIFT row that fires the bar — eyeballing is not
  a citation.

Absent all three: the correct work is verification depth (auditing settled
conclusions), instrumentation advocacy (keeping §3 current), and protocol
maintenance driven by friction — not new runs. Data is cheaper than a false
belief, but compute spent re-asking answered questions is pure loss.
