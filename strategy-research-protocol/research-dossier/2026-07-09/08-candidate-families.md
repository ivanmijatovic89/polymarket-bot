# 08 — Candidate Families (Synthesis of Lanes 01–07)

Payoff document of the 2026-07-09 seven-lane research fan-out. Every proposed
driver from lanes 01–07 was cross-referenced, merged where lanes converged,
discarded where it collides with an existing family's `duplicateKeys`
([`src/strategies/research/INDEX.json`](../../../src/strategies/research/INDEX.json)),
violates [`strategy-research-protocol/SCOPE.md`](../../SCOPE.md), or repeats a
recorded lesson ([`strategy-research-protocol/LESSONS.md`](../../LESSONS.md)).
Survivors are ranked by **expected edge × durability × cheapness to test**
(cheapness per lane 05's capability map). Each brief is written so a
ProposeFamily worker ([`strategy-research-protocol/modules/ProposeFamily.md`](../../modules/ProposeFamily.md))
can consume it directly.

## Claimed idea-space (do not re-propose)

From INDEX.json, four families own these drivers and keys:

- **imbalance-hold** (validated): book-imbalance, orderbook-imbalance,
  depth-imbalance, bid-ask-depth-skew, book-pressure,
  liquidity-imbalance-follow, imbalance-taker-hold.
- **maker-favorite** (researching): favorite-maker-entry, directional-maker-bid,
  resting-favorite-bid, maker-discount-directional.
- **momentum-hold** (proposed, never run): momentum-following, trend-follow,
  move-continuation, breakout-take, spike-follow, directional-taker-hold,
  take-and-hold-to-redemption.
- **spread-capture** (researching): market-making, liquidity-provision,
  two-sided-quote, split-and-quote, split-sell-redeem, spread-harvest,
  both-sides-maker, complement-set-market-making.

Note: momentum-hold's keys `directional-taker-hold` / `take-and-hold-to-redemption`
describe an _execution style_ shared by most candidates below. Per the dedup
rule ("by driver, not by words"), a candidate is distinct if its primary
decision driver differs; every brief below states its differentiation
explicitly, and several carry a mandatory kill condition if the
differentiating filter fails to bind.

## Before proposing anything new — three cheap actions from lane 06

1. **Run momentum-hold 000.** Fully specced, never run; the only 13-point
   measured directional prior (spike continuation 40% follow vs 27.6% fade)
   is untested. Highest information per run in the program; also determines
   how much residual room candidates 3–4 below have.
2. **Re-measure the ~2.5¢ ask-heavy-favorite claim** (one run: win% of
   ask-heavy vs bid-heavy favorites, by month). It is load-bearing in the
   validated family's thesis and two experiments now lean against it.
3. **Month-decompose the maker-favorite confirm runs** (data already in
   backtest_runs). If May–Jun is a broadly favorable regime, several
   "failed" confirms (006 at −0.18, 011 at −0.07) are regime-censored, and
   the calendar axis matters for judging every candidate below.

## Merge map (how lane drivers became candidates)

| Lane drivers                                                                                                         | Disposition                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01-D1 liquidity-pull + 01-D6 asymmetric quote-retreat + 04-underexplored-2 maker-withdrawal                          | → candidate 2 `liquidity-pull` (01-D6 folded in: collinear per lane 01)                                                                                                   |
| 02-D1 quiet-decay + 02-D4 tick-cap + 07-D1 cut-off harvest + 01-D7 realized-vol convergence                          | → candidate 1 `quiet-decay`                                                                                                                                               |
| 02-D2 speed ratio + 02-D3 late-hover + 07-D4 extreme-jump fade (+ 02-D6 QV gate, 02-D7 self-calibration as overlays) | → candidate 3 `speed-ratio`                                                                                                                                               |
| 01-D4 tape-burst + 04-underexplored-1 aggressor-burst (07-D2 dumb-flow, 04-4 retail-timing as follow-ons)            | → candidate 4 `tape-burst`                                                                                                                                                |
| 07-D3 decade lines + 02-D5 50c barrier                                                                               | → candidate 5 `tick-barrier`                                                                                                                                              |
| 01-D2 quote-vs-trade mid-move decomposition                                                                          | → candidate 6 `quote-cause`                                                                                                                                               |
| 01-D3 sweep resiliency + 07-D7 whale herd fade                                                                       | → candidate 7 `sweep-refill`                                                                                                                                              |
| 07-D5 cross-episode streak tilt                                                                                      | → candidate 8 `streak-tilt`                                                                                                                                               |
| 01-D5 cross-book staleness / micro-price divergence                                                                  | DISCARDED — lane 03 live probe: the two books are one book mirrored (identical sizes, ask sum 1.01); divergence is structurally ~0. See "do not bother".                  |
| 01-D8 fleeting-size discount; 02-D6 QV gate; 07-D6 session gate; 03-6 rebate-pool monitor                            | Not families — feature transforms/overlays to A/B inside other baselines (each must bind, per `a-binding-filter-that-peaks-at-its-loosest-setting-is-not-the-driver`).    |
| 03-1 rebate spread capture, 03-2 split/merge completion                                                              | COLLIDE with spread-capture keys (`spread-harvest`, `split-and-quote`, `complement-set-market-making`). Also internally measured gross-negative in all 15 cells (sc-000). |
| 03-3 tie-rule micro-edge                                                                                             | Too small for a family (lane 03: "may be < fees/spread — then it only tilts maker skew"). Keep as a pricing asymmetry note: fair(UP) = P(up) + P(tie).                    |
| 03-4 endgame tick-regime, 03-5 redemption velocity                                                                   | Infrastructure/measurement items (see 00-README), not decision drivers.                                                                                                   |
| 04-5 window-lifecycle seams, 04-6 wash-flow filtering                                                                | No concrete mechanism yet / hygiene; measurement notes only.                                                                                                              |
| 06-contradiction-6 late supported-leg complement buy (31.58% win → complement ~68%)                                  | Belongs INSIDE imbalance-hold (same driver, reversed sign + time gate); its roadmap already flags it. Not a new family.                                                   |

---

## Ranked candidate briefs

### 1. `quiet-decay` — silence-conditioned time-decay favorite capture

- **coreIdea:** Taker-buy the BTC 15m favorite when its ask lags the
  parameter-free decayed-fair price implied by book silence and time-to-expiry,
  holding to fee-free redemption.
- **duplicateKeys:** `time-decay-capture`, `theta-harvest`, `stale-ask-favorite`,
  `silence-conditioned-decay`, `decayed-fair-taker`, `late-favorite-convergence`,
  `cutoff-harvest`, `tick-cap-extreme`, `quiet-book-repricing`.
- **Mechanism & fee survival.** For a driftless underlying, fair p follows
  `p_new = Φ(Φ⁻¹(p_old)·√(τ_old/τ_new))` _conditional on no underlying move_;
  the only in-stream proxy for "no move" is book/trade silence. Conditional
  drift is large: +4.0¢ (0.70, 180→120s), +7.1¢ (0.70, 120→60s), +8.3¢
  (0.80, 120→60s), +6.5¢ (0.90, 60→30s) — lane 02 §3, Monte Carlo verified.
  A silent book with an un-decayed ask is a stale quote, buyable for several
  cents of model edge. Behavioral tailwind: the cut-off effect / late-favorite
  FLB — in-play bettors won't pay 0.90 to win 0.10, and late extreme-favorite
  buying is documented profitable ("Favorite-Longshot Midas",
  https://jacobslevycenter.wharton.upenn.edu/wp-content/uploads/2018/08/The-Favorite-Longshot-Midas.pdf;
  Sørensen, https://web.econ.ku.dk/sorensen/Papers/tobaflb.pdf). Fees: live
  crypto taker fee is `0.07·p(1−p)` per share — 0.63¢ at p=0.90, 0.33¢ at
  0.95, ~0.14¢ at 0.98 (lane 03 §1.1), so the fee is _smallest exactly where
  this family trades_; single-fee hold-to-redemption is the only validated
  cost structure (measured ~$0.11–0.12/mkt at size 20, lane 06). A 2–4¢
  conditional decay edge clears a sub-1¢ fee plus a 1–3¢ spread.
- **Supporting evidence.** Lane 02 D1 (its rank 1) + D4; lane 07 D1 (its
  rank 1); lane 01 D7 (realized-vol variant, roadmap); lane 06 gap 3 (minutes
  7–15 have never hosted a deliberate entry in any family — this is the first
  family that lives there) and the internal record that hold-to-redemption is
  the only exit ever to survive a confirm. Short-horizon calibration is good
  (logit slope 0.90–1.10 under one week, arXiv:2602.19520), so expect a small
  residual concentrated at extremes — consistent with a few-cent edge, not a
  free lunch. Kalshi's identical product shows the same last-minute favorite
  pileup (https://predictionmarketspicks.com/articles/kalshi-bitcoin-15-minute-markets).
- **Inputs / plumbing:** CHEAP (zero plumbing). Mid/ask path, event timestamps
  (silence detector), τ from slug epoch — all pure functions of the tick
  stream (lane 05 §6). L7 caveat: the strategy only wakes on book-change
  ticks, so "silence" is evaluated on the first tick after the window — the
  spread-capture idiom handles this.
- **000-baseline sweep sketch.** Entry: FOK taker buy favorite when
  `ask < decayed_fair − edge` after Δ seconds of book/trade silence; hold to
  redemption; one entry per episode. Sweep: silence Δ ∈ {15, 30, 60}s ×
  min net edge ∈ {1, 2, 3}¢ × price zone ∈ {0.55–0.75, 0.75–0.90, 0.90–0.98} ×
  τ window ∈ {300–120s, 120–45s, 45–15s}. Extreme corner (ask=99,
  decayed-fair > 99.5, τ ≤ 45s) is a designated cell, not a separate family.
  Mandatory checks: EV must NOT peak at the loosest silence Δ (else the
  conditioning isn't binding and it's just "buy favorites"), and
  participation must drop as Δ and edge tighten.
- **Likely failure & lesson.** Adverse selection at the moment of fill: the
  ask that is still un-decayed is precisely the one about to be repriced
  against us by spot-watching makers — losses concentrate in the fills we
  get. Also silence clusters in dead/low-activity regimes → calendar-shape
  read is mandatory (`parameter-isolation-warns-time-instability-kills`);
  and the binding checks above (`a-binding-filter-that-peaks-at-its-loosest-setting-is-not-the-driver`).

### 2. `liquidity-pull` — cancel-led one-sided depth-evaporation follow

- **coreIdea:** Follow the direction revealed when makers cancel-pull one
  side's resting depth ahead of repricing, entering with one FOK taker buy on
  the not-yet-repriced side and holding to redemption.
- **duplicateKeys:** `maker-withdrawal`, `cancel-flow-follow`,
  `depth-evaporation`, `quote-pull-signal`, `one-sided-cancel`,
  `liquidity-retreat`, `asymmetric-quote-retreat`, `spread-retreat-direction`,
  `cancellation-led-repricing`.
- **Mechanism & fee survival.** Spot-watching MMs cancel doomed-side quotes
  _before_ repricing or being swept — the earliest in-book footprint of
  off-venue information, firing before any print and before the mid moves
  (Hasbrouck & Saar fleeting orders,
  https://pages.stern.nyu.edu/~jhasbrou/Research/Working%20Papers/HS10-11-10.pdf;
  queue-reactive cancellation intensity, arXiv:1312.0563). Entry precedes the
  mid adjustment, so the captured repricing (multi-cent when real) clears the
  ~1–1.75¢ mid-range taker fee. Inherently transient — the structural
  opposite of the persistence trap. Lane 04 confirms nobody public trades
  quote-pulling as a signal (it is only ever discussed from the MM's side).
- **Supporting evidence.** Lane 01 D1 (its top pick, "single best
  under-exploited event type in scope") + D6 folded in; lane 04
  underexplored-2. Two-lane independent convergence.
- **DEDUP CAUTION (load-bearing).** The validated champion
  (imbalance-hold/002-flow-trigger) already trades _change in depth ratio
  over 30s at 10 levels_. This family is distinct only via **cause**: pulls
  are cancels netted against re-adds at adjacent prices (a move ≠ a pull),
  with consumption-driven drops excluded — an information axis the champion
  cannot see. Proposal must include an entry-overlap measurement vs the
  champion; if >~70% of entries coincide (lane 01's own threshold), this is
  the same driver and must not proceed as a family.
- **Inputs / plumbing:** CHEAP degraded / MODERATE clean. Per-side resting
  depth within ±k¢ of mid from book deltas is free; cleanly excluding
  consumption-driven drops needs trade prints — engine limit L1
  (`recentTrades` recorded but not exposed in snapshots; small-moderate
  change, lane 05 §5). Degraded baseline proxy: depth drop with no
  contemporaneous touch-price trade-through. Recommend landing L1 first.
- **000-baseline sweep sketch.** Trigger: pull fraction φ ∈ {30, 50, 70}% of
  one side's depth within window w ∈ {250ms, 1s, 3s}, depth zone k ∈
  {1, 3, 5}¢, cancel-driven only (netted vs re-adds; consumption excluded);
  FOK taker entry in revealed direction; exit at {30s, 120s, redemption};
  time-of-episode buckets, excluding final 2 minutes in the base grid.
  Binding check: participation must fall materially as φ rises and EV should
  peak at interior φ, w.
- **Likely failure & lesson.** A single wallet's quote refresh in a thin book
  mislabeled as a pull → the signal fires constantly at loose settings and is
  noise (`verify-a-new-filter-actually-binds`); or all EV concentrates in the
  final 2 minutes where cancels are mechanical
  (`an-isolated-entry-timing-spike-is-a-regime-artifact-not-a-signal`).

### 3. `speed-ratio` — realized-vs-fair QV deviation trading

- **coreIdea:** Compare realized mid variance to the parameter-free fair
  binary variance `σ_p² = φ(Φ⁻¹(p))²/τ` and trade the deviations — fading
  overreacted jumps (R≫1) and entering the first breakout after sticky
  underreaction (R≪1) — with taker entries held to redemption.
- **duplicateKeys:** `qv-budget`, `realized-vs-theoretical-vol`,
  `overreaction-fade`, `underreaction-follow`, `surprise-conditioned-fade`,
  `late-hover-break`, `null-model-deviation`, `speed-ratio-gate`.
- **Mechanism & fee survival.** For any fair binary, σ cancels: the law of
  the price path depends only on (p, τ) — E[R]=1 under _any_ driftless
  diffusion (lane 02 §0–1; Taleb arXiv:1703.06351, identities not disputed by
  the rebuttal arXiv:1907.01576). A fair 50/50 with 60s left should move
  ~5.15¢/s std; hovering in [0.40, 0.60] at τ=60s has only 5.3% null
  probability. Deviations are behaviorally signed: in-play markets underreact
  to moderate surprise and overreact to extreme surprise (Choi & Hui,
  https://www.sciencedirect.com/science/article/abs/pii/S0167268114000481;
  Angelini et al., https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996).
  Expected capture is multi-cent (the deferred/overreacted move), against
  mid-range fees up to 1.75¢ + spread — thin but positive if the
  conditioning selects real deviations. No public bot or internal family
  uses the null (lane 04; lane 06: realized vol never conditioned on by any
  taker family).
- **Supporting evidence.** Lane 02 D2+D3 (its ranks 2–3, all numbers Monte
  Carlo verified); lane 07 D4 (same fade leg from the behavioral side);
  in-play surprise literature above.
- **Differentiation from momentum-hold:** the follow leg _requires a prior QV
  deficit_ (the move being "owed"); the pass/fail statistic is the contrast
  vs the same rule without the R-conditioning. If the conditioning doesn't
  bind, the leg is momentum and dies by dedup.
- **Inputs / plumbing:** CHEAP (zero plumbing). Mid path and τ only.
- **000-baseline sweep sketch.** Two specs, judged separately. Fade: after a
  ≥k¢ move with R_W > θ_hi, buy the dumped side; W ∈ {30, 60, 120}s ×
  θ_hi ∈ {1.5, 2, 3} × k ∈ {5, 10, 15}¢ × τ bucket. Follow: R_W < θ_lo for
  ≥M s then first breakout tick, enter breakout direction; θ_lo ∈
  {0.3, 0.5, 0.7} × M ∈ {30, 60}s; include the late-hover cell (band
  [0.40,0.60] dwell ≥ {30,60}s at τ ∈ {90–30s}). One entry per episode; hold
  to redemption.
- **Likely failure & lesson.** R≫1 clusters in volatile regimes and R≪1 in
  dead ones — the canonical regime artifact; demand month-by-month sign
  stability (`parameter-isolation-warns-time-instability-kills`,
  `an-isolated-entry-timing-spike-is-a-regime-artifact-not-a-signal`). Lane 07
  expects the fade leg "to die honorably" — cheap to find out.

### 4. `tape-burst` — same-side print-run follow with zero-mid-move control

- **coreIdea:** Enter on a burst of same-side taker prints that has not yet
  moved the mid — the footprint of latency arbitrageurs grinding a lagging
  book — with one FOK taker buy in the burst direction held to redemption.
- **duplicateKeys:** `aggressor-burst`, `run-length-follow`,
  `signed-volume-burst`, `taker-sweep-follow`, `print-run`, `tape-momentum`,
  `trade-flow-imbalance`.
- **Mechanism & fee survival.** Fast bots hit these books exactly when spot
  moves; a same-side run over seconds directly indexes how far behind the
  book is (order-splitting run mechanics: Lillo-Mike-Farmer, SSRN 708303,
  different generator here). Fires while prints are still eating one level —
  before the mid moves — so the entry captures the subsequent repricing.
  Mid-range fee ~1.75¢ + spread is the hurdle; the internal spike-continuation
  prior (follow 40% vs fade 27.6%, lane 06) says follow-through exists
  gross. Lane 04 (underexplored-1): every public bot subscribes to Binance
  directly; none reads what flow itself reveals — recovering the external
  signal from inside the book is both in-scope and uncrowded.
- **Supporting evidence.** Lane 01 D4; lane 04 underexplored-1 (two-lane
  convergence); lane 07 D2/D7 are same-input follow-on families once prints
  are exposed.
- **Differentiation from momentum-hold:** HARD FILTER — contemporaneous mid
  move ≤ 1¢. If EV vanishes under this filter, the driver is momentum and
  the family must be dropped (pre-registered kill condition).
- **Inputs / plumbing:** MODERATE — blocked on engine limit L1: trade prints
  are recorded (`OrderBookEngine.recentTrades`, cap 200) but not exposed in
  `OrderBookSnapshot`, and `last_trade_price` emits no tick (lane 05 §5 L1;
  "highest ROI single engine change on this list", small-moderate, needs
  commit + fleet sync). Pre-step once exposed: audit the stream's aggressor
  side labels — public-feed inference matched on-chain truth only ~59% in
  the literature (arXiv:2604.24366); label noise attenuates every run
  statistic roughly linearly.
- **000-baseline sweep sketch.** Run length N ∈ {3, 5, 8} same-side prints
  (or signed volume ≥ v) within Δt ∈ {1, 3, 10}s, also in volume time;
  hard filter mid move ≤ 1¢; FOK entry in burst direction; exit {60s, 5m,
  redemption}; exclude final 2 minutes and p > 0.95 (near-resolution bots,
  not information).
- **Likely failure & lesson.** The zero-mid-move filter fails to bind in a
  thin book (every burst moves mid instantly) leaving no tradable subset
  (`verify-a-new-filter-actually-binds`); or side-label noise makes long
  runs rare and spurious.

### 5. `tick-barrier` — round-tick depth-wall bounce/break dynamics

- **coreIdea:** Trade first touches of round-tick price levels (50/60/70/80/90¢)
  whose resting-depth anomaly forms a real wall, fading the touch or entering
  on a confirmed depth-consumed break, held to redemption.
- **duplicateKeys:** `round-number-anchor`, `decade-line-barrier`,
  `barrier-bounce`, `barrier-break-confirm`, `depth-wall`,
  `fifty-cent-anchor`, `price-clustering-levels`.
- **Mechanism & fee survival.** Limit orders cluster at round numbers and act
  as barriers (Euronext price-barrier evidence,
  https://www.researchgate.net/publication/287209361_Limit_Order_Clustering_and_Price_Barriers_on_Stock_Markets_Empirical_Evidence_from_Euronext;
  crypto LOB clustering, https://www.sciencedirect.com/science/article/abs/pii/S221463502400008X;
  FX book clustering, arXiv:1307.5440). In probability space the anchors are
  50¢ (favorite flips; σ_p is _maximized_ there — maximal null-vs-behavior
  tension, lane 02 §5) and decade lines. No paper measures this on
  Polymarket — first-mover measurement edge (lane 07 §4). Edge must clear the
  worst-case fee zone (1–1.75¢ at 50–70¢), so only strong walls are worth
  trading.
- **Supporting evidence.** Lane 07 D3; lane 02 D5; documented depth profile
  "closer to uniform than top-of-book" (arXiv:2604.24366) means walls are
  well-defined against neighboring ticks.
- **Inputs / plumbing:** CHEAP. Full depth ladder is in every snapshot
  (levels beyond 10 available via raw arrays, lane 05 §1.2); first-touch
  events from the mid path.
- **000-baseline sweep sketch.** Wall ratio R = depth(D)/mean(depth(D±1,2¢))
  > r ∈ {1.5, 2, 3} at decade level D ∈ {0.6, 0.7, 0.8, 0.9} (50¢ separate
  > cell); variant A fade the first touch toward the wall; variant B enter on
  > break after x ∈ {50, 80, 100}% of wall consumed; hold to redemption.
  > Mandatory shuffle test: the same rule at non-round levels must be
  > materially worse, else the level identity carries nothing.
- **Likely failure & lesson.** Walls are MM quoting-grid artifacts that
  reprice with BTC → no bounce edge, and the break variant collapses into
  momentum (`a-binding-filter-that-peaks-at-its-loosest-setting-is-not-the-driver`;
  dedup vs momentum-hold if the wall-ratio conditioning doesn't bind).

### 6. `quote-cause` — quote-driven vs trade-driven mid-move follow

- **coreIdea:** Classify every mid move by proximate cause and follow only
  maker-repricing (cancel/re-add, no print) moves — which embed spot
  information — while ignoring or fading taker-consumption moves, with taker
  entries held to redemption.
- **duplicateKeys:** `quote-driven-move`, `trade-driven-move`,
  `mid-move-cause-decomposition`, `maker-repricing-follow`,
  `no-print-repricing`.
- **Mechanism & fee survival.** MMs here watch spot; a mid move with no print
  is pure information injection, while trade-driven moves are part noise and
  partially revert post-impact (Glosten–Milgrom adverse-selection framing,
  lane 01 §9). The pass/fail statistic is the _decomposition contrast_
  (quote-class continuation EV minus trade-class), not either leg alone —
  which is also what separates it from momentum-hold (blind to cause).
  Multi-cent continuation on the quote-driven class vs ~1–1.75¢ fee.
- **Supporting evidence.** Lane 01 D2; spread/adverse-selection literature
  (earnings-announcement spread widening,
  https://www.sciencedirect.com/science/article/abs/pii/S1544612316302008).
- **Inputs / plumbing:** MODERATE — clean cause classification (consumed vs
  cancelled at the touch) needs trade prints (L1, same change as candidate 4).
- **000-baseline sweep sketch.** Move size m ∈ {1, 2, 3}¢ × cause class ∈
  {quote-only, trade-only, mixed} × hold {60s, 5m, redemption}; report
  continuation vs reversion per class; entry only on the quote-only class,
  with the contrast as the gate-1 statistic.
- **Likely failure & lesson.** In a 1¢-tick thin book most moves are
  mixed-cause within milliseconds → pure-class samples shrink; a contrast
  appearing in one calendar month only is a regime trend
  (`parameter-isolation-warns-time-instability-kills`).

### 7. `sweep-refill` — post-sweep non-replenishment confirmation entry

- **coreIdea:** After a large taker sweep, enter in the sweep direction only
  when makers refuse to replenish the consumed depth — using MM refill
  behavior as a free oracle on whether the sweep was informed — and hold to
  redemption.
- **duplicateKeys:** `resiliency-failure`, `no-refill-confirmation`,
  `post-sweep-replenishment`, `whale-fade-refill`, `herd-fade`,
  `sweep-confirmation-entry`.
- **Mechanism & fee survival.** LSE evidence: books often do _not_ reliably
  replenish after large trades; when they do, half-life ~20s — fits a 15m
  episode (Large 2007,
  https://www.sciencedirect.com/science/article/abs/pii/S1386418106000528).
  Refusal to re-quote means the best-informed resting agents agree with the
  sweep → follow at a worse price but on a much better-selected subset. The
  mirror read (refill + no extension → fade the herd) is lane 07 D7's whale
  fade — same inputs, opposite-sign arm, one family. Selection quality, not
  raw edge size, is the fee argument: the unconditional arm is the control.
- **Supporting evidence.** Lane 01 D3; lane 07 D7 (herding after visible
  prints: arXiv:2601.20452; Betfair volume-herding, Angelini et al.);
  ~32 effective makers median (arXiv:2604.24366) makes single prints salient.
- **Inputs / plumbing:** MODERATE — sweep detection and size-weighted refill
  need trade prints (L1) plus pre/post book snapshots (free).
- **000-baseline sweep sketch.** Sweep size q ∈ {p50, p75, p90} of episode
  print sizes; refill checkpoint τ ∈ {5, 15, 30}s; refill threshold ρ ∈
  {25, 50, 75}% of consumed depth (size-weighted); follow arm on no-refill,
  fade arm on refill+no-extension; hold {5m, redemption}. Control arm: enter
  on _every_ sweep — the family passes only if conditioning binds and beats
  the unconditional arm net of worse entry prices.
- **Likely failure & lesson.** Late-episode makers never refill regardless of
  information → reduces to "follow any late sweep"
  (`an-isolated-entry-timing-spike-is-a-regime-artifact-not-a-signal`);
  cosmetic auto-requotes at tiny size fake refills unless size-weighted.

### 8. `streak-tilt` — cross-episode gambler's-fallacy open fade

- **coreIdea:** After runs of same-outcome 15m episodes, buy the
  streak-continuation side early when the anti-streak side opens rich —
  harvesting gambler's-fallacy tilt against ≈iid BTC 15m outcomes — with one
  taker buy held to redemption.
- **duplicateKeys:** `gamblers-fallacy`, `cross-episode-streak`,
  `prior-outcome-conditioning`, `hot-hand-fade`, `streak-open-tilt`,
  `outcome-run-conditioning`.
- **Mechanism & fee survival.** Casino/online-betting evidence: after short
  streaks people bet against the streak; after 5+ they switch to hot-hand
  (Croson & Sundali, https://link.springer.com/article/10.1007/s11166-005-1153-2;
  Xu & Harvey 565,915-bet study,
  https://www.sciencedirect.com/science/article/pii/S0010027714000031).
  BTC 15m episodes are a metronome of identical back-to-back binaries — the
  cleanest natural lab for these effects anywhere (lane 07 §3). If outcomes
  are ≈iid, any streak-conditioned open tilt is pure mispricing. Fee hurdle
  is the problem: tilt must exceed ~2–4¢ all-in mid-range costs.
- **Supporting evidence.** Lane 07 D5; lane 06 gap 7 (cross-episode state:
  "every episode is treated i.i.d." — a genuinely new signal axis, never
  conditioned on by any family); 84.1% of Polymarket traders are net losers
  (https://www.cointribune.com/en/polymarket-kalshi-a-study-reveals-the-extent-of-losses-on-prediction-markets/).
- **Inputs / plumbing:** MODERATE — engine limit L5: no cross-episode memory
  in the replay (fresh strategy per market, unordered jobs). Sanctioned
  route: offline per-slug feature store (prior-episode outcomes/streaks
  keyed by slug) + loader plugin — deterministic and worker-friendly
  (lane 05 §5 L5, §6). Measure first, then trade: the unconditional
  streak-continuation base rate must be measured, not assumed iid.
- **000-baseline sweep sketch.** Pre-step (free, diagnostic): early tilt
  τ = mean(first-2-min mid) − 0.50 signed by streak side, per streak length
  k ∈ {2, 3, 4, 5+}, vs realized continuation frequency. Trade sweep only if
  |τ| ≥ 1¢ somewhere: buy continuation side early when anti-streak side is
  rich by θ ∈ {1, 2, 3}¢; hold to redemption.
- **Likely failure & lesson.** Tilt is microscopic (<1¢) vs costs — the
  filter never earns its fee; needs months of episodes for power; a tilt
  found in one regime window is an artifact
  (`parameter-isolation-warns-time-instability-kills`).

---

## Do not bother

Seductive ideas the combined evidence kills:

1. **Longshot-side FLB fades (buy the cheap side).** Quoted half-spreads are
   1,300–1,800 bps under 0.10 vs ~400 bps mid-range (arXiv:2604.24366, lane
   07); short-horizon prices are well calibrated (slope 0.90–1.10,
   arXiv:2602.19520); and `persistent-book-pressure-selects-longshots-not-informed-flow`
   already measured the cheap leg as fairly priced at best. The cheap leg is
   cheap for a reason.
2. **Ask-sum < $1 crossing arb.** The two books are one book mirrored (lane 03
   live probe: identical sizes, ask sum 1.01); sub-$1 sums are placement-race
   transients, two crypto taker fees eat gaps < ~3.5¢, and it is tutorialized
   to a mass audience (lane 04) — saturated speed race.
3. **Binance→Polymarket latency arb.** Forbidden by SCOPE.md (external feed)
   AND explicitly killed by the Dec-2025/Jan-2026 dynamic taker fee introduced
   for exactly this (lane 03 §1.1, lane 04 §5). Pre-fee data will show it
   working; that is a trap.
4. **Cross-book staleness / micro-price divergence taker (lane 01 D5).**
   Structurally emptied by the mirrored-book finding (lane 03 §2.3). At most a
   passive detector run to confirm divergence frequency ≈ 0; no family.
5. **VPIN toxicity.** Contested in its home domain (no incremental power once
   volume/vol controlled, SSRN 2305905), needs many volume buckets a 15m
   episode doesn't have, and ~59% side-label accuracy doubles the damage
   (lane 01 §2). Keep only the volume-clock reframing.
6. **Unconditional near-resolution 99¢ sniping.** Named public bot archetype
   with example wallets; excluded from liquidity rewards above 98¢; one
   terminal Chainlink reversal costs ~99¢ vs +1¢ wins (lanes 03, 04). The only
   defensible sliver (decayed-fair > 99.5 + silence) is a designated cell
   inside `quiet-decay`, not a family.
7. **Dump-and-hedge / short-vol DCA below 35¢ ("gabagool").** Multiple public
   writeups, 95–98% win-rate profile = short-vol tail bomb; internal record
   confirms high win rate anti-correlates with EV (lane 06:
   87.92% win → −1.18/mkt).
8. **Cross-timeframe 5m↔15m lag capture.** Out of scope (other timeframe,
   SCOPE.md) and a public bot archetype (lane 04) — doubly dead.
9. **TA-indicator momentum off spot (RSI/VWAP/MACD).** Out of scope (external
   feed) and in every 700-star README (lane 04) — in the price.
10. **Maker take-profit / stop-loss exit layers.** Every tested exit lost to
    hold-to-redemption across nine maker-favorite variants and spread-capture
    (lane 06;
    `one-shot-take-profit-can-add-churn-without-removing-tail-loss`).
11. **Directional standing-depth signals in new clothing** (book slope
    asymmetry, single-book micro-price, static imbalance).
    Claimed by imbalance-hold's keys and re-derived as traps in lane 01
    (§4–5): slope/micro-price-vs-mid ARE imbalance. Conditioning inputs only.
12. **Tie-rule micro-edge as a standalone family.** Real (`end ≥ start ⇒ UP`,
    lane 03 §3) but P(exact tie) is small; below fees as a taker trade. Keep
    as a maker-skew/pricing tilt inside other families.
13. **Rebate-farming / spread capture as new families.** Claimed
    (spread-capture keys); measured gross-negative in all 15 baseline cells —
    the loss is first-fill adverse selection, which rebates (~20% of taker
    fee) cannot flip (lanes 03, 06). Note: maker rebates are also not
    simulated by the engine at all.
