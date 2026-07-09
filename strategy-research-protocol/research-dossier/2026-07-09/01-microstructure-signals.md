# Microstructure Signals Survey — Order-Book & Trade-Flow Literature Transferred to Polymarket BTC-15m Binaries

Research lane 01 of the 2026-07-09 dossier. Scope: signals computable from the
recorded Polymarket market stream only (`book` snapshots/updates,
`price_change` events, depth, metadata, own order/fill events). No external
price feeds. See [`strategy-research-protocol/SCOPE.md`](../../SCOPE.md).

---

## 0. The venue, restated as a microstructure problem

Before mapping each literature signal, fix what "informed trading" means here.
In a BTC-15m up/down market the fundamental value process is BTC spot — which
is **exactly the input we are forbidden to see**. Every participant who watches
Binance/Coinbase spot is, relative to our information set, an _insider_. The
entire in-scope microstructure game is therefore:

> **Infer the spot-watchers' information from the footprints they leave in the
> market's own book and tape, faster or more cheaply than the book reprices.**

This is structurally identical to the Glosten–Milgrom / Kyle setting — a market
maker (us) filtering informed flow from noise flow — except we want to _follow_
the informed flow, not fade it. Known facts about this venue:

- **Hybrid CLOB.** Off-chain matching, on-chain settlement, price–time
  priority, prices in [0,1] with ~1¢ ticks (finer in the tails on some
  markets). Two coupled books per market (UP and DOWN are complementary
  assets whose prices should sum to ~$1).
