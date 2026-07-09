# Internal findings map — what we actually know (2026-07-09)

Synthesis of every empirical result in the four research families
([`src/strategies/research/INDEX.json`](../../../src/strategies/research/INDEX.json)),
[`strategy-research-protocol/LESSONS.md`](../../LESSONS.md), and the pre-protocol
comparables cited in family theses. All numbers are quoted from FAMILY.md /
FAMILY.json research logs; nothing here is modeled. Dataset: BTC 15m up/down
markets on Polymarket, telonex recordings, ~9000 markets spanning Mar–Jun 2026.

---

## 1. Experiment ledger

Net/gross figures are **EV per market in $**. "Screen" = 1000 latest markets
(gate 1); "confirm" = 3000 (gate 2); "full" = 9000 (gate 3). Fee model: ~156 bps
taker fee per fill; maker fills and $1 redemption are fee-free.

| Family         | Exp                    | Driver / mechanism                                                                                  | Best cell (params → numbers)                                                                                                                                                                                                                                        | Verdict                                                                                                                             |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| imbalance-hold | 000-baseline           | Instantaneous top-of-book depth-ratio differential; FOK taker buy supported leg, hold to redemption | imbLevels=1, minImb=0.1, startSec=60, maxEntry=0.8, size=20 → **+0.51 net @1000** (878 played, 1023 trades, 55.24% win, fees $110.3, gross +0.62) → **−0.22 net / −0.10 gross @3000** (51% win)                                                                     | success (gate-1 only); edge = one week (W24); level signal dead                                                                     |
| imbalance-hold | 001-persistence-filter | Same signal must hold K seconds continuously                                                        | persistSec 5/15/30/60 → −0.07/−0.09/−0.02/+0.00; binds hard (878→493→163→35 played); win% 49.7→21.7→10.4→11.4; avgLose −8.60→−1.05                                                                                                                                  | **fail** — persistence selects fairly-priced longshots, not informed flow                                                           |
| imbalance-hold | 002-flow-trigger       | **Change** in depth ratio over 30s at 10-level aperture; taker buy, hold to redemption              | imbLevels=10, flowWindow=30, minFlow=0.3 → **+0.49 @1000** (857 played, 52.98% win) → **+0.27 @3000** (4/5 weeks +) → **+0.03 net / +0.146 gross @9000** (8565 played, 10197 trades, 48.97% win, fees $1080.8). Monthly: Mar −0.23, Apr −0.18, May +0.21, Jun +0.42 | **VALIDATED** (champion). All 5 param neighbors negative at 1000: imbLevels 3/5 → −0.28/−0.36; window 10/60/120 → −0.12/−0.23/−0.03 |
| maker-favorite | 000-baseline           | Maker bid `mid−disc` on favorite, hold fills to resolution                                          | fav≥0.52, disc=0.01, size=40 → +0.39 @1000 (451 played, 460 trades, 56.54% win) → **−0.39 @3000** (52.36% win)                                                                                                                                                      | recycle                                                                                                                             |
| maker-favorite | 001-entry-window       | Add start/stop time gates                                                                           | startSec=0 best (=baseline +0.39); 180 → +0.29; 60/300 negative; stopSec 300/600/840 tie exactly (inert) → −0.39 @3000                                                                                                                                              | recycle — stop-only window is not a mechanism change                                                                                |
| maker-favorite | 002-underdog-mirror    | Same maker bid on underdog (sign control)                                                           | maxUnderdogMid=0.40, disc=0.04 → **−0.04 @1000, 14 trades, 28.57% win**; looser cutoff 0.48 → −1.59                                                                                                                                                                 | fail — maker discount is side-sensitive; underdog fills sparse or toxic                                                             |
| maker-favorite | 003-delayed-favorite   | Enter at 180s instead of first tick                                                                 | +0.29 @1000 (762 played, 67.72% win, 747 maker / 17 taker) → **−0.37 @3000** (65.54% win)                                                                                                                                                                           | recycle                                                                                                                             |
| maker-favorite | 004-delayed-threshold  | Delayed + stronger favorite                                                                         | fav≥0.55, disc=0.02 → +0.36–0.40 @1000 → **−0.24 @3000** (66.36% win)                                                                                                                                                                                               | recycle                                                                                                                             |
| maker-favorite | 005-take-profit        | Maker sell at entry+0.04 after fill                                                                 | **−1.18 @1000**, 1244 trades, 87.92% win                                                                                                                                                                                                                            | fail decisively — churn + tail losses                                                                                               |
| maker-favorite | 006-cancel-weakening   | Cancel resting bid if side weakens 0.03 pre-fill                                                    | +0.22 @1000 (627 played, 68.26% win) → **−0.18 @3000** — best confirm in family                                                                                                                                                                                     | recycle                                                                                                                             |
| maker-favorite | 007-confirm-stable     | Wait 30s, enter only if side stable                                                                 | −0.20 @1000, 389 trades, 70.69% win                                                                                                                                                                                                                                 | fail — negatively selected                                                                                                          |
| maker-favorite | 008-cancel-delta       | Sweep cancelDelta                                                                                   | 0.04 → +0.35 @1000 (656 trades); 0.02 → +0.25 (263); 0.01 → +0.18 (103) → 0.04 confirm **−0.25 @3000** (worse than 0.03's −0.18)                                                                                                                                    | recycle — loosest cell overfits latest 1000                                                                                         |
| maker-favorite | 009-cancel-threshold   | Stricter favThreshold on cancel lifecycle                                                           | 0.55/0.60/0.65 → +0.22/+0.17/+0.12; best = exact 006 params (confirm already known −0.18)                                                                                                                                                                           | no extension — duplicate evidence                                                                                                   |
| maker-favorite | 010-tight-spread       | Max favorite touch spread filter                                                                    | 0.04/0.06/0.08 **all tie byte-identical** +0.22, 627 trades — filter never binds                                                                                                                                                                                    | inert — favorite touch spreads are essentially always < 4¢ mid-window                                                               |
| maker-favorite | 011-book-imbalance     | Favorite bid-support depth gate (top-3 levels)                                                      | 0.45/0.50/0.55/0.60 → +0.18/+0.05/+0.03/+0.09 (binds: 410→229 trades) — non-monotonic, peak at loosest → confirm **−0.07 @3000** (1234 played)                                                                                                                      | recycle — gate is not the driver; ~2.5¢ ask-heavy-overpricing finding did NOT transfer                                              |
| maker-favorite | 012-cancel-take-profit | Take-profit sweep on cancel lifecycle                                                               | TP 0.02/0.04/0.06/0.08 → −1.15/−1.20/−1.08/−1.16 @1000 (85.65% win at best)                                                                                                                                                                                         | fail — closes fill-then-flatten                                                                                                     |
| maker-favorite | 013-momentum-confirm   | Bid only if favorite strengthened ≥ x over 60s                                                      | minMomentum=0.02 → **+0.02 @1000** (290 trades, all maker, 76.21% win); 0/0.01/0.04 → −0.16/0.00/−0.24 → confirm **−0.10 @3000** (74.78% win)                                                                                                                       | recycle — real signal-source change, still payoff-asymmetric                                                                        |
| maker-favorite | 014-volatility-guard   | Enter only if no flip and mid range small over 120s                                                 | maxRange 0.02 → 0 trades; 0.04/0.06 → −0.02 (1 trade each); 0.08 → −0.05 (7 trades)                                                                                                                                                                                 | fail — starves before it repairs                                                                                                    |
| maker-favorite | 015-stop-loss-exit     | FOK taker sell if held side weakens ≥ stop                                                          | stopLoss=0.04 → **+0.14 @1000** (662 played, 965 trades, 308 taker exits, $70.43 fees, 40.48% win); neighbors 0.02/0.06/0.08 → −0.32/−0.38/−0.17 → confirm **−0.31 @3000** ($195.71 fees, 909 taker exits)                                                          | recycle — most mechanism-aligned repair, still regime-bound                                                                         |
| spread-capture | 000-baseline           | Split full set, symmetric maker asks at mid+offset both legs                                        | Best of 15 cells: offset=0.05, quoteStop=420, reprice=0.01, size=5 → **−0.05 net / −0.048 gross @1000** (495 trades). ALL 15 cells net- AND gross-negative; fees $0.7–7.6 per 1000 mkts (fee-free thesis held)                                                      | fail — adverse-selection-bound, EV→$0 from below, every optimum at grid edge                                                        |
| spread-capture | 001-pair-completion    | Requote survivor aggressively after first fill                                                      | completionOffset 0/0.01/0.02/off → −0.13/−0.12/−0.10/−0.05 — monotone worse with aggression; win% 1.25/19/38/46%                                                                                                                                                    | fail refuted in DIRECTION — selling survivor realizes the adverse move                                                              |
| spread-capture | 002-inventory-stop     | Cancel survivor ask at first fill (reArmBand)                                                       | 0/0.05/0.15/0.5 → −0.05/−0.04/−0.06/−0.05 — flat ±0.01                                                                                                                                                                                                              | fail — survivor fills ≈ EV-neutral; ALL loss lives in the first fill                                                                |
| momentum-hold  | (none)                 | Taker-follow momentum, hold to redemption                                                           | proposed, fully specced, **never run**                                                                                                                                                                                                                              | —                                                                                                                                   |

**Pre-protocol comparables cited as measured evidence** (batch uids in family docs):

| Run                                                    | Result                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `obimb-sweep-14-ext2` (orderbook-imbalance taker)      | gross **+$335 / 6000 mkts = +$0.056/mkt**, net +$11 ≈ $0 → round-trip fee drag ≈ $0.054/mkt              |
| `obimb-v2-maker-6000` (same signal, maker take-profit) | saved $41 fees, **lost $93 gross** vs taker twin                                                         |
| spike-reaction taker                                   | fees ~$325 / 1000 mkts (**~$0.33/mkt round-trip drag**)                                                  |
| spike-reaction maker                                   | gross **−$676 / ~1000 mkts** (signal-triggered maker = pure adverse selection)                           |
| spike continuation study                               | 15m BTC mid-spikes **continue**: following won 40% vs fading 27.6%                                       |
| favorite/longshot calibration                          | tilt ~1–2¢ — below the 2–4¢ round-trip taker cost                                                        |
| convergence work                                       | ask-heavy favorite books **~2.5¢ overpriced** (informed selling); late-window books decisively one-sided |

---

## 2. Consolidated empirical picture of the market

### Book structure and tightness

- **Favorite touch spreads are essentially always < 4¢** in the mid-window
  (180s+): `maxFavSpread` at 0.04 removed **zero** of 627 markets (mf-010).
  Typical spreads 1–3¢ (spread-capture design note). Touch spread carries no
  discriminating information; any book-quality signal must key on depth.
- **Level vs depth aperture matters and inverts by signal type.** The depth-ratio
  _level_ lives at the touch (imbLevels 1–3 plateau +0.48/+0.51; 5/10 →
  +0.05/−0.07 at 1000, ih-000) but is noise at any aperture over more data. The
  depth-ratio _derivative_ only works at the **deep** book (10 levels → +0.49;
  1/3/5 all negative, ih-002): the touch flickers past any threshold within 30s
  in ~every market (minFlow non-binding at level 1: 874–882/1000 played across
  0.15–0.6).
- **Persistent one-sided books = collapsing longshot legs.** Requiring |imb|≥0.1
  for 15+ s routes entries into 5–14¢ legs whose win% ≈ entry price (fairly
  priced, EV ≈ 0 gross). Competitive legs reprice in seconds (ih-001).

### Maker fill rates and adverse selection

- A 1¢-below-mid maker bid on a mild favorite fills in **~45% of gated episodes**
  at entry-on-first-tick (451/1000, mf-000), rising to **~76%** when placed at
  180s (762/1000, mf-003) and ~69% with a 0.55 gate (685/1000, mf-004). Fills
  are ≥99% maker (accidental taker fills 0.4–2%).
- **Maker fills are structurally adversely selected**: a resting order is a
  momentum fader in a market where moves continue. Every maker variant that
  screened positive on the latest 1000 lost on the latest 3000 (nine
  screen-pass/confirm-fail cycles in maker-favorite; best confirm −0.07,
  worst −0.39). Symmetric quoting is gross-negative in all 15 cells with
  negligible fees (sc-000). Signal-triggered makers are the worst (pre-protocol
  −$676 gross; obimb maker −$93 gross).
- **Post-first-fill inventory policy is worth ≤ ±$0.01/mkt**: hold −0.05,
  sell-faster −0.10..−0.13, stop −0.04..−0.06 (sc-000/001/002). The entire
  spread-capture loss is the first fill's adverse selection.
- Caveat: the backtest maker model (`worst_queue`) fills a resting SELL only when
  bestBid rises through it — only the adversely-selected flow, none of the
  benign ask-lifting. Maker numbers are a conservative bound.

### Taker fee drag, measured

- Entry-only taker fee at size 20: **$110.3 / 1023 trades ≈ 10.8¢/trade ≈
  0.54¢/share** (~156 bps of ~0.35–0.70 entries), i.e. ~**$0.11/mkt** drag for
  single-fee hold-to-redemption vs the measured **~$0.30–0.33/mkt** round-trip
  drag of pre-protocol takers. The single-fee lever is real and validated: the
  champion's full-history gross +0.146 → net +0.03 ($1080.8 fees / 9000 mkts ≈
  $0.12/mkt).
