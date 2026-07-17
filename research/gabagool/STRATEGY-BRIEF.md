# STRATEGY-BRIEF — the gabagool concept build spec (living draft)

Session 1 draft, 2026-07-17. Every claim links to PRIORS (P/A numbers),
measurements/, wallets/, VENUE-MECHANICS, or ENGINE-GAPS. Update
continuously; this is the file the lab builds from.

## 1. Mechanism (what verifiably made money)

Passive two-sided BUY-only maker on crypto up/down binaries. Rest bids on
BOTH legs across a band around mid; every filled pair whose combined cost
< $1 is riskless at settlement. The archetype's verified implementation
(measurements/tail-forensics, era-comparison):

- **Delta-parity accumulation, not independent leg-catching**: leg
  imbalance held at ~0.1% across hundreds of fills per market. The bot
  buys whichever leg restores balance — pair completion is continuous,
  not an afterthought. This is why the "unpaired inventory" tail risk
  (P14) barely materialized for him (worst Dec market −$121 across 568).
- **Buys only. Zero sells, ever** (both eras). Exits: batched
  cross-market MERGE (~99% of exit dollars, every few minutes) + redeem
  dust. Merge recycles capital within the window (capital velocity —
  inexpressible in the current sim, G5).
- **Small clips, huge counts**: $4 median buy, p90 $13; 45–618 fills per
  market median by era/book; burst ladders (p50 inter-fill gap 0s).
- **Wide band**: buy prices p25–p75 = 0.31–0.63 (p5 0.11, p95 0.85). He
  quotes the whole probability band, not cheap tails.
- Economics by era (THE central fact — the edge is regime-dependent):
  - Zero-fee era (≤2026-01-06): pair cost p50 0.98 → ~2c/pair margin ×
    ~500k pairs/day scale → +1.9% of turnover, 98.7% win on btc-15m.
  - Fee+rebate era: pair costs compressed to ≥$1; trading PnL → −rebates;
    the 20% maker-rebate pool became the income; competed to breakeven →
    archetype exited 2026-02-20. NUANCE (A15): the fee shock itself was
    adapted to in ~6 days (Jan 12 was back to 94% win via 130bp deeper
    discounts); the actual death was slower competitive compression over
    mid-Jan→Feb.
  - Current era, FEE-INCLUSIVE (A16, on-chain audit): btc-15m still
    carries real edge — b55f +2.31% of turnover after fees (+3.20%
    gross); 0xce25 +0.31%. btc-5m cells are fee-negative and exist for
    rebate manufacturing. Winners are ~62% TAKER by notional.

## 2. Who pays (and the era-dependence of the counterparty)

- Zero-fee era: takers crossing mid-band spreads freely — retail
  gamblers + latency arbs (venue's own justification for the fee, VENUE-
  MECHANICS). The maker's 2c/pair was the immediacy premium of a young
  fee-free market.
- Current era: taker flow is taxed 0.07·p(1−p) (peak 1.75c/share) and
  20% of that tax is recycled to makers as rebates. The maker earns
  (a) whatever pair-cost margin survives competition, plus (b) the
  rebate stream ∝ own share of fee-weighted maker volume. Rebates are
  volume-proportional → they reward exactly the high-count/small-clip
  fingerprint the archetype had.
- Fee mechanics are now EXACTLY known per era (A13/A14/A16 +
  VENUE-MECHANICS): zero until 2026-01-06; then 0.25·p·(p(1−p))²/share
  taker-only (verified on-chain, no Jan ambiguity); currently
  0.07·p(1−p)/share taker-only on a new exchange contract that also
  MINT-matches complementary buys. Makers pay exactly $0 in every era.
  A lab family can therefore model fees precisely — but must model the
  TAKER side to do so, because the winning meta taker-completes ~62%
  of its notional (A16) and /activity-style gross accounting hides
  that cost.

## 3. Fair-value options (open — ranked by evidence)

The archetype's quoting band was wide and symmetric; nothing measured so
far REQUIRES a fair-value model beyond "mid ± band with delta-parity".
Candidates for the lab:

1. **No-model baseline (archetype-faithful)**: quote both legs around
   current mid with parity-keeping size selection. Evidence: he ran this
   (or something indistinguishable from it) profitably for 3 months.
   Cheapest to implement; the D2 fill-gap number decides if the sim can
   see its fills at all.
