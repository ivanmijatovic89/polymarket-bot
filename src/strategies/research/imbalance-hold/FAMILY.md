---
artifactType: strategy-family
family: imbalance-hold
---

# imbalance-hold

## Thesis

The strongest measured gross directional signal on BTC 15m up/down markets is
resting-book depth imbalance, and it was killed by its cost structure, not by
the signal: the pre-protocol `orderbook-imbalance` taker measured **gross
+$335 over 6000 markets (+$0.056/mkt)** that collapsed to **net +$11 ≈ $0**
only after paying the taker fee on both the entry and the exit (batch
`obimb-sweep-14-ext2`). The maker version of the same signal was measured
dead too — `obimb-v2-maker-6000` cut fees by $41 but lost $93 gross — so the
signal cannot be harvested passively; it must be taken, and the wall in front
of the taker was the round-trip fee.

This family re-tests that measured gross edge under the one cost structure
never tried on it: **take the imbalance-supported leg once as a taker, then
hold to resolution.** Winning shares redeem at $1 fee-free, so the round trip
pays a single taker fee (entry only) instead of two — roughly halving the
measured ~$0.054/mkt fee drag that turned +5.6¢ gross into ≈ $0 net.

Why depth imbalance should carry direction here: an independent cross-family
measurement found **ask-heavy favorite books are ~2.5¢ overpriced (informed
selling)** — the side of the book that resting liquidity leans away from is
the side informed flow is leaving. Who is on the other side of our taker buy:
resting ask liquidity on the bid-supported leg that has not repriced to the
pressure visible in its own book. Why the edge survives arbitrage: a taker
normally cannot profit from a ~5.6¢/mkt gross signal after ~5.4¢/mkt of
round-trip fees — the fee, not the signal, is the wall, and hold-to-redemption
is the specific untested way around it.

## Signal definition

All fields come from the replayed order book
(`snapshot.byAssetId[assetId]`: `bestBid`, `bestAsk`, `mid`,
`bidsDepthByLevel`, `asksDepthByLevel`) and market metadata
(`ctx.market.upAssetId` / `downAssetId` / `slug`). No external feeds, no
plugins. The episode clock is `tick.snapshot.timestamp` (unix ms), anchored at
the first valid tick of the episode (`t0`); state resets on every episode
boundary (market-key change).

Per tick, once both legs have a usable book (`bestBid`, `bestAsk`, `mid`
present) and warmup has completed:

- For each leg `S`, cumulative depth over the top `imbLevels` book levels:
  `bidDepth_S = bidsDepthByLevel[min(imbLevels, len) - 1]`, same for
  `askDepth_S` (the arrays are cumulative; index 0 = level 1). Skip the tick
  if either side's depth is missing or the total is zero.
- Per-leg bid-support ratio: `ratio_S = bidDepth_S / (bidDepth_S + askDepth_S)`
  in [0, 1].
- **Differential signal:** `imb = ratio_up - ratio_down` in [-1, 1]. Using
  both legs makes the signal complement-consistent: informed flow leaving UP
  shows up both as ask-heavy UP and bid-heavy DOWN, and both push `imb` the
  same direction.

Entry (at most **one** per episode; `entered` latches on emit):

- Act only if `elapsedSec >= startSec`.
- Choose the supported leg: `up` if `imb >= minImbalance`, `down` if
  `imb <= -minImbalance`, else skip this tick.
- Skip if the chosen leg's `bestAsk > maxEntryPrice` (an already-decided price
  leaves too little `(1 - price)` upside to pay the fee).
- Cross with one **FOK** BUY of `size` shares at
  `limit = round2(min(bestAsk + slippageTol, 0.98))`. FOK fills fully as a
  taker or kills — no resting maker remnant; a kill means no position that
  episode at zero cost. Deterministic `clientOrderId` keyed by market + side.
- Whatever fills is **held to resolution** (winners redeem $1, losers $0).
  Nothing is repriced, cancelled, or sold — that is what makes the round trip
  a single taker fee.

Default knobs (`search.defaults`; justification):

