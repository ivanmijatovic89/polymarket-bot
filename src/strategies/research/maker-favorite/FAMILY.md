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
   Tested with the cancel-weakening entry in `012-cancel-take-profit`.
7. **Favorite book depth imbalance (quality gate).** The touch-spread filter
   (`010`) was inert because favorite touch books are always tight; a real
   quality gate must key on _depth_, not touch. Rest the bid only when the
   favorite book is bid-supported -- `bidDepth/(bidDepth+askDepth)` over the top
   few cumulative levels above a threshold -- rejecting ask-heavy
   (being-sold-into) favorite books. Motivated by the cross-family convergence
   finding that ask-heavy favorite books are ~2.5 cents overpriced (informed selling); this is
   the first filter that can actually bind and remove the toxic confirm fills.
   Tested in `011-book-imbalance`.
8. **Favorite recent momentum confirmation.** The prior filters selected static
   state; this tests a real tick-stream direction signal. Arm on a delayed
   favorite, wait a short confirmation window, and bid only if the same favorite
   strengthened by at least a threshold. Tested in `013-momentum-confirm`.
9. **Recent volatility guard.** The high-win-rate `013` confirm still failed on
   payoff asymmetry, so test the simplest instability filter: only enter when
   the favorite side did not flip and its recent mid-price range stayed small.
   Tested in `014-volatility-guard`.

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

### 003-delayed-favorite

This experiment froze the only delayed-entry cell from `001-entry-window` that
looked interesting: wait 180 seconds into the BTC 15m episode, then apply the
same mild favorite gate (`favThreshold=0.52`), 1 cent maker discount, and size 40. As a single fixed variation, run `196` passed the stage-1 screen at
`0.29` net EV per market over 1000 markets, with 762 markets played, 764
trades, 747 maker fills, 17 taker fills, and `67.72%` win rate. Evaluator
advanced it to gate 2 and marked it the current champion candidate.

Interpretation: delaying the entry is a real mechanism change when it moves
the first eligible order away from the noisy open. It trades far more often
than the immediate baseline's best screen cell and has a higher win rate, but
the result is not yet robust because the earlier immediate favorite variants
also screened positive and then failed at 3000 markets. The required next
action is the normal stage-2 extension of run `196`.

The stage-2 extension then failed in the same pattern as the earlier favorite
variants. Run `196` over 3000 markets fell to `-0.37` net EV per market, with
2391 markets played, 2400 trades, 2356 maker fills, 44 taker fills, and
`65.54%` win rate. Delaying entry improved the 1000-market screen, but it did
not make the edge stable across the immediately older 2000 markets.

Lesson: Waiting 180 seconds before placing the mild-favorite maker bid is a
real fill-set change, but it still has the family-level screen/confirm
failure; future experiments need a stronger selection rule or a lifecycle
change, not just a different fixed entry time.

### 004-delayed-threshold

This experiment kept the delayed-entry lifecycle from `003-delayed-favorite`
but required a stronger favorite after the 180 second wait. The first pass
swept `favThreshold` with `discount=0.01`, `size=40`, `startSec=180`, and
`stopSec=840`. Evaluator selected `favThreshold=0.55`: it was the strongest
screen cell at `0.36` net EV per market over 1000 markets, with 685 markets
played and 687 trades, while the neighboring `0.52`, `0.60`, and `0.65`
cells all remained positive.

The discount pass fixed `favThreshold=0.55` and swept `0.01`, `0.02`, and
`0.04`. The top response was flat-positive: `discount=0.02` and `0.04` both
rounded to `0.40` net EV per market. Evaluator chose `discount=0.02` because
it kept more coverage, 662 trades versus 616, while `discount=0.01` was lower
at `0.36`. Gate 1 passed under `STAGE-GATES.md` version 1, and the best
params are `favThreshold=0.55`, `discount=0.02`, `size=40`, `startSec=180`,
and `stopSec=840`.

Interpretation: a modestly stronger favorite threshold repaired the delayed
screen without starving participation. It was the cleanest screen in the
family because it improved on the prior delayed variant while keeping a broad
enough fill set. The stage-2 extension then repeated the family-level failure:
run `201` over 3000 markets fell to `-0.24` net EV per market, with 2051
markets played, 2051 trades, 2042 maker fills, 9 taker fills, and `66.36%`
win rate. The stronger threshold improved the confirm result versus the
earlier delayed favorite run (`-0.37`), but it still failed the net-profit
confirm gate.