2. **Binance-anchored fair value** (Game B): p_fair from spot-vs-strike
   + time-left + vol; quote only the side(s) where book price < fair −
   margin. Feed exists on the unmerged branch (G6); strike must be
   proxied by window-open spot in replay. Untested by any prior campaign
   — the genuinely new territory. Risk: PM-tick-only wakeups leave stale
   quotes in quiet books (G6). Basis caveat (A18): resolution reads the
   **Chainlink BTC/USD data stream**, not Binance spot — Binance is a
   proxy for the oracle, fine mid-window, riskiest in the final seconds
   when the stream-vs-Binance basis can decide near-flat windows.
3. **Hybrid: parity-quoting with fair-value kill-switch**: quote like #1
   but pull quotes when |spot drift| since window open exceeds a
   threshold (the trending-window guard, P48). Targets the one measured
   loss channel of two-sided quoting (first-fill adverse selection, P42).

## 4. Quoting policy options

- **Measured ladder (D2, 43k fills)**: ~20% of fills at the touch, ~35%
  from a 1–4c-deep ladder below best bid (offset p10–p25 = bid−4c to
  bid−2c), ~9% inside the spread (Dec), and — the surprise — **29–45%
  taker completions at/above the ask**. The archetype was maker-BIASED,
  not maker-pure: passive ladders accumulate, and the lagging leg gets
  taker-completed when parity demands it (free in the zero-fee era;
  post-2026-05-28 the taker leg earns tier rebates, changing this
  arithmetic again).
- **Taker completion is now the MAJORITY mode (A16)**: July edge
  wallets run ~62% taker by notional on their edge book and still
  clear +2.3% fee-inclusive (b55f). A build spec needs an explicit
  completion policy: when a leg lags, cross the spread and pay
  0.07·p(1−p) iff expected pair margin + rebate > fee. This knob
  (completion aggressiveness) separates b55f (+2.31%) from 0xce25
  (+0.31%) — same operator, different aggression, 2% margin gap.
- **Current-era ladder shape (A17, Jun 12–14 fills×books)**: the edge
  wallets' ladders are DEEPER than the archetype's — offset vs touch
  p25 −2c but p10 **−12/−13c** below best bid (~35% of fills are these
  patient discount bids waiting for sweeps); at-touch resting
  concentrates on the CHEAP side (b55f touch-fill px p50 0.14 —
  longshot bids), taker completions are mid-band (px p50 0.58, IQR
  0.34–0.71). Post-fill mid drift at +10s/+60s ≈ 0 — no visible
  adverse signature at this granularity.
- **Timing (A17 + A20)**: fills are back-loaded — minutes 10–13 carry
  the most (b55f 39.7% of fills; minute-12 peak 12.1%), the final
  minute is CUT (6.8%/5.3%), and the open gets no special concentration
  (Game F negative for this cohort). Weight quoting toward minutes
  8–13; de-risk minute 14. Lifecycle context (A20): raw two-sided
  oscillation is FRONT-loaded (min 0–5) but open churn is adversely
  selected (fable E24); the winners' late concentration means their
  income is completion/positioning as decision arrives, not churn
  harvesting. Books are 1c-tight ALL window — the "temporarily cheap
  side" is a 1–2c-plus-depth-sweep phenomenon, never a wide spread.
- **The deep-pair operating point exists and prints (A30)**: the only
  known trading-profitable parity wallet at scale today (0x04b6d7e9,
  +0.30%T on $332k/day + $1.75k/day rebates, BTC-only, ~35% btc-15m)
  runs maker share 0.88–1.00 with pairRate only 0.78 but pair cost
  0.964–0.976 — it completes FEWER pairs, each 2–3c deeper, instead
  of grinding parity at 0.99+. Completion aggressiveness (H6) is not
  a monotone knob: the profitable corner may be LOW aggression + deep
  entry rather than b55f-style taker completion. Sweeps must include
  this cell (pair-cost target ≤0.98, patient/maker-only completion,
  tolerate ~20% unpaired).
- **A34 refines the deep-pair cell's mechanics (fills×books on its
  own btc-15m sleeve)**: the ladder is SHALLOW (offset p10 −2c, half
  of maker volume at-touch/inside) with seconds-scale requoting —
  its deep pair costs come from timing dips near the touch, not deep
  resting rungs; on btc-15m it actually grinds pairRate 0.94 p50
  (the 0.78 was a cross-book artifact of its maker-pure 5m/hourly
  farming sleeves) and concentrates ~ALL its taker completion on
  btc-15m; resting fills drift favorably post-fill. So the two
  proven roads to sub-$1 pairs are (a) deep patient rungs
  (b55f/0xce25) and (b) shallow fast requoting + timed completion
  (0x04b6d7e9) — the first sweep should carry BOTH cells, and
  requote interval joins the parameter list.
