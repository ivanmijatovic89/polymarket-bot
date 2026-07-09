# 07 — Behavioral Biases in Fast, Repeated, Binary Gambling-Adjacent Markets

Research lane: behavioral finance of in-play betting, binary options retail flow, and
prediction markets, mapped to testable footprints in Polymarket BTC 15-minute up/down
order-book data. Constraint respected throughout: every footprint uses ONLY the
market's own recorded stream (book + price_change events, depth, trade prints, own
fills, episode clock). Footprints that require remembering prior episodes' outcomes
are flagged **[cross-episode memory]**.

Claimed idea-space excluded from the ranked drivers: (1) book-depth imbalance taker
hold, (2) maker bid on the favorite, (3) momentum/trend-follow taker hold,
(4) two-sided MM / complement quoting.

---

## 1. Favorite-longshot bias (FLB)

**Evidence and magnitude.**

- Canonical magnitude by odds bucket (horse racing, ~century of data): betting
  odds-on favorites loses ~5–7%; betting longshots at 40/1+ loses ~40% of stake
  ([Snowberg & Wolfers, NBER w15923](https://www.nber.org/system/files/working_papers/w15923/w15923.pdf);
  [Wikipedia summary](https://en.wikipedia.org/wiki/Favourite-longshot_bias)). Snowberg &
  Wolfers' JPE 2010 test favors **probability misperception** (prospect-theory
  weighting) over risk-love — i.e., it is a bias in beliefs, not preferences
  ([JPE](https://www.journals.uchicago.edu/doi/abs/10.1086/655844)).
- Prediction markets inherit it: [Wolfers & Zitzewitz, "Interpreting Prediction
  Market Prices as Probabilities"](https://users.nber.org/~jwolfers/papers/InterpretingPredictionMarketPrices.pdf)
  show prices ≈ mean beliefs, but transaction costs, liquidity, and belief dispersion
  push longshot prices above objective probability.
- **Very short horizon / in-play evidence is where it matters for us, and it flips
  partly in our favor:**
  - [Green, Lee & Rothschild, "The Favorite-Longshot Midas"](https://jacobslevycenter.wharton.upenn.edu/wp-content/uploads/2018/08/The-Favorite-Longshot-Midas.pdf):
    in late/in-play horse betting, bets on extreme favorites at very short prices are
    systematically _profitable_ — the FLB persists into the final moments, and
    sophisticated ("Midas") bettors harvest it by buying favorites near the end.
  - [Sørensen, "The Timing of Bets and the Favorite-Longshot Bias"](https://web.econ.ku.dk/sorensen/Papers/tobaflb.pdf):
    late bets are smarter; FLB is strongest in early, uninformed flow.
  - Domain-specific prediction-market calibration ([arXiv 2602.19520](https://arxiv.org/abs/2602.19520)):
    at horizons **under one week, sports/short-horizon prices are well calibrated
    (logit slope 0.90–1.10)**; the strong FLB (slope ~1.74, prices compressed toward
    50%) appears only at month+ horizons. A 15-minute horizon is the extreme
    short end — expect _mild_ FLB at best, concentrated at extreme prices.
  - Polymarket-specific: [Reichenbach & Walther](https://www.researchgate.net/publication/398660802_Exploring_Decentralized_Prediction_Markets_Accuracy_Skill_and_Bias_on_Polymarket)
    find no _general_ market-level longshot bias but an overtrading of the "Yes"/default
    side and an "underdog bias" making longshot prices rich; retail users
    disproportionately trade at extreme prices where FLB is most pronounced.
  - Microstructure caution: [The Anatomy of a Decentralized Prediction Market
    (arXiv 2604.24366)](https://arxiv.org/html/2604.24366v1) measures quoted
    half-spreads of **1,300–1,800 bps for contracts under 0.10 vs ~400 bps in the
    0.4–0.6 range** on Polymarket. Much of the apparent longshot overpricing is a
    liquidity/spread artifact — exactly Lesson (a): cheap legs are cheap for a reason,
    and the cost of trading them is an order of magnitude higher.

**Footprint in our stream (single episode).** Calibration curve: bucket mid-price by
(price × seconds-remaining) cells; per cell, empirical win rate of the leading side vs
mid. FLB predicts win-rate(cell) > mid for high buckets (0.80–0.97) and < mid for the
mirror-image cheap buckets, _after_ subtracting measured taker fee + half-spread per
bucket. No external data needed — outcome is in-stream (resolution), price and spread
are in-stream.

**Counter-trade.** Buy the expensive favorite side late (never the cheap side). This
is NOT the claimed "maker bid on favorite" (passive, flow-capture) nor
"momentum hold" (path-conditioned): it is a _level-and-clock_-conditioned taker
convergence trade. See Driver 1.

---

## 2. Late-stage in-play biases: overreaction, underreaction, cut-off effects

**Evidence.**

- [Croxson & Reade, "Information and Efficiency: Goal Arrival in Soccer Betting" (EJ 2014)](https://onlinelibrary.wiley.com/doi/abs/10.1111/ecoj.12033):
  in-play prices update swiftly and near-fully to major news — the null is efficiency,
  so any strategy must target the residuals, not the level move.
- [Choi & Hui, "The Role of Surprise" (JEBO 2014)](https://www.sciencedirect.com/science/article/abs/pii/S0167268114000481):
  in-play bettors **underreact to moderately surprising events but overreact to very
  surprising ones**; effects decay within minutes. Surprise magnitude, not direction,
  determines the sign of the mispricing.
- [Angelini, De Angelis & Singleton, "Informational Efficiency and Behaviour Within
  In-Play Prediction Markets" (IJF 2022)](https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996):
  second-by-second Betfair data — after equalizing goals, _volume_ herds strongly
  toward the team that just scored, but _prices_ carry no exploitable function of who
  scored last. Behavioral flow exists; it is absorbed by sharps. Also: reverse-FLB
  style mispricing grows when the surprise is large and late (longshot scoring late is
  underpriced to win).
- [Winkelmann et al. 2024](https://journals.sagepub.com/doi/full/10.1177/15270025231204997)
  and [bettors' in-game reaction study (arXiv 2202.10085)](https://arxiv.org/pdf/2202.10085):
  in-play stakes concentrate in the final ~30 minutes and on high-uncertainty states —
  late-episode flow is the most retail/emotional flow.
- Cut-off effect: bettors avoid backing heavy odds-on favorites because payout per
  stake feels trivial ("won't tie up 95 to win 5"), leaving favorites cheap near
  certainty — the mechanism behind the Midas result above and the classic
  within-market complement of FLB.

**Footprint in our stream.**
(i) Define in-episode "surprise" as a price jump: Δmid over a k-second window scaled
by trailing episode volatility of mid (all in-stream). Measure drift from jump end to
resolution, split by jump-size decile × time-remaining. Overreaction predicts
negative continuation for top-decile jumps (esp. late), underreaction predicts
positive continuation for mid-decile jumps.
(ii) Cut-off effect: in the last 60–180s, compare ask on the 0.88–0.97 favorite to the
empirical win rate of that state; check whether the book _thins on the bid side of the
favorite_ (nobody wants to back it) while cheap-side taker buys tick up.

**Counter-trade.** Fade top-decile late jumps (buy the dumped side small); buy the
cut-off-neglected favorite late. Caveat per Lesson (b): a jump-fade calibrated on one
volatility regime is exactly the "isolated entry-timing spike" trap — demand the
effect survives across months and vol regimes.

---

## 3. Disposition effect, loss-chasing, and streak beliefs in rapid repeated bets

**Evidence.**

- Loss-chasing is multi-dimensional (stake size, stop decision, speed of play):
  [systematic scoping review](https://www.researchgate.net/publication/371451661_Behavioural_expressions_of_loss-chasing_in_gambling_A_systematic_scoping_review).
  Evidence is mixed on stakes: online casino players raised stakes after losses
  (Auer & Griffiths 2022), while [Chen et al. 2022 (PLOS One)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0273359)
  found gamblers bet _faster_ but smaller after losses; problem sports bettors placed
  _safer_ bets after losses ([Xuan & Shaffer 2009 via review](https://pubmed.ncbi.nlm.nih.gov/35981088/)).
  Robust common core: **losses accelerate the next bet** (shorter latency), wins slow it.
- Streak beliefs: [Xu & Harvey, "Carry on winning" (Cognition 2014)](https://www.sciencedirect.com/science/article/pii/S0010027714000031),
  565,915 online sports bets: winners moved to _safer_ odds (creating hot-hand-like
  streaks), losers to _riskier_ odds. [Croson & Sundali (JRU 2005)](https://link.springer.com/article/10.1007/s11166-005-1153-2)
  and [Sundali & Croson (JDM 2006)](https://www.sas.upenn.edu/~baron/journal/06001/jdm06001.htm),
  casino roulette: after short streaks people bet _against_ the streak (gambler's
  fallacy); after long streaks (5+) they switch to betting _with_ it (hot-hand).
- Base rates on our venue: **84.1% of Polymarket traders are net losers**
  ([Cointribune summary of Sergeenkov study](https://www.cointribune.com/en/polymarket-kalshi-a-study-reveals-the-extent-of-losses-on-prediction-markets/));
  ordinary Kalshi users lost >$0.5B cumulatively
  ([Roosevelt Institute](https://rooseveltinstitute.org/blog/since-kalshis-launch-ordinary-users-have-lost-half-a-billion-dollars/));
  fewer than 0.1% of accounts captured ~67% of profits
  ([CNBC](https://www.cnbc.com/2026/05/05/gen-z-millennials-prediction-markets.html)).
  ESMA banned retail binary options precisely for "structural expected negative
  return" and gambling-like rapid-fire behavior
  ([ESMA 2018](https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors)).
  Retail flow in this product class is, on average, negative-information flow.

**Footprint in our stream.** BTC 15m episodes are a metronome of identical,
back-to-back binaries — the cleanest natural lab for these effects anywhere:

- **[cross-episode memory]** After k consecutive same-outcome resolutions (e.g., 3 UPs),
  measure the _next_ episode's early state: first-2-minute mean mid deviation from
  0.50, signed by streak direction; early taker-flow imbalance by side. Gambler's
  fallacy predicts the anti-streak side is bid rich early; hot-hand (after long
  streaks) predicts the with-streak side is rich. Then compare to realized outcome
  frequency conditional on streak (BTC 15m outcomes ≈ iid coin ⇒ any tilt is pure
  mispricing).
- Within episode: loss-chasing predicts bursts of small, fast, same-side taker prints
  after an adverse swing (the losing crowd re-upping) — measurable as small-print
  arrival intensity conditioned on prior adverse Δmid.

**Counter-trade.** Buy the side the streak-reactive crowd discounts (Driver 5); fade
bursts of small aggressive prints (Driver 2).

---

## 4. Round-number anchoring in probability space (50c / 60c / 90c)

**Evidence.** Limit orders cluster at round numbers, creating excess depth that acts
as support/resistance; trading stalls at prominent prices and jumps between them
([Wiley, comprehensive limit-order data](https://onlinelibrary.wiley.com/doi/full/10.1111/j.1540-6288.2008.00208.x);
[Euronext price-barrier study](https://www.researchgate.net/publication/287209361_Limit_Order_Clustering_and_Price_Barriers_on_Stock_Markets_Empirical_Evidence_from_Euronext);
[FX order-book clustering, arXiv 1307.5440](https://arxiv.org/pdf/1307.5440)). A
documented second-order effect: sophisticated traders queue **one tick ahead** of
round levels for priority. In probability space the salient levels are 50c (toss-up
anchor), 60/70/80/90 (decade lines), and ~95c+ ("basically done"). No paper measures
this on Polymarket directly — that is our opportunity, and it must be established in
our data before anything is built on it.

**Footprint in our stream (single episode).** (i) Static: histogram of resting depth
by tick — excess mass at 10c-multiples vs neighboring ticks (and at x9/x1 ticks from
front-runners). (ii) Dynamic: event study on "first touch" of a round level by mid —
P(clean break) vs P(bounce), forward Δmid to resolution, book-consumption rate while
the level holds. (iii) 50c anchor: dwell time at 0.49–0.51 early in the episode vs
later, and whether flow-into-the-anchor is absorbed without price movement.

**Counter-trade.** If bounces dominate: fade first touch of a decade line (sell into
the wall). If breaks carry: enter on confirmed break with the wall's consumed depth
as the trigger (distinct from generic momentum: the trigger is the _level identity
and its depth anomaly_, not trailing returns). Caveat: on Polymarket, "walls" may be
MM quoting grids, not retail anchors — the depth-anomaly test (round tick vs adjacent
ticks, maker-count at the level from fills) must bind, per Lesson (c).

---

## 5. Herding after large visible trades

**Evidence.** Herding among less-informed traders is pervasive in prediction-style
markets ([UK spread-trading study, JPM](https://www.ubplj.org/index.php/jpm/article/view/2037));
order-flow sign autocorrelation partly reflects imitation of visible trades
([Tóth et al., "Why is order flow so persistent?", arXiv 1108.1632](https://arxiv.org/pdf/1108.1632)).
Agent-based work on prediction markets shows a whale print shifts price beyond its
information content, with distortion size/duration increasing in follower herding
([arXiv 2601.20452](https://arxiv.org/html/2601.20452v1)). Angelini et al. (above)
show exactly this on Betfair: volume herds after salient events, price impact does
not persist. Polymarket's tape is fully public (every fill visible on-chain/UI), and
median maker concentration is low (~32 effective makers,
[arXiv 2604.24366](https://arxiv.org/html/2604.24366v1)), so a single large print is
highly salient.

**Footprint in our stream (single episode).** Flag prints in the top size percentile
(from the fills/trades stream, rolling within-day percentile). Measure: (i) same-side
small-print arrival intensity in the following 10–60s vs baseline (herding), (ii)
Δmid from print to print+60s vs print+60s to resolution (impact vs reversal), (iii)
whether book depth refills on the hit side (makers fading the whale) — refill speed
distinguishes "informed whale" from "impact + herd".

**Counter-trade.** When a whale print is followed by herd flow but the book refills
and price does not extend, take the opposite side of the herd (buy the whale-hit
side). Failure mode: whales in a 15-minute BTC market may be latency arbs who _are_
informed relative to the (unobservable-to-us) spot move; the footprint test must
separate prints that resolve profitably from those that don't before any fade rule.

---

## 6. Time-of-day / session effects in retail crypto-gambling flow

**Evidence.** Crypto retail volume peaks roughly 17:00–20:00 local / evening hours
and thins on weekends, when flow becomes more retail-dominated
([intraday crypto HFT patterns, arXiv 2009.04200](https://arxiv.org/pdf/2009.04200));
online gambling activity concentrates in evenings and late nights and on weekend
afternoons/nights ([overview](https://time.now/blog/how-times-of-day-shape-online-gambling-patterns));
crypto trading and gambling engagement are strongly intercorrelated in surveys
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S074756322200259X),
[PubMed](https://pubmed.ncbi.nlm.nih.gov/39153016/)). Depth also thins near
resolution (~6% less mean depth per 10× reduction in time-to-close,
[arXiv 2604.24366](https://arxiv.org/html/2604.24366v1)), so late-episode + retail-hour
is the max-bias, min-liquidity corner.

**Footprint in our stream.** Episode timestamp is in-stream metadata. Per UTC-hour ×
weekday cell: median spread, depth, small-print share of taker volume, calibration
slope (price vs outcome), and per-driver conditional edge. Prediction: bias
footprints (Sections 1–5) are stronger, and calibration worse, in US-evening /
weekend cells with high small-print share.

**Counter-trade.** Not a standalone strategy — a **gating regressor**: run other
drivers only in cells where the small-print (retail) share is high. Per Lesson (c),
the gate must bind: if EV is flat across hour cells, drop it.

---

## 7. Bias → footprint matrix

| Bias                        | In-stream footprint (single episode unless flagged)                         | Counter-trade                             | Key cost caveat                                                  |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| FLB / cut-off               | win-rate vs mid by (price × time-left) cell                                 | buy expensive favorite late, taker        | longshot half-spreads 1,300–1,800 bps; never trade the cheap leg |
| Surprise over/underreaction | jump-size decile × time-left → post-jump drift                              | fade extreme late jumps                   | regime artifact risk (Lesson b)                                  |
| Loss-chasing / streaks      | **[cross-episode]** early mid tilt & flow imbalance vs prior-outcome streak | buy the anti-fallacy side                 | needs months of episodes for power                               |
| Round-number anchoring      | depth anomaly at decade ticks; touch → bounce/break stats                   | fade or break-confirm at decade lines     | walls may be MM grids, not anchors                               |
| Post-whale herding          | top-percentile print → follower intensity, refill, drift                    | fade herd when book refills, no extension | whale may be latency-informed                                    |
| Retail session flow         | hour×weekday cells: spread, small-print share, calibration                  | gate other drivers                        | must bind or be dropped (Lesson c)                               |
| Retail side toxicity        | small-print vs large-print aggressor imbalance divergence                   | side with large prints, against small     | overlaps depth-imbalance idea — keep trade-based, not book-based |

---

## 8. Ranked testable decision drivers

None of these are the claimed (1) depth-imbalance taker hold, (2) maker bid on
favorite, (3) momentum taker hold, (4) two-sided MM.

### Driver 1 — Late-episode favorite convergence premium ("cut-off harvest")

- **Mechanism.** Cut-off effect + FLB at the extreme: crowd won't pay 0.90 to win
  0.10 in the last minutes, so near-certain states trade below fair; Midas-style late
  favorite-buying is documented profitable in in-play racing (Green/Lee/Rothschild;
  Sørensen).
- **Inputs.** Mid/ask of leading side, seconds to resolution, spread. Nothing else.
- **Baseline sweep.** Taker-buy the leading side when ask ∈ [P_lo, P_hi] and
  time-left ∈ [T_lo, T_hi]; hold to resolution. Sweep P_lo ∈ {0.80, 0.85, 0.90},
  P_hi ∈ {0.93, 0.96, 0.98}, T ∈ {30–90s, 60–180s, 120–300s}. Gate: per-cell
  historical win rate must exceed ask + measured costs.
- **Likely failure.** Edge is a few cents minus spread — dies if late-episode spread
  widens (depth decays near close); tail risk of last-second BTC reversals is exactly
  what the crowd is pricing. If EV peaks at the _loosest_ price band, the filter
  isn't driving (Lesson c) — it's just "buy whatever is winning", i.e., disguised momentum.

### Driver 2 — Small-print/large-print flow divergence fade ("dumb-flow classifier")

- **Mechanism.** Retail flow in this product class is negative-information
  (84% of Polymarket traders net losers; ESMA binary-options findings). When small
  aggressive prints pile onto one side while large prints and/or refill behavior
  disagree, the small-print side is the wrong side.
- **Inputs.** Fills stream: taker side, size; rolling size percentiles; book refill after prints.
- **Baseline sweep.** Signed small-print imbalance I_s (size < p25) and large-print
  imbalance I_L (size > p90) over trailing W ∈ {60, 120, 300}s; enter against I_s
  when sign(I_s) ≠ sign(I_L) and |I_s| > q ∈ {p70, p80, p90}; hold to resolution.
- **Likely failure.** Size is a weak proxy for sophistication on Polymarket (sharps
  clip orders); divergence events may be rare → wide CIs; if EV is monotone in
  looser |I_s| thresholds, the classifier isn't binding.

### Driver 3 — Decade-line barrier dynamics (bounce/break at 60/70/80/90c)

- **Mechanism.** Round-number limit-order clustering creates real depth walls and
  psychological anchors; documented across equities/FX order books; unmeasured on
  Polymarket — first-mover measurement edge.
- **Inputs.** Full depth ladder (excess depth at decade tick vs adjacent ticks),
  mid path, first-touch events.
- **Baseline sweep.** On first touch of decade level D with wall ratio
  R = depth(D)/mean(depth(D±1,2)) > r ∈ {1.5, 2, 3}: variant A fade (enter toward
  the wall side), variant B break-confirm (enter through after >x% of wall consumed,
  x ∈ {50, 80, 100}). Hold to resolution; sweep D ∈ {0.6, 0.7, 0.8, 0.9} pooled and per-level.
- **Likely failure.** Walls are MM grid artifacts that reprice with BTC, giving no
  bounce edge; break-confirm variant collapses into momentum (must show the wall
  ratio R binds — shuffle-test against random non-round levels).

### Driver 4 — Extreme-jump overreaction fade, time-scaled

- **Mechanism.** In-play markets overreact to _very_ surprising events and underreact
  to moderate ones (Choi & Hui); in a 15-min binary, a top-decile jump late in the
  episode is the max-surprise case; herd volume follows salient moves without price
  information (Angelini et al.).
- **Inputs.** Δmid over k-second windows normalized by trailing in-episode vol;
  time-left; spread at fade entry.
- **Baseline sweep.** When normalized jump J > j-th percentile (j ∈ {90, 95, 99})
  with time-left ∈ {2–6, 6–10} min, taker-buy the dumped side; hold to resolution;
  cap at one fade per episode.
- **Likely failure.** THE Lesson-(b) trap: jump-fades are regime artifacts (profitable
  in chop, ruinous in trend regimes). Require sign-stability across every month of
  data and both BTC vol regimes before promotion; expect this to be the most likely
  driver to die honorably.

### Driver 5 — Cross-episode streak tilt (gambler's-fallacy open) **[cross-episode memory]**

- **Mechanism.** After runs of same-outcome episodes, gambler's fallacy prices the
  reversal side rich (short streaks) and hot-hand prices continuation rich (long
  streaks) — casino and online-betting evidence (Croson & Sundali; Xu & Harvey).
  BTC 15m outcomes are ≈ iid, so any streak-conditioned open tilt is free mispricing.
- **Inputs.** Prior k episode resolutions (own recorded stream, so allowed but flagged);
  current episode first-2-minute mid and flow imbalance.
- **Baseline sweep.** For streak length k ∈ {2, 3, 4, 5+}: measure early tilt
  τ = mean(mid) − 0.50 signed by streak side; if τ < −θ (anti-streak side rich),
  buy streak-continuation side early at θ ∈ {1c, 2c, 3c}; hold to resolution.
- **Likely failure.** Tilt may be microscopic (<1c) vs ~2–4c all-in costs; also BTC
  15m returns have slight serial dependence, so "iid ⇒ mispricing" needs the
  unconditional streak-continuation base rate measured first, not assumed.

### Driver 6 — Retail-session bias gate (meta-driver)

- **Mechanism.** Bias intensity tracks retail participation; retail crypto-gambling
  flow concentrates in evenings/weekends; calibration and spread quality vary by
  session.
- **Inputs.** Episode wall-clock hour/weekday; small-print share of volume;
  per-driver conditional PnL.
- **Baseline sweep.** For each surviving driver above, split PnL by (US-evening /
  EU-evening / Asia hours / weekend) × small-print-share tercile; keep the gate only
  if the top cell beats pooled EV out-of-sample.
- **Likely failure.** Pure Lesson-(c) exposure: hour-of-day splits on limited data
  are the canonical non-binding filter; treat as diagnostic, not a strategy, until it
  survives a month-by-month sign test.

### Driver 7 — Post-whale herd fade with refill confirmation

- **Mechanism.** Large visible prints trigger imitation flow beyond information
  content (agent-based + Betfair volume-herding evidence); when makers refill the hit
  side quickly and price fails to extend, the herd (not the whale) sets the last price.
- **Inputs.** Top-percentile print detection, follower small-print intensity, hit-side
  depth refill rate, post-print Δmid.
- **Baseline sweep.** After print > p95 size: if within 30–60s (a) same-side
  small-print intensity > 2× baseline, (b) hit-side depth refilled ≥ f ∈ {50, 75, 100}%,
  and (c) Δmid extension < e ticks, enter opposite the herd; hold to resolution.
- **Likely failure.** On a BTC-derivative market, the biggest prints are plausibly
  latency-informed (reacting to spot we cannot see) — the fade only works on the
  _unconfirmed_ subset, which may be too rare; three conjunctive conditions on thin
  event counts is an overfitting engine — pre-register the sweep grid.

---

_Sources of record are linked inline. Grey-literature practitioner sources
([Crypticorn guides](https://www.crypticorn.com/how-to-win-polymarket-bitcoin-up-down/),
[forum material](https://forum.betangel.com/viewtopic.php?t=24187)) were used only for
venue color, never as evidence of edge._
