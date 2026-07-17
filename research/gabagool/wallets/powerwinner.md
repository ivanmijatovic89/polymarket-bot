# @powerwinner — the taker-rebate farmer

Address: `0xf3531b23b504cf0aed4ff21325232b2a2d496685` **[verified]**
(profile-page dominant-address; lb-api rows present; seen live in the
global trade tape 2026-07-17).

Data: `data/activity-powerwinner-jul.jsonl` — 12,476 rows, complete
window 2026-07-14T00:00Z → 2026-07-16T00:00Z.

## Snapshot (lb-api 2026-07-17)

All-time +$247,119; 30d +$122,773 (the HOTTEST 30d of all tracked
wallets) on $13.6M volume (0.90%); 1d +$7,291.

## Measured fingerprint (Jul 14–16)

- **Trades ONLY btc-updown-5m.** 11,884 fills, ALL BUYs (0 sells), $982k
  bought in 2 days. No merges; 588 REDEEMs. Clip p50 **$83.93** (p99
  $158, max $175 — tight, machine-like ladder), buy price band centered
  0.50 (p25 0.32, p75 0.67).
- **Trading cash flow: NEGATIVE.** Complete markets (n=539 of ~576
  windows): net −$7,495, mean **−$13.90/market**, win 43.6%.
- **TAKER_REBATE: $6,155.75 + $6,063.43 = $12,219 / 2 days
  (~$6,110/day)**, paid ~00:10 UTC. Zero MAKER_REBATE. Also 2 `YIELD`
  events (new type — pUSD holding yield, small).
- Net ≈ **+$2,363/day = rebates − trading losses.**

## Interpretation

A pure **taker-rebate farmer**: deliberately crosses spreads on both
sides of the highest-weight book (crypto 2.3× tier weight; 5m = max
turnover per dollar per hour), eats ~−$14/market of spread+fees, and
recoups via the top-tier 50% taker-fee refund + tier bonuses. The
strategy is only possible at Obsidian-tier volume — and only since
2026-05-28 (program launch). His 30d lb profit ($122.8k) vs measured
−$3.7k/day trading implies the leaderboard "profit" INCLUDES rebate
transfers or his July window is unrepresentative — treat lb figures for
rebate-era wallets as decomposition-required (extends PRIORS P51).

Contrast with the concept: this is NOT gabagool-style edge — it is
subsidy extraction wearing the same both-sides costume. For the
cross-wallet synthesis: the "~$18.5k/day ecosystem" number mixes at
least three income mechanisms (trading edge, maker rebates, taker
rebates); per-wallet decomposition is mandatory before calling anything
"the strategy still prints".

## Leg balance (answered)

Per-market |up−down|/max leg imbalance: p50 7.7%, p90 20.0% — loosely
pair-shaped, far from the archetype's 0.1% parity. Worst markets −$362.
The buy band centers on p=0.50, which is where fee = 0.07·p(1−p) peaks —
i.e., where each dollar of churn manufactures the MOST weighted volume
for the rebate tier. The trading loss is the manufacturing cost of
subsidy volume, not a failed edge.

## Open
- YIELD event mechanics (holding rewards program).
- Whether his volume alone moves the btc-5m books (he IS ~10% of that
  tape some hours).
