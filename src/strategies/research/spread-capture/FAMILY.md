---
artifactType: strategy-family
family: spread-capture
---

# spread-capture

## Thesis

Every prior directional idea on BTC 15m up/down markets died on execution
costs, not on signal absence: takers on this venue pay the bid-ask spread plus
a ~156 bps taker fee on every entry, and the measured mispricings were smaller
than that floor. The flip side of "takers always pay" is that someone always
collects — the resting maker. This family takes the collecting side: split $1
of collateral into one UP + one DOWN share (a full set, guaranteed to redeem
for exactly $1 at resolution), then rest maker SELL orders on BOTH legs above
their mids. Takers who cross the spread for instant directional exposure —
retail chasing the BTC move, and the arb bots that were measured taking any
sum-of-asks < $1 instantly — buy from these resting asks.

Who is on the other side: impatient directional takers in a fast 15-minute
market, paying spread + taker fee for immediacy. Why the mispricing exists:
immediacy in a 15-minute episode is genuinely scarce — books are thin, the
window is short, and urgency is high near BTC moves. Why it has not been
arbitraged away: liquidity provision is not free money — it carries adverse
selection (in a trending window the winning leg sells cheap and the losing leg
stays in inventory), inventory risk, and capital lockup until resolution.
Those risks are the compensation being charged; the research question is
whether the collected spread exceeds the realized adverse selection. Unlike
every killed comparable, the direction-agnostic maker structure pays zero
taker fees, and the unsold full-set remainder is hedged by the $1 redemption,
bounding the downside per market.

## Signal definition

All quantities come from recorded tick snapshots (`book` / `price_change`
only) and shared portfolio state; no external feeds, no live-only fields.

Per market (one 15m episode), with `up` and `down` the two legs from market
metadata (`upAssetId` / `downAssetId`):

- `midS` = `snapshot.byAssetId[S].mid` for leg `S` (null-guarded; a leg
  without a valid mid is not quoted).
- Window end: `endMs = (epochStart + 900) * 1000` parsed from the slug
  `btc-updown-15m-<epochStart>`; fallback when the slug is unavailable:
  first-tick timestamp + 900,000 ms.
- Entry: on the first tick where BOTH legs have a valid `bestBid`, `bestAsk`,
  and `mid`, emit one `split_positions` of `sizeUsd` full sets (cost
  `sizeUsd` USDC, yields `sizeUsd` UP + `sizeUsd` DOWN shares).
- Quoting: for each leg `S` with inventory `qty >= 1` and no active ask,
  place maker `SELL` at `askS = clamp(round2(midS + offset), 0.01, 0.99)`
  for the full remaining `qty`, order type `GTC`.
- Reprice: an active ask placed at price `p` implies its reference mid
  `ref = p - offset`. When `|midS - ref| >= repriceDelta`, cancel it; a fresh
  ask at the current mid is placed on a later tick once the cancel settles.
  `repriceDelta = 1` is the "never reprice" sentinel (mids live in (0,1), so
  the threshold is unreachable).
- Cutoff: when `endMs - now <= quoteStopSec * 1000`, emit one `cancel_all`
  and stop quoting. Remaining inventory is held to resolution (a full set
  redeems $1; an unpaired leg redeems its outcome value).

Knob defaults (these are `search.defaults`; justification):

- `sizeUsd = 10` — small enough to sit inside typical L1 depth on these
  books; in the simulator maker fills take the full resting quantity at the
  resting price, so EV scales linearly in size and the default only needs to
  be representative (pass 4 is a linearity check, expected flat per-dollar).
- `offset = 0.02` — roughly the observed half-spread-to-full-spread scale on
  these books (spreads typically 1–3 cents); one notch above the tightest
  quotable improvement (0.01) so the premium is not given away.
- `repriceDelta = 0.02` — reprice only when the mid has moved a full spread
  width, balancing staying near the market against cancel churn (each
  reprice risks a fill-before-cancel under queued intent execution).
- `quoteStopSec = 120` — stop quoting in the last two minutes: late-window
  books collapse toward 0/1 and turn one-sided, where a resting ask is pure
  adverse selection (pre-protocol convergence work measured late-window
  books as the most decisively one-sided regime).

## Edge economics

Costs are measured, never modeled; the argument here is mechanism plus
measured comparables from pre-protocol runs (numbers live in
`backtest_runs`, cited by batch uid).

- The measured killer of every comparable was the taker fee, not the signal:
  spike-reaction taker runs measured ~$325 fees per 1000 markets (~$0.33/mkt
  drag); orderbook-imbalance's best taker cell measured gross +$335 over
  6000 markets (+$0.056/mkt) collapsing to net +$11 ≈ $0 after fees (batch
  `obimb-sweep-14-ext2`). Conclusion measured there: order-book mispricings
  on this venue are smaller than TAKER costs. This family pays no taker fee
  on any leg by construction — entry is a fee-free `split`, exits are maker
  fills, remainder is redeemed. The measured ~$0.33/mkt fee floor that
  killed the comparables is structurally absent.
