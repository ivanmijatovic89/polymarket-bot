# Measurement: income decomposition of the 7 active wallets (Jul 14–16, 2026)

Session 1. Script: `scripts/decompose-activity.ts` over complete pulls of
2026-07-14T00:00Z → 07-16T00:00Z (`scripts/pull-activity.ts`). "Trading"
= cash flow on complete markets (fills>0, 1h/2h margins). Rebates = paid
MAKER_REBATE / TAKER_REBATE rows in-window.

## The table (per DAY, 2-day window ÷ 2)

| wallet | books traded | trading $/d | maker reb $/d | taker reb $/d | total $/d | trading % of buys | win% | leg imbalance p50 | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 0xce25 (b55f sibling) | 4 coins × 5m/15m/1h | **+5,850** | 372 | 2,592 | +8,813 | **+2.31%** | 50.3 | n/a | **edge-dominant** |
| b55f (incumbent) | 4 coins × 5m/15m/1h+ | +2,674 | 915 | 3,050 | +6,639 | ~+0.7% | 47.0 | loose | edge + subsidies |
| badfallen | btc-5m only | **+3,171** | 207 | 1,723 | +5,101 | **+1.68%** | 64.4 | 9.7% | **edge-dominant** |
| powerwinner | btc-5m only | −3,748 | 0 | 6,110 | +2,363 | −0.76% | 43.6 | 7.7% | taker-rebate farmer |
| doggystyie | btc-5m only | −729 | 0 | 3,240 | +2,511 | −0.32% | 45.6 | **0.0%** | parity taker-rebate farmer |
| 0xaaaaa | btc-5m only | −159 | 0 | 1,982 | +1,822 | −0.07% | 58.1 | 34.8% | breakeven + rebates |
| bonereaper | btc/eth 5m+15m | **−3,963** | 883 | 1,683 | −1,397 | −0.65% | 56.4 | n/a | NEGATIVE window (all-time $1.19M — 2-day sample likely unlucky; re-check) |

(b55f/0xce25 buy-turnover: ~$441k/d and ~$254k/d; bonereaper ~$606k/d;
farmers ~$180–490k/d each. Clip sizes: farmers $35–84 p50; edge wallets
$6–11 p50 — the EDGE wallets trade small like the archetype did.)

## Findings

1. **H3 (subsidy dominance) verdict: STRATIFIED, not universal.** Three
   wallets have real, current trading alpha (+0.7% to +2.31% of
   turnover); three are deliberate rebate farmers whose trading is a
   manufacturing cost; one printed negative this window. Real edge
   SURVIVES in July 2026 — the lab is not chasing a ghost.
2. **The current edge wallets look like the archetype**: small clips
   ($6–11 p50 vs farmers' $35–84), wide multi-book coverage (0xce25
   spans all 4 coins × 3 timeframes; 1,995 markets in 2 days), moderate
   leg discipline. The subsidy farmers trade big clips at p≈0.5 on
   btc-5m only (max fee-weight per dollar — rebate-volume manufacturing).
3. **doggystyie is a living gabagool end-state**: PERFECT parity (p50
   0.0% imbalance), pair cost ≥ $1, trading −0.32%, taker rebates flip
   it to +$2.5k/day. The archetype's Feb-2026 economics still run
   profitably today because the 2026-05-28 taker-rebate program pays
   for what used to be a slow bleed. (He has NO maker rebate → his
   both-side entries CROSS the spread — a taker-side parity variant.)
4. **Rebate stack ranking**: every one of the 7 collects taker rebates;
   only the multi-book/15m wallets collect maker rebates too. The 5m
   book is where rebate farming concentrates (fee-weight 2.3× × 288
   windows/day = max weighted volume per capital-hour).
5. Collective: ~$25.9k/day total income across 7 wallets, of which
   ~$21.9k/day trading+taker-side nets to ≈ $2.9k trading + $19k
   subsidies+edge mix... decomposed: trading net −$2.7k+... — summed:
   trading −$2,704/d? No: +5850+2674+3171−3748−729−159−3963 = +$3,096/d
   trading; maker rebates $2,377/d; taker rebates $20,380/d. **The
   ecosystem's dominant income stream is the taker-rebate program
   (~$20k/day across these 7 alone)** — a venue-funded pool that exists
   since 2026-05-28 and can be repriced by Polymarket at any time
   (program risk is THE systemic risk of the current meta).

## Caveats

- 2-day window; bonereaper's negative and 0xaaaaa's near-zero could be
  window luck. Trading% for high-variance wallets needs a longer pull
  before strong per-wallet claims (minority-outcome rule, METRICS).
- lb-api "profit" ≠ these numbers (likely excludes rebate transfers,
  includes MTM; PRIORS P51/A10).
- Maker/taker role per fill still unobserved (needs on-chain data).
- **GROSS-OF-FEE (added session 3, A13)**: all trading nets here
  exclude net taker fees (invisible in /activity — fee docked in
  shares, verified on-chain), while rebate income (a fee REFUND) was
  counted. True income = gross net − taker fees + rebates; taker fees
  can be bounded by rebate ÷ tier%. The "edge" margins here need a
  fee-inclusive re-audit before being trusted
  (measurements/jan-transition-gabagool22.md).

## Per-book trading nets for the edge wallets (H5/T1 answer)

Same window/method, per book family:

| book | b55f net (% of buys) | 0xce25 net (% of buys) |
|---|---|---|
| **btc-15m** | **+$5,578 (+3.20%)** — its best absolute book | **+$2,567 (+1.97%)** |
| btc-5m | −$312 (−0.14%) | +$8,482 (+4.56%) — its best |
| sol-15m | +$1,534 (+6.36%) | +$675 (+3.26%) |
| eth-15m | −$1,203 (−1.81%) | −$398 (−0.72%) |
| eth-5m | −$1,741 (−2.47%) | −$10 (−0.02%) |
| btc-1h+ | +$451 (+0.44%) | n/a |

- **T1 RESOLVED FOR THE LAB'S SCOPE: btc-updown-15m is a live positive-
  edge book in July 2026** for both current edge wallets (+2.0 to +3.2%
  of turnover). The INV's "15m ≈ 0" (P18) was an era artifact.
- ETH books are NEGATIVE for both edge wallets — whatever the edge is,
  it is not symmetric across coins (BTC+SOL yes, ETH no). Coin-level
  flow composition differs; worth one look at why (retail concentration?
  another bot owning ETH?).
- The two edge wallets DISAGREE on btc-5m (+4.56% vs −0.14%) —
  variant-specific, not book-structural.
