---
title: Profit Calculations
description: One consistent profit definition for daily, weekly and monthly wallet research.
---

# Profit calculations

The normal `profit_usdc` result is the calculated profit from **all downloaded
market histories belonging to the requested period**. All observed trading
wallets participate. A diagnostic disagreement with Polymarket's reported profit
does not remove a wallet or any of its market rows.

## Select the markets first

A June BTC 15-minute query selects markets whose 15-minute window starts in June,
in UTC. It includes trading before each window and downloaded activity after it,
such as a July redemption of a June position. Gamma's listing creation time does
not decide which month a market belongs to.

Daily, weekly and monthly analyses apply exactly the same rule. A leaderboard
requires the requested days and market windows to have been downloaded. It does
not silently present half a downloaded month as a complete month.

## Calculate each wallet's market profit

```text
cash profit = sales + merges + redemptions - purchases - splits
profit = cash profit + remaining shares valued at the final market payout
```

For example: buying winning shares for 40 USDC that ultimately pay 100 USDC gives
60 USDC profit. Before redemption, the 100 is remaining settlement value. After
redemption, it is cash. It is counted once either way, so delaying redemption
alone does not move the wallet down the leaderboard.

A split spends collateral to create both outcomes. A merge returns collateral
by consuming both outcomes. Both belong in the cash calculation. Trade cash comes
from activity `usdc_size`, which already includes the observed trade fee; fees
must not be deducted a second time. Trades separately identify participants and
executions and are not counted as a second cash payment.

Amounts use exact integer millionths during calculations and decimal columns in
Parquet. Rewards and rebates are stored separately and are not added to the
normal profit ranking. Wallet deposits and withdrawals are not trading profit.

## Add the selected markets

The normal leaderboard sums each wallet's calculated market profits, counts its
markets and sums its participant trade occurrences. It includes losing markets
and markets with retained diagnostic differences. Never filter out individual
losing or flagged rows before summing a wallet's result.

A final payout is needed to calculate settlement value. If a selected market has
not resolved, the wallet remains present but its final profit is `null`, rather
than an invented zero or a partial total. Such rows sort after numeric profits.

`wallet_months.profit_usdc` uses the same rule and requires the complete calendar
month. For a current month-to-date result, use `research:leaderboard` with the
first day of the month and today's UTC date as the exclusive end.

## Positions and the API's reported profit

Positions are Polymarket's reported holdings and profit **for one wallet, market
and outcome at fetch time**. OPEN and CLOSED records help check the history and
explain balances. They are not daily profits to add together. OPEN and CLOSED can
overlap, and a refreshed position replaces the earlier daily generation rather
than becoming an extra payment.

The normal profit is calculated from activity cash and final payouts. It is not
replaced by Polymarket's `total_pnl`. Both the reported value and comparison remain
stored for maintenance. The API can return rounded or inconsistent records; the
system preserves what it received without fabricating missing events. Detailed
rules and investigation evidence live in the [audit reference](./accounting-audit).

## When is a month available?

A full-month query is available after the last day has downloaded, usually after
the next nightly run. The last seven complete days are refreshed on following
nights, so recent activity and source updates continue to arrive. Allow roughly
a week after month end for that routine refresh window; it is not a guarantee
that the API will never issue a later correction. An explicit older-range refresh
can collect later changes. There is no mandatory five-day monthly waiting job.
