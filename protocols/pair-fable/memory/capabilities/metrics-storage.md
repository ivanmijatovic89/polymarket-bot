# Capability: metrics & result storage

verified: 2026-07-30 @ 1415c2b (code-survey + initializer spot-check of the settlement formula; storage layout RUN-VERIFIED via run 852; cost==invested + intent_meta channel RUN-VERIFIED via run 856 — see below)

## Run-verified (2026-07-30, run 856: pair-fable-probe-capital-v0, 3 markets, multi-buy both sides, 22 taker fills, winning-side settlement)

- **cost == invested CONFIRMED for no-sell strategies, winning side included**: on all 3 markets `cost` = Σ(buy price·size) + Σ(taker fees) to the cent (e.g. 0.4098×51 + 0.59×15 + 1.11 = 30.86 stored), and `pnl = mergable + remainingWinner − cost` exactly. Settlement never mutates the Portfolio — winning shares do NOT reduce stored basis. Full arithmetic table in memory/process/evaluator.md. [db run 856 | 2026-07-30]
- **intent_meta dedup verified**: market btc-updown-15m-1775088900 had 8 fills from 7 orders (crossing GTC consumed 2 ask levels → 2 TAKER fills, one per level, code BacktestExecution.buildFillsFromBook:116-167) and stored exactly 7 meta entries — one per clientOrderId, order-level data intact. [db run 856 | 2026-07-30]
- **meta records intent, not execution**: a GTC with meta p=0.62 s=56 filled at 0.60 (crossing orders fill at book level prices — price improvement is real in the sim). Invested must come from `cost`, never from meta sums. [db run 856 + run log | 2026-07-30]
- **Taker fee formula verified exactly**: fee = (feeRateBps/10000)·p·(1−p)·size; observed 0.07×0.60×0.40×56 = 0.9408 on a printed fill; feeRateBps hardcoded 700 in backtest. [run 856 | 2026-07-30]
- FOK with a +0.02 crossing buffer fills at the actual ask (not the limit), tolerating book drift across the 140ms simulated latency — all 18 FOK probes filled. [run 856 | 2026-07-30]

## Run-verified (2026-07-30, run 852: BuyLowPrice.v1, 5 markets, 1 maker BUY 10sh@0.10 each, all on the losing side)

- Column names as stored: `final_outcome`, `trade_count`, `trade_as_maker/taker`, `fees_paid`, `up_shares/down_shares/mergable_shares`, `cost`, `avg_entry_price_up/down`, `intent_meta`, `machine_id`, `commit_sha`. (`backtest_runs` has NO machine_id — that column is per-market only.) [db run 852 | 2026-07-30]
- `cost` = buy notional for a no-sell no-settlement-consumed position: 10 sh × 0.10 = 1.0000 stored, pnl −1.0000 (full loss of basis), fees 0 (maker). cost==invested now CONFIRMED for the multi-buy + winning-side case too — see run 856 section above. [db run 852 | 2026-07-30]
- `intent_meta` is `[]` (not NULL) when the strategy attaches no `Intent.meta`. Per-order analytics require the strategy to stamp meta explicitly. [db run 852 | 2026-07-30]
- `avg_entry_price_*` is NULL for the side never bought (not 0). [db run 852 | 2026-07-30]
- Segment rows for small runs: all/daily/weekly/monthly only; last_n starts at ≥500 markets. Numbers matched the printed BATCH STATS exactly. [db run 852 | 2026-07-30]

## Where results live