Lesson: Delayed favorite entry improves when paired with a modestly stronger
favorite threshold, but the one-shot hold-to-resolution favorite-maker
lifecycle still fails confirm; the next experiment needs a lifecycle or
toxicity-control change rather than another simple threshold/window sweep.

### 005-take-profit

This experiment changed the lifecycle after the best delayed-threshold entry:
place the same delayed stronger-favorite maker bid, then rest one maker SELL
at entry plus `takeProfit=0.04` for any filled position instead of simply
holding everything to resolution. The fixed params were `favThreshold=0.55`,
`discount=0.02`, `size=40`, `startSec=180`, `stopSec=840`, and
`takeProfit=0.04`.

The screen failed decisively. Run `205` over 1000 markets produced `-1.18`
net EV per market, with 662 markets played, 1244 trades, 1239 maker fills, 5
taker fills, and `87.92%` win rate. Evaluator recycled gate 1. Interpretation:
the extra maker exit doubled trade count and created many small realized
wins, but the remaining loss tail was much worse than holding the same entry
set. A naive fixed take-profit does not solve the confirm instability; it
monetizes favorable moves too early while leaving bad inventory exposed.

Lesson: A one-shot fixed take-profit SELL is a harmful lifecycle change for
this family; future lifecycle experiments need explicit toxicity avoidance
before entry or cancellation of stale bids, not just early profit-taking after
the fill.

### 006-cancel-weakening

This experiment changed the pending-order lifecycle before fill: keep the
delayed stronger-favorite maker bid from `004-delayed-threshold`, but cancel
the active buy if the selected side's mid weakens by `cancelDelta=0.03` from
the entry snapshot. Filled inventory is still held to resolution, so the only
new mechanism is avoiding stale resting bids after adverse movement.

The stage-1 screen passed but was weaker than the uncanceled delayed-threshold
screen. Run `207` over 1000 markets produced `0.22` net EV per market, with
627 markets played, 627 trades, 622 maker fills, 5 taker fills, and a
`68.26%` win rate. Evaluator advanced it to gate 2 because it met the stage-1
success criteria, but noted that canceling stale weakening bids reduced
participation and did not improve on the prior `004-delayed-threshold` screen
cell at about `0.40` net EV per market.

The stage-2 confirm extension failed, though it was the best confirm result in
the family so far. Run `207` over 3000 markets fell to `-0.18` net EV per
market, with 1869 markets played, 1869 trades, 1860 maker fills, 9 taker
fills, and `67.09%` win rate. This improved on the prior delayed-threshold
confirm result (`-0.24`) by reducing participation, but it still did not pass
the net-profit confirm gate.

Interpretation: pre-fill cancellation is directionally useful as toxicity
control, but the first simple rule is too blunt to produce a robust edge. It
removes some older-history adverse fills, yet the remaining filled favorite
inventory still has negative EV when held to resolution. The next experiment
should keep the delayed strong-favorite entry but make the cancellation rule
more selective or add a second pre-fill confirmation, rather than adding an
after-fill exit.

Lesson: Canceling weakened resting favorite bids is the first lifecycle change
that improved 3000-market confirm loss, but the `0.03` adverse-move threshold
still fails; toxicity control needs a sharper pre-fill condition before this
family can validate.

### 007-confirm-stable

This experiment tested the simplest sharper pre-fill condition after
`006-cancel-weakening`: do not rest the maker bid immediately after the
delayed strong-favorite signal. Instead, arm the candidate, wait `confirmSec=30`
seconds, and place the bid only if the same side remains the favorite, stays
above `favThreshold=0.55`, and has not weakened by more than
`maxWeakening=0.01`. The bid still used `discount=0.02`, `size=40`,
`startSec=180`, and `stopSec=840`, and filled inventory was held to
resolution.

The screen failed. Run `209` over 1000 markets produced `-0.20` net EV per
market, with 389 markets played, 389 trades, 386 maker fills, 3 taker fills,
and `70.69%` win rate. Evaluator recycled gate 1. Interpretation: the short
confirmation window cut participation far below `006-cancel-weakening` but
selected a worse fill set, so the stable-after-30-seconds rule is not the
right toxicity filter. The higher win rate did not compensate for loss
magnitude among the remaining fills.

