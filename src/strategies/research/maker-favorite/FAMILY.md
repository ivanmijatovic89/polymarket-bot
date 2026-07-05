---
artifactType: strategy-family
family: maker-favorite
---

# maker-favorite

## Thesis

The simplest directional bet on a binary market is: buy the side that is
currently the favorite (mid > 0.5) and hold it to resolution. Taken as a
**taker**, this is a known dead end on BTC 15m — the favorite is priced
roughly fair, so crossing the spread and paying the taker fee turns a
fair-value bet into a guaranteed net loss (favorite/longshot calibration tilt
measured at only ~1-2¢, smaller than the ~2-4¢ round-trip taker cost).

This family changes exactly one thing: enter the favorite **as a resting
maker bid below mid**, never as a taker. Who is on the other side? Whoever is
selling the favorite down to our resting price. The bet is that on a _stable_
favorite — one we picked purely because its mid sits above a threshold, with
no toxic momentum/imbalance trigger — the counterparties hitting our bid are
ordinary liquidity-driven sellers, not informed flow. If so, we acquire a
fair-valued position at a below-mid price with zero taker fee, and the maker
discount is real edge. The reason it is not already arbitraged away: makers on
this venue are thin near the touch, retail sizing is small, and passive
below-mid bids sit unfilled unless price actively ticks toward them.

The whole family is a test of the one lever prior BTC-15m research left open:
**cheaper execution (maker/fee-free) rather than a bigger signal.** If even a
plain, unconditioned favorite hold cannot survive as a maker, the maker lever
is closed for directional entries too.

## Signal definition

All fields come from the replayed order book (`snapshot.byAssetId[assetId]`)
and market metadata (`ctx.market.upAssetId/downAssetId/slug`). No external
feeds, no plugins.

Per episode (one 15m market), on the first tick where **both** legs have a
usable book (`bestBid`, `bestAsk`, `mid` all present) and warmup has completed:

- `upMid = byAssetId[upAssetId].mid`, `downMid = byAssetId[downAssetId].mid`.
- `favAssetId = upMid >= downMid ? upAssetId : downAssetId`;
  `favMid = max(upMid, downMid)`.
- **Entry gate:** act only if `favMid >= favThreshold`. Otherwise the market
  is too close to a coin-flip; skip the whole episode (place nothing).
- **Resting bid price:** `bidPrice = round2(favMid - discount)`, clamped to
  `[0.01, 0.99]`. Because `bidPrice < favMid <= bestAsk`, the order rests
  (it never crosses), i.e. it is always a maker.
- Place exactly **one** GTC BUY of `size` shares at `bidPrice` on
  `favAssetId`. Deterministic `clientOrderId` keyed by market + favorite side.
- Do nothing else for the rest of the episode: no reprice, no cancel. Whatever
  fills is held to resolution (winners redeem at $1, losers at $0). An
  unfilled bid simply expires with the market at zero cost.

Default knobs (justified in Edge economics):

- `favThreshold = 0.55` — only trade decided-ish favorites, where mid is
  meaningfully above 0.5 so the below-mid discount stays a valid probability.
- `discount = 0.02` — rest 2¢ below the favorite mid; the central
  maker-discount-vs-adverse-selection tradeoff and the highest-impact knob.
- `size = 20` shares — ~$11-15 notional at typical favorite prices; large
  enough to clear minimum order size, small enough to fill against thin books.

## Edge economics

Costs are measured, not modeled — the numbers below are the mechanism
argument, verified against measured outcomes of comparable strategies.

Gross-edge ceiling if the favorite is fair (win% ≈ mid) and fills are
**unbiased**: each filled share is bought at `mid - discount` and pays out
`mid` in expectation, so gross EV ≈ `+discount` per share. At the baseline
`discount = 0.02`, `size = 20`, that is up to **+$0.40/market gross** on
filled episodes, and it carries **zero taker fee** (fills are maker).

The comparable measured numbers:

- **Taker favorite is fee-bound.** Favorite/longshot calibration tilt on BTC
  15m measured ~1-2¢ — below the ~2-4¢ round-trip taker cost; taker fee drag
  alone measured ~$0.30-0.33/market on comparable directional strategies. So
  the taker version loses net. This family removes both the crossed spread and
  the taker fee → structurally different from the fee-bound taker.