- Taker _exits_ re-add the drag fast: mf-015's stop-loss paid $195.71 over 3000
  mkts (909 taker exits) and failed confirm.
- **Fees are never the whole story**: ih-000 was gross-negative at 3000; the
  fee lever cannot rescue a signal with no gross edge.

### Win rate vs entry price vs EV

- Win% tracking entry price = fairly-priced fills (longshots 10–22% win at
  5–14¢ entries, EV≈0; ih-001). Mild favorites: 52–56% win at ~0.52+ mids.
  Delayed favorites: 65–68% win, still net-negative held to resolution.
- **High win rate anti-correlates with EV across the whole record**: 87.92% win
  → −1.18 (mf-005); 76.21% win → +0.02 screen/−0.10 confirm (mf-013); the
  validated champion wins only **48.97%** and profits on payoff spread
  (avgWin 9.27 vs avgLose 9.07 at 3000). Payoff asymmetry, not hit rate, decides.
- **Hold-to-redemption beats every tested exit**: take-profit (−1.08..−1.20),
  pair-completion (monotone worse), stop-loss (confirm −0.31). Redemption is the
  only exit that has ever survived a confirm.

### Time-of-window effects

- Entry-time responses at fixed params are **oscillating noise**, not pockets:
  startSec 0/30/45/60/90/120/180/420 → −0.63/+0.52/−0.11/+0.51/+0.17/−0.13/
  −0.17/−0.65 (ih-000). An isolated timing spike is a regime artifact (lesson).