Lesson: A fixed 30-second same-side stability confirmation is too selective
and negatively selected; future toxicity controls should adapt to price
movement magnitude or episode timing instead of imposing a single short
confirmation delay before every entry.

### 008-cancel-delta

This experiment reused `006-cancel-weakening` and swept only the adverse-move
cancel threshold. The idea was that `cancelDelta=0.03` improved 3000-market
loss versus the uncanceled delayed-threshold entry, but might be too blunt.
The pass tested `cancelDelta` values `0.01`, `0.02`, and `0.04` while keeping
`favThreshold=0.55`, `discount=0.02`, `size=40`, `startSec=180`, and
`stopSec=840`.

All three screen cells were positive. Evaluator selected `cancelDelta=0.04`
because it reached `0.35` net EV per market over 1000 markets, with 656
markets played and 656 trades. The tighter `0.02` and `0.01` cells were also
positive at `0.25` and `0.18` net EV per market, but they were much thinner
at 263 and 103 trades. Gate 1 passed and `008-cancel-delta` became the current
champion candidate pending confirm.

The confirm extension failed. Run `212` over 3000 markets fell to `-0.25` net
EV per market, with 2009 markets played, 2009 trades, 2000 maker fills, 9
taker fills, and `66.40%` win rate. This was worse than the original
`cancelDelta=0.03` confirm result (`-0.18`) despite the stronger 1000-market
screen.

Interpretation: this is a useful response curve, but only at screen coverage.
Cancellation is not simply "more is better"; overly tight cancellation removes
too much participation, while looser cancellation preserves screen fills that
do not survive older-history confirm. The family now has several variants
that screen positive and fail confirm, with the best confirm still the
`006-cancel-weakening` `cancelDelta=0.03` run at `-0.18`.

Lesson: Pre-fill cancellation has a participation-sensitive screen response,
but loosening to `cancelDelta=0.04` overfits the latest 1000 markets and fails
confirm; further attempts need a different information source or a stronger
selection rule than a single adverse-move threshold.

### 009-cancel-threshold

This experiment kept the best-confirming cancellation branch,
`cancelDelta=0.03`, and swept the favorite threshold through `0.55`, `0.60`,
and `0.65`. The intent was to see whether stricter side selection could fix
the repeated screen/confirm failure without changing the lifecycle again.

The screen was positive but did not support the stricter-threshold hypothesis.
Evaluator selected the `0.55` control at `0.22` net EV per market over 1000
markets, with 627 markets played and 627 trades. The stricter `0.60` and
`0.65` cells remained positive at `0.17` and `0.12` net EV per market, but
both reduced participation and EV. The selected best is the same parameter
set as `006-cancel-weakening`, whose 3000-market confirm is already known to
fail at `-0.18` net EV per market.

Interpretation: tightening the favorite threshold is not the missing
selection rule for this lifecycle. It improves win rate but gives up too much
participation and does not improve the screen. Since the best cell duplicates
an already-confirmed failed experiment, extending this record would only
repeat known evidence rather than adding new information.

Lesson: For the cancel-weakening lifecycle, stricter favorite thresholds do
not improve the edge; the family needs a genuinely different signal or should
pause rather than recycling the same delayed favorite maker entry.

### 010-tight-spread

This experiment tried to use recorded order-book quality as the selection rule
the family has been missing. It kept the best-confirming cancel-weakening entry
(`favThreshold=0.55`, `discount=0.02`, `size=40`, `startSec=180`,
`stopSec=840`, `cancelDelta=0.03`) and added `maxFavSpread`: only rest the bid
if the favorite leg's bid/ask spread at entry is at most that width, the idea
being that wide-book markets are lower quality and produce the toxic confirm
fills. The one pass swept `maxFavSpread` through `0.04`, `0.06`, and `0.08`.