- `imbLevels = 3` — measure depth over the top 3 cumulative levels: the same
  aperture as the ~2.5¢ ask-heavy-overpricing measurement and deep enough to
  smooth single-level flicker while staying near the actionable touch.
- `minImbalance = 0.2` — the differential must be a full 60/40 lean (e.g.
  `ratio_up 0.6` vs `ratio_down 0.4`) before it counts as pressure; small
  leans are book noise. Highest-impact knob, so pass 1 sweeps it.
- `size = 20` shares — ~$10–15 notional at typical entry prices; clears
  minimum order size and fills within a few ask levels so the single entry fee
  stays small and FOK does not kill on thin books.
- `startSec = 60` — skip the first minute while the books are still forming;
  depth ratios on a just-opened book are not yet informative.
- `maxEntryPrice = 0.80` — above 80¢ the winning payout `(1 - price)` is
  ≤ 20¢ and the ~1¢/share taker fee plus crossed spread eats too much of it.
- `slippageTol = 0.02` — FOK limit 2¢ above `bestAsk` so a size-20 order can
  consume 2–3 levels and actually fill, while capping taker slippage.

## Edge economics

Costs are measured, never modeled; this is the mechanism argument built from
measured comparables (killed families' outcomes, LESSONS.md, and pre-protocol
runs cited by batch uid).

- **The gross edge of this exact signal class is measured, and it is the
  largest on record.** `orderbook-imbalance`'s best taker cell: gross
  **+$335 over 6000 markets = +$0.056/mkt**, net **+$11 ≈ $0** (batch
  `obimb-sweep-14-ext2`). The measured fee drag on that run is the difference:
  ~$324 / 6000 ≈ **$0.054/mkt**, paid across entry and exit legs.
- **The untested lever is single-fee execution.** Redemption of winning shares
  is fee-free (SCOPE execution-cost list). Entering as a taker and holding to
  resolution pays the fee once, cutting the measured ~$0.054/mkt drag roughly
  in half. If the strategy captures gross edge of the measured magnitude,
  net ≈ +$0.056 − ~$0.027 ≈ **+2–3¢/mkt** — the stage-1 screen reads this
  directly from measured `evPerMarketTotal` vs `totalFeesPaid`.
- **The sign of the signal has independent measured support.** The
  cross-family convergence finding measured **ask-heavy favorite books ~2.5¢
  overpriced (informed selling)**: depth leaning away from a side predicts
  that side falling. Buying the bid-supported leg follows that informed flow.
- **The maker path is measured dead, twice.** `obimb-v2-maker-6000` (maker
  take-profit variant of this signal) saved $41 in fees but lost $93 gross;
  `spread-capture` measured symmetric maker quoting gross-negative in all 15
  baseline cells with negligible fees — resting orders fade continuations and
  eat adverse selection. Taking is the only execution posture the measured
  numbers leave open for this signal, which is why this family is a taker.
- **Why this is structurally different from the fee-bound comparable.** The
  killed taker round-tripped (entry + exit fee); this changes the exact cost
  axis that bound it by deleting the exit fee via redemption. It is the same
  lever `momentum-hold` was accepted for, applied to a different, directly
  measured decision driver.
- **Honest risks, stated up front.** (a) maker-favorite `011-book-imbalance`
  gated maker favorite bids on the favorite's own bid-support and found a
  non-monotonic response peaked at the loosest gate (net EV/mkt
  0.18/0.05/0.03/0.09 as the gate tightened 0.45→0.6) — one measured fill set
  where bid-support did not monotonically add information. Defense: that fill
  set was maker-selected (fills only on pullbacks), so it measures the gate on
  adversely-selected fills, not taker-entry informativeness; still, it is the
  nearest in-protocol measurement and it is not flattering. (b) The gross edge
  is thin (~5.6¢/mkt best measured); if this family's simpler differential
  ratio captures less of it than the killed family's tuned version, half-fee
  is not enough. (c) Hold-to-redemption keeps the binary payoff asymmetry that
  broke `maker-favorite` at confirm — the defense is that the imbalance signal
  has measured gross directional content, unlike the ~fair favorites that
  family held. (d) Crossing the spread costs the half-spread on top of the
  fee; wide-spread moments may bury the thin edge, which the entry-price and
  threshold passes probe cheaply at stage 1.

