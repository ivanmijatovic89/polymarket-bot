# JOURNAL — gabagool knowledge shift (append-only)

## 2026-07-17T00:30Z — session 1 begins

First session of the relay. No STATE.md existed; created STATE.md with the
full work queue seeded from the charter, plus this journal. Starting Phase 0
(required reading → PRIORS.md).

Early surprise: the charter points to a "binance aggTrades feed doc under
docs/datasets/" — that doc does not exist anywhere in this repo (repo-wide
grep for "aggTrades" only hits the charter itself). Binance-spot replayability
in backtests is claimed as NEW; I need to find where it actually lives
(possibly strategy-research-protocol/ or the engine code) or ledger it as an
unverified claim.

## 2026-07-17T01:05Z — Phase 0 complete, PRIORS.md written

Read everything the charter required (~3,400 lines + the Binance branch
docs). PRIORS.md now holds 51 tagged claims. The surprises:

1. The "missing" Binance aggTrades doc exists — on unmerged branch
   `binance-aggtrades-r2-sync`. The feed is implemented AND verified against
   the live WS stream (0 mismatches on 48k trades, measured p50 latency
   110ms baked in as the default). So "Binance spot is replayable" is true,
   with the caveat that strategies still only wake on Polymarket book ticks.
2. The mirror-book fact (fable-lab E9/CAL-001: bid_DOWN = 1 − ask_UP,
   16,352/16,353 samples) quietly kills the *instantaneous* version of the
   pair-cost story: top-of-book ask_UP + ask_DOWN = 1 + spread ≥ 1 always.
   Gabagool's sub-$1 pair cost is a TIME-SEPARATED phenomenon. Charter
   measurement D1 needs re-scoping accordingly (noted in PRIORS §11).
3. The two prior campaigns and the live wallets flatly contradict each
   other (T2): every sim-visible passive-maker variant on BTC 15m measured
   negative-to-zero at BOTH fill-model bounds, yet the flagship wallet
   banked ~$644k doing this live. Five candidate reconciliations ledgered;
   the passive-fill reality gap (D2) is the measurement that arbitrates.

Next: wallet forensics scaffolding + @gabagool22 handle→address resolution.

## 2026-07-17T01:55Z — wallet forensics unit 1: handles resolved, ecosystem alive

Resolved all 9 target handles to addresses (profile-page dominant-address
method + lb-api name echo). Findings that move priors:

- gabagool22 = 0x6031…f96d, all-time $868,863 (bigger than the incumbent).
  Active window pinned by data: 2025-10-29 12:34Z → 2026-02-20 09:06Z.
  Ran the full multi-book operation from literally the first minute.
- He DID merge (697 MERGEs in the 2.6-day tail) — "never merges" (P10) is
  a successor-wallet fact, not an archetype fact. Contested.
- MAKER_REBATE rows exist: $1,693 paid 2026-02-18. Venue rebate income is
  real — T2 reconciliation (iv) is live, workstream B must find the terms.
- His volume was mostly 5m/15m BTC/ETH (~35k fills/day) — contests the
  INV claim that the edge lives on 1h/4h (P18/T1 needs re-measurement).
- The ecosystem TODAY: 7 confirmed-active wallets collectively printing
  ~$18.5k/day over 30d; the incumbent's 30d rate GREW since the INV
  (83.8k → 110.6k). "Edge decaying" is contested.
- Cluster lead: incumbent + @0xce25 profiles created 121s apart with the
  same name pattern — likely one operator, two wallets.

Full-history pull for gabagool22 is infeasible (~3-4M rows via a 500/page
API); kept the 75k-row tail (Feb 17-20 + post-stop) and will sample
mid-life windows instead.

## 2026-07-17T02:50Z — puller bug found+fixed; tail forensics done; venue fee timeline pinned

A dedupe bug in puller v1 (identical same-second rows are LEGITIMATE — no
unique ids in /activity) was silently dropping ~22% of trades and showed
+$45k tail profit. Fixed puller, re-pulled, validated MERGE semantics
(= pairs × $1). Corrected picture of his final 2.6 days:

- Trading net −$1,767 (−0.50% of turnover); rebates +$1,819 → he quit at
  breakeven on 2026-02-20. Win% 39–65% by family, NOT 99%.
- Fingerprint: buys only, both sides, near-zero delta (0.13% leg imbalance
  across 845 fills), pair cost ≈ $1.00–1.02 (paying over $1, financed by
  the 20% maker rebate), $4 median clips, burst ladders (p50 gap 0s),
  exits via batched cross-market merges.
- Venue timeline (workstream B): 15m crypto fee-free until 2026-01-06;
  dynamic taker fees (~1.56c/share at p=0.5 — exactly the repo's 156bps
  era) + daily 20%-share maker rebates introduced Jan 6-7; current (Jul
  2026) crypto feeRate 0.07 (1.75c at p=0.5). VENUE-MECHANICS.md started.
- Big narrative shift: end-state gabagool = REBATE FARMER (trading PnL ≈
  −rebates; the live E29 equilibrium). His $869k must be mostly from the
  zero-fee era → mid-life sample (Dec 2025) is the next measurement.

Also: briefly created (and immediately removed) a stray dir at repo-root
measurements/ — write-scope discipline note to self.

## 2026-07-17T03:15Z — ENGINE-GAPS.md written

Eight gaps documented from code reading, ranked. New beyond the charter's
known list: (G3) the sim's taker-fee model is wrong in SHAPE (linear
min(p,1−p) vs the venue's quadratic p(1−p)) and undercharges takers 2–4×
across the price range; (G4) rebates — now known to be the end-state edge
— are absent and their pool-share arithmetic needs trade prints; (G5)
mid-episode merge in sim DESTROYS value (fable E4) while live merge is the
capital-recycling engine of the real strategy — capital velocity is
inexpressible; (G8) the live meta is a 7-bot equilibrium no replay can
express. Fee-shape check also sharpened a fable-lab premise: their "156
bps" era matched January's venue curve only at 45% of its mid-price value.

## 2026-07-17T04:10Z — era comparison: the edge lived and died with the fee regime

Pulled Dec 8-10 2025 (277k rows) and compared to the Feb tail with fixed
boundary handling. Zero-fee December: +1.90% of turnover (~$10k/day), BTC
15m his best book at +$63.85/market and 98.7% win over 229 markets, pair
cost 0.98, worst market −$121. Fee-era February: −0.50%, win rates
collapsed, pair cost ≥ $1, rebates ≈ −trading. The operator claim "99%
win, $30-120/market" is now VERIFIED for December and REFUTED for
February — both were true, at different times.

Venue archaeology (archive.org): Feb-era crypto fee = C·p·0.25·(p(1−p))²
(peak $0.78/100sh = the repo's 156bps calibration, exactly); current =
C·0.07·p(1−p) (peak $1.75). Fees extended to ALL crypto markets
2026-03-06. The maker-rebates docs page first appears in the archive on
2026-02-20 — the day gabagool quit. January's true rate is contested
(press says 2× the Feb snapshot); resolving it matters because a
mid-February fee/rebate halving would be a clean exit trigger.

PRIORS amended (A1–A8). Era-comparison measurement file written.

## 2026-07-17T04:55Z — incumbent decomposition: the current meta is subsidy-heavy but edge-positive

Pulled 2 complete days (Jul 14-16) for 0xb55f. Three income streams:
trading +$2,674/day, MAKER_REBATE $915/day, and a previously-unknown
TAKER_REBATE program paying $3,050/day — venue subsidies now EXCEED the
trading edge. The incumbent is a different animal from the archetype:
never merges (2,220 redeems — INV's "never merges" was about him, A2
confirmed), 47% win rate with tail-harvest payoffs (worst −$770, best
+$2,202), clips to $1,260, buys deep longshots (p25 price $0.09), all 4
coins. Wrote wallets/b55f-incumbent.md with the side-by-side fingerprint
table. The concept now has two verified profitable EXPRESSIONS: parity
grinder (archetype, zero-fee era) and loss-tolerant tail harvester
(incumbent, current era).
