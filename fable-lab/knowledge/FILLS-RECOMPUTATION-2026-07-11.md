# FILLS-RECOMPUTATION — independent check of every published fills.ts figure

_U75 (session 57), part of closing AUDIT-COVERAGE residue R5. Method mirrors
U71's battery recomputation: the published numbers are re-derived with raw
SQL aggregates over `backtest_run_markets` — NOT with fills.ts — then
fills.ts is re-run on the same runs as the separate transcription (C)
check. Outcome safety held throughout: the recomputation query touches only
`trade_as_maker` / `trade_as_taker` (+ `backtest_runs.params`/`batch_uid`
for cell binding); no PnL/outcome column was selected._

## Query (run 2026-07-11, one-off script in gitignored logs/)

```sql
SELECT run_id,
       COUNT(*) AS n,
       SUM(CASE WHEN trade_as_maker + trade_as_taker > 0 THEN 1 ELSE 0 END) AS filled_markets,
       SUM(trade_as_maker) AS maker_fills,
       SUM(trade_as_taker) AS taker_fills
FROM backtest_run_markets
WHERE run_id IN (337,338,339,340,341,352,353,355,356,357,358)
GROUP BY run_id ORDER BY run_id;
```

Cell binding for 337-340 read from `backtest_runs.params` (offset/jumpSize).

## Results vs published

| run | cell / context | recomputed (n, filled, maker fills) | published (unit) | match |
|-----|----------------|--------------------------------------|------------------|-------|
| 337 | E15 feasibility (0.01, 0.10) | 30, 12, 26 | 12/30 markets, 26 fills (U29) | YES |
| 338 | E15 feasibility (0.02, 0.10) | 30, 6, 11 | 6/30 (U29; fill total unpublished) | YES |
| 339 | E15 feasibility (0.03, 0.10) | 30, 3, 3 | 3/30 (U29) | YES |
| 340 | E15 feasibility (0.02, 0.05) | 30, 7, 17 | 7/30 (U29) | YES |
| 341 | EXP-007 smoke | 10, 4, 6 | 10 markets, 6 maker fills (U29) | YES |
| 352 | D18 pair, worst_queue | 8, 2, 5 | 2/8 markets, 5 maker fills (U35) | YES |
| 353 | D18 pair, touch | 8, 8, 19 | 8/8 markets, 19 maker fills (U35) | YES |
| 355 | EXP-008 smoke | 10, 8, 23 | 8/10 filled (U36; totals unpublished) | YES |
| 356 | EXP-009 smoke | 10, 8, 33 | 8/10 filled (U36) | YES |
| 357 | EXP-008 probe | 500, 392, 1324 | 392 played, 1324 maker fills (U38) | YES |
| 358 | EXP-009 probe | 500, 348, 1482 | 348 played, 1482 maker fills (U39) | YES |

`taker_fills` = 0 on all 11 runs (all are maker-side diagnostics/probes) —
consistent with every narrative.

Transcription check: `npx tsx fable-lab/tools/fills.ts 337 338 339 340 352
353 357 358` printed identical n/filledMarkets/makerFills/takerFills for
every run (same session, same DB state).

Static outcome-safety check (the tool's headline claim): fills.ts selects
exactly `backtestRuns.{id,params,batchUid}` and aggregate expressions over
`backtestRunMarkets.{tradeAsMaker,tradeAsTaker}` filtered by `runId` —
no PnL/outcome/win column appears anywhere in the file. One doc drift found
and fixed in the same unit: the header claimed `skip_reason` counts were
selected; they never were (comment corrected rather than widening the query
surface).