- **Late-window (≥420s) bid-support ANTI-predicts** under a 0.8 price cap:
  31.58% win taker-buying the supported leg (ih-000 p4) — the leg still priced
  ≤0.8 late is the one being faded. Late-window books are decisively one-sided
  (pre-protocol).
- For makers, quoting less is monotonically better at any time: quoteStopSec
  60→420 improves −0.34→−0.15; early-window quoting is as adversely selected as
  late (sc-000 pass 2).
- Maker favorite entry at 180s materially changes the fill set vs 0s
  (451→762 played, win% 56→68) but not the confirm sign.

### Regime shifts (Mar–Jun 2026)

- The validated champion's EV has a **monotonic calendar trend**: monthly
  Mar −0.23, Apr −0.18, May +0.21, Jun +0.42 (ih-002 @9000). Full-history +0.03
  is the average of a dead old regime and a +0.2–0.4 recent one.
- The same shape explains maker-favorite's nine screen/confirm failures: every
  variant is positive on the **latest 1000 (June)** and negative once the older
  2000 (≈May and earlier at time of runs) are added. Weekly reads agree: W24
  (mid-June) is the strong week in ih-000 (+0.33, only positive week) and the
  loss-carrying week for spread-capture; W23 near break-even for sc.
- Nobody has decomposed maker-favorite (or spread-capture) confirms by month;
  the "confirm failure" verdicts and the champion's "recent-regime edge" have
  never been reconciled against the same calendar axis.

