---
artifactType: strategy-family
family: endgame-panic-bid
---

# endgame-panic-bid

## Thesis

In the final seconds of a BTC 15m episode the outcome is close to public
knowledge — spot vs strike is visible to everyone — yet two flows keep
crossing the book at bad prices. One of them is holders of the ~99% winning
token who dump into the bid with 1–15 seconds left, donating ~2.4 cents per
share to whoever is resting there. This family rests that bid: in the last
seconds of each episode, place one maker bid on the near-certain winning
token at a fixed sub-fair price and hold any fill to settlement.

Who is on the other side: price-insensitive panic sellers of near-settled
winners — people converting a 0.99 probability into cash a few seconds
early at 0.965, presumably to avoid settlement wait or out of loss-aversion
reflex after watching the window wobble. The overnight glitch-hunt mission
measured this donor flow directly (operator lead OL-001, memo 003 channel 2) and its mirror — lottery buyers of the dying longshot donate −1 to −6
cents in the same seconds, 8/8 months — so the "irrational endgame crosser"
population is corroborated from both sides of the same books.

Why it survives arbitrage: the donation lands only at resting quotes. The
taker route to the same cell was measured wrong-signed (buying the ≥0.96
favorite ask at t≥885 loses −0.3 to −0.7c gross before fees, glitch-hunt
K-002, formally closed), so no taker is ever paid to tighten the bid side;
the pick-off tail (a last-second favorite dump can mean spot actually
crossed the strike) is exactly what keeps resting bids ~2.4c under fair
while the ask side of the same books is fair. This is the resting-quote
sink pattern (glitch-hunt S-001): all four measured donation channels in
this market empty into maker quotes. Collecting them requires bearing the
pick-off tail — which is the one term book data cannot measure and the
backtest engine's maker-fill model can.

The family's entire question is that unpriced term: P(win | our bid
FILLED). The standing margin is measured (+2.3/+2.5c); if fills are
concentrated in the episodes where the dump was informed (spot crossed the
strike), the realized win rate of fills drops toward the bid price and the
edge is an illusion. The engine's `worst_queue` maker model is deliberately
pessimistic — a resting BUY fills only when the best ask drops below our
price, i.e. it samples the most adverse fill scenarios — so a net-positive
baseline here is strong evidence, not weak.

## Signal definition

All inputs are replayed order-book state (`tick.snapshot.byAssetId`) and
market metadata (`ctx.market.upAssetId/downAssetId/slug`). No plugins, no
external feeds. Episode start time comes from Gamma metadata or the
`btc-updown-15m-<epochStart>` slug; elapsed seconds
`elapsedSec = (tick.snapshot.timestamp − startMs) / 1000`.

Per episode (one-shot, state reset on market rotation):

- Wait until `elapsedSec >= entryTimeSec` (and `< 900`). Ticks are
  event-driven; the endgame is churn-dense, so trigger ticks exist in
  active episodes. Intents flush at the next tick (queued execution),
  which is why the sweep stops at 897, not 899.
- Wait further (without consuming the one shot) until **both** legs have a
  usable two-sided book (`bestBid`, `bestAsk`, `mid` finite). The measured
  cell conditions on two-sided books; one-sided endgame books are a
  different (roadmap) regime.
- At the first such tick, decide once:
  - `favAssetId` = the higher-mid leg.
  - **Certainty gate:** require `fav.bestBid >= certaintyThreshold`, else
    place nothing this episode. Bid-based (not mid) to match the census
    conditioning (`bid_band 90–98`) and to be the conservative reading.
  - **Maker-only guard:** require `fav.bestAsk > bidPrice`, else place
    nothing — a GTC that crosses would take the ask and pay the taker fee,
    which is the measured wrong-signed K-002 path. Every fill this family
    ever gets must be maker.
  - Place exactly one GTC BUY of `size` shares at `bidPrice` (rounded to 3
    decimals — endgame favorites trade at sub-cent ticks; measured avg
    standing bid 0.9662) on `favAssetId`, deterministic `clientOrderId`
    keyed by market + side. Hold any fill to settlement; an unfilled bid
    dies with the market at zero cost.

Default knobs (all justified from the measured cell; see Edge economics
for the source numbers):

- `entryTimeSec = 897` — the standing margin ramps hard into expiry:
  +0.58c at t=870, +0.96c at t=885, **+2.32c at t=897**, +2.52c at t=899.
  897 is the deepest measured checkpoint that still leaves ticks for the
  queued intent to flush and the order to rest.