- **The enemy is adverse selection, not fees.** Signal-triggered maker entries
  measured badly precisely here: a spike-triggered maker was adversely
  selected to gross ≈ −$676 over ~1000 markets; an imbalance maker take-profit
  lost ~$93 gross over 6000 markets versus its taker twin (net swing ≈
  −$0.015/market) — the fills it got were the toxic ones. Those makers were
  triggered by a _directional signal_, so the flow hitting them was informed.

The bet of this family is the untested middle: a maker bid placed on a
favorite chosen **only** for being a favorite (no momentum/imbalance trigger)
should see less-informed flow than a signal-triggered maker. Net EV is then
`discount − adverse_selection − nonfill_opportunity_cost`. If adverse
selection on an unconditioned favorite is < ~2¢/share, the baseline is
net-positive; if it is ≥ the discount (as it was for triggered makers), the
family is closed and the maker lever is dead for directional entries. Either
way the answer is measured cheaply at stage 1.

## Experiment roadmap

Ranked, mechanism-distinct ideas beyond the baseline (prose until specced):

1. **Discount depth curve (adverse-selection profile).** Sweep `discount`
   wider (0.00→0.10) at fixed threshold to map fill-rate vs realized win% of
   fills. A discount that fills often but wins rarely proves adverse
   selection; one where deeper discounts keep winning proves real edge. This
   is the decisive diagnostic and the baseline's first pass.
2. **Favorite strength gate.** Vary `favThreshold` (0.52 → 0.75). Stronger
   favorites are "more decided" — do they suffer less adverse selection (fewer
   flip on us), or is the discount just smaller in absolute EV? Tests whether
   the edge lives in mild or strong favorites.
3. **Entry-time window.** Only rest the bid inside a window of the episode
   (e.g. skip the first N seconds while the market is finding its level, or
   stop entering in the last M seconds). Early ticks may be noisier; late
   entries have less time to be adversely picked off.
4. **No-chase reprice discipline.** If the favorite mid rises after we rest,
   our stale bid becomes a deep bargain that only fills on a reversal (toxic).
   Test cancelling-and-not-replacing when mid moves away by K cents — refusing
   fills we can only get when the favorite weakens.
5. **Underdog mirror (sign check).** Rest the maker bid on the _underdog_
   (mid < 0.5) at the same discount. If the underdog maker also "wins," the
   discount is an artifact of fill mechanics, not a favorite edge; if only the
   favorite side works, the directional thesis holds. A cheap control.
6. **Fill-then-hold vs fill-then-flatten.** Instead of holding to resolution,
   test resting a maker _ask_ a few cents above our fill to scratch out the
   spread on winners quickly, reducing resolution-time regime risk (capacity /
   variance) while keeping the maker-only, fee-free posture.

## Duplicate notes

Not a duplicate of `spread-capture`. That family is **market-neutral**: it
splits collateral into UP+DOWN full sets and rests maker **asks on both legs**
to harvest the spread takers pay, hedged by $1 redemption — its
`duplicateKeys` are all two-sided/market-making terms (`both-sides-maker`,
`split-and-quote`, `two-sided-quote`, `complement-set-market-making`).
maker-favorite is **directional**: a single maker **bid** on one chosen side
(the favorite), no split, no second leg, betting on calibration + maker
discount rather than on spread capture. Different primary decision driver
(directional favorite entry vs market-neutral spread harvest), so a different
family.

## Research log

### 000-baseline

The baseline tested the simplest version of the family: choose the higher-mid
BTC 15m leg, place one resting maker bid below mid, and hold any fill to
resolution. Stage-1 coordinate search first showed that the discount pass was
negative at the default threshold, with `discount=0.01` least bad at
`-0.07` net EV per market and wider discounts deteriorating monotonically.
The favorite-strength pass changed the result: lowering the gate to
`favThreshold=0.52` produced the first positive cell at `0.20` net EV per
market over 1000 markets, while higher thresholds reduced participation and
EV. The size pass then scaled nearly linearly; the winner was
`favThreshold=0.52`, `discount=0.01`, `size=40`, run `177`, with `0.39` net
EV per market over 1000 markets, 451 markets played, and 460 trades. Gate 1
therefore passed under `STAGE-GATES.md` version 1.

