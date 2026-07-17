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