- **The shallow-fast cell's ENTRY GATE is momentum context (A44,
  validated + corrected by A45)**: on 8.6k joined resting fills
  across three day-samples, the winner's fills concentrate in
  near-calm states while the breakeven grinder's fire mid-chase at
  local tops (robust in every sample). Gate spec (post-validation):
  (a) prefer quoting when |mid drift over 30s| ≈ 0; (b) HARD veto
  fills within ~10s of a fall on that asset (pull/widen the bid on
  a falling ask — held 3/3 samples, corr up to +0.21); (c) never
  instant-requote upward under a rally; (d) any DIRECTIONAL 30s+
  momentum signal is day-regime-dependent (sign flipped on Jun-10)
  — sweep it, never fix it. No other book feature (spread, depth,
  event rate, minute) discriminates. Judge gates on aggregate drift
  + pair cost — favorable share is ~48% for everyone.
- **Hour-of-day is a policy variable, not just a regime caveat
  (A35)**: 0x04b6d7e9 trades ONLY 12–19Z weekdays (zero fills
  20–05Z, dark on weekends 21/32 and on Memorial Day) and earned its
  entire +$473k in that envelope — the high-flow US session where
  realized pair costs look WORST (O7) is where the winner harvests,
  because fills are the binding resource. Lab evaluation should
  segment by session (12–19Z weekday vs rest) and consider
  restricting v1 to the winner's envelope rather than running 24/7.
  **A36 sharpens this into a two-regime map**: the 24/7 grinder
  (b27bc932) is gross-NEGATIVE exactly in 12–19Z (pairCost p50
  1.006, 50% losers, −$384 over 64 June markets) and positive in
  every other session — so the day divides: parity-grind recipe
  off-hours, shallow-fast/favorite-lean recipe (A34) in the US
  session. A v1 that runs the grinder overnight/EU/evening and
  idles (or switches recipe) 12–19Z matches both living winners'
  revealed preferences. **A49 confirms this at month scale (478
  markets, Mar/Jun/Jul)** and sharpens it: in the current era the
  grinder is gross-flat-or-negative in three of four sessions —
  evening 20–23Z is the ONLY robustly positive one (+1.65%, 28%
  losers; US −1.05%) — so the v1 grinder sleeve should run 20–24Z
  first, not merely avoid 12–19Z. Realized vol is NOT an
  independent gate: the US bleed concentrates in US×storm (−1.43%)
  but evening storms are fine (+1.27%) — gate on session (plus at
  most a US-storm veto), never on a vol tercile alone. And the
  margin has a clock: the same recipe earned +1.9% of outlay in
  late March and ≈0% June onward (A49) — judge current-era
  candidates on trading-gross + expected rebate (A28), and never
  pool January/March-era measurements with current-era ones.
  **A52 adds the fee confound to that clock**: the late-March
  margin was earned under the OLD cheap taker curve (peak
  $0.78/100sh); the curve 2.3×'d on Mar-29/31 (rollout with the v2
  exchange release train, published 0.072, trimmed to 0.070 May
  6–10). Part of the Mar→Jun "margin decay" is therefore a fee-cost
  step, not pure competition — and any taker-completion economics
  must use the right era's curve (0.25·p·(p(1−p))² before Mar-29;
  0.072·p(1−p) to ~May-8; 0.07·p(1−p) after). **A53 is the
  revealed-preference confirmation**: b27bc932 ran its btc-15m
  sleeve for a ~1-week trial under the new curve, killed it in one
  day (Apr-08→09), ignored the 2.8% May trim, and only revived it
  (~May-27) when taker-tier refunds arrived — so btc-15m
  taker-completion economics flipped sign at 0.072 and are only
  positive-for-incumbents at 0.070+tiers. A lab candidate (tier-0,
  no refund) must budget the FULL 0.07 curve on every taker leg —
  maker-completion weight is the lever that decides viability.
- Band width: archetype ~[0.11, 0.85] effective.
- Reprice cadence: unknown for archetype (cancels invisible, P21);
  inter-fill bursts suggest standing ladders, not chase-the-mid. NOTE:
  SRP spread-capture measured never-reprice as the WORST static-ask
  config under worst_queue (P42) — but that was the SELL side without
  parity control.
- Parity control (the load-bearing piece): size each new bid to close
  the current leg imbalance; suspend the rich side when imbalance = 0.
