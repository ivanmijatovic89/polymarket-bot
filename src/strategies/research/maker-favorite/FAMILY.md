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
