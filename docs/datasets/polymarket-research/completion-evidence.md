---
title: June–September Completion Evidence
description: Full-range coverage, quality limits, benchmarks and verified local research.
---


> Historical evidence: the studies below used the original strict audit population.
> Normal research now includes all observed wallets. See the [current overview](./overview)
> and [profit calculation](./accounting); use `--strict` and `audit-*.sql` only to
> reproduce the earlier reconciliation-based selections.

# June–September completion evidence

The initial BTC 15-minute backfill is complete for market windows starting
`2026-06-01 <= market_start < 2026-10-01`, UTC. All **122 days and 11,712
scheduled markets** are present. The independent final verifier passed file
digests, calendar coverage, participant counts, cash identities, trade/activity
occurrences and source-volume quality checks. There are no missing windows or
pending-resolution wallet/market rows.

This is complete calendar coverage of the served API data. It does not certify
every wallet's accounting or prove that upstream indexing exposes every event.
Unresolved facts remain saved and queryable, with strict ranking exclusions.

## Dataset and quality

| Measure | Result |
| --- | ---: |
| Participant trade rows | 37,120,045 |
| Activity rows | 41,171,117 |
| Position rows, including distinct source views | 6,535,035 |
| Distinct observed trading wallets across four months | 62,226 |
| Complete wallet/market pairs | 5,207,175 |
| Unresolved wallet/market pairs | 100,037 |
| Active Parquet bytes | 7,113,305,039 (6.62 GiB) |
| Source-volume warning markets | 146: 115 corroborated, 31 unresolved |

Activity cutoffs range from October 4 at 16:02:56 UTC through October 5 at
19:26:12 UTC. Each selected market includes its served full lifecycle up to the
recorded cutoff, including pre-window trades and later redemptions. These are
observations made during the downloads, not an atomic historical API snapshot.
Use `sync --refresh` to obtain subsequent source changes.

Strict rankings exclude a wallet's entire selected cohort if any market is
unresolved. Per-month populations are:

| Month | Markets | Trade rows | Observed wallets | Eligible wallets | Excluded wallets | Rows belonging to excluded wallets |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| June | 2,880 | 12,240,106 | 30,091 | 27,817 | 2,274 | 50.1% |
| July | 2,976 | 9,620,888 | 23,369 | 21,678 | 1,691 | 37.0% |
| August | 2,976 | 8,070,073 | 17,874 | 12,317 | 5,557 | 90.4% |
| September | 2,880 | 7,188,978 | 15,247 | 14,271 | 976 | 45.3% |

Monthly wallet counts overlap and must not be summed as distinct people or
wallets. Selecting all four months at once excludes 9,093 wallets with
29,691,069 trade rows; 53,133 wallets remain eligible for that longer cohort.
August in particular cannot support a population-wide claim about the best
performer. The [exception inventory](./api-limitations) accounts for every
unresolved pair by explicit issue combinations. It records evidence and unknown
causes without inventing missing events or waiving quality criteria.

## Research and performance

Saved SQL provides separate monthly top-20 rankings, top-100 CLI leaderboards,
the fixed June candidates followed through September, and detailed wallet
profiles. All 400 monthly top-100 entries were independently cross-checked for
whole-wallet eligibility, exact cash plus settlement value, order and agreement
with the top-20 SQL. The [wallet study](./monthly-wallet-study) retains losses,
inactivity and unresolved results. Its selected wallets are never replaced using
later outcomes. Exact strategy reconstruction still needs orderbook and other
evidence unavailable in the trade/activity history.

A fresh local connection opened in 60.52 ms. Full-range trade/wallet counting
took 569.32 ms, the eligible top-100 query 156.66 ms and a 1,000-row activity
timeline 69.75 ms on first execution. OS caches were retained. The richer four
separate monthly top-20 query took 4.36 seconds with one query thread. These are
different workloads; neither result promises a bound for arbitrary SQL.

Fresh September downloads averaged **267.32 seconds (4.46 minutes) per 96-market
day**, with 7,743 requests per day on average. The summed stored successful-attempt
durations for all months are 12.46 hours; they exclude earlier failed attempts,
development, investigations and waits. They are not the elapsed wall-clock time
of this task. Active Parquet size excludes retained older generations, probe
artifacts and logs. See [benchmark evidence](./benchmark-evidence) for the full
measurements, working-disk samples and initial planning estimates.

## Verification and reproducibility

The permanent root is
`/Users/mijat/Sites/polymarket-bot/data/polymarket-research-v2`.
No blockchain download, enrichment or verification was used. Live/backtest
strategy and tick paths are outside this feature's diff.

Evidence relative to that root:

- `logs/backfill-validation/full-range-verification.json`: all 122 generations.
- `logs/backfill-validation/full-range-coverage.json` and
  `full-range-benchmark.json`: coverage, source flags and measurements.
- `logs/backfill-validation/months/`: each month's coverage and leaderboard.
- `logs/monthly-accounting-audit/2026-06/` through `2026-09/`: inventories,
  SQL, population cross-checks and review records.
- `logs/monthly-wallet-study/`: the original selection plan and four-month study.
- `logs/final-acceptance-20261005/`: final audit script, source revision,
  generation bindings, ranking cross-checks and check logs.

The final audit reran sync over all 122 published days with network requests
forbidden: all days were skipped, zero requests occurred and `index.json` stayed
byte-for-byte unchanged. All 41 feature tests pass after integration with main
through `72032083`; root TypeScript and ESLint pass. CI also exercises the existing
trading, recorder, feed, WebUI, Dashboard and docs checks.

Use the [commands](./commands), [SQL examples](./schema#runnable-research-queries),
[analyst](./agents/analyst) and [auditor](./agents/auditor) instructions for
subsequent research. Always include the cohort's quality exclusions in findings.
