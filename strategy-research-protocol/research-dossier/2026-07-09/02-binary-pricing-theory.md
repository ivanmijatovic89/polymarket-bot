# 02 — Binary Pricing Theory: Ultra-Short-Expiry Fair-Value Dynamics for 15m Up/Down Markets

Research lane: pricing theory of near-expiry binaries, using ONLY the market's own price path
(mid, book, `price_change` events, τ = time-to-expiry) as input. Scope per
[`strategy-research-protocol/SCOPE.md`](../../SCOPE.md): no external BTC feed — the strategy sees
the binary's book, not spot. All numeric claims below were verified by Monte Carlo
(200k paths, 1s steps) during this session.

---

## 0. The null model (everything else derives from it)

Let the unobservable underlying `X_t` be a driftless diffusion with vol σ, reference price `K = X_0`,
window length `T = 900s`, τ = T − t. The fair UP probability is

```
p_t = Φ(z_t),   z_t = (X_t − K) / (σ√τ)
```

Itô on `p = Φ(z)` with `dz = dW/√τ + (z/2τ)dt` gives (drift cancels exactly — `p` is a martingale):

```
dp_t = φ(z_t) · dW_t / √τ          ⇒   σ_p(p, τ) = φ(Φ⁻¹(p)) / √τ
```

**Two remarkable properties:**

