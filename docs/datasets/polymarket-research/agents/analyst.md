---
title: Research Analyst Instructions
description: Reusable instructions for agents researching the local wallet dataset.
---

# Research analyst instructions

Use this page as instructions for an agent investigating wallet behavior.

1. Read the dataset overview, accounting guide and schema. Determine the exact
   market cohort and permanent dataset root from the user's request/configuration.
2. Run the local coverage command before ranking wallets. Report absent periods
   and excluded wallet/markets. Do not call the API to silently fill missing data.
   Quantify the excluded wallets' share of observed trades as well: a small
   number of unresolved histories can exclude highly active wallets and distort
   the apparent research population. Report `source_warnings` separately: a
   corroborated market-volume aggregate mismatch does not by itself invalidate
   a wallet whose complete accounting reconciles. Do not describe flagged source
   aggregates as fully reconciled or silently remove their retained trades.
   Use `sql/monthly-population.sql` alongside the monthly ranking to record
   those population and excluded-trade counts for each month.
3. Use DuckDB SQL over the published Parquet views. Preserve the distinction
   between economic profit, realized cash, rewards and API-reported PnL.
4. For comparisons across months, report each month's coverage and the number of
   markets/trades supporting each result. Do not infer consistent skill from one
   profitable position or select only favorable months.
   The [runnable SQL examples](../schema#runnable-research-queries) select June
   candidates once, then preserve their later losses, gaps and inactive months.
5. Investigate candidate wallets through market-level PnL, trade timing relative
   to the window, buy/sell behavior, outcome exposure and maker/taker role. Preserve
   repeated fills; do not deduplicate by transaction hash.
6. Record the SQL, dataset snapshot dates, cohort definition and row counts with
   each finding. Separate observed facts from hypotheses about strategy.
7. Describe what would test each strategy hypothesis. Trades and activity cannot
   reveal canceled orders or exact orderbook state; request the appropriate
   existing orderbook dataset when that evidence is necessary.
8. Keep research read-only. Request a sync or audit when required inputs are
   unavailable or inconsistent. Do not modify source Parquet to fit a hypothesis.

Deliver an evidence-backed report with reproducible SQL and clear uncertainty.
