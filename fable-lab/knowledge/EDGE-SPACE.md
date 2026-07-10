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
| — | expiry-tail maker capture | IDEAS #7 | dead unexamined (park clause, EXP-001 kill) | — |

Summary of the map:

- **Taker side: fairly priced everywhere tested.** Five independent probes
  measured gross edge ≈ 0 at the achieved entry prices (win rate ≈ mean
  entry ask to 3-4 decimal places in three of them). The 156 bps taker fee
  therefore makes every tested taker strategy strictly negative. The fee
  floor is ~1.5c/share gross at mid-range prices (E10).
- **Maker punch-through side: adversely selected at both regime extremes.**
  Under worst-queue, a fill IS a move through the level; that move is
  informative whether the tape is quiet (E16: −0.79/played market) or loud
  (E17: −1.27/played market), at zero maker fee, with fill size simulated
  in the strategy's favor. No regime gate between those extremes has any
  evidence of flipping the sign.
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

NOT proved: that at-touch liquidity provision (join the queue at the touch,
get filled by flow that does NOT move the level) loses. That channel —
where real maker PnL lives on most venues — is invisible to this
instrument. Nothing recorded in the dataset (book + price_change only; no
trade prints; no queue data) can decide it.

## 3. Instrumentation that would extend the measurable space

All three are operator decisions. They require writing outside `fable-lab/`
or live activity, both forbidden to this lab (charter hard constraints 1
and 4). Ordered by cost:

1. **In-model optimistic bracket (cheapest; one src-side line).** The
   engine already contains an at-touch fill model: `touch_or_better`
   (`BacktestExecution.ts:50-114`), hardcoded unreachable
   (`runSingleMarket.ts:133`). Exposing it (CLI flag or env) lets the
   frozen EXP-006/EXP-007 cells re-run under the OPTIMISTIC bound
   (always first in queue). Decision value is real in both directions:
   if even touch_or_better is ≤ 0, at-touch maker economics is dead
   in-model conclusively and no live measurement is worth funding; if
   > 0, the truth lies in [worst_queue, touch_or_better] and live
   measurement has a defined prize. This lab can run those re-runs the
   day the flag exists.
2. **Trade-print recording (medium; recorder/dataset change).** A
   queue-realistic fill model (fill when printed volume at your price
   exceeds the queue ahead of you) is the standard midpoint between the
   two bounds, but it needs executed-trade events, which the current
   dataset lacks (`byType: book, price_change` — verified on every run).
   If Polymarket's market WS emits trade prints (e.g. `last_trade_price`),
   the live recorder already persists raw messages and would capture them;
   the Telonex conversion would need a new event type. Historical data
   cannot be backfilled — this only pays forward.
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
  were invisible to EXP-001..005.
- **Maker, in-model:** the fill trigger must NOT be "the book moves
  through my level." No such trigger exists in the current engine — so
  in-model maker registrations are closed until instrumentation §3.1 or
  §3.2 lands. Any punch-through variant, whatever its gate, re-tests
  E16/E17 and is auto-dead at dedupe.
- **New data regimes:** the universe accrues ~96 markets/day. A
  structural change in the venue (fee schedule change, new market maker
  program, visible microstructure shift in recorded books) is evidence
  that can reopen a measured question — cite the observed change in the
  idea entry.

Absent all three: the correct work is verification depth (auditing settled
conclusions), instrumentation advocacy (keeping §3 current), and protocol
maintenance driven by friction — not new runs. Data is cheaper than a false
belief, but compute spent re-asking answered questions is pure loss.