### Dataset quirks

- **Dead tail**: the ~39 newest markets (after `btc-updown-15m-1781394300`,
  Jun 13–14) contain only pre-window snapshots — they replay as
  `no_in_window_activity`, diluting every latest-N denominator identically and
  making `--latest --limit 10` smokes look like broken code (LESSONS).
- Determinism is solid: duplicate cells reproduce byte-for-byte across passes
  (three exact replicas in sc-000; run 257 = 256 in ih-000).
- Participation ceiling: ~86–88% of latest-N markets produce a valid two-leg
  book after 60s (878/1000, 2861/3000, 8565/9000).
- No capacity wall found up to 40 shares: per-share EV flat ~2.55¢ 10→40
  (ih-000 p5); size is a pure scale knob everywhere it was swept.

---

## 3. Contradictions and untransferred findings

1. **The ~2.5¢ ask-heavy-favorite-overpricing finding has never been reproduced
   in-protocol and two experiments now lean against it.** mf-011 gated maker
   favorite bids on bid-support and got a non-monotonic response peaking at the
   _loosest_ gate (+0.18/+0.05/+0.03/+0.09); ih-000/001 measured the bid-support
   _level_ as directionally empty (gross −0.10 @3000) or adverse (longshot
   selector). Either the pre-protocol effect was regime-specific (its data
   predates Mar–Jun), price-level-specific, or an artifact. It is still cited
   as load-bearing motivation in the validated family's thesis. **Worth
   resolving first** — a direct re-measurement (win% of ask-heavy vs bid-heavy
   favorites, by month) is one cheap run.
