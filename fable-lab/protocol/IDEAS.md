# IDEAS — mechanism-first idea ledger

Rules (DECISIONS D5): every entry names its mechanism class, its who-loses
story, a falsifiable prediction about recorded data, and the cheapest
experiment that could kill it. Duplicates are judged by mechanism +
prediction, not by indicator or parameterization. Statuses: `open`,
`registered (EXP-NNN)`, `parked`, `dead (EXP-NNN)`.

## Mechanism classes

A closed starter set; extending it requires a DECISIONS.md entry saying why
the new class is not a re-skin of an existing one.

| class | one-line definition |
|---|---|
| `stale-quote` | resting orders lag a fast repricing; the book briefly quotes yesterday's probability |
| `tail-overpricing` | near-certain outcomes trade below $1 (or hopeless above $0) by more than remaining risk justifies |
| `spread-capture` | quoting both sides earns the spread when true probability moves slower than the spread width |
| `sum-mispricing` | UP+DOWN books jointly price to ≠ $1 beyond fees; split/merge or dual-sided taking captures the gap |
| `flow-momentum` | one-sided book pressure (depth deltas) predicts short-horizon drift of the implied probability |
| `time-structure` | systematic mispricing tied to the episode clock (open auction chaos, expiry pin, dead zones) |

## Priority queue

Score = mechanism novelty (no prior EXP in class) × plausibility × 1/cost.
Ordered; top entries get registered first.

| # | idea | class | status |
|---|---|---|---|
| 1 | expiry certainty discount | `tail-overpricing` | dead (EXP-001) |
| 2 | UP+DOWN dutch-book scan | `sum-mispricing` | dead (EXP-002) |
| 3 | post-jump stale ladder | `stale-quote` | dead (EXP-003) |
| 4 | quiet-regime two-sided quoting | `spread-capture` | dead (EXP-006, model-conditional per D14) |
| 5 | depth-imbalance drift | `flow-momentum` | dead (EXP-004) |
| 6 | first-minute overreaction | `time-structure` | dead (EXP-005) |
| 7 | expiry-tail maker capture | `spread-capture` | dead (EXP-001 killed at main; per its own park clause it dies unexamined) |

## Entries

### 1. Expiry certainty discount — `tail-overpricing` — dead (EXP-001)
- **Who loses:** holders of the winning side who sell out at 0.95-0.99 in
  the final minutes to avoid redeem friction (gas, capital lockup, workflow),
  and late hedgers who must cross the spread. Their urgency is structural.
- **Prediction:** in the last T minutes, buying the side whose book mid is
  ≥ 0.9 and holding to resolution has positive gross EV before fees, and the
  win rate at price p exceeds p by a margin that widens as expiry approaches.
- **Cheapest kill:** probe with a taker strategy that buys the ≥0.9 side at
  various time cutoffs; if realized win rate ≤ price at all cutoffs, dead.
- **Risk:** taker fee `156bps × min(p,1−p)` is small at extreme p — this is
  the mechanism the fee shape punishes least. Adverse selection (book knows
  a reversal) is the true test. Simulator exposure: taker-only ⇒ pessimistic
  side of sim bias — a clean property.

### 2. UP+DOWN dutch-book scan — `sum-mispricing` — dead (EXP-002)
- **Who loses:** whichever side of the pair is quoted lazily; makers who
  don't rebalance the complement when one book moves.
- **Prediction:** moments exist where bestAsk(UP)+bestAsk(DOWN) < 1 − fees
  (buy both, guaranteed $1) or bestBid(UP)+bestBid(DOWN) > 1 + fees (split
  $1, sell both). Frequency and depth of these moments is measurable from
  ticks alone.
- **Cheapest kill:** probe strategy that takes only when the inequality
  clears measured fees at top-of-book depth. If it never (or almost never)
  fires across 500 markets, the market is internally consistent — dead, and
  that itself is a lesson worth having.
- **Simulator exposure:** taker-only, size capped by quoted depth ⇒
  pessimistic side. Watch cascade cap (100 events/drain) with batch orders.

