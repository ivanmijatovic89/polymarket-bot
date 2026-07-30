# Capability: metrics & result storage

verified: 2026-07-30 @ 4fde3ae (code-survey + initializer spot-check of the settlement formula; NOT yet run-verified)

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
- **Invested per market / profit per $100 invested: NOT derivable from stored columns.** Buy notional (totalUp/DownBuyCost) is computed inside computeMarketStats and discarded; `cost` is remaining basis, not invested; avgEntryPrice×shares ≠ invested for anything that sells/merges. Two paths: (a) engine persists buy notional (→ PROPOSALS P-002), (b) strategy stamps price/size/side into `intent_meta` and our evaluator sums it — works today, protocol-side only. For a no-sell strategy (RULES rubric 1), invested ≈ cost + what settlement consumed... NO: with no sells, remainingCostBasis at end IS total invested (incl. taker fees) — so for pair-fable strategies `cost` ≈ invested per market. Verify empirically in PLAN `metrics-and-capital-units` before relying on it.
- EV at several capital levels: impossible retroactively — no cash model exists (capital never constrains fills); "capital level" must be encoded in strategy params (per-market stake caps) and swept, not derived after the fact.
- Walk-forward: `computeWalkForwardForRun` (wfMeanEv, minEv, tail metrics, stabilityPass gate) is pure recomputation from segments — exists, not stored; reusable by our evaluator. [code src/backtest/stats/walkForwardRank.ts:22-153]

## Gotchas

- `market_start_ms` on market rows comes from slugTs(slug) unconditionally (schema comment claims telonex source — equivalent today).
- Zero-activity markets ARE persisted (skipReason `no_in_window_activity`) to keep denominators stable; unresolved-outcome markets are NOT market rows (surface as failures/skips).
- Latency used by a run is NOT reliably recoverable from DB (see backtest-cli.md; env-sourced latency leaves no trace).
