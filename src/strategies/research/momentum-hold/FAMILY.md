---
artifactType: strategy-family
family: momentum-hold
---

# momentum-hold

## Thesis

Two things are already measured on BTC 15m up/down markets, and they point in
opposite directions:

1. **Intra-episode moves CONTINUE, they do not revert.** Pre-protocol spike
   work measured that 15m BTC mid-spikes continue rather than fade (following
   won 40% vs fading 27.6%). The two research families that lose money both
   lose it _because_ of this: a resting maker order is, by construction, a
   momentum **fader** — a resting bid below mid fills only when the mid falls
   to it, a resting ask above mid fills only when the mid rises to it — so it
   is always run over by a move that continues. `spread-capture` measured its
   entire loss in that first adversely-selected maker fill; `maker-favorite`
   measured the same toxic-fill / payoff-asymmetry failure across 15
   experiments.
2. **Taker directional edge is real but thin and was eaten by ROUND-TRIP
   fees.** The strongest killed directional signal (orderbook-imbalance) still
   measured a positive _gross_ taker edge (+$0.056/mkt over 6000 markets) that
   collapsed to ≈$0 net only after the ~156 bps taker fee was charged on both
   the entry and the exit.

This family takes the one execution posture neither dead family tried:
**follow momentum as a taker, then hold the position to resolution.** A taker
can actually follow a move (a maker structurally cannot). Holding to
resolution means the winning shares _redeem_ at $1 — and redemption is
fee-free — so the round trip pays a **single** taker fee (entry only) instead
of two. The bet is narrow and honest: the momentum signal's gross edge is
already measured to be roughly the size of a _round-trip_ fee, so halving the
fee by never selling is exactly the lever that could flip it net-positive.

Who is on the other side: when we cross the spread to take the leg that has
been rising, we lift resting ask liquidity that has not repriced fast enough
to a move that (per the measured continuation) is more likely to keep going.
Why it survives arbitrage: a taker normally cannot profit here because the
round-trip fee exceeds the thin edge — the fee, not the signal, is the wall,
and hold-to-redemption is the specific untested way around it.

## Signal definition

All fields come from the replayed order book
(`snapshot.byAssetId[assetId]`: `bestBid`, `bestAsk`, `mid`) and market
metadata (`ctx.market.upAssetId` / `downAssetId` / `slug`). No external feeds,
no plugins. The episode clock is `tick.snapshot.timestamp` (unix ms), anchored
at the first valid tick of the episode (`t0`); `elapsedSec = (now - t0)/1000`.
State is reset on every episode boundary (market-key change).

Per tick, once both legs have a usable book and warmup has completed:

- Append `{ ts: now, up: upMid, down: downMid }` to a bounded per-episode
  history (pruned to roughly the last `lookbackSec`).
- Let `past` = the newest sample at or before `now - lookbackSec*1000`. If no
  sample is that old yet, skip.
- `momUp = upMid - past.up`, `momDown = downMid - past.down` (per-leg mid
  change over the lookback window).

Entry (at most **one** per episode; `entered` latches on emit):

- Act only if `elapsedSec >= startSec`.
- Choose the strengthening leg: `up` if `momUp >= minMomentum` and
  `momUp >= momDown`; else `down` if `momDown >= minMomentum`; else skip this
  tick.
- Skip if the chosen leg's `bestAsk > maxEntryPrice` (do not chase an
  already-decided price where the `(1 - price)` upside cannot cover the fee).
- Cross with one **FOK** BUY of `size` shares at
  `limit = round2(min(bestAsk + slippageTol, 0.98))`. FOK fills the full size
  as a taker (consuming ask levels up to `limit`) or kills — so there is never
  a resting maker remnant; a kill simply means no position that episode at zero
  cost. Deterministic `clientOrderId` keyed by market + side.
- Whatever fills is **held to resolution** (winners redeem $1, losers $0).
  Nothing is repriced, cancelled, or sold — this is what makes the round trip a
  single taker fee.