The filter turned out to be completely inert. All three cells (runs
`217`/`219`/`218`) tie byte-for-byte at `0.22` net EV per market over 1000
markets, 627 markets played, 627 trades, `68.26%` win rate. Even the tightest
`0.04` bar removed zero markets relative to the `006-cancel-weakening` screen
(also 627 trades, `+0.22`), which means favorite books in this delayed
mid-window are essentially always tighter than 4 cents, so the threshold never
binds. Evaluator passed gate 1 on the tightest tied value but flagged the
result as an exact duplicate of the `006` screen and advised against spending a
stage-2 extension, because that identical parameter set already failed confirm
at 3000 markets (`-0.18`).

Interpretation: this was not a real mechanism change. A filter whose threshold
never binds cannot alter the fill set, so it reproduces a known screen and a
known confirm failure — no new information. Favorite books near the touch are
too tight for a static spread bar to discriminate quality here; a book-quality
filter would have to key on depth or imbalance, not raw touch spread, to
actually remove markets. Given that `009-cancel-threshold` (champion) and now
`010` both reduce to the already-failed `006` parameter set, the delayed
cancel-weakening favorite-maker entry has been exhausted with the levers tried
(threshold, discount, cancel delta, entry timing, touch spread). Decision: do
not extend `010`; the next step is either a genuinely different information
source (order-book depth/imbalance quality, or a lifecycle that is not
hold-to-resolution) or, if the roadmap has no mechanism-distinct idea left,
the family's stopping rules should be assessed next iteration.

Lesson: Before trusting a "passing" screen from a new filter, confirm the
filter actually removed markets — a threshold that never binds (here
`maxFavSpread` on always-tight favorite touch books) yields a screen
byte-identical to the unfiltered variant and silently re-runs a known result.

### 011-book-imbalance

This experiment tried the roadmap's depth-based quality gate -- the first filter
built to actually bind after `010-tight-spread` proved touch spread inert. It
kept the best-confirming cancel-weakening entry (`favThreshold=0.55`,
`discount=0.02`, `size=40`, `startSec=180`, `stopSec=840`, `cancelDelta=0.03`)
and added `minFavBidRatio`: rest the bid only when the favorite book is
bid-supported -- `bidDepth/(bidDepth+askDepth)` over the top `imbLevels=3`
cumulative levels at or above the threshold -- rejecting ask-heavy
(being-sold-into) favorite books. The motivation was the cross-family
convergence finding that ask-heavy favorite books are ~2.5 cents overpriced
(informed selling), so filtering them should strip the toxic fills that make
held favorite inventory lose at confirm. The single pass swept `minFavBidRatio`
through `0.45`, `0.5`, `0.55`, `0.6`.

All four cells were net-positive and, unlike `010`, the filter genuinely bound --
trade counts dropped as the gate tightened (410 -> 348 -> 290 -> 229). But the EV
response undercut the hypothesis. It was non-monotonic and best at the
**loosest** gate: `minFavBidRatio=0.45` gave `0.18` net EV per market over 1000
markets on 410 all-maker trades (zero taker, zero fees), while `0.5`/`0.55`/`0.6`
gave `0.05`/`0.03`/`0.09`. Evaluator passed gate 1 on the `0.45` cell (decision
`go`) but flagged that because the strongest EV sits where the gate barely binds
and tightening it does not help monotonically, the depth filter is not what earns
the edge — the `+0.18` is inherited from the `006` config, and the gate looks
near-inert-to-harmful as tightened.