## Experiment roadmap

Ranked, mechanism-distinct ideas beyond the baseline (prose until specced).
Per LESSONS.md, any filter idea below must verify it actually binds
(participation drops vs the unfiltered variant) before its screen is trusted.

1. **Imbalance persistence filter.** Require `|imb| >= minImbalance`
   continuously for K seconds before entering, rejecting one-print book
   flickers. Adds a time dimension the instantaneous baseline cannot express;
   directly tests whether sustained pressure is the informative version of the
   signal.
2. **Imbalance-change (flow) trigger.** Trigger on the change in `imb` over a
   lookback window (depth being added to bids / pulled from asks) instead of
   its level — a first-derivative order-flow signal. Distinguishes "book has
   been lopsided all episode" (possibly structural) from "book is turning"
   (possibly informed action).
3. **Complement-agreement veto.** Enter only when the legs individually agree
   (`ratio_up >= 0.5 + d` AND `ratio_down <= 0.5 - d`), not merely on the
   differential; vetoes entries where both books lean the same way, which the
   differential mistakes for direction but is more likely a venue-wide
   liquidity artifact.
4. **Entry-price band.** Add a `minEntryPrice` floor and sweep the band. The
   informed-selling measurement was made on favorites; whether the imbalance
   edge pays best on favorites, coin-flips, or longshots (where `(1 - price)`
   upside is fattest per fee dollar) is unmapped, and the answer relocates the
   family's capacity.
5. **Late-window imbalance.** Restrict entries to the final minutes of the
   episode. Pre-protocol convergence work measured late-window books as the
   most decisively one-sided regime; if depth imbalance is most informative
   when time-to-resolution is short, the same signal at a late gate is a
   different (and cheaper-to-confirm) regime than mid-episode entries.
6. **Distance-weighted depth.** Replace raw top-N cumulative sums with
   proximity-weighted depth (levels nearer the touch weigh more). Tests where
   the informative liquidity actually sits — touch flicker vs deep walls —
   i.e., a different measurement of the driver rather than a different filter
   on it.

## Duplicate notes

Checked against every family in `src/strategies/research/INDEX.json`; the
primary decision driver (current resting-liquidity distribution decides the
side) is new. `duplicateKeys` cover the synonym space: book-imbalance,
orderbook-imbalance, depth-imbalance, bid-ask-depth-skew, book-pressure,
liquidity-imbalance-follow, imbalance-taker-hold.

- **vs `momentum-hold`** (driver: realized mid-price change over a lookback;
  same taker + hold-to-redemption execution posture). The shared posture is
  the cost structure, not the driver: a leg can be bid-supported with zero
  recent mid change (pressure building, price not yet moved) and a leg can
  have strong recent momentum with a neutral book (move already done). Its
  `duplicateKeys` are all momentum/trend/continuation terms — none cover
  resting depth. Its roadmap #4 ("depth-backed momentum gate") keeps momentum
  as the driver and uses depth only as a confirmation filter; this family has
  no momentum requirement at all. If the two families ever converge on a
  combined momentum+depth strategy, the experiment belongs to whichever
  family's driver is primary in that spec.
- **vs `maker-favorite`** (driver: favorite selection, maker execution). Its
  `011-book-imbalance` used the favorite's bid-support as a quality gate on a
  maker favorite bid — imbalance filtered an entry decided by favoriteness,
  and the fills were maker (pullback-selected). Here imbalance alone decides
  the side (either leg, favorite or not) and execution is taker. Its measured
  011 result is cited honestly in Edge economics as adjacent evidence.
- **vs `spread-capture`** (driver: symmetric market-neutral spread harvest,
  maker). Nothing shared: no split, no quoting, directional by construction.
- **Legacy note (out of dedup scope).** Pre-protocol `orderbook-imbalance`
  lives outside `src/strategies/research/` and does not block proposals; it is
  this family's measured comparable, and its killed round-trip cost structure
  is exactly what this family changes.

## Research log
