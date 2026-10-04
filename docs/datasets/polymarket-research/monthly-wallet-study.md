---
title: Monthly Wallet Research
description: Complete-June wallet rankings and reproducible local strategy investigations.
---

# Monthly wallet research

The June 2026 BTC 15-minute cohort is complete: all 30 UTC market-start days and
2,880 scheduled windows are published and independently verified. The results
below were calculated locally from Parquet on October 4, 2026, using each selected
market's full observed lifecycle. July–September ingestion and the later-month
comparison remain in progress.

## Population and ranking limits

The cohort contains 12,240,106 participant trade rows and 30,091 observed wallets.
There are 10,826 unresolved wallet/market pairs among 1,629,489 observed pairs.
Strict whole-wallet exclusion removes 2,274 wallets (7.6%) from the June ranking.
Those wallets account for 6,127,405 trade rows, **50.1% of observed trading rows**.
Their facts remain in Parquet and can be queried with their quality flags.

The ranking therefore describes 27,817 reconciled wallets. It cannot establish
the best performer among every observed wallet. The six corroborated market
volume warnings are reported separately and do not themselves exclude wallets.
The [API exception guide](./api-limitations) explains the unresolved accounting
classes and the source-warning evidence rule.

The first five eligible June ranks are:

| Rank | Wallet | Markets | Trade rows | Economic PnL, USDC |
| ---: | --- | ---: | ---: | ---: |
| 1 | `0x7e5d2991c2647de2348287e2f499329fc6a6c4c3` | 2,772 | 288,018 | 54,166.546621 |
| 2 | `0x565ca59275f81991bd9877d7fa8404c5ecf6519e` | 8 | 293 | 49,414.538956 |
| 3 | `0x19cdff29af22829f92fc9a1805d71c00165edd44` | 5 | 214 | 37,113.781452 |
| 4 | `0x912a58103662ebe2e30328a305bc33131eca0f92` | 2,270 | 26,813 | 13,000.997558 |
| 5 | `0xee65685de42f8de9a03b4c53ee77d56a20d2cfc9` | 1,711 | 11,880 | 12,845.819382 |

Rank 4 includes 358.407662 USDC of settled but unredeemed value; its cash result
is 12,642.589896 USDC. This illustrates why ranking only redemption cash would
change the profit definition. Ranks 2 and 3 have very few traded markets, so
their large dollar profits provide limited evidence about repeatable behavior.

## Selection made before complete June was available

The saved selection plan chooses June's eligible profit leader and, separately,
the wallet with the most traded markets among ranks 2–20, breaking ties by trade
count and then address. It was recorded while June was incomplete. Subsequent
July–September outcomes were not used to choose these wallets.

The two selected wallets are:

- Profit leader: `0x7e5d2991c2647de2348287e2f499329fc6a6c4c3`, June rank 1.
- Active candidate: `0x424eb20fcd25113e3b98f42522a54580350b263b`, June rank 11.

## Cash and market results

Every observed trade for both wallets is a BUY. Their other served activities
are redemptions; there are no observed sales, splits, merges or attributable
rewards. Both have zero remaining settlement value in this snapshot.

| Measure | Profit leader | Active candidate |
| --- | ---: | ---: |
| Markets traded | 2,772 | 2,795 |
| Trade rows | 288,018 | 95,368 |
| Purchase cash, USDC | 3,297,064.842169 | 563,526.957045 |
| Redemption cash, USDC | 3,351,231.388790 | 571,914.497584 |
| **Economic PnL, USDC** | **54,166.546621** | **8,387.540539** |
| Native API PnL, USDC | 54,296.163800 | 8,394.820900 |
| Profitable / losing markets | 1,502 / 1,270 | 1,594 / 1,201 |
| Profitable days out of 30 | 20 | 23 |
| Best market, USDC | 4,435.545553 | 438.504113 |
| Worst market, USDC | -4,855.546855 | -433.525846 |
| Five largest wins / gross positive market profit | 4.69% | 3.15% |

The cash identities are exact:

```text
3,351,231.388790 - 3,297,064.842169 = 54,166.546621 USDC
  571,914.497584 -   563,526.957045 =  8,387.540539 USDC
```