- Endgame: stop quoting when a leg's price leaves the band (book decided)
  — archetype's band implies no quoting beyond ~0.85; endgame-panic-bid
  family results (P43) say late resting bids ≈ fairly priced tail risk.

## 5. Leg-risk policy — ERA-DEPENDENT (updated after the actives decomposition)

- Archetype (zero-fee era): prevent, don't manage — 0.1% parity kept the
  unpaired remainder ≈ dust; remainder rides to settlement (never sold).
- **Current edge wallets are LOOSE**: per-market leg imbalance p50 20.3%
  (0xce25) and 40.0% (b55f, p90 = fully one-sided markets), win rates
  44–50%, right-tail payoffs. Meanwhile the one perfect-parity wallet
  today (doggystyie, 0.0%) is trading-NEGATIVE and lives on rebates.
  Reading: with fees taxing mid-band crossings, forcing parity means
  paying tax/spread for the completing leg; today's alpha tolerates
  directional remainders and lets resolution settle them. Parity is a
  zero-fee-era artifact, not a concept invariant.
- SRP evidence agrees from the other side: post-first-fill survivor
  policies were a ±$0.01 sideshow (P42); the decision that matters is
  WHICH fills to accept (band, price-vs-value, kill-switch), plus HOW
  MUCH imbalance to carry — sweep parity tolerance as a first-class
  knob (0.1% → 40%), not a fixed virtue.
- **Which leg to leave unpaired (A34)**: when 0x04b6d7e9 carries an
  excess leg on btc-15m, it leans toward the FAVORITE (excess avg px
  0.547 vs 0.437 other leg) and that leg won 18/30 (60%, ≈ +5c/share
  gross) — the imbalance is a directional choice, not adverse
  cheap-side pile-up. Leg-risk policy sweeps should include the sign:
  cap CHEAP-side excess tighter than favorite-side excess.

## 6. Sizing / cadence / capital

- Clip $1–28, median $4 (both eras) — sits inside L1 depth; rebate
  income scales with fill COUNT × fee-weight, favoring many small fills.
- **Rebate arithmetic per policy (W5, A28)**: per $1 of maker
  notional at price p the rebate is exactly `1.4%·(1−p)`; a taker
  pays `7%·(1−p)` on the same dollar. Balanced two-sided quoting
  earns ~0.7% of maker notional; cheap-side (p≈0.1) earns ~1.3% —
  the subsidy curve structurally favors cheap-side accumulation.
  $1/day/market payout threshold ⇒ minimum viable density ≈ $143
  (balanced) / $75 (cheap-side) maker notional per market — a STEP
  function; below it the rebate line is zero. Calibrated: b27bc932's
  whole profit at scale = +0.43% of turnover subsidy on breakeven
  trading. (measurements/rebate-economics-per-policy.md)
- Per-market outlay: Dec p50 $3.2k (btc-15m), max $7.9k; capital
  recycled by merges within minutes. Per-day capital ≈ few × $10k for
  ~$10k/day at peak (extraordinary ROC — enabled by merge velocity, G5).
- Books: archetype = BTC+ETH, 15m+1h (Dec) → +5m (Feb). Successors run
  4 coins × 4 timeframes. Diversification across ~16 books smooths the
  daily P&L (leading book rotates, P18-note).

## 7. Exit / endgame handling

- Merge whenever paired inventory accumulates (batched, cross-market,
  every few minutes live). In SIM: never emit merge (G5/E4) — hold pairs
  to auto-credit; accept that sim capital velocity is unmeasurable.
- Redeem the (dust) remainder after resolution; abandonment observed only
  at sub-$20 scale.
