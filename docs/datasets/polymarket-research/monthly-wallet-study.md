---
title: Monthly Wallet Research
description: June through September wallet rankings, source limitations and reproducible local strategy investigations.
---

# Monthly wallet research

The June 2026 BTC 15-minute cohort is complete: all 30 UTC market-start days and
2,880 scheduled windows are published and independently verified. The results
below were calculated locally from Parquet on October 4, 2026, using each selected
market's full observed lifecycle. July, August and September are also fully published and
independently verified; their follow-up results are below. Verification includes
explicit unresolved histories, so it does not imply every wallet can be ranked.
The four-month comparisons are complete, including explicitly unresolved results.

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

The follow-up studies keep these wallets fixed through July, August and September:

1. Compare complete-month profitability, losing periods, activity and role mix,
   retaining inactive months and unresolved accounting explicitly.
2. Measure whether the timing and inventory imbalance persist, and whether
   outcome selection contributes more than paired inventory to the result.
3. For subsequent strategy reconstruction, use existing price/orderbook datasets to test candidate quote,
   inventory and signal rules. This trade dataset does not reveal canceled orders,
   contemporaneous book state or the wallet's private signals.

The July follow-up supports persistence of the observed behavior. September shows
a different execution pattern for the active candidate. The study does not
reproduce either strategy or establish future performance.

## July follow-up with the June selection fixed

All 31 July days and 2,976 windows are published and independently verified.
The cohort has 9,620,888 participant trade rows and 23,369 observed wallets.
Strict rankings include 21,678 wallets. The 1,691 excluded wallets account for
3,562,673 trade rows (37.0%); 12,382 wallet/market pairs remain unresolved.
Six corroborated market-volume warnings are separate from wallet exclusions.
The accounting audit found the same five issue classes as June.

The two wallets selected from June both reconcile across their entire July
cohort. No later outcomes were used to change that selection.

| July measure | June profit leader | June active candidate |
| --- | ---: | ---: |
| July eligible rank | 2 | 42 |
| Markets / trade rows | 2,522 / 271,524 | 2,956 / 94,920 |
| Economic PnL, USDC | 18,148.088389 | 1,854.056583 |
| Cash PnL, USDC | 18,147.728389 | 1,854.056583 |
| Unredeemed settlement value, USDC | 0.360000 | 0.000000 |
| Native API PnL, USDC | 18,251.701900 | 1,856.717200 |
| Profitable days out of 31 | 17 | 17 |
| Maker / taker rows | 229,926 / 41,598 | 94,920 / 0 |
| Markets buying both outcomes | 2,490 | 2,884 |
| Median fill size, shares | 10 | 5 |
| Median first / last fill offset | 7 / 745 seconds | 28 / 628 seconds |
| Median smaller/larger outcome quantity | 0.6773 | 0.6477 |
| Median combined average pair cost, USDC | 1.0642 | 1.0658 |

Both still only buy and redeem, with no observed sales, splits, merges or
attributable rewards. Their exact cash identities are:

```text
2,891,696.773965 - 2,873,549.045576 = 18,147.728389 USDC
  276,992.885321 -   275,138.828738 =  1,854.056583 USDC
```

The leader's best day was July 15 (+11,181.160547 USDC); its worst was July 1
(-7,255.561820). The active candidate's best was July 5 (+637.623263), and its
worst was July 18 (-500.067823). The reports retain every day, including losses.
Both earned less than in June. The active candidate's purchase turnover fell
from 563,526.957045 to 275,138.828738 USDC alongside a smaller median fill, so a
profit comparison alone cannot separate sizing changes from changes in edge.

The broad execution pattern persists: both-outcome accumulation with unequal
inventory, predominantly maker fills for the leader and exclusively maker fills
for the active candidate. This supports a behavior hypothesis, not an exact
quote rule. Lifetime average pair costs still combine trades at different times.
The August follow-up below retains these wallets despite unresolved accounting.
The September follow-up also preserves the original selection.

Evidence is in `logs/monthly-wallet-study/follow-up-2026-07/`, including fixed
selection checks, snapshot generations, SQL, daily losses, market profiles and
`research-review.json`. The independent issue inventory and population
cross-checks are in `logs/monthly-accounting-audit/2026-07/`.
SQL execution and result retrieval took 2.73 seconds for monthly rankings and
1.64 / 1.59 seconds for the wallet profiles; these are not cold-cache benchmarks.

## August follow-up: observed behavior, unresolved profit

All 31 August days and 2,976 windows are published and independently verified.
There are 8,070,073 participant trade rows and 17,874 observed wallets. Strict
rankings include 12,317 wallets; 5,557 are excluded. Those excluded wallets
account for **7,293,457 rows, or 90.4% of observed trading rows**. This is a severe
selection limitation: August's eligible leaderboard cannot identify the best
performer across the full observed population.