2. **Signal aperture inversion, never cross-checked.** Level lives at the touch
   (ih-000), flow lives at 10 levels (ih-002) — but deep-book _level_ was only
   measured once at 1000 (−0.07) and touch _flow_ only at one window (30s).
   The champion's winning cell is a lone peak whose neighbors were never
   re-measured at 3000/9000; parameter isolation is formally undischarged.
3. **Gate asymmetry vs regime.** imbalance-hold-002 validated on a window whose
   old half is negative (Mar/Apr −0.2), while maker-favorite variants are
   recycled for exactly that shape (recent-positive, older-negative) — the only
   difference is that the champion's recent half is big enough to carry the
   3000-market average. If May–Jun is a broadly favorable regime, several
   "failed" maker-favorite confirms (006 at −0.18, 011 at −0.07) may be
   regime-censored rather than mechanism-dead. Nobody has run any of them on a
   May–Jun-only window or read their confirms monthly.
4. **Momentum continuation is the strongest measured prior (40% vs 27.6%) and
   the only one with zero in-protocol tests.** maker-favorite-013 is _not_ that
   test (a maker conditioned on momentum still fills on the pullback); the
   family built to test it (momentum-hold) has never run. Meanwhile all three
   maker post-mortems attribute their losses to continuation — the prior is
   being used to explain failures while remaining untested as an edge.
5. **Win-rate/EV inversion is consistent but its converse is unexplored**: every
   high-win-rate cell lost, and the only validated cell wins <50%. No family
   has deliberately sought low-win-rate/fat-payoff structures (e.g. cheap-leg
   taker buys on flow signals) — the one place longshots appeared (ih-001) they
   were an accident of a filter, measured fairly priced _at the persistence
   -selected subset only_.
6. **Late-window anti-prediction is a measured signal being wasted.** 31.58%
   win buying the supported leg late (ih-000, n≈875) implies ~68% for the
   complement at prices that are by construction ≤0.8/≥0.2. Both ih and mh
   roadmaps flag it (reverse-signal variant; late-window decisiveness) — never
   specced. Its consistency with "late books are one-sided" (the _one-sided
   side_ loses?) vs the informed-selling story has not been checked.

---

## 4. Gap analysis — unexplored regions of (signal × entry style × time × price)

