---
title: Stored Data and SQL
description: What the Parquet files contain and how agents query them.
---

# Stored data and SQL

Each published day contains six Parquet tables. DuckDB opens them together as
views, so an agent can query a day, week, month or several months in one statement.
No separate database server is required.

| Table/view | What one row represents | Why it is stored |
| --- | --- | --- |
| `markets` | One market/condition | BTC/timeframe identity, window, outcomes, final payouts and resolution. |
| `trades` | One participant trade occurrence | Which wallet traded, when, what outcome, side, shares, price and maker/taker role. |
| `activities` | One wallet activity occurrence | Actual purchase/sale cash, splits, merges, redemptions and other served activity. |
| `positions` | One served wallet/market/outcome position snapshot | Polymarket's reported holdings, profit and fees at fetch time. |
| `wallet_markets` | One observed trading wallet in one market | Calculated cash, settlement value, profit, rewards and execution counts; internal audit fields also remain stored. |
| `coverage` | One scheduled market window | Whether the market was found and the recorded participant/trade counts. |
| `wallet_months` | One observed wallet in one calendar month | A calculated view: `wallet`, `month`, `market_count`, `trade_count`, `profit_usdc`. |
| `wallet_months_audit` | One observed wallet in one calendar month | Optional internal reconciliation and historical strict ranking fields. |

The last two are SQL views, not additional Parquet files. Daily and weekly totals
are ordinary queries over `wallet_markets`; they are not precomputed copies.

## What positions mean

A position identifies a wallet, market and outcome token. Typed fields include
`current_size`, `realized_pnl`, `unrealized_pnl`, `total_pnl` and `entry_fees_usdc`.
The original status and additional API fields remain in `raw_json`.

These are **snapshots**, not profit payments. Do not sum the same position across
refresh versions or add API position profit to calculated activity profit. OPEN
and CLOSED can overlap. The accounting layer handles their comparison while the
normal profit follows [activity cash plus final settlement value](./accounting).

## Types and identity

Market and activity times are Unix seconds. Money and share quantities use
`DECIMAL(38,6)`; prices use `DECIMAL(38,18)`. Payouts are micro-dollar amounts in
outcome order. Source tables retain original payloads in `raw_json`.

`row_index` distinguishes occurrences within a table and snapshot generation. It
is not a permanent event ID. A transaction can contain multiple identical-looking
fills; never deduplicate trades by transaction hash. `is_taker` comes from
multiset matching against the separate taker feed.

Prefer typed columns when scanning large ranges. Selecting and sorting every raw
JSON payload can consume much more memory than the small final result suggests.
Each query has a private DuckDB connection and spill directory.

## Monthly leaders

```sql
SELECT month, wallet, profit_usdc, market_count, trade_count
FROM wallet_months
WHERE month BETWEEN '2026-06' AND '2026-09'
QUALIFY row_number() OVER (
  PARTITION BY month ORDER BY profit_usdc DESC NULLS LAST, wallet
) <= 20
ORDER BY month, profit_usdc DESC NULLS LAST, wallet;
```

All observed wallets remain present. A full-calendar-month total is null until
its market coverage and final payouts are available. For month-to-date research,
use the leaderboard command with the available exclusive end date.

## Daily results

```sql
SELECT strftime(to_timestamp(market_start), '%Y-%m-%d') AS day, wallet,
  CASE WHEN count(*) FILTER (WHERE economic_pnl_usdc IS NULL) = 0
    THEN sum(economic_pnl_usdc) END AS profit_usdc,
  count(*) AS markets, sum(trade_count) AS trades
FROM wallet_markets
WHERE market_start >= epoch(DATE '2026-09-01')
  AND market_start < epoch(DATE '2026-10-01')
GROUP BY day, wallet
QUALIFY row_number() OVER (PARTITION BY day ORDER BY profit_usdc DESC NULLS LAST, wallet) <= 20
ORDER BY day, profit_usdc DESC NULLS LAST, wallet;
```

## Follow June's leaders through later months

Run `sql/june-candidates-across-months.sql`. It chooses wallets using June alone
and preserves their later results, including losses. No observed trading is left
null rather than replaced with invented zero profit. Do not use later outcomes
to choose June candidates when testing a strategy hypothesis.

`sql/wallet-market-profile.sql` provides per-market profit, outcome execution
prices, maker/taker counts and timing. Replace its example wallet and date range.
Market profit appears once per market; expanding outcome details must not multiply
that profit when aggregating.

## Inspect trade timing

```sql
SELECT m.slug, t.timestamp - m.market_start AS seconds_from_window_start,
  t.side, t.token_id, t.size, t.price, t.is_taker, t.transaction_hash
FROM trades t JOIN markets m USING(condition_id)
WHERE t.proxy_wallet = '0x...'
ORDER BY m.market_start, t.timestamp, t.row_index;
```

Negative offsets are legitimate pre-window trading. Within a second, the source
traversal order does not establish matching-engine chronology. Research data
cannot reveal canceled orders or reconstruct the historical orderbook.

## Maintenance fields

`quality`, `issues`, `notes`, API PnL comparisons and market `source_warnings`
remain stored for diagnosis and upgrades. They are not filters for ordinary
research. The [audit reference](./accounting-audit) and `audit-*.sql` examples
explain explicit diagnostic use. Normal result tables do not repeat these fields.
