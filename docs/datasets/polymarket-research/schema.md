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