- `bidPrice = 0.965` — matches the measured standing bid (0.9662/0.9646 at
  t=897/899), i.e. "join the book where the donation is measured to land".
- `certaintyThreshold = 0.95` — inside the measured qualifying band
  (standing bid 0.90–0.98) while keeping participation; higher thresholds
  buy purity at the cost of n.
- `size = 20` shares (~$19 notional) — well inside the measured median
  top-3 bid depth at the cell (626–719 shares ≈ $600–700/window).

Sweep intent: `entryTimeSec` locates the mechanism on the margin ramp;
`bidPrice` maps the adverse-selection curve (deeper bids only fill on
deeper collapses under `worst_queue` — 0.955 has +3.4c standing margin but
the worst fills, 0.975 has +1.4c and the mildest); `certaintyThreshold`
tests purity vs participation (low-threshold cells partially self-filter
via the maker-only guard when the ask sits under 0.965); `size` tests
capacity linearity inside measured depth.

## Edge economics

Everything below is measured, not modeled. Source: glitch-hunt OL-001
([`strategy-research-protocol/glitch-hunt/ATLAS.md`](../../../../strategy-research-protocol/glitch-hunt/ATLAS.md)),
memo 003 channel 2
([`strategy-research-protocol/glitch-hunt/memos/003-endgame-taker-efficiency.md`](../../../../strategy-research-protocol/glitch-hunt/memos/003-endgame-taker-efficiency.md)),
data in `strategy-research-protocol/glitch-hunt/census/`
(`endgame_calibration_bid.csv`, `regime_audit.csv`; 17,126-episode holdout
endgame extraction, 2025-10..2026-05, one-sided books kept, numbers
mantis-verified and re-derived from the CSVs while writing this proposal).

- **Standing gross margin.** Two-sided favorite bid, bands 90–98:
  t=897 — n=2,080, P(win)=0.9894, avg standing bid 0.9662 → **+2.32c** per
  share; t=899 — n=1,281, P(win)=0.9899, avg bid 0.9646 → **+2.52c**.
  Positive **8/8 months** (+1.4c..+3.8c).
- **Regime-stable and stronger late** (regime audit A-002, the only
  glitch-hunt standing claim that strengthened in the recent regime):
  early 2025-10..2026-02 +1.97/+2.24c (z=5.48/5.91); late 2026-03..05
  **+2.65/+2.90c (z=10.58/7.85)** at t=897/899. This matters against the
  dominant failure mode of this protocol's maker families
  (screen-positive → confirm-negative regime instability, see
  `maker-favorite`): the prior here is measured stable across the whole
  window and improving, so the stage-2/3 climbs test a measured property
  rather than hope.
