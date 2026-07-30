# Evaluator — capital-aware units (DRAFT)

Status: DRAFT — units section written by PLAN `metrics-and-capital-units`
(2026-07-30). The full stage pipeline / promotion criteria / overfitting
guards land with PLAN `evaluator-design`. Everything in this file is
evidence-tagged and usable now.

## Scope guard (when these formulas are valid)

The unit formulas below rely on `backtest_run_markets.cost` being the total
invested capital. That equality holds **only** for strategies that:

1. never SELL (RULES rubric 1 — realized proceeds reduce stored basis),
2. never emit `split_positions` (`split_cost` must be 0),
3. never emit `merge_positions` in backtests (RULES backtest ban — a merge
   consumes shares and reduces basis mid-market).

Every pair-fable strategy satisfies all three by constitution. If a row shows
`split_cost != 0`, or a strategy variant sells, these formulas are WRONG for
it — recompute from `intent_meta` or reject the variant.

## Why cost == invested (verified, not assumed)

`Portfolio.applyFillToPosition` accumulates BUY cost basis as
`price*size + takerFeeUsdc` per fill (round2 per update) and nothing else
touches it for a no-sell strategy; backtest settlement is a pure valuation in
`computeMarketStats` — final positions are never mutated, so the stored
`cost` (= remaining cost basis at market end) is exactly the fee-inclusive
buy notional. [code src/trading/Portfolio.ts:672-692; src/backtest/stats/marketStats.ts:161-167,195 @ 1415c2b]

Empirical confirmation, multi-buy on BOTH sides incl. the WINNING side
(the case run 852 left open) — run 856 (pair-fable-probe-capital-v0,
3 markets, 22 taker fills, all outcomes UP, UP-heavy positions):

| slug (…-15m-) | avgUp×upSh + avgDn×dnSh | + fees_paid | stored cost | pnl check: merge+redeem−cost |
|---|---|---|---|---|
| 1775088000 | 0.4098×51 + 0.59×15 = 29.7498 | +1.11 = 30.8598 | 30.86 ✓ | 15+36−30.86 = 20.14 ✓ |
| 1775088900 | 0.4237×63 + 0.5533×15 = 34.9926 | +1.33 = 36.3226 | 36.32 ✓ | 15+48−36.32 = 26.68 ✓ |
| 1775089800 | 0.5775×71 + 0.51×15 = 48.6525 | +1.46 = 50.1125 | 50.11 ✓ | 15+56−50.11 = 20.89 ✓ |

Settlement of winning shares does NOT reduce cost. Losing-side case verified
earlier by run 852 (full basis retained, pnl −cost). [db run 856 | 2026-07-30]
Taker fee formula verified exactly: fee = (feeRateBps/10000)·p·(1−p)·size —
observed 0.07×0.60×0.40×56 = 0.9408 on a printed fill. [run 856 | 2026-07-30]

## The units (exact formulas over DB columns)

All from `backtest_run_markets` (m) joined on `run_id`; pnl is already net of
taker fees (never subtract fees_paid again — double count).

1. **invested(market)** = `m.cost`
   Fee-inclusive dollars actually deployed in that market.
2. **profitPer100(market)** = `100 * m.pnl / m.cost` (only where `m.cost > 0`)
   Return per $100 invested in that market.
3. **investedTotal(run)** = `SUM(m.cost)`
   **profitPer100(run)** = `100 * SUM(m.pnl) / SUM(m.cost)` (capital-weighted;
   report alongside the per-market distribution — median, p10/p90 — because a
   few big-notional markets can dominate the weighted number)
4. **evPerMarketTotal(run)** = `SUM(m.pnl) / COUNT(*)`
   The headline EV unit for this strategy. Matches
   `backtest_run_segments(kind='all').ev_per_market_total`. Use the TOTAL
   denominator, not Played: batchStats classifies pnl==0 markets as skipped,
   and a pair strategy that idles out a market produces exactly pnl==0 — the
   Played denominator would flatter selective variants.
5. **invested distribution** = `MAX(m.cost)`, `AVG(m.cost)` over `cost>0` rows
   — proxy for per-market capital requirement. NOTE live capital needs exceed
   this: capital stays locked from fill until merge/redeem settles on-chain,
   which can span market boundaries; treat max(cost) as a lower bound.
6. **EV at capital level C**: NOT derivable retroactively. There is no cash
   model — `INITIAL_CAPITAL` is pure reporting and never constrains fills
   [code + backtest-cli.md]. Capital levels must be encoded as strategy
   params (per-market stake cap in $ / max pairs), one run per level, then
   compared via units 3–4. Every pair-fable strategy MUST expose a per-market
   capital-cap param so the standard sweep is possible (binding convention;
   also listed in parity.md conventions).

SQL skeleton (single run):

```sql
SELECT COUNT(*) AS markets,
       SUM(pnl) AS pnl_total,
       SUM(pnl)/COUNT(*) AS ev_per_market_total,
       SUM(cost) AS invested_total,
       100*SUM(pnl)/NULLIF(SUM(cost),0) AS profit_per_100,
       MAX(cost) AS invested_max,
       AVG(NULLIF(cost,0)) AS invested_avg_played
FROM backtest_run_markets WHERE run_id = ?;
```

## intent_meta stamping convention (binding for pair-fable strategies)

Channel mechanics (verified run 856 + code): `Intent.meta` on each
`place_limit` / batch order is copied onto every fill of that order and
deduped to ONE entry per clientOrderId in `backtest_run_markets.intent_meta`
[code src/backtest/stats/marketStats.ts:169-178; src/backtest/runSingleMarket.ts:261-269 @ 1415c2b].
Run 856 market btc-updown-15m-1775088900: 8 fills from 7 orders (the crossing
GTC filled across 2 book levels) → exactly 7 meta entries, order-level data
intact. [db run 856 | 2026-07-30]

Rules:

1. Every order-placing intent carries `meta` with at least:
   `{ t: '<strategyShortTag>', i: <orderSeq>, side: 'UP'|'DOWN', ot: <orderType>, p: <limitPrice>, s: <intendedSize>, ts: <tick timestamp ms> }`
   (probe omitted `ts`; stamp it — timing analytics need it.)
2. One intent per order with a UNIQUE clientOrderId. Reusing a clientOrderId
   collapses meta entries (dedup is by clientOrderId).
3. `meta` records INTENT, not execution: run 856 market 1775089800's GTC had
   meta p=0.62 s=56 but filled at 0.60 (price improvement; fills execute at
   book level prices). Never compute invested from meta — use `cost`.
   Meta is for behavioral analytics: which increments fired, sides, order
   types, timing.
4. Partial fills at market end: meta `s` is intended size; actual acquired
   shares come from `up_shares`/`down_shares`. Meta sums are upper bounds.
5. Keep meta small (flat keys, short names): it is stored as JSON per market
   row and `export:trade-features` consumes it downstream.

## Open items for `evaluator-design`

- Stage pipeline (cheap screen → full universe → latency sweep → walk-forward
  via computeWalkForwardForRun) — not yet designed.
- Champion selection + portfolio criteria, overfitting guards, variant
  independence (daily-pnl correlation) — not yet designed.
- Capital-cap param sweep grid (which C levels) — decide with the baseline
  strategy's first real numbers.