### 3. Post-jump stale ladder — `stale-quote` — dead (EXP-003)
- **Who loses:** makers whose deep resting levels don't reprice within the
  first seconds after a large implied-probability jump.
- **Prediction:** after a mid jump of ≥ X in ≤ Y seconds, levels beyond the
  touch on the lagging side get consumed at prices that are stale relative
  to the new mid; taking them and exiting (or holding) is +EV.
- **Cheapest kill:** probe taker strategy triggered by jump detection; if
  post-jump ladders are already gone (books thin instantly), dead.
- **Simulator exposure:** taker-only against recorded liquidity, but the
  no-market-impact assumption matters if size > level size; cap size at
  quoted level size in the strategy itself.

### 4. Quiet-regime two-sided quoting — `spread-capture` — dead (EXP-006 probe kill, 2026-07-10; model-conditional per D14: closes the punch-through-backtestable version only — live at-touch provision was never measurable in this design)
- **Who loses:** impatient takers crossing a wide spread in low-volatility
  mid-episode stretches.
- **Prediction:** in windows where realized mid volatility is low
  (`timeWindowVolatility` plugin), quoting inside a wide spread on both UP
  books earns more in captured spread than it loses to adverse fills.
- **Cheapest kill:** probe; the worst-queue maker model is the pessimistic
  fill assumption, so a positive result is meaningful — but full-size-fill
  is the optimistic one, so size must stay small; classification will be
  `simulator-favored` unless taker-exit dominates. Expect this to need live
  paper regardless — register only when class 1-3 are exhausted.

### 5. Depth-imbalance drift — `flow-momentum` — dead (EXP-004)
- **Who loses:** quoters who ignore one-sided pressure buildup; the book
  tips before the price moves.
- **Prediction:** cumulative depth imbalance (bid vs ask, top 10 levels,
  both books) predicts the sign of the next N-second mid move better than
  chance, by enough to clear taker fees at the achieved entry prices.
- **Cheapest kill:** this one is killable OFFLINE: the prediction is a pure
  data question. But per protocol, offline feature studies are diagnostics —
  the decisive test is still a strategy run. Probe = simple threshold-entry
  taker.

### 6. First-minute overreaction — `time-structure` — dead (EXP-005)
- **Who loses:** traders who anchor the opening quotes before the book has
  found the window's true baseline; recording starts at the first book
  snapshot, so "open" here = first recorded state (CAPABILITIES §2 late-start
  caveat — the diagnostic must measure how late recording actually starts).
- **Prediction:** fading large deviations of implied probability from 0.5 in
  the first minute reverts more often than it continues, net of fees.
- **Cheapest kill:** probe with a fade-entry, fixed-exit taker.

### 7. Expiry-tail maker capture — `spread-capture` — dead (EXP-001 killed at main; per its own park clause)
- **Motivating evidence:** E12's synthesis — the only measured inefficiency
  is the expiry-tail certainty discount (EXP-001 probe: win rate 0.9697 vs
  mean ask 0.9343). EXP-001 pays the spread to reach the friction sellers;
  a maker posted at the bid collects the discount PLUS the spread, and
  serves the same structural counterparty (redeem-friction sellers who
  cross the spread to exit).
- **Who loses:** the same near-certain-side holders as EXP-001, selling out
  in the final minutes to avoid redeem friction; they hit resting bids.
- **Prediction:** a GTC bid posted at/inside the best bid on the ≥0.9 side
  in the final minutes fills in a substantial fraction of markets, and
  filled markets win more often than the fill price implies — by MORE than
  EXP-001's taker margin (the spread is added to the discount).
- **Cheapest kill:** probe with a passive-bid strategy; the worst-queue
  maker model (fills only when the book trades THROUGH the level) is the
  pessimistic fill assumption, so a positive result is meaningful, but
  full-size-fill optimism means size must stay small. Classification will
  be `simulator-favored` on the fill-rate axis regardless — needs live
  paper before belief. Hence parked until EXP-001 (same counterparty,
  taker version) confirms on holdout; if EXP-001 dies at main/holdout,
  this dies with it unexamined.