- **The margin is expiry-specific**, not a generic book artifact: at t=870
  it is +0.58c (n=4,836) and at t=885 +0.96c (n=3,713) — under fee-scale
  before the final 15 seconds — and the OL-003 scan found the asymmetric
  straddle shape (bid ≥2c under fair while the same book's ask is fair)
  nowhere in the mid-window field (16/373 cells pass the shape filter,
  all z ≤ 1.1). The donor operates only in the last seconds.
- **Donor corroboration.** The mirror channel in the same books — taker
  buyers of the 4–20c longshot — donates −2.90c at t=885 → −6.20c at
  t=899, 8/8 months. Price-insensitive endgame crossers are real on both
  sides.
- **Persistence.** The correction is maker-only (S-001): the taker path
  is measured wrong-signed — favorite ask ≥0.96 at t=885/897/899 is
  −0.30/−0.61/−0.68c gross, ≈−2.2c net of the 156bps fee convention
  (K-002, formally closed on the full resolved universe). Nobody is paid
  to tighten the bid; the mispricing can persist.
- **Fees.** In the engine, maker fills carry no taker fee, and the
  maker-only guard blocks accidental crossing. Measured comparable:
  `maker-favorite`'s all-maker runs measured ~$0.27 total fees over 3,000
  markets (1,234 trades, 011-book-imbalance) — the maker path is
  measured near-fee-free here. So the standing +2.3/+2.5c margin is
  approximately gross = net per filled share at standing win rates, and
  the whole margin is the adverse-selection budget. (Memo 003's stricter
  breakeven of 0.9813 at a 0.965 bid — only 0.86c of budget — assumed the
  156bps fee applies to the fill; under the engine's maker semantics that
  is a conservative floor, not the operative bar.)
- **The unpriced term and the loss tail.** P(win | filled) is unobservable
  in book deltas by construction (deltas cannot distinguish trades from
  cancels). Per fill at 0.965 the tail is −96.6c against +3.4c: realized
  fill win rate must exceed 96.5% to be positive. LESSONS payoff-shape
  warnings apply in full (`one-shot-take-profit-can-add-churn-without-removing-tail-loss`,
  `persistent-book-pressure-selects-longshots-not-informed-flow`): if the
  baseline's fill win rate lands ≈ the bid price, the fills are
  fairly-priced and the family answer is "the sink is fully toxic" — a
  cheap, decisive stage-1 negative. The `worst_queue` fill model biases
  the measurement AGAINST the family (fills only when the ask collapses
  below our bid), so a positive baseline is evidence with teeth.
- **Capacity honesty.** Median top-3 bid depth near the cell is 626–719
  shares ≈ **$600–700 per window**. This family is capacity-bounded by
  construction; `size` default 20 and sweep max 40 stay well inside
  measured depth. It can be a small durable edge, never a large one.

Structural difference from measured fee-bound comparables: every killed or
struggling taker family here paid spread + 156bps to enter; this family
pays neither (maker, hold to fee-free redemption), and unlike the
`maker-favorite` mid-window discount bet, its edge cell is measured
directly on settlement outcomes with month-stable sign. The one term the
census could not measure is precisely what the backtest instrument
measures. That is the definition of a proposable family.

## Experiment roadmap

Ranked, mechanism-distinct, prose only (specced by the Researcher only
when results justify it):

1. **Cancel-on-adverse-move.** After placing, cancel the resting bid if
   the favorite's best bid or mid drops by K cents from the placement
   snapshot. Pre-fill toxicity control: refuses fills that arrive during a
   genuine last-second flip (spot crossing strike) — directly attacks
   P(win|fill), the family's one unknown. Distinct mechanism: lifecycle
   management of the pending order, not entry selection.
2. **Pre-entry path stability qualifier.** Qualify not on the level at the
   trigger tick but on the favorite's recent path — e.g. no favorite-side
   flip and mid range ≤ R over the last N seconds before entry. Targets
   skipping the contested endgames where the window is still a coin flip
   near the strike. Distinct: conditions on the tick-stream history, not
   the instantaneous book.
3. **Earlier placement with dynamic repricing.** Enter at t≈840–885 and
   reprice to stay joined to the best bid until expiry. Trades margin
   (measured only +0.58/+0.96c standing at 870/885) for queue time and
   fill probability. Distinct: multi-shot quote management vs one-shot.
4. **Bid-only book qualifier.** The endgame taxonomy measures one-sided
   book state as a near-perfect classifier (P(UP | up-book bid_only) =
   0.9967→0.9992 across t=780→899). Use bid_only state (ask side empty) as
   the certainty signal and rest the bid there, relaxing the two-sided
   requirement. Distinct: a different information source (book-state
   taxonomy, not price level) and a different episode population.
5. **Split-and-ask the dying longshot (mirror harvest).** Split $1 into
   UP+DOWN, rest an ask on the near-zero longshot to collect the measured
   lottery-buyer donation (−2.9..−6.2c at t≥885, 8/8 months), and hold the
   favorite share to settlement. Distinct: harvests the other donor
   channel of the same endgame, requires split lifecycle and inventory.
6. **Size ladder across price levels.** Split size across several bid
   levels (e.g. 0.955/0.965/0.975) instead of one level — probes depth
   capacity and averages across the adverse-selection curve rather than
   sitting at one point of it. Distinct: order-book placement structure,
   not signal.

## Duplicate notes

- **`maker-favorite`** (researching) is the nearest neighbor: same order
  shape (one resting GTC bid on the stronger leg, hold fills to
  resolution). It is not the same family because the primary decision
  driver differs on every axis that defines it: maker-favorite enters
  mid-window (its tuned variants use `startSec=180`, `stopSec=840` — it
  never enters the final 60 seconds) on any mild favorite (threshold
  0.52–0.65) at a price **relative to mid** (`discount` knob), betting on
  a generic maker discount; endgame-panic-bid enters **only in the final
  seconds** on a **near-certain** favorite at an **absolute price level**,
  harvesting a specific measured donor flow (OL-001). Per
  `rules/NAMING.md`, late-entry alone would be a duplicate — but
  late-entry + certainty gate + absolute-price sink is a new independent
  driver combination, and the glitch-hunt measured that the exploited
  shape (bid ≥2c under fair, same-book ask fair) exists **only** at
  t=897/899 and nowhere in the mid-window field maker-favorite trades
  (OL-003). The two families' EV cannot come from the same cells. If the
  maker-favorite Researcher ever proposes endgame entry timing, the
  `duplicateKeys` here should route it to this family instead.
- **`momentum-hold`**, **`imbalance-hold`**: taker directional entries on
  different drivers (momentum, depth imbalance); no overlap with a
  passive endgame maker bid.
- **`spread-capture`**: market-neutral two-sided maker asks via
  split/merge; different driver (spread harvest) and posture. Roadmap
  idea 5 borrows its split mechanics but remains endgame-donor-driven; if
  that idea is ever specced, re-check overlap then.
- **Glitch-hunt graveyard (not protocol families, cited as lessons):**
  K-002 — endgame taker certainty buying at the same cells — is CLOSED
  wrong-signed (−0.6/−0.7c gross at t=897/899, ≈−2.2c net). This family
  is its maker-side mirror, structurally different per the S-001
  resting-quote-sink pattern: the donation exists only at the resting
  quote. The maker-only guard in Signal definition exists precisely so
  this family can never degenerate into K-002.

## Research log

### 000-baseline — 2026-07-10

Coordinate search (4 passes, 13 runs, latest 1000 markets) then a stage
climb on the best cell. Pass winners: `entryTimeSec=897` (885/890 net
−0.03/mkt with fill win rates 90.48%/85.71% — below the 96.5% breakeven at
a 0.965 bid — while 895/897 tied at +0.01, 8W‑0L; the two losing episodes
filled at 885/890 and at neither late trigger), `bidPrice=0.955` (identical
8 fills as 0.965 but avgWin 0.90 vs 0.70 — under `worst_queue` a fill means
the ask crashed through the level, so deeper collects strictly more),
`certaintyThreshold=0.95` (0.93 ties exactly — inert below 0.95; 0.97
halves participation, 8→4 played, with zero purity gain), `size=40` (pnl
exactly linear 3.60/7.20/14.40 across 10/20/40 — the engine does not
consume depth, so linearity beyond the sweep is engine artifact, not
capacity evidence).

Stage‑1 gate PASSED on run 391 (897/0.955/0.95/40): net +0.01/mkt at 1000
markets, +14.40 pnl, 8 trades, 8W‑0L, all maker, zero fees → verdict
`success` against the frozen bar "Best cell netEvPerMarket > 0 at stage‑1
coverage (STAGE-GATES.md gate 1)"; champion set to 000-baseline (first
gate‑passing experiment; anchor for challengers).