Interpretation: the family is not just a maker-fee avoidance test anymore;
the edge appears specifically in mild favorites, not strong favorites, and
the 1 cent maker discount gives enough fill volume without pushing the fill
set into obviously toxic reversals. The linear size response is encouraging
for stage 1, but it is not proof of capacity: the grid only tested small
retail sizes, and the Evaluator flagged 10 accidental taker fills in the best
cell plus possible queue/liquidity realism limits. The stage-2 extension then
reversed the result: the same run over 3000 markets fell to `-0.39` net EV per
market, with 1459 markets played, 1483 trades, and win rate down to `52.36%`.
Gate 2 recycled the experiment; the newest 1000-market edge did not survive
the immediately older 2000 markets.

The next experiment is `001-entry-window`: keep the same mild favorite gate,
1 cent discount, and size 40, but only place the one resting bid inside an
elapsed-time window. This is the simplest mechanism-distinct follow-up because
it asks whether the screen/confirm split was caused by unstable entry timing
rather than the favorite-maker premise itself.

Lesson: A very simple passive favorite bid can pass the 1000-market screen,
but the edge is not stable across immediate older history; treat mild-favorite
maker entry as regime-sensitive until an entry-window or no-chase filter
passes confirm.

### 001-entry-window

This experiment kept the same mild favorite maker bid from `000-baseline` and
added elapsed-time gates around the one-shot entry. The start pass showed that
immediate entry remained the best screen cell: `startSec=0` repeated the
baseline's `0.39` net EV per market over 1000 markets, `startSec=180` stayed
positive but weaker at `0.29`, and `startSec=60`/`300` were negative. The
stop pass then tied exactly across `stopSec=300`, `600`, and `840`, each at
`0.39` net EV per market with 451 markets played and 460 trades. Evaluator
selected the simplest tied value, `stopSec=300`, and gate 1 passed.

The stage-2 extension was decisive: run `185` over 3000 markets fell to
`-0.39` net EV per market with 1459 markets played and 1483 trades, matching
the baseline confirm failure. Interpretation: the stop boundary did not
change the fill set on recent coverage, and immediate-entry timing is just
the same unstable mild-favorite maker bet with a different wrapper. Delaying
entry can change the fill set, but the best delayed screen cell was weaker
than the already-failed immediate entry, so the next test should change the
side or fill mechanism rather than adding another stop-time wrapper.

Lesson: A stop-only window around a one-shot first-eligible maker bid is not a
real mechanism change; if the order usually enters before the stop boundary,
it will reproduce the baseline screen and confirm behavior.

### 002-underdog-mirror

This experiment ran the roadmap sign check: keep the one-shot resting maker
bid and hold-to-resolution lifecycle, but buy the lower-mid leg instead of
the favorite. The first pass swept the underdog cutoff. The `0.35` cutoff had
zero trades, so Evaluator excluded it as non-evidence. Among cells that
actually traded, `maxUnderdogMid=0.40` was least bad at `-0.06` net EV per
market over 1000 markets with only 14 trades and a `28.57%` win rate; wider
cutoffs increased participation but got much worse, down to `-1.59` net EV
per market at `0.48`.

The discount pass fixed `maxUnderdogMid=0.40` and swept `0.01`, `0.02`, and
`0.04`. A wider discount helped slightly, but the best cell was still
negative: `discount=0.04`, run `194`, reached only `-0.04` net EV per market
over 1000 markets, with 14 all-maker trades and the same `28.57%` win rate.
Gate 1 recycled the experiment. Interpretation: the below-mid maker discount
is not a generic artifact that makes any side work. Underdog fills are sparse
at strict cutoffs and badly selected at broader cutoffs. That makes the
failed favorite result more specific: mild favorite selection can screen
positive in the newest window, but neither a stop wrapper nor an underdog
mirror produces a robust edge.

Lesson: The maker-discount lever is side-sensitive; underdog passive buys are
not a viable mirror control here, and broadening the underdog cutoff mainly
adds toxic fill volume.