Coverage so far, compressed: **signals** = depth-ratio level / persistence /
30s-flow, favorite-mid level, favorite momentum (maker-gated), mid-range
volatility, touch spread (inert); **entry styles** = FOK taker + redemption,
resting maker bid + redemption (+ cancel/TP/stop variants), symmetric maker
asks; **time** = entries at 0–180s (effectively all fills happen in the first
~3 min; single late probe at 420s); **price** = maxEntryPrice caps 0.6–0.9,
favThreshold 0.52–0.65, underdog ≤0.40–0.48 (14 trades). Ranked gaps:

1. **Momentum × taker × hold (momentum-hold 000).** Fully specced, never run.
   The only measured 13-pt directional prior, on the validated single-fee cost
   structure. Highest information per run in the program; also the direct test
   of contradiction #4. Its roadmap already contains the second-biggest combo
   gap: momentum confirmed by deep-book flow (#4) — no family has ever combined
   two signal types in one entry decision.
2. **Regime/calendar conditioning.** No strategy conditions on anything outside
   its episode; yet the largest measured effect in the whole dossier is the
   monthly trend (Mar −0.23 → Jun +0.42). Concrete cheap runs: (a) monthly
   decomposition of mf-006/011/015 confirm runs (data already exists in
   backtest_runs); (b) champion challenger gated on trailing-N-market
   realized EV. Also the protocol question: whether gates should read monthly
   shape, which lesson `parameter-isolation-warns-time-instability-kills`
   already half-codifies.
3. **Late-window (≥420s) space is essentially unmapped** — one cell ever, and it
   was strongly _anti_-predictive, i.e. informative. Untested: complement-buy of
   the late supported leg; late decisive-favorite taker buy (mh roadmap #7,
   distinct: high price + little time, no continuation assumption); maker asks
   only late into one-sided books. All entries in every family currently happen
   before minute 3 of a 15-minute episode; minutes 7–15 have never hosted a
   deliberate entry.
4. **Price-level bands.** No family has ever set a `minEntryPrice` floor;
   entry-price response is only known via caps (0.7–0.9 plateau, 0.6 collapse
   to 46% win — itself unexplained). Whether the champion's flow edge lives in
   coin-flips, mild favorites, or cheap legs is unknown and relocates capacity
   (ih roadmap #4, unqueued). Deliberate longshot taker buys on a _flow_ signal
   (vs ih-001's persistence-selected ones) are untested.
5. **Champion neighborhood + unqueued mechanism variants.** Parameter isolation
   at 3000/9000 (imbLevels 7–9, window 20–45s) is one batch; complement
   -agreement veto and distance-weighted depth are specced-in-prose and would
   sharpen what "deep-book flow" actually measures. Cheap, directly protects
   the only live-candidate strategy.
6. **Spread-capture entry-side ideas.** The family located its loss precisely
   (first-fill adverse selection) and has two untested entry-side responses:
   spread-anchored quoting (003, already chosen next) and the bid-side mirror
   (buy-both-and-merge — different inventory profile; a cheap unpaired leg is a
   longshot remnant, which ih-001 measured as ~fairly priced, weakly improving
   the mirror's prior). Lower promise: the worst_queue model caps upside.
7. **Never-conditioned-on state, anywhere:** absolute depth / dollar liquidity
   (only ratios used), spread _width as a signal_ (only as an inert filter),
   cancel/replace activity, cross-episode state (previous market's outcome or
   streak — every episode is treated i.i.d.), time-of-day, and realized
   BTC-side volatility for taker families (mf-014 tested it only as a maker
   starvation filter). Any of these is a genuinely new signal axis for a future
   family proposal.

### Bottom line

Validated knowledge is narrow but real: **one taker fee is ~$0.11/mkt and
redemption is free; deep-book flow carries ~+0.15 gross/mkt; the recent regime
(May–Jun) is where all net edge lives; makers get only toxic fills here; exits
lose, redemption wins; win rate is a payoff-shape warning, not a target.** The
cheapest high-value next actions are: run momentum-hold 000, re-measure the
2.5¢ ask-heavy claim, and month-decompose the maker-favorite confirms.