Stage‑2 gate RECYCLED at 3000 markets: net −0.01/mkt, −29.88 pnl, 27
played, 25W‑2L = 92.59% fill win rate vs the 95.5% breakeven at a 0.955
bid. The family's deciding question — P(win | bid filled) vs bid price —
now has a first quantitative answer: both losses are genuine last‑second
flips (bought DOWN at 0.955, settled UP — btc-updown-15m-1778775300,
btc-updown-15m-1780179300; −38.20 each), i.e. the pick‑off tail is real
and, at n=27, prices the fills to approximately the bid (2 losses observed
vs ~1.2 expected at exact breakeven; the stage‑1 window was simply the
lucky zero‑loss third of the data). The measured +4.5c standing margin is
therefore roughly the fair price of bearing the flip tail under the
engine's most adverse fill model — not free money, but also not measurably
toxic beyond fair: the point estimate of the donation surviving adverse
selection is ≈ 0, not < 0.

Interpretation and decision: the baseline one‑shot hold‑to‑settlement shape
converts a +2 to +4.5c standing margin into ≈ 0 net because ~7% of fills
are informed flips that cost the full stake. The obvious attack is removing
informed fills, not finding more margin: roadmap idea 1
(cancel‑on‑adverse‑move) targets exactly the observed loss mechanism — a
last‑second flip is observable pre‑fill book state, and the losing fills
arrive while the favorite's book is already deteriorating. Next experiment:
001-cancel-on-adverse-move. Advisories carried forward: fills are ~0.9% of
markets (27/3000), so every stage answer rides on tens of fills — expect
noisy gates; the maker‑only guard leaked 2 taker fills (both won at better
prices, so the leak is benign in sample but should be watched).

Lesson: Under `worst_queue`, a resting bid on a ~0.99 favorite fills only
when the ask side collapses through it, and those collapses split into
benign panic (settles with you, ~93% of fills) and genuine flips (full
−0.955 stake loss) at a ratio that consumes the entire 4.5c standing margin
— the census's unmeasurable P(win|filled) term turned out to be almost
exactly the breakeven, so any positive EV in this family must come from
filtering the flip tail out of the fill stream, not from price placement
(passes 1–4 already optimized placement and the best cell still recycled).