- `backtest_runs`: identity/provenance ONLY (strategy, params JSON, protocol, model, cmd, capital_initial, status, counts). **Zero performance columns** — run-level stats live in `backtest_run_segments` where `segment_kind='all' AND segment_key='all'`. [code src/db/schema.ts:89-157]
- `backtest_run_markets` (one row per market): pnl(2dp), trade_count, trade_as_maker, trade_as_taker, fees_paid, avg_entry_price_up/down (buy-VWAP over ALL buys), up_shares/down_shares/mergable_shares (FINAL holdings), cost (= REMAINING cost basis incl. capitalized taker fees), split_cost, intent_meta JSON, machine_id, commit_sha, durations, events. UNIQUE(run_id,idx), UNIQUE(run_id,slug). [code src/db/schema.ts:159-221]
- `backtest_run_segments`: BatchStats per bucket — kinds all / last_n (500/1000/3000/6000) / daily / weekly / monthly. Every bucket uses the SAME capitalInitial (isolated windows, not chained). [code src/backtest/stats/backtestSegments.ts:24-51]
- **Individual fills are NEVER persisted.** They exist in memory during replay and reduce to aggregates. The only per-order artifact is `intent_meta` — strategy-supplied `Intent.meta`, deduped per clientOrderId (one entry per order even with 5 partial fills). ⇒ **A strategy that wants per-order analytics must stamp them into `meta` itself** — this is the designed channel (export:trade-features builds ML features exclusively from it). [code src/backtest/stats/marketStats.ts:169-178; src/cli/research/export-trade-features.ts]

## Per-market PnL (settlement)

`pnl = realizedPnl(sells) + min(upShares,downShares)*$1 + remainingWinnerShares*$1 − remainingCostBasis − splitCost`, rounded 2dp. Settlement values held pairs at $1/pair automatically — **no merge intent needed for the edge to be booked** (this is why RULES bans merge_positions in backtests). PnL is already NET of taker fees (BUY fee capitalized into costBasis, SELL fee off proceeds); `fees_paid` is informational — subtracting it again double-counts. [code src/backtest/stats/marketStats.ts:139-167 — spot-checked; src/trading/Portfolio.ts:665-714]

## Batch stats (per segment row)

capitalInitial/Final, pnlTotal, totalFeesPaid, qualitySystem/qualityTrade (mean/std of pnls; null when std==0 or |ratio|>1e8), evPerMarketPlayed, evPerMarketTotal, markets{Total,Skipped,NoInWindowActivity,FlatWithTrades,Played,Won,Lost}, winRate, trades{Total,Maker,Taker}, pnlAvg/Max Win/Lose, streaks, durations. **Classification is by pnl SIGN**: pnl==0 ⇒ counted skipped even with trades (marketsFlatWithTrades is the tell) — win-rate and evPerMarketPlayed denominators exclude flat markets; for a pair strategy whose idle markets are flat, `evPerMarketTotal` is the honest EV unit. [code src/backtest/stats/batchStats.ts:162-343]

## Capital-aware units — derivability from stored data

- Fee totals: derivable now. Maker/taker fill COUNT split: derivable now.
- **Invested per market / profit per $100 invested: for pair-fable (no-sell, no-split, no-merge) strategies these ARE derivable — `cost` IS fee-inclusive invested capital** (verified run 856, winning side included; formulas + scope guard in memory/process/evaluator.md). For general strategies (anything that sells/splits/merges) they remain NOT derivable: buy notional is computed inside computeMarketStats and discarded → PROPOSALS P-002 (sharpened with exact columns). Meta sums are NOT a substitute for invested (intent ≠ execution — price improvement, partial fills).
- EV at several capital levels: impossible retroactively — no cash model exists (capital never constrains fills); "capital level" must be encoded in strategy params (per-market stake caps) and swept, not derived after the fact.
- Walk-forward: `computeWalkForwardForRun` (wfMeanEv, minEv, tail metrics, stabilityPass gate) is pure recomputation from segments — exists, not stored; reusable by our evaluator. [code src/backtest/stats/walkForwardRank.ts:22-153]

## Gotchas

- `market_start_ms` on market rows comes from slugTs(slug) unconditionally (schema comment claims telonex source — equivalent today).
- Zero-activity markets ARE persisted (skipReason `no_in_window_activity`) to keep denominators stable; unresolved-outcome markets are NOT market rows (surface as failures/skips).
- Latency used by a run is NOT reliably recoverable from DB (see backtest-cli.md; env-sourced latency leaves no trace).
- Stats collection reads `portfolio.recentFills`, a rolling buffer capped at 500 (Portfolio.ts:85-101,610-612), drained per tick by runSingleMarket (247-269). If >500 fills landed within ONE tick cascade the oldest would be evicted before collection and silently missing from stats. Implausible for pair-fable's small-increment style; re-check only if a variant ever emits hundreds of orders per tick. [code @ 1415c2b]
