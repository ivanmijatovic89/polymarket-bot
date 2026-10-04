---
title: Research SQL Schema
description: Parquet tables and offline SQL examples for wallet research.
---

# Research SQL schema

The SQL CLI opens these local views:

| View | Grain | Main fields |
| --- | --- | --- |
| `markets` | One condition | slug, condition_id, token_ids, outcomes, market_start/end, payouts, resolved |
| `trades` | One served trade occurrence | proxy_wallet, condition_id, token_id, timestamp, side, size, price, is_taker |
| `activities` | One served activity occurrence | trade identity fields, type, usdc_size |
| `positions` | Served position snapshot (OPEN/CLOSED may overlap) | current_size, realized_pnl, unrealized_pnl, total_pnl, entry_fees_usdc |
| `wallet_markets` | Trading wallet/condition | cash/economic PnL, rewards, API comparison, quality, issues, notes |
| `wallet_months` | Trading wallet/calendar month | market/trade counts, cohort_complete, incomplete_markets, monthly economic PnL |
| `coverage` | Scheduled market window | found, trade count, complete/unresolved/pending wallet counts |

`market_start`, `market_end` and activity/trade `timestamp` are epoch seconds.
Money and share quantities use `DECIMAL(38,6)`. Prices use `DECIMAL(38,18)`.
`payouts` contains micro-dollar amounts per share in outcome order.

The source fact tables preserve `raw_json` for fields not promoted to columns.
`row_index` identifies an occurrence within a day's source table and generation;
it is not a blockchain log index or a permanent global event ID. `is_taker` is
assigned by multiset matching against the separately downloaded taker feed.

## Compare monthly profitability

```sql
SELECT wallet, month, market_count, trade_count, economic_pnl_usdc
FROM wallet_months
WHERE month >= '2026-06' AND month <= '2026-09'
  AND cohort_complete AND incomplete_markets = 0
ORDER BY month, economic_pnl_usdc DESC;
```

## Find traders present in all four months

```sql
SELECT wallet, count(*) AS months, sum(economic_pnl_usdc) AS pnl_usdc,
       min(economic_pnl_usdc) AS weakest_month_usdc
FROM wallet_months
WHERE month BETWEEN '2026-06' AND '2026-09'
  AND cohort_complete AND incomplete_markets = 0
GROUP BY wallet
HAVING count(*) = 4
ORDER BY weakest_month_usdc DESC;
```

This selects traders with activity in every month. An absent row means no
observed trading for that wallet/month, not an unknown zero-valued PnL snapshot.
The coverage report must establish that the underlying month is present.

## Runnable research queries

Four SQL files in `docs/datasets/polymarket-research/sql/` support the initial
June–September workflow. Run them from the repository root with the permanent
data directory configured:

```bash
npm run research:sql -- --sql-file docs/datasets/polymarket-research/sql/monthly-rankings.sql
npm run research:sql -- --sql-file docs/datasets/polymarket-research/sql/monthly-population.sql
npm run research:sql -- --sql-file docs/datasets/polymarket-research/sql/june-candidates-across-months.sql
```

`monthly-rankings.sql` returns up to 20 eligible wallets for each month, with
found/expected windows and observed/unresolved wallet counts. An incomplete
month has a coverage row with null wallet, rank and PnL. A complete month can also
have no eligible wallets; inspect its population counts. Ranks use profit then
wallet address, so tied profits have a deterministic display order.

`monthly-population.sql` reports observed wallets, unresolved wallet/market
pairs, and the share of participant trade rows belonging to excluded wallets.
It counts every trade of an excluded wallet in that month, including its
reconciled markets. A small unresolved-pair count can therefore accompany a
large excluded-trade share. These are participant occurrences, not a count of
unique matched executions or a claim about unseen upstream data. Source-warning
markets are reported separately. Incomplete months retain their coverage flag;
their observed populations can grow as additional days arrive. A month with no
observed trades has a null exclusion percentage, not zero.

`june-candidates-across-months.sql` selects the June candidates once and follows
those same wallets through September. It retains later losses and distinguishes
an incomplete month, unresolved wallet accounting and no observed trading. An
absent trading record is not replaced with a made-up PnL of zero. An incomplete
June yields no candidates; inspect the monthly coverage query first.

This differs from selecting wallets that traded in all four months: it keeps
June candidates even if they subsequently stop trading. When investigating a
strategy, form hypotheses from the selection period and test them on later data;
using the later results to choose the June candidates would introduce hindsight.

Copy `wallet-market-profile.sql`, replace the wallet and dates in its `params`
CTE, then pass that file to `research:sql --sql-file`. It reports each market's
PnL, quality flags, maker/taker counts, execution prices and timing relative to
the market window. It keeps unresolved rows for diagnosis and includes full-range
coverage on every row. Raw trade-price VWAP is separate from fee-inclusive
activity cash. Execution prices and volumes are grouped by outcome inside each
market row; `token_ids` and `outcomes` give the corresponding names. Market PnL
appears once per row, so expanding outcome details requires care when aggregating.

Keep the `research:coverage` output and snapshot timestamps with these query
results. These files are reusable analyses, not evidence that the four-month
backfill has already completed.

## Inspect execution timing and trade role

```sql
SELECT m.slug, t.timestamp - m.market_start AS seconds_from_window_start,
       t.side, t.token_id, t.size, t.price, t.is_taker, t.transaction_hash
FROM trades t JOIN markets m USING (condition_id)
WHERE t.proxy_wallet = '0x...'
ORDER BY m.market_start, t.timestamp, t.row_index;
```

Negative offsets are legitimate pre-window trades. Same-second ordering is
source traversal order; it does not establish exact matching-engine chronology.

## Audit excluded results

```sql
SELECT wallet, slug, economic_pnl_usdc, api_position_pnl_usdc,
       api_pnl_difference_usdc, modeled_api_pnl_usdc, api_pnl_status, issues, notes
FROM wallet_markets
WHERE quality <> 'complete'
ORDER BY market_start, wallet;
```

Avoid summing only the good rows of an otherwise incomplete wallet. That can
exclude losses and produce a misleading ranking. Use the leaderboard command or
require all selected wallet/market rows to be complete.

## Source aggregate warnings

New market Parquet files include `source_warnings` (`VARCHAR[]`). A null or empty
list means no source warning was recorded for that snapshot; older snapshots
were published under the strict aggregate-match rule. The local dataset reader
adds an empty field when reading only older files. Use:

```sql
SELECT slug, source_warnings
FROM markets
WHERE coalesce(len(source_warnings), 0) > 0;
```

`corroborated_source_volume_disagreement` preserves an API aggregate mismatch
that passed the narrow repeat-feed and counterparty checks described in
[API limitations](./api-limitations). Its original and downloaded quantities
remain in `report.json` (`volume_checks`); repeated rows are in checksummed
`volume-evidence.json`. Coverage, leaderboard and wallet reports expose
`source_warnings` with the exact share difference. `verify` distinguishes
`all_source_aggregates_reconciled` from wallet accounting and file validity.