Default knobs (`search.defaults`; justification):

- `lookbackSec = 60` — measure momentum over the last minute of the 900s
  episode; long enough to be a move rather than one print, short enough to be
  "recent" continuation.
- `minMomentum = 0.03` — require a ≥3¢ mid rise to call it momentum; the
  measured continuation asymmetry was on multi-cent mid-spikes, and 3¢ is
  above tick noise. Highest-impact knob, so pass 1 sweeps it.
- `size = 20` shares — ~$10–15 notional at typical entry prices; large enough
  to clear minimum order size, small enough to fill within a few ask levels so
  the single entry fee stays small and FOK does not kill on thin books.
- `startSec = 60` — skip the noisy first minute while the book is finding its
  level; only measure momentum after a reference has formed.
- `maxEntryPrice = 0.80` — do not take asks above 80¢: there the winning
  payout `(1 - price)` is ≤20¢ and the ~1¢/share taker fee plus crossed spread
  eats too much of it.
- `slippageTol = 0.02` — FOK limit sits 2¢ above `bestAsk` so a size-20 order
  can consume 2–3 levels and actually fill, while capping taker slippage at
  2¢.

## Edge economics

Costs are measured, never modeled; the numbers below are the mechanism
argument built from measured comparables (killed families' outcomes,
`LESSONS.md`, and pre-protocol runs cited by batch uid).

- **The gross directional edge exists and is ≈ a round-trip fee.**
  orderbook-imbalance's best taker cell measured **gross +$0.056/mkt over 6000
  markets**, collapsing to **net +$11 ≈ $0** after fees (batch
  `obimb-sweep-14-ext2`). The measured round-trip taker fee drag on comparable
  directional strategies is **~$0.30–0.33/mkt** (spike-reaction ~$325 fees per
  1000 markets). So the signal is not absent — it is fee-bound: gross ≈ +5.6¢,
  round-trip fee ≈ +5.5¢, net ≈ 0.
- **The specific untested lever is single-fee execution.** Redemption of
  winning shares is fee-free (SCOPE execution-cost list; ENGINE portfolio /
  redeem semantics). Entering as a taker and holding to resolution pays the
  taker fee **once** (entry) instead of on both legs of a round trip, roughly
  halving the ~$0.33/mkt drag to a single ~$0.008–0.009/share entry fee (156
  bps of a ~$0.5–0.8 share). If a ~+5.6¢/mkt gross edge survives with only
  ~half the fee, net crosses from ≈0 to ≈+2–3¢/mkt. This is the arithmetic the
  stage-1 screen tests directly by reading measured `evPerMarketTotal` vs
  `totalFeesPaid`.
- **Momentum continuation is the measured directional prior.** 15m BTC
  mid-spikes continue, not revert (following 40% vs fading 27.6%, pre-protocol
  spike work, cited in `spread-capture` Edge economics). Taking the
  strengthening leg is aligned with that prior; the two dead maker families
  were implicitly betting the other way (their resting orders fade the move).
- **Why this is not just a re-run of a fee-bound taker.** The comparable
  directional takers round-tripped (entry + exit fee) — this changes the exact
  cost axis that bound them by removing the exit fee entirely via redemption.
  It is not a new threshold on the same round trip; it is a different cost
  structure. And it is not the maker-momentum idea that already died:
  `maker-favorite` `013-momentum-confirm` conditioned a _maker_ bid on favorite
  strengthening and failed confirm (payoff asymmetry) precisely because a maker
  still fills on the pullback, not on the continuation. A taker fills into the
  continuation.