1. **σ cancels.** The instantaneous volatility of the _probability itself_ depends only on `(p, τ)` —
   not on the underlying's vol. Given the current price and clock, the entire law of the remaining
   fair-price path is **parameter-free**. This is the core of Taleb's martingale-arbitrage argument
   for binary forecasts ([arXiv:1703.06351](https://arxiv.org/abs/1703.06351); partial rebuttal
   [arXiv:1907.01576](https://arxiv.org/pdf/1907.01576) — the rebuttal disputes Taleb's
   _comparative-static in vol_ heuristic, not the martingale/QV identities used here).
2. **QV budget identity.** Since `p_T ∈ {0,1}`, the expected remaining quadratic variation of any
   fair binary price is exactly `E[∫ₜᵀ (dp)²] = p_t(1 − p_t)`. (Sim check: mean realized QV of a
   50/50 start = 0.2466 ≈ 0.25.)

These give a fully specified, in-stream-computable **null model for how fast the price should move**.
Every driver below is a deviation from this null.

---

## 1. Q1 — How fast should the price move? Theta/gamma of the near-expiry ATM binary

### Fair per-second std of the probability (cents), `σ_p = φ(Φ⁻¹(p))/√τ`:

| p \ τ | 600s | 300s | 120s | 60s      | 30s  | 10s  |
| ----- | ---- | ---- | ---- | -------- | ---- | ---- |
| 0.50  | 1.63 | 2.30 | 3.64 | **5.15** | 7.28 | 12.6 |
| 0.60  | 1.58 | 2.23 | 3.53 | 4.99     | 7.05 | 12.2 |
| 0.70  | 1.42 | 2.01 | 3.17 | 4.49     | 6.35 | 11.0 |
| 0.80  | 1.14 | 1.62 | 2.56 | 3.61     | 5.11 | 8.9  |
| 0.90  | 0.72 | 1.01 | 1.60 | 2.27     | 3.20 | 5.6  |
| 0.95  | 0.42 | 0.60 | 0.94 | 1.33     | 1.88 | 3.3  |
| 0.99  | 0.11 | 0.15 | 0.24 | 0.34     | 0.49 | 0.8  |

RMS move over the **next 30 seconds** (sim): from p=0.50 it is 8.9c at τ=600s, 12.7c at 300s,
20.2c at 120s, **28.8c at 60s**. From p=0.90: 4.0c → 15.0c over the same τ ladder.

**Interpretation.** A fair 50/50 market with one minute left should wiggle ~5 cents _per second_
(std). An ATM binary near expiry is the binary analogue of peak-gamma 0DTE
([OAS 0DTE mechanics](https://www.optionsanalysissuite.com/documentation/0dte-options)): for
digitals, the vanna/gamma singularity concentrates at ATM as τ→0
([BSIC exotic greeks primer](https://bsic.it/greexotics-a-first-step-in-the-land-of-exotic-derivatives-greeks-part-1/)).
Theta has the opposite sign on each side of 50: **for p > 0.5 the pure passage of time pushes fair
up; for p < 0.5, down** (see §3 table) — a binary "theta" that is _directional_, unlike vanillas.

### In-stream detectability of under/overreaction

Define the **speed ratio** over a rolling window W:

```
R_W = realized_var(mid; W) / ∫_W φ(Φ⁻¹(p_s))²/τ_s ds
```

Numerator and denominator both come from the stream alone. Under the null `E[R] = 1` at any `(p, τ)`.

- `R ≪ 1` late in the window at mid-range p ⇒ the price is **stickier than any fair binary can be**
  — either the underlying is genuinely pinned at the strike (possible but has its own signature, §2),
  or quotes are stale and the eventual resolution move is being deferred (underreaction).
- `R ≫ 1` ⇒ the price is churning more QV than its remaining budget `p(1−p)` justifies —
  overreaction; the in-play literature says overreaction concentrates after _surprising_ moves
  ([ScienceDirect: in-play prediction market efficiency](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996);
  [Role of Surprise, in-play soccer](https://www.researchgate.net/publication/256013000_The_Role_of_Surprise_Understanding_Overreaction_and_Underreaction_to_Unanticipated_Events_using_In-Play_Soccer_Betting_Market)).

Caveat (circularity): the theoretical leg uses the _market's own_ p as the argument. R is therefore a
_self-consistency_ diagnostic — it detects when the price path is incompatible with **any** driftless
diffusion, which is exactly the right null given we cannot see spot.

---

## 2. Q2 — Pinning vs collapse: when should 60/40 go to 99/1, and when may it hover?

`z_t | z_0 ~ N(z_0·√(τ_0/τ_t)·(scaling), (τ_0−τ_t)/τ_t)` — variance of z **diverges** as τ→0, so
`|z| → ∞` and p must collapse to 0 or 1. Monte Carlo, starting 50/50 at τ=900s:

| τ remaining | P(p ∈ [0.40, 0.60]) "hover" | P(p ≥ 0.95 or ≤ 0.05) "resolved" |
| ----------- | --------------------------- | -------------------------------- |
| 120s        | 7.8%                        | 52%                              |
| 60s         | **5.3%**                    | 66%                              |
| 30s         | 3.8%                        | 76%                              |
| 10s         | 2.2%                        | 86%                              |

**A fair market spends almost no late time near 50.** Under the null, hovering at 55/45 with 45s
left is a ~1-in-20 state. Two distinct causes must be separated in data:

- **Genuine pin**: spot glued to the reference. Signature: _both_ the level is near 50 **and**
  realized σ_p matches the theoretical (huge) value — the price should be violently noisy around 50,
  ~5c/s std. A _quiet_ 50 is not a pin; it is a stale market.
- **Sticky quotes / unpriced resolution risk**: level near 50 with `R ≪ 1`. The terminal jump is
  deferred; the first genuine repricing under-travels relative to a fair path that "should already
  have left." This is the testable "convergence too slow" driver.

Also relevant: for driftless BM the **last crossing time of the reference follows the arcsine law** —
lead changes cluster at the very start and very end of the window. Frequent 50c crossings in the
last 2 minutes are _normal_; a market that stops crossing while sitting at 52c is not.

---

## 3. Q3 — Time-value decay traps: when is buying the favorite late structurally overpaying?

First the _opposite_ effect, which is real and exploitable: **pure time-decay repricing**. If the
book is quiet (no `price_change`/trades — in-stream evidence that informed flow with spot feeds saw
nothing to trade), fair drifts away from 50 deterministically: `p_new = Φ(Φ⁻¹(p_old)·√(τ_old/τ_new))`.

| p_old | τ_old → τ_new | fair p_new | drift |
| ----- | ------------- | ---------- | ----- |
| 0.60  | 300 → 180s    | 0.628      | +2.8c |
| 0.70  | 180 → 120s    | 0.740      | +4.0c |
| 0.70  | 120 → 60s     | 0.771      | +7.1c |
| 0.80  | 120 → 60s     | 0.883      | +8.3c |
| 0.90  | 60 → 30s      | 0.965      | +6.5c |
| 0.95  | 60 → 20s      | 0.998      | +4.8c |

Martingale subtlety (important, this is where naive "theta harvest" is wrong): unconditionally
`E[p_{t+Δ}|F_t] = p_t` — there is **no** free drift. The drift above is _conditional on the
underlying not having moved_, and the only in-stream proxy for that is book/trade silence. The trade
thesis is precisely: _silence + un-decayed ask on the favorite = stale quote_, not "theta always
accrues."

Now the traps — buying the favorite late structurally overpays when:

1. **The decay is already over-consumed**: ask = 99c while decayed-fair is 98.2 — at extremes one
   tick is the whole edge. With 1c ticks, fair 0.985 must print 98 or 99; the ask side
   systematically sits on the _over_-rounded tick.
2. **Payoff asymmetry at extremes**: buying at 97 risks 97c to win 3c; a single adverse oracle print
   (Polymarket resolves on the Chainlink BTC/USD stream —
   [Polymarket BTC 15m market](https://polymarket.com/event/btc-updown-15m-1776361500)) needs win
   rate > 97% _after_ spread+fees. Kalshi's structurally identical 15m BTC contracts show the same
   last-minute pileup into the favorite
   ([Kalshi 15-min mechanics](https://predictionmarketspicks.com/articles/kalshi-bitcoin-15-minute-markets),
   [settlement averaging edge cases](https://predictionmarketspicks.com/articles/how-kalshi-settles-bitcoin)) —
   note Kalshi averages 60s of index, Polymarket/Chainlink is a point-ish read: terminal reversals
   are _more_ dangerous here, not less.
3. **Adverse-selection asymmetry**: other participants _do_ see spot. Any resting order we place
   late is picked off by feed-armed takers; any late taker buy of the favorite crosses a spread set
   by makers who are faster-informed than us. Costs measured in the harness (taker fee, spread,
   slippage) rise exactly where σ_p peaks (table §1). Late-window edge must clear a cost curve that
   grows like 1/√τ.

---

## 4. Q4 — What the literature says about where systematic mispricing sits near expiry

- **Favorite-longshot bias (FLB)**: longshots systematically overpriced, favorites underpriced;
  losses ~5% on favorites vs ~40% on extreme longshots in fixed odds
  ([overview](https://www.researchgate.net/publication/228884358_The_Favorite-Longshot_Bias_An_Overview_of_the_Main_Explanations);
  [college sports evidence](https://www.sciencedirect.com/science/article/abs/pii/S1062976916000041)).
  Direct implication in probability space: the 1–5c side of a late 15m market is on average a
  donation; the 95–99c side is where residual value sits — _if_ costs allow reaching it.
- **In-play (structurally identical: binary, hard expiry, continuous news)**: Croxson & Reade find
  exchange odds adjust to goals near-instantly with little drift
  ([Economic Journal 2014](https://onlinelibrary.wiley.com/doi/abs/10.1111/ecoj.12033)) — the
  efficient benchmark. But later work on in-play exchanges finds **underreaction to normal news,
  overreaction to surprising news** (longshot scores late → market *under*rates their win prob,
  a _reverse_ FLB flavor in-play)
  ([Informational efficiency in in-play prediction markets](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996)).
  Mapped to our stream: moderate mid moves late → follow-through residual; violent
  outlier moves (R ≫ 1) → fade residual. The _surprise-conditioning_ is the transferable finding,
  not a blanket momentum or reversal claim.
- **Prediction-market microstructure**: even the most liquid binary constructions sit 2–4% from
  execution-adjusted parity ([arXiv:2601.01706](https://arxiv.org/html/2601.01706v1)) — the
  within-market complement-sum is not reliably arbitrage-tight at our horizon (adjacent to claimed
  idea 4, so not ranked below, but it calibrates how much raw slack exists: a few cents).

---

## 5. Q5 — Round-number / tick-boundary effects in probability space

- Crypto LOBs show strong limit-order clustering at round numbers, deeper away from the touch, and
  the clusters act as barriers
  ([crypto LOB clustering](https://www.sciencedirect.com/science/article/abs/pii/S221463502400008X);
  [limit order clustering and price barriers](https://efmaefm.org/0efmameetings/efma%20annual%20meetings/2007-Austria/papers/0286.pdf);
  [Above Up, Below Down](https://www.researchgate.net/publication/378809671_Above_Up_Below_Down_The_Impact_of_Limit_Order_Clustering_on_Stock_Price_Movements)).
  In a 1–99c probability book the natural barriers are 50 (favorite flip — maximum salience), and
  multiples of 5/10.
- 50c is special twice over: behaviorally (which side is "the favorite" flips) and mathematically
  (σ_p is maximized at p=0.5, so the fair price moves _fastest_ exactly where the behavioral barrier
  is stickiest — maximal tension between null and behavior).
- Tick floor/cap: fair values in (0, 0.5c) and (99.5c, 1) are unquotable; near expiry decayed-fair
  regularly exceeds 99.5 (§3 table: 0.95 at 60s → 0.998 by 20s) while the ask is capped at 99 —
  a structural, bounded, sign-known residual, tradable only if fees/slippage < ~0.5c and terminal
  reversal risk < ~0.5%.

---

## 6. Ranked testable decision drivers (outside claimed idea-space)

Claimed and excluded: book-depth-imbalance taker hold, maker-bid-on-favorite, momentum taker hold,
two-sided MM/complement quoting. Everything below keys off the **parameter-free null** (§0), which
none of the claimed ideas use.

### D1. Quiet-book time-decay repricing (conditional theta capture) — RANK 1

- **Mechanism**: book/trade silence over Δ seconds is in-stream evidence spot hasn't moved; then fair
  drifts `p → Φ(Φ⁻¹(p)√(τ_0/τ_1))` (+3 to +8c per minute in the 60–90c zone, §3) while stale asks
  lag. Buy the favorite's un-decayed ask as taker. Not naive theta: the silence conditioning is the
  whole trade.
- **Inputs**: `price_change`/trade event timestamps (silence detector), mid, best ask, τ.
- **Baseline sweep**: silence window Δ ∈ {15, 30, 60s} × min decay-edge net of (spread+fee)
  ∈ {1, 2, 3c} × p-zone ∈ {55–75, 75–90} × τ ∈ {300–120s, 120–45s}. Entry: ask < decayed-fair − edge;
  hold to expiry.
- **Failure mode**: silence = dead/abandoned market, not still spot (lesson b: regime artifact —
  quiet markets cluster in low-activity regimes); ask gets pulled before fill; per lesson (c) the
  edge must NOT peak at the loosest silence threshold — if Δ=15s beats Δ=60s, the conditioning
  isn't binding and it's just "buy favorites."

### D2. Speed-ratio (realized vs theoretical σ_p) over/underreaction gate — RANK 2

- **Mechanism**: `R_W = realized var / ∫φ(Φ⁻¹(p))²/τ dt` (§1), E[R]=1 under any driftless diffusion.
  Fade legs: after a ≥k-cent move with R ≫ 1 (surprise-overreaction, in-play lit §4), buy the side
  that got cheap. Follow leg: R ≪ 1 for M seconds then first breakout tick → enter breakout
  direction (differs from claimed momentum: entry _requires_ prior QV deficit, i.e., the move being
  "owed").
- **Inputs**: mid path, τ. Nothing else.
- **Baseline sweep**: W ∈ {30, 60, 120s} × R-fade ∈ {1.5, 2, 3} × R-follow ∈ {0.3, 0.5, 0.7} ×
  τ bucket × move size k ∈ {5, 10, 15c}. Fade and follow tested as separate specs.
- **Failure mode**: R ≫ 1 clusters in vol regimes and R ≪ 1 in dead regimes (lesson b/d — must hold
  across regime splits); circularity (theoretical leg uses market p) makes R a consistency check,
  not an oracle; overlap with claimed momentum family must be shown incremental (kill if the QV
  conditioning doesn't bind, lesson c).

### D3. Late-hover convergence anomaly — RANK 3

- **Mechanism**: fair markets are almost never near 50 late (5.3% in [40,60] at τ=60s, §2).
  Persistent late hover with `R ≪ 1` = deferred resolution jump: position for the break. Entry on
  first tick that exits the hover band (direction of exit), because the deferred move under-travels.
  Distinguish from genuine pin via R: a true pin at 50 is _loud_ (σ_p ≈ 5c/s), not quiet.
- **Inputs**: mid band-occupancy timer, R, τ.
- **Baseline sweep**: band ∈ {[45,55], [40,60]} × min hover dwell ∈ {30, 60s} × τ entry window
  ∈ {90–30s, 60–20s} × exit-tick confirmation ∈ {1, 2 ticks}.
- **Failure mode**: genuine pins (spot exactly at reference) make the break a coin flip and the
  spread eats both sides; late spreads widen exactly here (§3 trap 3); hovering episodes may be
  concentrated in specific hours (lesson b).

### D4. Tick-cap extremes: buy 99c when decayed-fair > 99.5 — RANK 4

- **Mechanism**: quotable cap at 99 vs fair ≥ 99.5 near expiry (§5). Sign-known, bounded residual
  (~0.5–1c) with very high win rate required; FLB literature (§4) says the extreme favorite is the
  _underpriced_ side, aligning the behavioral and mechanical residuals.
- **Inputs**: p path (for decayed-fair), τ, best ask = 99 (or 98), quiet-book conditioning from D1.
- **Baseline sweep**: τ ≤ {45, 30, 15s} × decayed-fair floor ∈ {99.3, 99.5, 99.7} × require silence
  Δ ∈ {10, 20s}. Hold to resolution.
- **Failure mode**: one terminal Chainlink reversal costs ~99c vs +1c wins ⇒ needs empirical
  terminal-reversal rate ≪ 1%; fees/slippage may exceed the entire residual; volume at 99 may be
  unfillable size (measure fill realism first).

### D5. 50c barrier: cross-continuation vs bounce with round-tick depth conditioning — RANK 5

- **Mechanism**: order clustering at round ticks creates barriers (§5); 50c adds favorite-flip
  salience while the null says p moves _fastest_ there. Test whether a depth-cleared 50c cross
  carries residual drift (barrier-breach flow) vs bounce (barrier holds).
- **Inputs**: resting depth at 48–52 (and 45/55), cross events, τ, R.
- **Baseline sweep**: {continuation, bounce} × depth-consumed confirmation ∈ {50%, 100% of level} ×
  τ ∈ {mid-window, late} × hold {to expiry, +5c TP}.
- **Failure mode**: collapses into claimed momentum unless the round-tick depth conditioning binds
  (lesson c: compare against same rule at non-round levels — must be materially better at 50);
  arcsine clustering of crossings late (§2) means late crossings are noise-dense.

### D6. Remaining-QV budget gate (universal filter, tested as a binding driver) — RANK 6

- **Mechanism**: expected remaining QV = p(1−p) (§0). Episodes whose _cumulative_ realized QV
  already far exceeds the initial 0.25 budget are jump-driven/toxic (oracle-vs-book skirmishes);
  gate any other strategy's late entries on `QV_used / budget_consumed_by_clock`.
- **Inputs**: mid path QV accumulator, τ.
- **Baseline sweep**: apply as an overlay to D1–D3 baselines: gate ∈ {off, 1.5×, 2×, 3× budget-pace}.
- **Failure mode**: as a filter it must bind and not peak at "off" (lesson c); if it only helps in
  one regime window it is an artifact (lesson b/d).

### D7. In-episode self-calibration: early-window R as a late-trade classifier — RANK 7

- **Mechanism**: measure each episode's own speed ratio over minutes 0–8; classify
  {sticky, fair, jumpy}; permit D1/D3 entries only in sticky episodes and D2-fade only in jumpy
  ones. Durability play: parameters adapt per-episode from the stream itself, no cross-regime
  constants (directly targets lesson d).
- **Inputs**: own mid path split into calibration half / trading half.
- **Baseline sweep**: first test _persistence_ (rank-corr of R across the two halves of the same
  episode); only if ρ > ~0.3 proceed to gating sweeps {tercile cuts} × {which driver gated}.
- **Failure mode**: within-episode R persistence may be near zero (then kill immediately — cheap
  falsification); double-dipping the same path for signal and gate risks overfit — keep the halves
  disjoint.

---

## Sources

- Taleb, _Election Predictions as Martingales_ — [arXiv:1703.06351](https://arxiv.org/abs/1703.06351)
- _Election predictions are arbitrage-free: response to Taleb_ — [arXiv:1907.01576](https://arxiv.org/pdf/1907.01576)
- Croxson & Reade, _Information and Efficiency: Goal Arrival in Soccer Betting_ — [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/ecoj.12033)
- _Informational efficiency and behaviour within in-play prediction markets_ — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996)
- _The Role of Surprise_ (in-play over/underreaction) — [ResearchGate](https://www.researchgate.net/publication/256013000_The_Role_of_Surprise_Understanding_Overreaction_and_Underreaction_to_Unanticipated_Events_using_In-Play_Soccer_Betting_Market)
- _Favorite-Longshot Bias: Overview of Main Explanations_ — [ResearchGate](https://www.researchgate.net/publication/228884358_The_Favorite-Longshot_Bias_An_Overview_of_the_Main_Explanations)
- FLB in college basketball/football — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1062976916000041)
- Crypto LOB price clustering — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S221463502400008X)
- Limit order clustering and price barriers — [EFMA paper](https://efmaefm.org/0efmameetings/efma%20annual%20meetings/2007-Austria/papers/0286.pdf)
- _Above Up, Below Down_ (LOB clustering → price moves) — [ResearchGate](https://www.researchgate.net/publication/378809671_Above_Up_Below_Down_The_Impact_of_Limit_Order_Clustering_on_Stock_Price_Movements)
- 0DTE mechanics/pin risk background — [OAS](https://www.optionsanalysissuite.com/documentation/0dte-options)
- Digital option greeks — [BSIC](https://bsic.it/greexotics-a-first-step-in-the-land-of-exotic-derivatives-greeks-part-1/)
- Polymarket BTC 15m market — [polymarket.com](https://polymarket.com/event/btc-updown-15m-1776361500)
- Kalshi 15m BTC mechanics (structural comparison) — [predictionmarketspicks.com](https://predictionmarketspicks.com/articles/kalshi-bitcoin-15-minute-markets), [settlement](https://predictionmarketspicks.com/articles/how-kalshi-settles-bitcoin)
- Law-of-one-price violations in prediction markets — [arXiv:2601.01706](https://arxiv.org/html/2601.01706v1)