- Gross collection when both legs fill: asks rest at `mid + offset` on each
  leg, and the two mids sum to ≈ $1, so a fully sold set collects
  ≈ `1 + 2*offset` against a $1 split cost — at defaults ($10, offset 0.02)
  up to ≈ $0.40/mkt gross, an order of magnitude above the +$0.056/mkt best
  measured gross of the strongest killed directional family.
- The real cost is adverse selection, and the closest measured comparables
  are one-sided maker orders conditioned on directional signals:
  spike-reaction maker entries measured gross −$676 (chasing momentum), and
  orderbook-imbalance's maker take-profit variant cut fees by $41 but lost
  $93 gross (batch `obimb-v2-maker-6000`). Both rested a single maker order
  precisely when a directional signal said the market was about to move
  through it. This family is structurally different: quoting is symmetric
  and unconditional, one leg's adverse fill is partially offset by the
  premium already banked on the other leg (or by the redemption hedge), and
  quoting stops before the late-window one-sided regime. Whether symmetric
  premium collection beats trending-window adverse selection is exactly what
  the stage-1 screen measures.
- Known risk, stated honestly: pre-protocol spike work measured that 15m BTC
  mid-spikes CONTINUE rather than revert (following won 40% vs fading
  27.6%), so trending windows will produce one-sided fills; the roadmap's
  inventory-stop and pair-completion ideas exist for that failure mode.
- The backtest maker model (`worst_queue`) fills a resting SELL only when
  `bestBid` rises through the resting price — it simulates ONLY the most
  adversely-selected subset of real fills and none of the benign
  ask-lifting flow. A net-positive stage-1 result under this model is
  therefore a conservative signal, not an optimistic one.

## Experiment roadmap

Ranked, mechanism-distinct ideas beyond the baseline; prose only until the
Researcher specs them.

1. **Pair-completion repricing** — after the first leg fills, aggressively
   reprice the surviving leg to the NEW mid plus a reduced offset so the set
   completes and banks `~2*offset` before the trend runs away, instead of
   letting the survivor rot at a stale price. Targets the measured
   winners-rot failure of static maker exits.
2. **Inventory stop** — the moment one leg fills, cancel the opposite ask
   and stop quoting (optionally re-arm if the mid returns within a band of
   0.5). Caps the trending-window loss at one adversely-selected fill plus
   the redemption hedge, trading premium frequency for tail control.
3. **Static ask ladder** — place a one-shot ladder of asks at fixed absolute
   prices on both legs at window open (e.g. 0.55 / 0.60 / 0.65) and never
   cancel. Removes reprice churn and fill-before-cancel latency risk
   entirely; sells more the further the market swings, monetizing
   oscillation without tracking it.
4. **Early-window-only quoting** — quote only the first N minutes when mids
   sit near 0.5 and outcome uncertainty is maximal, then hold the hedged
   remainder. Pre-protocol convergence work measured late-window books as
   decisively one-sided; this cuts the window where a resting ask is most
   likely to be pure adverse selection.
5. **Spread-anchored quoting** — quote relative to the book instead of the
   mid: rest at `bestAsk - 0.01` (join/improve the touch) so the collected
   premium scales with the liquidity premium actually being paid at that
   moment, rather than a fixed offset that may sit inside a wide spread or
   outside a tight one.
6. **Bid-side mirror (buy-and-merge)** — rest maker BUY bids below mid on
   both legs; whenever both fill, `merge_positions` returns $1 per pair
   against a combined cost of `1 - 2*offset`. Same driver from the other
   side of the book; different inventory profile (unpaired leg is a cheap
   directional remnant instead of a hedged set).

## Duplicate notes

`src/strategies/research/INDEX.json` lists no families yet — no research
dedup conflicts. Boundary notes against adjacent ideas so future proposals
land correctly:

- Killed pre-protocol directional families (spike-reaction,
  orderbook-imbalance, convergence-near-expiry, favorite/underdog) all
  decided WHICH side to take from an order-book signal. This family's
  driver is providing liquidity symmetrically and earning the spread;
  direction is deliberately not predicted. A proposal that adds a
  directional entry signal to maker quoting belongs to a signal family, not
  here.
- Legacy (non-research, out of dedup scope) `SplitSellRedeem.*` splits and
  then sells ONE side chosen by dwell/time gates — an inventory bet on
  direction. Shares the split plumbing, not the driver.
- Legacy `BuyBoth`/`buyBothSidesAndMerge` style taker complement-arb (lift
  both asks when they sum < $1) was measured dead pre-protocol — faster
  bots take it. This family is the maker counterparty of that flow, not a
  faster taker.
- `duplicateKeys` cover the synonym space: market-making,
  liquidity-provision, two-sided quoting, split-and-quote, spread
  harvesting, both-sides maker, complement-set market making.

## Research log