- Endgame flip priors (A20, June flip table): leading side ≥0.90 with
  <5 min left flips 0–6%; the 0.5–0.6 band is a coin toss at EVERY
  horizon — "the book has decided" is only true above ~0.8. Measured
  flips sit at/below price-implied in all bands ≥0.6: the trailing
  cheap side is ~1–5c overpriced gross (sub-fee; the fable "cheap-side
  trap" from the other leg). Cheap-side pair completion must come at
  deep discounts (b55f's 0.14-median touch rests), not near mid.
- Resolution facts that bound the endgame (A18, primary-sourced):
  oracle = Chainlink BTC/USD data stream ("not other sources or spot
  markets"); end ≥ start → UP, i.e. **ties resolve UP** — a structural
  (if tiny) asymmetry favoring the UP leg in dead-flat windows; how
  tiny depends on the stream's price precision, which is still OPEN.
  negRisk = false, tick 0.01, min order 5 shares.

## 8. What kills this (measured failure modes)

-1. **The long-run force is ceiling compression, not blow-up (A43)**:
   best documented per-operator daily rate by era — Nov 2025 ~$14k
   (PurpleThunder/52483137) → Dec–Jan ~$10.6k (93c22116) → Feb–Mar
   ~$6.5k (guh123) → living best ~$2.75k incl. rebates (0x04b6d7e9).
   Each fee/venue shock opened a briefly-rich window (A40–A42), then
   the ceiling ratcheted down. All 8 documented winners exited
   abruptly at full speed (quit-at-peak n=8; the first, 52483137,
   quit Dec-06 BEFORE fees — competition alone sufficed). Plan for a
   $1–3k/day ceiling and an eventual margin-compression exit, not a
   blow-up. **A54 caveat: quit-at-peak is partly identity ROTATION**
   — gabagool22's successor profile (guh123) was created 6m51s after
   its last trade and printed for 33 more days. Wallet lifecycles
   understate operator persistence; the ceiling-compression curve is
   the real signal, wallet "exits" are noisier than they look.

0. **What does NOT kill a cold-start (A32)**: the taker-tier moat only
   taxes taker completion. Maker-pure new entrants win TODAY
   (0x13e0d447 ≈ +$121k in its first 5 weeks; ohio-house +$6k in week
   1 on deep pairs) because maker rebates pay the same rate at every
   tier. Entry risk concentrates in (a) taker-completion legs at
   tier-0 fees (HelixEdge −$20k/mo) and (b) maker breadth WITHOUT
   pair discipline (0x76d4d470: −0.98%T trading, alive only on
   subsidy). (measurements/cold-start-economics.md)
1. Fee-regime shift against takers → pair-cost compression (the
   archetype's actual death; VENUE-MECHANICS timeline).
2. Rebate-pool dilution — more maker wallets splitting the same 20%
   (current meta risk; G8 — no sim can price it). Now partially
   quantified (A23/A24): btc-15m's maker pool ($7.3k/day) is
   FRAGMENTED — the biggest earner (`0xb27bc932`, archetype-discipline
   multi-book grinder) holds only ~3–4% of it; new entrants start
   at a taker-fee-tier disadvantage (A16). The pool is contestable;
   the entry risk is execution quality, not an incumbent wall.
   (CORRECTED by A26: the "−$542k/30d failed challenger" cited here
   earlier was a World Cup sports-MM blow-up, not a class casualty —
   its crypto-updown life was dust-scale and near-breakeven. The class
   has NO known large-loss example on crypto-updown; measured downside
   is slow bleed — HelixEdge −$20k/30d — or fee-margin compression.
   Blow-up risk concentrates in jump-driven event books, which is
   evidence for the bounded-window continuous-underlying niche;
   wallets/95f5-challenger.md.)
3. Worst-queue-style adverse selection IS real when quoting without
   parity/flow context: every prior sim family died on the first fill
   (P42/P43/P45). The archetype's counter was flow-feeding parity at
   scale, not smarter single quotes.
4. A strong directional window with a stale ladder — bounded by band +
   parity (Dec worst −$121), but only if repricing keeps up (G6 wakeup
   gap in quiet books).

## 9. Open questions gating the build (→ OPEN-QUESTIONS.md)

- ~~D2~~ **ANSWERED**: worst_queue admits 44–49% of real fills, touch
  64–68% (measurements/d2-fill-reality-gap.md). Sim = lower bound seeing
  the adverse half; screens retain signal, validation needs live-paper
  or a trades-channel queue model.
- ~~Income decomposition~~ **ANSWERED** (all 7 actives + fee-inclusive
  re-audit, A16): the meta is stratified; fee-inclusive btc-15m edge
  +2.31% (b55f) is real; farmers are fee-negative rebate loops.
- ~~January transition speed~~ **ANSWERED** (A15): fee shock adapted to
  in ~6 days; competitive compression killed over weeks.
- ~~Level offsets at fill time~~ **ANSWERED** (D2 + A17): archetype
  ~20% touch / ~35% ladder 1–4c deep; current edge wallets go deeper
  (p10 −12c) with cheap-side touch rests.
- ~~Edge SOURCE on btc-15m~~ **ANSWERED** (A17): deep patient ladders
  + cheap-side touch accumulation + mid-band taker completion (~43% of
  notional), back-loaded minutes 10–13; the better wallet waits longer
  and crosses further from the fee peak (H6 sharpened).
- Whether rebate accrual can be estimated per-fill precisely enough to
  bolt onto backtest stats (G4 estimator; needs pool-share assumption).