- **Honest risks, stated up front.** (a) The gross edge is thin (~5.6¢/mkt
  best measured); if this family's momentum definition captures less of it than
  orderbook-imbalance did, single-fee is not enough. (b) Crossing the spread
  costs the half-spread on top of the fee. (c) Holding to resolution keeps the
  binary payoff asymmetry that killed `maker-favorite` — the defense is that
  the momentum prior is a _real_ directional edge (unlike the ~fair favorites
  maker-favorite held), so the taken side should win more than its entry price
  implies. (d) If the pre-protocol taker momentum work already held to
  redemption, this reduces to a known result — which the stage-1 screen settles
  cheaply by reading measured gross vs measured fee drag.

## Experiment roadmap

Ranked, mechanism-distinct ideas beyond the baseline (prose until specced):

1. **Momentum-window shape.** Sweep `lookbackSec` (e.g. 15 / 30 / 60 / 120s)
   at fixed `minMomentum`. Tests whether fast micro-momentum or a slower
   episode-drift is the version of "the move" that actually continues; the
   baseline fixes one window and pass 1 only sweeps the threshold.
2. **Entry-price band.** Sweep `maxEntryPrice` (and add a `minEntryPrice`
   floor) to map where continuation edge net of the thin `(1 - price)` upside
   plus fee actually pays. Finds the price band in which momentum-hold is
   net-positive rather than assuming 0.80 is the right ceiling.
3. **Acceleration / breakout trigger.** Require momentum to be _accelerating_
   (mid change over the most recent sub-window exceeds the change over the
   prior sub-window), targeting genuine breakouts and rejecting decelerating
   drifts that are more likely to stall — a second-derivative signal the
   first-derivative baseline cannot express.
4. **Depth-backed momentum gate.** Take only when the chosen leg's book is
   order-flow-supported (thin asks / thick bids over the top levels), i.e. the
   move has resting-liquidity backing rather than being a single-print blip.
   Note this uses book imbalance to **confirm** momentum, the opposite sign
   from `maker-favorite` `011`, which used it to fade — a distinct mechanism.
5. **Size / capacity & realized slippage.** Sweep `size` (and `slippageTol`)
   and read measured slippage from consuming deeper ask levels, to find the
   largest stake before multi-level taker cost eats the thin edge — the
   capacity question a single-fee taker must answer before it can matter.
6. **Re-entry / pyramiding on persistence.** Allow a second taker entry (held
   to redemption) if momentum extends past a further threshold, concentrating
   stake on the most strongly trending episodes instead of one fixed clip.
7. **Late-window decisiveness variant.** Enter only in the last few minutes
   when a strong favorite has already emerged (high mid, little time left to
   reverse), buying a near-decided winner and holding to fee-free redemption —
   a distinct entry regime (time-gated decisiveness) from mid-window momentum,
   and a cleaner test of the single-fee-hold lever without the continuation
   assumption.

## Duplicate notes

Not a duplicate of either existing research family; the primary decision
driver (follow momentum as a taker held to redemption) and the cost structure
(one taker fee) are both new.

- **vs `maker-favorite`** (driver: rest a passive maker **bid** on the
  favorite at a discount; fee-free maker). That family _fades_ — its bid fills
  only when the favorite weakens — and it was killed by adverse selection /
  payoff asymmetry. Its `013-momentum-confirm` conditioned the _maker_ bid on
  favorite strengthening and still failed, because a maker cannot fill into a
  continuation. momentum-hold is a **taker** that crosses the spread to follow
  the move; different driver, different execution, different (single) fee.
- **vs `spread-capture`** (driver: split a full set and rest symmetric maker
  **asks on both legs**; direction-agnostic spread harvest, fee-free). That
  family is market-neutral and passive; momentum-hold is directional and
  aggressive. `spread-capture`'s measured lesson (the loss is the first
  adversely-selected maker fill) is the direct motivation to take the trade as
  a taker instead of resting into it.
- `duplicateKeys` cover the synonym space so future proposals catch the
  overlap: momentum-following, trend-follow, move-continuation, breakout-take,
  spike-follow, directional-taker-hold, take-and-hold-to-redemption.

## Research log
