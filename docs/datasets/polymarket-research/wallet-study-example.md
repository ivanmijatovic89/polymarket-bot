---
title: Local Wallet Study Example
description: A reproducible first-week BTC 15-minute wallet study using saved Parquet only.
---


> Historical evidence: the studies below used the original strict audit population.
> Normal research now includes all observed wallets. See the [current overview](./overview)
> and [profit calculation](./accounting); use `--strict` and `audit-*.sql` only to
> reproduce the earlier reconciliation-based selections.

# Local wallet study example

This example investigates wallet
`0xeebde7a0e019a63e6b476eb425505b7b3e6eba30` in BTC 15-minute markets starting
from June 1 through June 7, 2026, UTC. It uses complete coverage of those seven
days and each selected market's observed lifecycle, including redemption after
the period. The [complete June study](./monthly-wallet-study) now provides a
separate monthly ranking and two investigations selected from that ranking.
The [four-month follow-up](./monthly-wallet-study) and
[full-range verification](./completion-evidence) are now complete, with
unresolved wallet histories reported explicitly.

The wallet was selected because an accounting correction made its active weekly
cohort eligible for research. Selection did not use a profitable monthly ranking.
All queries below ran against local Parquet, with no API requests.

## Coverage and economic result

All 672 scheduled market windows are present. The wallet traded in 618 of them,
and all 618 wallet/market histories pass the current accounting checks. The 54
other windows have no observed trades for this wallet; they are not catalog gaps.
Accounting version 6 explains a terminal merge's native rounding difference
without changing exact cash. The [accounting guide](./accounting) describes the
conditions for that explanation.

| Measure | Result |
| --- | ---: |
| Trade occurrences | 148,234 |
| Purchase cash | 1,840,478.750855 USDC |
| Sale cash | 0 USDC |
| Merge proceeds | 5,399.712112 USDC |
| Redemption proceeds | 1,833,579.676074 USDC |
| Remaining settlement value | 0 USDC |
| Attributable rewards | 0 USDC |
| Net economic PnL | **-1,499.362669 USDC** |
| Native API PnL | -1,438.061000 USDC |

The exact cash identity is:

```text
5,399.712112 + 1,833,579.676074 - 1,840,478.750855
= -1,499.362669 USDC
```

Purchase cash is turnover; this dataset does not establish capital employed.
The last recorded redemption for the cohort occurred on June 8 at 00:00:46 UTC
and remains attributed to its June 7 market. Native API PnL is retained separately
because its cost accounting can differ from exact served cash.

Daily PnL below is rounded to cents; the saved JSON retains six decimals.

| Market-start day | Markets traded | Trade rows | Economic PnL, USDC |
| --- | ---: | ---: | ---: |
| June 1 | 96 | 21,818 | 1,228.84 |
| June 2 | 96 | 26,683 | -804.39 |
| June 3 | 51 | 15,638 | 509.12 |
| June 4 | 96 | 31,485 | -879.01 |
| June 5 | 87 | 9,008 | -1,348.19 |
| June 6 | 96 | 22,341 | -805.38 |
| June 7 | 96 | 21,261 | 599.65 |

The wallet had 267 profitable and 351 losing markets. Its best market made
1,158.171714 USDC and its worst lost 1,528.646240 USDC. High activity alone did
not translate into a profitable week.

## Observed execution pattern

- Every trade occurrence is a BUY. There are two MERGE activities and 629
  redemption activities, with no observed sales or splits in this cohort.
- The wallet bought both outcomes in 599 of 618 traded markets (96.9%).
- Taker executions account for 90,692 rows (61.2%) and 72.7% of bought shares.
  Maker executions account for 57,542 rows; no trade role is unknown.
- Median fill size is 10 shares; the median market has 238.5 fill occurrences.
- The median first execution is four seconds after window start; the earliest
  first execution is two seconds after start. Median last execution is at
  832 seconds. There are 329 executions after the nominal 900-second window,
  with a maximum offset of 1,023 seconds.
- Among markets with purchases of both outcomes, the median smaller-to-larger
  quantity ratio is about 0.503. Exposure is often substantially unequal.

For each market with both outcomes, summing the two fee-inclusive average
purchase costs gives a descriptive cost per matched pair. Its median is about
1.0358 USDC; 236 markets are below 1 USDC and 363 are at least 1 USDC. These
averages combine executions across the entire lifecycle. They do not establish
simultaneous executable prices or a risk-free entry opportunity.

## Strategy hypothesis and next tests

The observed pattern supports a hypothesis of repeated accumulation with uneven
outcome exposure, followed by settlement. The regular entry timing suggests a
repeatable process. The data does not identify its decision rule, quote placement,
canceled orders or external price signals. Predominantly taking liquidity also
limits the evidence for describing this as passive market making.

To investigate the hypothesis, compare sizing and outcome exposure with the
contemporaneous market state, measure how exposure changes during each window,
and test proposed rules on later periods chosen before examining their results.
Orderbook-dependent rules require the corresponding tick data. Full-month
candidate selection and June-to-September comparisons must wait for complete
calendar coverage and retain later losses and unresolved histories.

## Reproduce and audit

Use `research:coverage` for `--from 2026-06-01 --to 2026-06-08`, then copy
`sql/audit-wallet-market-profile.sql` from this documentation directory and set its
wallet and dates to this study's scope. The
[SQL guide](./schema#runnable-research-queries) explains the command and
outcome-level fields.

The permanent dataset contains the exact SQL, results and generation metadata in
`logs/pilot-wallet-study-20260601-20260608/`:

- `summary.sql`, `daily.sql`, `activity-types.sql`, `outcome-balance.sql` and
  `profile.sql`, with corresponding JSON results;
- `coverage.json` and `snapshots.json`, recording the seven market-start days;
- `validation.json`, containing SQL hashes and checks of unique markets, trade
  counts, maker/taker totals, outcome totals and exact cash identities.

The independent profile, daily and activity-type totals all reconcile to the
same exact PnL. Source snapshots were observed on October 4, 2026 and retain their
original timestamps through the offline accounting rebuild. These observations
describe this wallet's selected week. They do not establish this wallet's
eligibility in a longer cohort; its complete-June history includes unresolved
markets. Longer-period strategy conclusions require the corresponding data and research.