Interpretation: this is a real, binding filter (the fill set genuinely differs
from `006`'s 627 trades), so it is not the inert `010` case -- but the direction
of the depth gate is wrong-signed for our thesis. If ask-heavy favorites were the
toxic fills, tightening `minFavBidRatio` (keeping only bid-supported books) should
have raised EV monotonically; instead the best cell keeps the most markets and
tightening only sheds EV. The convergence-family "ask-heavy favorite overpriced"
effect either does not transfer to this delayed-maker fill set or is swamped by
whatever the `006` entry is already capturing. Because the fill set is materially
different from `006` (410 vs 627 trades), the stage-1 `go` still warrants the
stage-2 confirm spend to see whether removing those ~217 markets happened to drop
the toxic older-history fills — but the non-monotonic screen is weak prior
evidence that it will.

Decision: honor the gate `go` and extend run for `minFavBidRatio=0.45` to
stage-2 confirm (3000 markets) next iteration; do not spend further passes
tightening the gate, since the screen response already shows tightening does not
help. If confirm fails like every prior favorite-maker variant, the depth-gate
idea is spent and the roadmap has no mechanism-distinct lever left, which would
move the family to a stopping-rules assessment.

Lesson: A binding filter is necessary but not sufficient -- even when a new gate
genuinely removes markets (here depth imbalance cut trades 410->229 as tightened),
a non-monotonic screen whose EV peaks at the loosest, barely-binding setting is
evidence the gate is NOT the driver; the EV is inherited from the base config, and
tightening the gate only sheds participation. Attribute the edge to the inherited
config and expect the confirm to track the base variant, not the filter.

Stage-2 extension (2026-07-05): honored the gate `go` and extended the winning
cell (run 222, `minFavBidRatio=0.45`) backward by 2000 contiguous older markets
to reach stage-2 confirm coverage (3000 total latest markets, 0 failures).
`batchUid` unchanged (`maker-favorite--011-book-imbalance--p1-minFavBidRatio`);
run 222 grew in place. Ready for the Evaluator's stage-2 gate judgment.

Stage-2 evaluation (2026-07-05): Evaluator recycled the experiment. The extended
run 222 fell from `+0.18` at the 1000-market screen to `-0.07` net EV per market
over 3000 markets, with 1234 markets played, 1234 trades, 1232 maker fills,
2 taker fills, and $0.27 fees. The depth gate did bind and reduced participation
versus `006`, but it did not solve the core regime problem: the newest-window
positive result again failed when the immediately older 2000 markets were added.
This confirms the stage-1 warning that the `0.45` imbalance gate was not the
driver of the edge; it only selected a smaller version of the same unstable
delayed favorite maker lifecycle.

Lesson: A binding book-quality filter that does not improve monotonically at
screen should not be trusted until confirm; in this family, even a materially
different fill set (`410` screen trades versus `006`'s `627`) still collapsed at
3000 markets, so the delayed favorite maker lifecycle remains recent-slice
positive but confirm-negative.

### 012-cancel-take-profit

This experiment tested the final roadmap lifecycle idea: keep the best
pre-fill cancel-weakening entry (`favThreshold=0.55`, `discount=0.02`,
`size=40`, `startSec=180`, `stopSec=840`, `cancelDelta=0.03`), but after any
fill rest one maker sell above entry instead of passively holding every share to
resolution. The pass swept `takeProfit` through `0.02`, `0.04`, `0.06`, and
`0.08`. The intended mechanism was simple: if the recent-screen edge is only a
short-lived maker spread opportunity, flattening winners quickly should reduce
the older-history regime losses that keep breaking confirms.

The result was not close. All cells failed stage 1. The least bad cell was
`takeProfit=0.06` at `-1.08` net EV per market over 1000 markets, with 627
markets played, 1162 trades, 1157 maker fills, 5 taker fills, and `85.65%` win
rate. The other cells were similarly bad: `0.02` reached `-1.15`, `0.08`
reached `-1.16`, and `0.04` reached `-1.20`. Compared with the hold/cancel
variants, the take-profit lifecycle roughly doubled trade count and converted a
high count of small realized wins into occasional large residual losses.

Interpretation: fill-then-flatten did not reduce resolution risk; it made the
payoff shape worse. The strategy still enters the same toxic favorite fills, then
adds churn and leaves unsold residual exposure when the one take-profit sell
does not fully solve the position before resolution. This closes the simplest
non-hold lifecycle repair for maker-favorite. Combined with `011`, both the
depth-quality route and the lifecycle route failed to repair the repeated
screen-positive/confirm-negative pattern.

Decision: recycle. Do not extend `012`. The next Researcher action should assess
whether any genuinely distinct roadmap idea remains; if not, the family is not
empirically killable yet under `minExperiments=20`, but any continuation must be
a substantially new signal source rather than another threshold tweak on the
delayed favorite maker bid.

Lesson: A one-shot maker take-profit exit can worsen a directional maker entry
by adding churn while leaving tail losses intact; high win rate with many small
realized sells is not evidence of positive EV when unresolved residual losses
dominate the market-level PnL.

### 013-momentum-confirm

This experiment tested a true tick-stream direction signal instead of another
static book or threshold filter. It armed on the delayed favorite, waited
`confirmSec=60`, and placed the maker bid only if the same favorite had
strengthened by at least `minMomentum`. The pass swept `minMomentum` through
`0`, `0.01`, `0.02`, and `0.04`, keeping the delayed favorite defaults
(`favThreshold=0.55`, `discount=0.02`, `size=40`, `startSec=180`,
`stopSec=840`).

The screen barely passed. The best cell was `minMomentum=0.02` at `+0.02` net
EV per market over 1000 markets, with 290 markets played, 290 trades, all maker,
no taker fills, no fees, and `76.21%` win rate. The response was peaked but
fragile: `0.01` was exactly `0.00` over 324 trades, `0` was `-0.16` over 346
trades, and the stricter `0.04` fell to `-0.24` over 240 trades. Evaluator
advanced it because v1 gates advance on positive net EV, but flagged the margin
as extremely thin.

Interpretation: unlike the inert spread filter, this signal genuinely changes
the fill set and the direction makes intuitive sense: requiring some recent
favorite strengthening removed weaker fills. But the edge is too small to trust
without confirm, especially given this family's repeated pattern of screen
positive and confirm negative. The useful thing about `013` is that it is a real
new signal source; the concerning thing is that the best result is only two
cents per 100 markets.

Decision: honor the gate `go` and extend run 232 (`minMomentum=0.02`) to
stage-2 confirm. If it fails, this confirms that even real recent-momentum
conditioning is not enough to stabilize the favorite-maker lifecycle.

Lesson: A real signal-source change can still be too weak to matter; when the
best stage-1 cell is barely positive and neighboring cells are flat or negative,
the only defensible next step is confirm, not parameter celebration.

Stage-2 evaluation (2026-07-05): Evaluator recycled the experiment. The extended
run 232 fell from `+0.02` at the 1000-market screen to `-0.10` net EV per market
over 3000 markets, with 896 markets played, 897 trades, 892 maker fills, 5 taker
fills, $0.75 fees, and `74.78%` win rate. Momentum confirmation clearly selected
a higher-win-rate fill set than the simpler delayed favorite variants, but the
confirm window was still negative because occasional losses outweighed the many
small wins.

Interpretation: `013` is stronger evidence than the inert/static filters because
it changed the signal source and produced a high win rate, but it still did not
stabilize EV. The family pattern is now very consistent: simple favorite-maker
variants can be recent-slice positive, and filters can make them look cleaner,
but the broader contiguous history remains negative once stage-2 coverage is
added.

Lesson: Higher win rate is not enough for this family; the decisive failure mode
is payoff asymmetry. A favorite-maker filter must reduce loss severity or avoid
the losing regimes entirely, not merely select more winning fills.

### 014-volatility-guard

This experiment tested the simplest instability filter suggested by the `013`
failure: keep the delayed favorite maker entry, but only enter when the favorite
side did not flip and its recent mid-price range stayed small over a
`lookbackSec=120` window. The pass swept `maxRange` through `0.02`, `0.04`,
`0.06`, and `0.08`, with the same `favThreshold=0.55`, `discount=0.02`,
`size=40`, `startSec=180`, and `stopSec=840`.

The result failed stage 1. The strictest `maxRange=0.02` cell produced zero
trades, so Evaluator treated its zero EV as non-evidence. The best trading
cells, `maxRange=0.04` and `0.06`, tied at `-0.02` net EV per market over 1000
markets, each with only one losing maker trade. The loosest `0.08` cell reached
7 trades but worsened to `-0.05` net EV per market, with 6 maker fills, 1 taker
fill, and `42.86%` win rate. Gate 1 recycled the experiment.

Interpretation: the volatility guard mostly starved the strategy rather than
finding a profitable stable regime. That is still useful information: if a
filter has to become so strict that it produces no trades, it cannot repair the
family at realistic coverage; if loosened enough to trade, the fill set remains
negative. This closes the simplest "avoid unstable markets" repair for the
payoff-asymmetry problem observed in `013`.

Decision: recycle. Do not extend `014`. Any next experiment must use a different
mechanism than stricter pre-entry quietness; the family is not killable yet under
the empirical stopping rule, but the remaining candidates need to target loss
severity directly rather than reducing trade count.

Lesson: A volatility/quietness gate that produces zero or near-zero fills is not
a viable EV repair; once loosened enough to trade, it must still prove positive
on the trading cells, not on a no-trade zero.
