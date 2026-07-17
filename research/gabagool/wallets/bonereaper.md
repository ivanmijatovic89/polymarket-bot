# @bonereaper — hybrid: btc-5m rebate manufacturing + real 15m edge + sports punts

Address: `0xeebde7a0e019a63e6b476eb425505b7b3e6eba30` **[verified]**
(resolved in _META; pseudonym "Popular-Insurrection").
lb-api all-time profit: $1,189,582 — the LARGEST all-time figure among
the active set, predating and outliving the archetype.

Data: `data/activity-bonereaper-jul2.jsonl` (Jul 7–12, 137,913 rows,
pull-activity.ts, complete `done:true`) + the earlier 2-day Jul 14–16
window (`activity-bonereaper-jul.jsonl`, actives-decomposition.md).
Analysis: decompose-activity.ts + inline per-book net split (this file's
producing commands are in JOURNAL 2026-07-17T01:5xZ).

## Verdict (resolves the "negative window — sample luck?" flag)

**Not sample luck — structurally trading-negative, rebate-carried.** The
5-day window confirms the 2-day one: trading net **−$35,673 on $3.16M
buys (−1.13%), win 60.0%, 2,109 complete markets**. But the book split
shows THREE distinct businesses in one wallet:

| book | complete mkts | net | buys | margin | win% |
|---|---|---|---|---|---|
| btc-5m | 1,390 | −$23,428 | $2,604,573 | **−0.90%** | 53.5 |
| other (sports/politics) | 15 | −$15,164 | $75,662 | −20.0% | 33.3 |
| eth-5m | 345 | −$477 | $135,063 | −0.35% | 72.5 |
| eth-15m | 182 | +$994 | $129,791 | **+0.77%** | 82.4 |
| btc-15m | 177 | +$2,401 | $214,149 | **+1.12%** | 66.7 |

1. **btc-5m = rebate-volume manufacturing** (82% of buy turnover at
   −0.90% — the same manufacturing-cost signature as powerwinner and
   doggystyie).
2. **15m books = real edge, again** — btc-15m +1.12%, eth-15m +0.77%.
   Third independent wallet where btc-15m is trading-positive in July
   2026 (extends A11; note eth-15m is positive HERE but was negative for
   b55f/0xce25 — coin-asymmetry is wallet-specific, not universal).
3. **Sports punts are discretionary variance**, not part of the system:
   a single `will-ronaldo-cry-at-the-world-cup-2026` bet lost −$18,743;
   an MLB market won +$7,697. −$15.2k of the −$35.7k window loss is this.

## The payout stream — and a $62.6k anomaly

TAKER_REBATE (6 events, $72,481 total) and MAKER_REBATE (5 events,
$3,270). But the daily cadence is ~00:10 (taker) / ~00:45 (maker) at
**~$1.4–2.9k/day taker + $0.35–1.2k/day maker** — confirmed identical in
the separate Jul 14–16 window ($1.4–2.0k + $0.8–1.0k). One payout breaks
the pattern: **$62,612.93 TAKER_REBATE at 2026-07-08T23:34:35Z** —
off-schedule, 20–45× the daily rate. RESOLVED (A21): it is one
same-second batch across 6/7 actives — the program's May 28–Jun 19
accrual true-up (daily payouts only began Jun 20). It is June income
paid in July, not a windfall
(measurements/rebate-payout-provenance.md).

Steady-state economics this window, EXCLUDING the anomaly:
trading −$7.1k/day + rebates +$2.6k/day ≈ **−$4.5k/day**. INCLUDING it,
the window nets ≈ +$40k. The wallet's headline "profit" is hostage to
bulk venue payouts — the sharpest example yet of A10/P51 (leaderboard
numbers must be decomposed) and of program risk as the meta's systemic
risk.

## Fingerprint

- Leg imbalance p50 **65.7%**, p90 100% — the loosest measured; far from
  archetype parity (0.1%), looser even than b55f (40%).
- Clips: p50 $4.56, p90 $34.67, p99 $384 — small base clips with a heavy
  size tail (archetype-like base, farmer-like tail).
- Buy prices: p5 0.08 / p25 0.28 / p50 0.50 / p75 0.71 / p95 0.99 —
  quotes the whole band including extreme longshots and near-certainties.
- Exits: 2,419 REDEEM vs 143 MERGE — hold-to-resolution dominant.
- REWARD/REFERRAL/YIELD: dust ($0.14 / $69.79 / 0).

## Is it gabagool-style?

Partially. The 15m sleeve behaves like the loose-parity current-era edge
expression (small clips, both sides, redeem exits). But the wallet's
CENTER is btc-5m taker-rebate farming plus discretionary punting.
Classify: **hybrid farmer-with-an-edge-sleeve**. For the lab, its 15m
sleeve is a third confirmation that btc-15m pays today; its 5m sleeve is
another data point that 5m at scale is only rational under rebates.