Purchase cash measures turnover, not capital employed. Native PnL is kept
separate from the cash result under the [accounting rules](./accounting).
The concentration percentages use gross positive market profit as their
denominator, before offsetting losing markets.

The leader's best day was June 4 (+8,469.987243 USDC); its worst was June 10
(-4,486.301082). The active candidate's best was also June 4 (+1,546.817359),
and its worst was June 9 (-618.891657). The saved daily results retain all losses.

## Execution and exposure patterns

| Measure | Profit leader | Active candidate |
| --- | ---: | ---: |
| Maker trade rows | 235,781 (81.9%) | 95,368 (100%) |
| Taker trade rows | 52,237 | 0 |
| Unknown trade roles | 0 | 0 |
| Markets with purchases of both outcomes | 2,735 (98.7%) | 2,594 (92.8%) |
| Median fill size, shares | 10.32 | 8.5 |
| Median fills per market | 89 | 27 |
| Median first execution after window start | 7 seconds | 32 seconds |
| Median last execution after window start | 765 seconds | 754 seconds |
| Executions before the window | 0 | 0 |
| Executions at or after the nominal window end | 2 | 1 |
| Median smaller/larger outcome purchase quantity | 0.6661 | 0.5638 |
| Median combined fee-inclusive average cost per pair | 1.0520 USDC | 1.0991 USDC |

For the leader, maker executions represent 71.6% of purchased shares, so its
taker fills are larger on average than its maker fills. Its last observed
execution offset is 910 seconds; the active candidate's is 900 seconds.
Timestamp and source-row order do not establish exact within-second chronology.

The pair-cost measure sums the two outcome-specific average purchase costs over
an entire market lifecycle. Among markets with both outcomes, it is below 1 USDC
in 969 leader markets and 428 active-candidate markets. The other 1,766 and
2,166 markets have pair averages of at least 1 USDC. These averages combine
executions at different times and do not establish simultaneous executable
prices. Unequal quantities leave substantial directional exposure.

## Strategy hypotheses and later tests

Both histories support a hypothesis of repeated accumulation of both outcomes
with unequal inventory, followed by settlement. The active candidate obtains
all observed fills as a maker; the leader supplements predominantly maker fills
with taker purchases. Their early, recurring entry timing and broad market
participation are consistent with a systematic process. The exact decision rule
is not observable from fills alone.

The next tests keep these wallets fixed through July, August and September:

1. Compare complete-month profitability, losing periods, activity and role mix,
   retaining inactive months and unresolved accounting explicitly.
2. Measure whether the timing and inventory imbalance persist, and whether
   outcome selection contributes more than paired inventory to the result.
3. Use the appropriate existing price/orderbook datasets to test candidate quote,
   inventory and signal rules. This trade dataset does not reveal canceled orders,
   contemporaneous book state or the wallet's private signals.

The available evidence supports those hypotheses and tests. It does not yet
establish their performance in later months or reproduce either strategy.

## Reproduce and verify

Run the [monthly ranking, population and fixed-candidate SQL](./schema#runnable-research-queries)
against the permanent root. All study queries used local Parquet without API
requests. Evidence is under `logs/monthly-wallet-study/`:

- `selection-plan.json` records the rule before complete June was available.
- `june/snapshots.json` binds the analysis to immutable generations and source revision.
- `june/monthly-rankings.json` contains the top 20 eligible June wallets;
  `monthly-population.json` records exclusions, and the cross-month query retains
  explicit incomplete-month statuses for later periods.
- Each selected wallet directory contains the SQL and results for summary,
  daily results, activity types, market profiles, profit concentration and
  outcome purchases.
- `june/validation.json` checks full-month coverage, whole-wallet accounting,
  actual trade counts, activity cash, separate rewards and agreement between
  profile, daily, concentration and ranking totals. Outcome-purchase reports
  separately verify market counts and their purchase-only applicability.

Observed SQL execution and result retrieval took 0.90 seconds for the monthly
ranking query and 0.68 / 0.60 seconds for the two complete market profiles.
These timings exclude database setup and result-file writes. OS caches were not
flushed, and the downloader was active; they are not cold-start or full-range
benchmarks.

The completed June study is one milestone. Full June–September ingestion,
separate later-month rankings, fixed-wallet comparisons and full-range benchmarks
remain required for feature acceptance.
