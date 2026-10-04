---
title: API Accounting Exceptions
description: Reproducible evidence for excluded wallet histories and the limits of additional V2 endpoints.
---

# API accounting exceptions

The downloader can finish and pass local integrity checks while some served
wallet histories remain inconsistent. `verify.valid` confirms the implemented
file and SQL checks; `all_wallet_accounting_complete` answers the separate
accounting question. An unresolved wallet is excluded from the strict leaderboard
for the entire selected cohort, including its otherwise complete markets.

The following evidence was inspected on October 4, 2026. It uses Data API V2 and
saved Parquet only. The contract reference is the
[official V2 OpenAPI document](https://data-api.polymarket.com/v2/openapi.json).
Context7 returned older V1 documentation for the holder lookup, so the V2 contract
and bounded live requests were used for that endpoint.

## Observed issue classes

These are overlapping wallet/market counts from accounting version 5. A row can
have several issues; adding the columns overcounts affected pairs. These three
sample days are not evidence of complete calendar months.

| Issue | June 1 | July 1 | August 1 | Meaning |
| --- | ---: | ---: | ---: | --- |
| `api_pnl_unreconciled` | 425 | 426 | 298 | Cash-based economics differs from native PnL beyond the supported explanations. |
| `missing_position_economics` | 76 | 56 | 29 | No position economics is available for this observed trading wallet/market. |
| `missing_position_snapshot` | 107 | 89 | 88 | An outcome requiring a position comparison has no served snapshot. |
| `position_balance_mismatch` | 260 | 29 | 1 | The activity-derived balance and served position disagree materially. |
| `unexplained_token_outflow` | 71 | 27 | 1 | Observed sells, merges or redemptions consume more tokens than the history acquired. |
| Distinct unresolved pairs | 732 | 492 | 347 | Each affected wallet/market counted once. |

The sample days have no trade/activity multiset mismatches. Agreement between the
two trade feeds cannot prove that all non-trade acquisitions, burns or transfers
were exposed. The evidence below distinguishes observations from possible causes.

## Winning holding disappears without a redemption row

Wallet `0x0b4c08cc6017119e98479629c17b1445c41f0f79`, condition
`0xde70ef2f4204289e0fcc54d22a5b0ed941334cf9d0eb9b859d73c7b83967f5e3`:

- The saved activity contains one BUY of `6.340908` winning shares for `5.626869`.
- The CLOSED position reports zero shares and native PnL `0.7140`.
- The local economic result is `0.714039` if those shares remain available for
  settlement, but there is no activity establishing their later disposition.
- A fresh activity request still returns just that BUY. A complete holder walk
  with `include_pnl=true` returns 121 holders and none for this wallet. An OPEN
  position request with `include_archived=true` and a one-micro-share floor is
  also empty.

A second one-BUY case, wallet `0x10e5900cf249c95c5e4912843b008059120e63c8`
on condition `0xd2a9e15d208a0e7adcfd093ac7b462e6f8a9756dc39068c926070585eefe2db8`,
has the same pattern: no matching holder among 153 served holders, no OPEN
position, and no additional activity. These checks do not tell us whether a
redemption or another disposition is missing. Matching approximate economic PnL
is insufficient to assert complete cash and inventory history.

## Acquisition or position economics is absent

Wallet `0x651f1e1bd1ef9736bdca24578bd06e8ca953e460`, condition
`0xa683556202289e88862297e4b1c44d49fb45a6ee54f7229d3ac52d761703266b`,
has SPLIT 40, SELL 20 for `18.4`, and MERGE 20, but no native positions. A fresh
walk returns the same three activities, no OPEN position and no matching holder
among 86 served holders. This market's remaining observed shares have zero
settlement value; the missing native economics is still explicitly unresolved.

For the same wallet on condition
`0xd2a9e15d208a0e7adcfd093ac7b462e6f8a9756dc39068c926070585eefe2db8`,
the saved history contains SELL 20, MERGE 20 and REDEEM 20 without an acquisition.
There is no defensible local purchase price to invent. An unexposed transfer or
missing source activity is a possible cause, not an established explanation.

## Large native PnL differences in SPLIT histories

Wallet `0x674887d1ac838099a48b629dff53f25b7b87ee08`, condition
`0xa87031a0326f50403887aa0f9e15574532d54271cd4c8c6f12eec857572bcc53`,
has 58 trades, one SPLIT and one REDEEM. Its served cash totals are:

```text
240.340200 sell + 83.161355 redeem - 172.276920 buy - 400 split
= -248.775365 USDC
```

The two CLOSED positions instead sum to `-5.684400`. Their `total_size` fields
match BUY quantities and omit the 400 shares minted per outcome. That observation
does not establish how the native ledger accounted for the SPLIT. The empirical
WAC replay gives `-248.772638`, so ordinary rounding does not reproduce native
PnL here. Two further inspected markets for this wallet have differences above
193 USDC. These histories remain unresolved; the pipeline neither replaces the
cash result with native PnL nor treats the difference as a fee adjustment.

## What the other V2 endpoints can establish

| Endpoint | Useful evidence | Why it does not repair these histories |
| --- | --- | --- |
| `/v2/holders?include_pnl=true` | Per-outcome gross holdings and position economics; both outcomes can appear. | A present-day snapshot has no missing transaction history. The three complete sample walks above recovered no missing holding. |
| `/v2/positions` | Remaining balances and native economics; wallet-scoped CLOSED recovers exited traders omitted by market-scoped queries. | Inactive markets can still be excluded; missing or contradictory source facts remain possible. |
| `/v2/user-pnl` and `/v2/user-stats` | Wallet-wide native PnL and profile statistics. | Neither accepts the arbitrary BTC 15-minute condition cohort needed to isolate these months. |
| `/v2/leaderboard` | Existing category/time-period rankings. | Its rolling windows and accounting definition differ from a chosen historical market-start cohort; it is not a June BTC 15-minute reconciliation source. |
| `/v2/biggest-winners` | Large individual winning positions. | It omits the complete loss history needed for wallet rankings and selects by resolution window. |

Holder pagination uses offset positions inside its cursor. Merge token groups by
`token_id`; exhausted groups disappear from later pages. A changing holder table
is not a frozen historical transaction snapshot. The bounded probes used stable,
resolved markets, preserved every original filter and followed each cursor to
completion.

## Reproduce the local audit

Run these queries through `research:sql --sql-file ...` against the saved root.
They make no API requests. Always pair the output with `research:coverage` and
the selected snapshot timestamps.

```sql
SELECT strftime(to_timestamp(market_start), '%Y-%m-%d') AS day,
       u.issue, count(*) AS affected_pairs,
       count(DISTINCT wallet) AS affected_wallets
FROM wallet_markets, unnest(issues) AS u(issue)
GROUP BY day, u.issue
ORDER BY day, u.issue;
```

```sql
SELECT wallet, condition_id, slug, trade_count, activity_count,
       buy_usdc, sell_usdc, split_usdc, merge_usdc, redeem_usdc,
       cash_pnl_usdc, unredeemed_value_usdc, economic_pnl_usdc,
       api_position_pnl_usdc, api_pnl_difference_usdc,
       modeled_api_pnl_usdc, issues, notes
FROM wallet_markets
WHERE quality <> 'complete'
ORDER BY abs(api_pnl_difference_usdc) DESC NULLS LAST
LIMIT 25;
```

Filter `activities` and `positions` by both `proxy_wallet` and `condition_id` to
inspect an individual case. `raw_json` retains fields such as native cost basis
and source event timestamps. A source refresh may recover corrected rows; an
offline rebuild can only reevaluate the facts already saved. Neither operation
is evidence that a discrepancy has disappeared until its checks pass again.