- **Documented stylized facts** (Anatomy of a Decentralized Prediction Market,
  30B events / 52 days / 600 markets,
  [arXiv:2604.24366](https://arxiv.org/abs/2604.24366)):
  - a **longshot spread premium** (spreads widen at extreme prices — quoting
    the cheap side is expensive);
  - **depth profile closer to uniform than top-of-book** — unlike equities,
    liquidity is _not_ concentrated at the touch, so touch-level measures
    undersample the book;
  - **maker-wallet diversity with a concentrated tail** — a few professional
    MM bots plus a broad retail fringe;
  - **trade-direction inference from the public feed matches on-chain truth
    only ~59%** (vs ~80% Lee–Ready on Nasdaq). Any aggressor-side signal must
    first be validated against our own recorded stream's explicit side fields
    — if labels are noisy, every tape-sign signal is attenuated roughly
    linearly in label accuracy;
  - median feed latency <50ms with multi-second tails — stale-book states
    exist and are observable _as_ staleness.
- **Bot ecology** in the 15m crypto markets specifically: latency-arb takers
  reacting to confirmed spot momentum (reported ~98% win rates,
  [Yahoo Finance](https://finance.yahoo.com/news/arbitrage-bots-dominate-polymarket-millions-100000888.html)),
  complement-pair arbitrageurs, fair-value repricers, cross-timeframe (5m vs
  15m) bots, and near-resolution 99¢ buyers
  ([Moonsat, 6 bot types](https://moonsat.medium.com/6-main-types-of-trading-bots-on-up-down-markets-on-polymarket-12893a484f28)).
  The informative events in-stream are dominated by these bots' actions, not
  by human retail.
- **Time structure.** Each episode is 15 minutes; the price is a bounded
  martingale that must hit 0 or 1. Variance-to-go shrinks deterministically;
  the same 3¢ mid move means something entirely different at t=14:00 than at
  t=1:00. Every signal below must be conditioned on time-to-expiry — the
  literature almost never is, because equities have no expiry per-episode.
- Prediction-market precedent: betting exchanges reprice within seconds and
  are near semi-strong efficient in-play (Croxson & Reade;
  [Angelini et al. 2021](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996)),
  and prediction-market ecology is a mix of persistent one-directional bettors
  and fleeting arbitrageurs, not canonical noise traders (Rothschild & Sethi,
  [SSRN 2322420](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2322420)).

Standing constraint from hard-won lessons: **persistent, standing** book
pressure selects unarbitraged longshot legs (cheap losing side), not informed
flow. The signals worth testing below are, almost without exception,
**transient event-flow signals**, the structural opposite of persistence.

---

## 1. Order flow imbalance (OFI) — Cont, Kukanov & Stoikov

**Literature.** OFI counts signed order-book _events_ at the best quotes —
arrivals of limit buys and market sells add/remove supply-demand — and finds
short-horizon price changes are _linear_ in OFI with slope inversely
proportional to depth; robust across stocks and timescales, and cleaner than
the volume–price ("square-root") relation
([arXiv:1011.6402](https://arxiv.org/abs/1011.6402),
[SSRN 1712822](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1712822)).
Extensions: multi-level OFI aggregating deeper levels, and deep-learning on
stationary OFI features beating raw-book models at multi-horizon return
prediction (Kolm, Turiel & Westray,
[SSRN 3900141](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3900141));
integrated/cross-asset OFI ([arXiv:2112.13213](https://arxiv.org/abs/2112.13213)).

**Transfer assessment.** Strong candidate, with two required adaptations:

1. _Use multi-level OFI._ The documented near-uniform depth profile means
   best-quote-only OFI throws away most of the book. Aggregate signed event
   flow over the top K levels (or all levels within ±x¢ of mid).
2. _OFI is contemporaneous impact, not necessarily prediction._ In CKS the
   linear relation is same-interval. The tradable question is whether OFI over
   window w predicts the _next_ window's mid move net of taker cost. In
   equities lagged OFI predictability is weak; here it may be stronger because
   the repricing chain (spot moves → arb bots act → laggards reprice) takes
   observable hundreds of ms to seconds.

**Degeneration risk.** In a thin discrete book, one MM bot re-quoting a large
resting order generates huge event counts with zero information. OFI here
degenerates into "which MM refreshed their quote" unless cancel/add churn from
the same price level is netted or the flow is trade-weighted. Also, standing
imbalance and OFI correlate at long windows — at loose (long-window,
low-threshold) settings this collapses into claimed family (1) and inherits
lesson (a). Keep windows short (≤ a few seconds).

## 2. Trade-flow toxicity (VPIN) — Easley, López de Prado & O'Hara

**Literature.** VPIN buckets volume into equal bins, classifies buy/sell
volume, and takes the moving average of |buy−sell|/total as a real-time proxy
for the probability of informed trading; claimed to lead the 2010 flash crash
([quantresearch.org/VPIN.pdf](https://www.quantresearch.org/VPIN.pdf)).
Heavily contested: Andersen & Bondarenko show VPIN is mechanically correlated
with volume/volatility, is very sensitive to the trade-classification scheme,
and has **no incremental predictive power** for volatility once volume and
volatility are controlled
([SSRN 2305905](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2305905)).

**Transfer assessment.** Weak as designed. Three blows: (i) the classification
sensitivity critique bites doubly hard given ~59% public-feed sign accuracy on
Polymarket; (ii) VPIN needs many volume buckets to stabilize — a 15-minute
episode with sparse trades gives a handful of buckets, so the estimator is
mostly noise; (iii) in this venue "toxicity" isn't a rare regime — spot-watching
bots are _always_ the marginal aggressor, so a toxicity level indicator has
little cross-time variance to exploit.

**What it degenerates into / salvage.** VPIN in a 15m binary degenerates into
short-window signed volume imbalance — i.e., tape-side OFI. The salvageable
core idea is _volume clock_: measure signals in trade-count/volume time rather
than wall time, so quiet minutes don't dilute event windows. That reframing is
worth applying to every driver below; VPIN itself is not worth a family.

## 3. Queue dynamics & cancellation rates

**Literature.** Queue position has measurable economic value — for large-tick
names, front-of-queue value is of the same order as the half-spread (Moallemi
& Yuan, [queue-value-2016.pdf](https://moallemi.com/ciamac/papers/queue-value-2016.pdf));
cancellation intensity depends on queue position and book state
(queue-reactive model, [arXiv:1312.0563](https://arxiv.org/abs/1312.0563)).
Hasbrouck & Saar: ~1/3 of visible limit orders cancelled within 2s ("fleeting
orders"); cancellation-rate measures identify low-latency activity
([Hasbrouck & Saar](https://pages.stern.nyu.edu/~jhasbrou/Research/Working%20Papers/HS10-11-10.pdf)).

**Transfer assessment.** Two distinct uses:

- **Cancellations as the fastest informed footprint.** An MM watching spot
  pulls quotes _before_ repricing or before arb bots sweep. A sudden one-sided
  evaporation of resting depth (mass cancel on the ask of UP) is a directional
  signal that fires _before_ any trade prints — potentially ahead of the
  momentum signal that claimed family (3) waits for. This is the single best
  under-exploited event type in scope, and it is inherently transient (anti-
  persistence, consistent with lesson (a)).
- **Cancel-to-trade ratio / order lifetime as a regime gauge** of how many
  fast bots are active — an adverse-selection gate for any maker-style or
  slow-taker logic.

**Degeneration risk.** In a thin book, "mass cancel" may be one wallet moving
one order; size-thresholding is essential or the signal is one bot's quote
refresh. Cancels also spike mechanically at episode boundaries and after
sweeps (order-management churn), so the detector must net out re-adds at
adjacent prices (a _move_ is not a _pull_).

## 4. Book slope and shape

**Literature.** Næs & Skjeltorp define book slope (depth added per unit price)
and find slope negatively related to volatility and to the volume–volatility
relation; slope proxies dispersion of beliefs
([SSRN 565323](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=565323),
[frds.io implementation](https://frds.io/measures/limit_order_book_slope/)).
Later work uses slope asymmetry (bid slope vs ask slope) as a return
predictor.

**Transfer assessment.** Mostly a **volatility/regime instrument, not a
directional one.** Slope asymmetry as a directional signal is just standing
depth imbalance re-parameterized → collapses into claimed family (1) and
lesson (a) applies with full force: a steep bid slope on a 20¢ longshot is the
unarbitraged-leg trap in slope clothing. The defensible uses: (i) flat/thin
overall slope ⇒ fragile book ⇒ larger response to a given sweep (interaction
term for sweep-following); (ii) _change_ in slope within an episode (book
thinning into the final minutes) as an execution-cost forecast. The
near-uniform depth profile finding says slope is well-defined here (depth
actually extends through prices), which is a point in its favor as a
_conditioning variable_.

**Degeneration risk.** Directional slope = claimed idea (1). Keep slope
strictly as an interaction/sizing input, never the entry trigger.

## 5. Micro-price vs mid

**Literature.** Stoikov's micro-price: the limit of expected future mids, a
martingale adjustment of the mid using imbalance and spread state; empirically
beats mid and weighted-mid as a short-horizon fair-value estimate
([SSRN 2970694](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2970694)).

**Transfer assessment.** With ~1¢ ticks on a 1–99¢ asset, the tick is huge
relative to price (2%+ near the tails); the mid is coarsely quantized and the
micro-price is exactly the tool for de-quantizing it. Two in-scope uses:

- **Within one book:** micro-price − mid as the marginal directional read.
  Alone, this is imbalance again → family (1). Not a family.
- **Across the complement pair (novel and venue-specific):** compute
  micro-price for the UP book and DOWN book independently. In an efficient
  state, `microprice(UP) + microprice(DOWN) ≈ 1`. Deviations decompose into
  (a) genuine complement mispricing (claimed by family 4's spread-capture
  only as a _quoting_ opportunity) and (b) **one book being stale** — the
  fresher book's micro-price is the better estimate of truth, and the stale
  book's touch is takeable before it updates. Direction and which-book-to-hit
  both come from the market's own stream.

**Degeneration risk.** Micro-price estimation (Markov-chain over
imbalance/spread states) needs data; per-episode books are sparse, so states
must be pooled across episodes, assuming the imbalance→drift map is stable
across regimes — precisely the kind of assumption lesson (d) warns about.
Guard: re-estimate on rolling windows, test sign stability by month.

## 6. Quote stuffing / spoofing footprints

**Literature.** Quote stuffing = episodic quoting-activity spikes degrading
market quality (Egginton, Van Ness & Van Ness,
[ResearchGate](https://www.researchgate.net/publication/302570021_Quote_Stuffing));
spoofing = large non-bona-fide resting orders to induce fills opposite;
detection models need posting-distance features
([arXiv:2504.15908](https://arxiv.org/abs/2504.15908)).

**Transfer assessment.** As an _alpha source_, weak: we cannot see wallets in
the market stream, so attribution is impossible; and spoof-like patterns in a
thin retail book are indistinguishable from one MM's inventory management.
The transferable insight is **defensive**: any depth-based signal (including
claimed family 1 and our micro-price uses) is _spoofable_ — resting size at or
behind the touch is cheap talk; consumed size (prints) and cancels-under-fire
are costly signals. Concretely: weight book-pressure features by
_executed-against_ depth, and treat resting size that repeatedly appears and
vanishes without ever trading (fleeting, large, one-sided) as a **negative**
weight — its presence predicts the opposite of naive imbalance. This
"discount-the-fleeting-size" correction is testable as a feature transform
inside other drivers rather than as its own family.

**Degeneration risk.** A spoof detector in a thin book degenerates into a
fleeting-order counter (§3). Fold it in there.

## 7. Aggressor-side run length

**Literature.** Market-order signs have power-law long memory driven by
order-splitting of large metaorders (Lillo, Mike & Farmer,
[SSRN 708303](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=708303);
quantitative confirmation with account-level data,
[arXiv:2301.13505](https://arxiv.org/abs/2301.13505)). Runs of same-sign
aggression indicate a metaorder being worked; prices drift with the metaorder.

**Transfer assessment.** The _mechanism_ transfers with a different driver: on
Polymarket-15m nobody splits large metaorders over hours; instead, a same-side
run of taker prints over seconds is the footprint of **latency-arb bots
repeatedly hitting a lagging book while spot keeps moving** — i.e., the run
directly indexes how far behind the book is. Burst detection on the tape
(N same-side prints within Δt, or X depth consumed per second, in volume
time per §2) is a cleaner "informed flow now" trigger than any standing-book
measure, and is nearly orthogonal to claimed family (3) because it can fire
while the mid has not yet moved (prints grinding through one level).

**Degeneration risk.** (i) Sign-label noise (~59% issue) directly attenuates
run statistics — validate labels first; (ii) at loose thresholds this becomes
"price went up, buy" = momentum family (3); the run trigger must be shown to
add EV _conditional on_ zero-or-small contemporaneous mid move, else it is not
a separate driver; (iii) late-episode runs on the 95¢ favorite are
near-resolution bots, not information — condition on time and price level.

## 8. Resiliency after large trades

**Literature.** Large (2007) models replenishment after big trades with
mutually-exciting Hawkes processes: in >60% of cases the LSE book did _not_
reliably replenish; when it did, half-life ~20s
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1386418106000528)).
Follow-ups measure spread/depth/intensity recovery paths
([arXiv:1602.00731](https://arxiv.org/abs/1602.00731)).

**Transfer assessment.** Excellent fit as a **second-stage confirmation
signal**. After a sweep on UP's ask: if MMs (who see spot) promptly re-quote
the same or better ask, they are asserting the sweep was noise → the move
should revert → skip or fade. If the ask does _not_ replenish (makers agree
with the sweep), the move is informed → follow, even at the worse price. This
turns MM behavior — the best-informed resting agents in the market — into a
free oracle read. Timescales (tens of seconds) fit a 15m episode, and the
signal is event-anchored and transient (anti-lesson-(a) by construction).

**Degeneration risk.** In a thin book "replenishment" may be one bot's
auto-requote regardless of information → measure replenishment _price_ and
_size_ relative to pre-sweep state, not mere presence; near expiry makers
stop re-quoting unconditionally (variance-to-go too high per tick), so the
signal must be time-conditioned or it degenerates into "late in episode ⇒
always follow," a regime artifact per lesson (b).

## 9. Spread dynamics as an information signal

**Literature.** Adverse-selection spread theory (Glosten & Milgrom 1985,
[JFE](https://www.sciencedirect.com/science/article/pii/0304405X85900443));
spreads widen days before earnings announcements as makers price anticipated
information asymmetry
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1544612316302008));
spread widens before information-event price moves generally
([NBER w7331](https://www.nber.org/system/files/working_papers/w7331/w7331.pdf)).

**Transfer assessment.** Here MMs watch spot; the quoted spread is their
posted price of adverse selection _right now_. Decompose spread changes:

- **Symmetric widening (both sides retreat):** volatility warning, direction
  unknown. Use as an abstain gate / sizing input for taker entries (entering
  into a widening spread pays maximum cost exactly when informed flow is
  strongest against you), and as a _timing_ signal for volatility-long
  structures.
- **Asymmetric retreat (one side steps back, other holds/steps up):** the
  side that retreats reveals which outcome MMs fear — a _directional_ read
  with no trade required. This is the state-variable twin of the
  cancellation-flow signal in §3.
- **Mid moves without trades** (`price_change` with no print): pure maker
  repricing = spot information injected directly. A "quote-driven vs
  trade-driven mid move" decomposition — following quote-driven moves and
  ignoring/fading trade-driven ones — is a genuinely different decision
  driver from price-level momentum (family 3), which is blind to the _cause_
  of the move.

**Degeneration risk.** The longshot spread premium means spread level is
mostly a function of price level — any spread signal must be normalized by
price (moneyness) and time-to-expiry or it degenerates into "price is extreme."
Spread widening near expiry is mechanical (per-tick variance explodes), so
raw widening → "late episode" regime proxy, lesson (b).

---

## Transfer matrix (summary)

| Signal                                   | Directional value here                  | Main degeneration                                                   | Verdict                                    |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| OFI (event flow, multi-level)            | High, short windows only                | MM quote-churn noise; long windows → standing imbalance (claimed 1) | Test                                       |
| VPIN                                     | Low                                     | Signed-volume imbalance with too few buckets; sign-label noise      | Reject; keep volume-clock idea             |
| Cancellations / liquidity pulls          | High, fastest footprint                 | One bot's requote; boundary churn                                   | Test (top pick)                            |
| Book slope                               | Low directional / medium as conditioner | Slope asymmetry = claimed 1                                         | Conditioning only                          |
| Micro-price (single book)                | Medium but = imbalance                  | Claimed 1                                                           | Fold into cross-book use                   |
| Micro-price (cross-book UP/DOWN)         | High, venue-specific                    | Regime-unstable state map                                           | Test                                       |
| Spoofing/stuffing footprints             | Low as alpha                            | Fleeting-order counter                                              | Defensive feature (discount fleeting size) |
| Aggressor run-length / sweeps            | High                                    | Momentum-in-disguise; label noise                                   | Test with mid-move control                 |
| Resiliency after sweeps                  | High as confirmation stage              | Auto-requote false positives; time confound                         | Test                                       |
| Spread dynamics / quote-driven mid moves | High                                    | Moneyness/time mechanical effects                                   | Test with normalization                    |

---

## Ranked testable decision drivers (outside claimed idea-space)

All inputs below are from the recorded stream. Sweeps deliberately include a
"does the filter bind / is the EV peak interior" check per lessons (b)–(c),
and monthly sign-stability accounting per lesson (d).

### D1. Liquidity-pull follow (cancellation-led repricing)

- **Mechanism.** Spot-watching MMs cancel resting quotes on the doomed side
  _before_ repricing or being swept. A sharp one-sided depth evaporation is
  the earliest in-book footprint of off-venue information — earlier than the
  print momentum waits for. Following it takes the not-yet-repriced opposite
  quote. Edge survives fees only if entry precedes the mid adjustment; the
  event is transient by construction (opposite of the persistence trap).
- **Inputs.** `book`/`price_change` deltas: per-side resting-depth time series
  within ±k¢ of mid; cancel events netted against re-adds at adjacent prices
  within a short matching window (a move ≠ a pull); trade prints to exclude
  consumption-driven depth drops (must be cancel-driven).
- **Baseline sweep.** Pull fraction threshold φ ∈ {30, 50, 70}% of side depth
  within window w ∈ {250ms, 1s, 3s}; depth zone k ∈ {1, 3, 5}¢; taker entry on
  the revealed direction; exit at fixed horizon {30s, 120s, redemption};
  time-of-episode buckets. Binding check: participation rate must fall
  materially as φ rises, and EV should peak at interior φ, w.
- **Likely failure.** Single-wallet quote refresh mislabeled as a pull (thin
  book) → signal fires constantly at loose settings and becomes noise
  (lesson c); or all EV concentrates in the final 2 minutes → mechanical
  near-expiry regime artifact (lesson b).

### D2. Quote-driven vs trade-driven mid-move decomposition

- **Mechanism.** Decompose every mid change by proximate cause: maker
  repricing (cancel/re-add, no print) vs taker consumption (print). Maker-
  driven moves embed spot information (MMs are the insiders); taker-driven
  moves are a mix of informed arb and noise and, post-impact, partially
  revert. Follow quote-driven moves; require confirmation for (or fade)
  trade-driven ones. Distinct from momentum family (3), which is blind to
  cause.
- **Inputs.** Event-synchronized book deltas + trade prints; classification of
  each best-quote change into {consumed, cancelled, improved, added}.
- **Baseline sweep.** Move size m ∈ {1, 2, 3}¢; cause class ∈ {quote-only,
  trade-only, mixed}; entry taker in move direction; hold {60s, 5m,
  redemption}; separately estimate continuation vs reversion per class —
  the _decomposition contrast_ (quote-class EV minus trade-class EV) is the
  pass/fail statistic, not either leg alone.
- **Likely failure.** In a 1¢-tick thin book most mid moves are mixed-cause
  within milliseconds, shrinking the pure-class samples; if the contrast only
  appears in one calendar month, it is a regime trend (lesson d).

### D3. Sweep-then-no-refill (resiliency failure) confirmation entry

- **Mechanism.** After a large taker sweep, MMs' refill behavior is an oracle:
  refusal to replenish at pre-sweep prices means the informed move is real
  (Large 2007: books often do _not_ replenish; refill half-life ~20s fits the
  episode). Enter in sweep direction only on confirmed non-replenishment —
  paying a worse price for a much better-selected subset of sweeps.
- **Inputs.** Trade prints (sweep detector: depth consumed ≥ q within Δt);
  post-sweep book state vs pre-sweep snapshot (depth restored within ±1¢ of
  pre-sweep best, measured at checkpoint τ).
- **Baseline sweep.** Sweep size q ∈ {p50, p75, p90} of episode print sizes;
  refill checkpoint τ ∈ {5s, 15s, 30s}; refill threshold ρ ∈ {25, 50, 75}% of
  consumed depth; hold to {5m, redemption}. Contrast arm: enter on _every_
  sweep — D3 passes only if the no-refill condition binds (rejects most
  sweeps) and beats the unconditional arm net of the worse entry price.
- **Likely failure.** Late-episode makers never refill regardless of
  information → condition on time-to-expiry or the driver reduces to "follow
  any late sweep" (regime artifact, lesson b); auto-requoting MM bots refill
  cosmetically at tiny size → refill must be size-weighted.

### D4. Tape-burst follow with zero-mid-move control (run-length trigger)

- **Mechanism.** A run of same-side taker prints within seconds is the
  footprint of latency arbitrageurs grinding through a lagging book while
  spot keeps moving (LMF run mechanics, different generator). Fires while the
  mid is still unmoved (prints eating one level) — the residual edge after
  the momentum family is exactly the mid-hasn't-moved-yet subset.
- **Inputs.** Trade tape with aggressor side (**pre-step: audit our stream's
  side labels against on-chain fills for a sample — public-feed inference was
  only ~59% accurate in the literature**); mid series for the control.
- **Baseline sweep.** Run length N ∈ {3, 5, 8} prints or signed volume ≥ v in
  window Δt ∈ {1s, 3s, 10s} (also in volume-time); **hard filter: contempora-
  neous mid move ≤ 1¢** (this is what separates it from claimed family 3 —
  if EV vanishes under this filter, the driver is momentum and must be
  dropped); taker entry, exit {60s, 5m, redemption}.
- **Likely failure.** Side-label noise makes long runs rare and spurious; or
  the zero-mid-move filter fails to bind (all bursts move mid instantly in a
  thin book) leaving no tradable subset (lesson c).

### D5. Cross-book staleness / micro-price divergence taker

- **Mechanism.** UP and DOWN books update asynchronously. When one book has
  repriced (fresh events) and its complement has not (no updates for s
  seconds), the fresh book's micro-price implies the stale book's touch is
  off by more than fees. Hitting the stale quote is informed by the market's
  own stream alone. Not family (4): no quoting, no spread capture — a
  directional taker decision using which-book-is-fresh as the signal.
- **Inputs.** Both books' event streams per market; per-book last-update age;
  Stoikov micro-price per book (imbalance/spread state map pooled across
  episodes).
- **Baseline sweep.** Divergence d = |mp(UP) + mp(DOWN) − 1| ∈ {2, 3, 5}¢
  triggers; staleness s ∈ {1s, 3s, 10s}; hit the stale side in the fresh
  side's direction; exit on stale-book update or fixed 60s. Check EV is
  interior in d (at loose d this is generic complement arb, likely claimed
  and crowded).
- **Likely failure.** "Stale" book is actually empty/wide (longshot spread
  premium) so the takeable price already reflects the divergence — measured
  slippage eats the edge; micro-price state map fit on one regime flips sign
  next month (lesson d).

### D6. Asymmetric quote-retreat state (spread decomposition direction)

- **Mechanism.** Split every spread widening by side: ask retreats while bid
  holds ⇒ makers fear UP resolution (buy UP), and vice versa. The retreating
  side is a costless-to-observe insider poll — the _state_ twin of D1's flow
  signal, catching slower, quieter retreats D1's windowed pull-fraction
  misses.
- **Inputs.** Best bid/ask series per book; normalization by price level
  (longshot spread premium) and time-to-expiry (mechanical late widening).
- **Baseline sweep.** Retreat asymmetry a = |Δask| − |Δbid| ≥ {1, 2, 3}¢ over
  w ∈ {3s, 10s, 30s} with no prints in w; taker entry toward the retreat;
  exclude final {1, 2} minutes; hold {2m, redemption}.
- **Likely failure.** Collinear with D1 (both fire on the same cancel
  events) — if the two drivers select >70% overlapping entries, keep one; and
  post-normalization the signal may just re-discover "price drifted toward
  the tail," a longshot-side selection per lesson (a).

### D7. Time-scaled favorite convergence priced off in-stream realized vol

- **Mechanism.** The binary must converge to 0/1. Using the market's _own_
  realized mid volatility (in-stream, allowed) and time-to-go, compute the
  implied probability that the current favorite survives; when the traded
  price is below that implied value by more than fees (longshot demand and
  the documented longshot spread premium cheapen the favorite side), buy the
  favorite as a taker. This is a _pricing-model_ driver, unlike claimed (2),
  which is a maker-execution idea on the favorite, and unlike (1)/(3), which
  read book pressure/price direction.
- **Inputs.** Own mid history within episode (realized vol of the bounded
  price), time-to-expiry, current touch; freshness gate: recent book updates
  on both sides (a stale cheap favorite is a trap, since we cannot check
  spot).
- **Baseline sweep.** Edge threshold e = model_p − ask ∈ {2, 4, 6}¢; vol
  window {2m, 5m, whole episode}; entry window (last {5, 3, 1} min); price
  band p ∈ {0.70–0.85, 0.85–0.95}; hold to redemption. Must show the
  freshness gate binds and that EV is not monotone-increasing toward the
  loosest e (lesson c).
- **Likely failure.** Adverse selection at the moment of entry: the favorite
  is cheap precisely when the book hasn't yet repriced an adverse spot move —
  losses concentrate in exactly the fills we get (classic picked-off-taker
  asymmetry); also monthly sign flips if realized-vol scaling misprices
  regime shifts in BTC vol (lesson d).

### D8. Fleeting-size discount as a feature transform (toxicity-adjusted book pressure)

- **Mechanism.** Resting size that repeatedly appears/vanishes without
  trading is cheap talk (spoof-adjacent, §6); size that gets consumed is
  costly signal. Re-weight any depth/imbalance feature by each level's
  historical _execution realization rate_ within the episode. Not a family —
  a transform to be A/B-tested inside D1/D5/D6 baselines.
- **Inputs.** Level-keyed add/cancel/trade event history per episode.
- **Baseline sweep.** Feature ablation: driver EV with raw depth vs
  fleeting-discounted depth; discount half-life ∈ {10s, 60s, 5m}.
- **Likely failure.** Too few events per level per 15m episode to estimate
  realization rates — the transform adds variance, not signal.

---

## Sources

- Cont, Kukanov & Stoikov, _The Price Impact of Order Book Events_ — [arXiv:1011.6402](https://arxiv.org/abs/1011.6402), [SSRN 1712822](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1712822)
- Kolm, Turiel & Westray, _Deep Order Flow Imbalance_ — [SSRN 3900141](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3900141)
- Cont et al., _Cross-Impact of Order Flow Imbalance_ — [arXiv:2112.13213](https://arxiv.org/abs/2112.13213)
- Easley, López de Prado & O'Hara, _VPIN_ — [quantresearch.org/VPIN.pdf](https://www.quantresearch.org/VPIN.pdf); _VPIN and the flash crash_ — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1386418113000189)
- Andersen & Bondarenko, _Reflecting on the VPIN Dispute_ — [SSRN 2305905](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2305905)
- Moallemi & Yuan, _Queue Position Valuation_ — [moallemi.com](https://moallemi.com/ciamac/papers/queue-value-2016.pdf)
- Huang, Lehalle & Rosenbaum, _Queue-Reactive Model_ — [arXiv:1312.0563](https://arxiv.org/abs/1312.0563)
- Hasbrouck & Saar, _Low-Latency Trading_ (fleeting orders) — [NYU pdf](https://pages.stern.nyu.edu/~jhasbrou/Research/Working%20Papers/HS10-11-10.pdf)
- Næs & Skjeltorp, _Order Book Characteristics and the Volume-Volatility Relation_ — [SSRN 565323](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=565323); slope measure — [frds.io](https://frds.io/measures/limit_order_book_slope/)
- Stoikov, _The Micro-Price_ — [SSRN 2970694](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2970694)
- Egginton, Van Ness & Van Ness, _Quote Stuffing_ — [ResearchGate](https://www.researchgate.net/publication/302570021_Quote_Stuffing)
- _Learning the Spoofability of Limit Order Books_ — [arXiv:2504.15908](https://arxiv.org/abs/2504.15908)
- Lillo, Mike & Farmer, _A Theory for Long-Memory in Supply and Demand_ — [SSRN 708303](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=708303); LMF quantitative test — [arXiv:2301.13505](https://arxiv.org/abs/2301.13505)
- Large, _Measuring the Resiliency of an Electronic Limit Order Book_ — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1386418106000528); resiliency after market orders — [arXiv:1602.00731](https://arxiv.org/abs/1602.00731)
- Glosten & Milgrom (1985) — [JFE](https://www.sciencedirect.com/science/article/pii/0304405X85900443); earnings-announcement spread widening — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1544612316302008); spread/activity modeling — [NBER w7331](https://www.nber.org/system/files/working_papers/w7331/w7331.pdf)
- _The Anatomy of a Decentralized Prediction Market: Microstructure Evidence from the Polymarket Order Book_ — [arXiv:2604.24366](https://arxiv.org/abs/2604.24366)
- _Arbitrage Analysis in Polymarket NBA Markets_ — [arXiv:2605.00864](https://arxiv.org/abs/2605.00864)
- Rothschild & Sethi, _Trading Strategies and Market Microstructure (Intrade)_ — [SSRN 2322420](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2322420)
- Angelini, De Angelis & Singleton, _Informational efficiency within in-play prediction markets_ — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996)
- Bot ecology: [Moonsat, 6 bot types](https://moonsat.medium.com/6-main-types-of-trading-bots-on-up-down-markets-on-polymarket-12893a484f28); [Yahoo Finance on Polymarket arb bots](https://finance.yahoo.com/news/arbitrage-bots-dominate-polymarket-millions-100000888.html)