The audit finds 69,273 unresolved wallet/market pairs among 1,186,610 pairs.
Missing native positions and economics, inventory and native PnL discrepancies,
and unresolved market-volume disagreements all contribute. Of 134 market-volume
warnings, 103 meet the corroboration rule and 31 remain unresolved. The latter
mark all observed participants unresolved. Counts and evidence are in the
[August accounting inventory](./api-limitations#complete-august-accounting-inventory).

Both wallets selected from June have unresolved August histories. Their strict
August profit and rank are unavailable; diagnostic cash totals are retained in
the saved reports but must not be presented as verified profit. The selection is
unchanged, and neither wallet is replaced with a later winner.

| August observed measure | June profit leader | June active candidate |
| --- | ---: | ---: |
| Markets / trade rows | 2,099 / 231,305 | 1,665 / 57,176 |
| Unresolved markets | 117 | 57 |
| Days with observed trading | 30 | 20 |
| Maker / taker rows | 178,140 / 53,165 | 57,176 / 0 |
| Markets buying both outcomes | 1,988 | 1,585 |
| Median fill size, shares | 10 | 5 |
| Median first / last fill offset | 6 / 733 seconds | 32 / 691 seconds |
| Strict economic PnL and rank | Unavailable | Unavailable |

Every observed trade is still a BUY. The leader's 117 unresolved markets include
83 with missing position snapshots, 82 with missing position economics, eight
with unreconciled native PnL and 31 with unresolved source volume. The active
candidate's 57 include 54 missing snapshots, 53 missing economics and four
unreconciled native PnL results. These issue counts overlap.

The served fills remain consistent with the earlier both-outcome accumulation
pattern and maker-role split. Lower observed participation does not by itself
establish why either wallet changed activity. Accounting uncertainty prevents a
verified August profitability comparison or a complete inventory-exposure test.
Among the fixed June top 20, nine have unresolved August histories, nine have
no observed August trading, and two reconcile. The two reconciled outcomes are
-672.641164 and +46.610000 USDC; losses and inactivity remain in the comparison.

Evidence is in `logs/monthly-wallet-study/follow-up-2026-08/`, including SQL,
snapshot generations, eligibility records and `research-review.json`. The audit
is under `logs/monthly-accounting-audit/2026-08/`. Monthly ranking SQL took
4.48 seconds and the two wallet profiles 2.47 / 2.18 seconds, excluding setup and
file writes with OS caches retained. September results follow below; full-range
measurements are in [benchmark evidence](./benchmark-evidence).

## September follow-up and four-month comparison

All 30 September days and 2,880 windows are published and independently verified.
The cohort has 7,188,978 participant trade rows and 15,247 observed wallets.
Strict rankings include 14,271 wallets. The 976 excluded wallets account for
3,254,786 rows (45.3%); 7,556 wallet/market pairs remain unresolved. There are
no September source-volume warnings.

The original profit leader has one unresolved September market among 2,228.
On `btc-updown-15m-1789845300`, its saved 33 BUY activities and remaining holdings
give a diagnostic economic result of -109.400064 USDC, while native positions
report -48.390900: a difference of -61.009164 USDC. The served losing position
includes positive realized PnL despite this purchase-only activity history.
That discrepancy remains unexplained. The wallet has no strict September profit
or rank; dropping that one market would produce a partial result.

The active candidate reconciles for September, with **3,560.216249 USDC**
economic and cash profit, eligible rank 52. Its exact cash identity is:

```text
54,390.392292 - 50,830.176043 = 3,560.216249 USDC
```

There are no observed sales, splits, merges, rewards or remaining settlement
value. Native PnL is separately retained at 3,560.286900 USDC. Of 729 traded
markets, 449 were profitable and 280 losing. It had 18 profitable days among
29 days with observed trading; its best day was September 9 (+855.223735 USDC)
and worst September 6 (-992.607088). September 1 has no observed trading for it.

Its execution pattern changed substantially:

| Observed active-candidate measure | July | September |
| --- | ---: | ---: |
| Traded markets / trade rows | 2,956 / 94,920 | 729 / 1,127 |
| Maker / taker rows | 94,920 / 0 | 107 / 1,020 |
| Median fill size, shares | 5 | 46 |
| Median fills per market | 31 | 1 |
| Median first / last fill offset | 28 / 628 seconds | 537 / 638 seconds |
| Markets buying both outcomes | 2,884 | 104 |

The September history is mostly taker executions, typically starts later, and
buys both outcomes in only 14.3% of traded markets. There are 35 pre-window fills,
the earliest 60 seconds before the nominal window. This contradicts an unchanged
all-maker accumulation pattern across all months. It supports investigating a
change toward more selective directional buying, but does not reveal the trigger,
signal, capital allocation or exact strategy. Later entry is an observation,
not proof that the wallet predicts settlement from any particular signal.

Among markets with both outcomes, the median smaller/larger purchase quantity is
0.3012 and combined lifetime average pair cost is 1.0846 USDC. Only 29 of those
104 markets have average pair cost below 1; quantities remain unequal and these
averages are not simultaneous executable prices.

The original June selection yields this comparison:

| Month | June profit leader: strict economic PnL | June active candidate: strict economic PnL |
| --- | ---: | ---: |
| June | 54,166.546621 USDC | 8,387.540539 USDC |
| July | 18,148.088389 USDC | 1,854.056583 USDC |
| August | Unavailable: 117 unresolved markets | Unavailable: 57 unresolved markets |
| September | Unavailable: 1 unresolved market | 3,560.216249 USDC |

Neither wallet receives a verified four-month profit total. The fixed June top
20 contains five reconciled September histories, four unresolved histories and
eleven wallets with no observed trading. One reconciled candidate, June rank 7,
lost 26,302.943172 USDC across 1,595 September markets. That loss remains in the
comparison; later winners do not replace original candidates.

Evidence is in `logs/monthly-wallet-study/follow-up-2026-09/` and
`logs/monthly-accounting-audit/2026-09/`. The final full-range report saves all
80 fixed-candidate month outcomes. Source rows for the leader's September gap
are retained under `logs/final-acceptance-20261005/`.

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

All four monthly studies, fixed-wallet comparisons and full-range benchmarks
are complete. [Completion evidence](./completion-evidence) records the generation
checks, source limitations and reproducibility details. Further strategy
reconstruction can use these observations as hypotheses while supplying the
missing orderbook and signal evidence.
