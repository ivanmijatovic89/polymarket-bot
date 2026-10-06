---
title: Research Commands
description: Download, inspect and query local wallet data.
---

# Research commands

Use Node 20 and the repository dependencies. Set the permanent root once:

```bash
export POLYMARKET_RESEARCH_DATA_DIR=/absolute/path/to/polymarket-research-v2
```

All commands also accept `--root PATH`. Dates select UTC market-window starts;
`--from` is inclusive and `--to` exclusive. The default `--to` is today's UTC
midnight. Only `--market btc:15m` is enabled.

## Download and maintain

```bash
# Missing days plus the last seven complete days:
npm run research:update -- --from 2026-06-01

# Download a specific range, skipping published days:
npm run research:sync -- --from 2026-06-01 --to 2026-07-01

# Explicitly refresh an older range:
npm run research:sync -- --from 2026-06-01 --to 2026-07-01 --refresh

# Latest nightly/manual update state:
npm run research:status
```

Defaults are 16 workers, 60 shared requests/second and a 5 GiB free-disk reserve.
Endpoint limits apply in addition to the shared limit. `sync --keep-raw` retains
compressed request pages after publication. `update --no-combine-wallets` is a
comparison mode for measuring independent daily wallet requests.

The [nightly guide](./downloading) explains installation and catch-up.

## Daily, weekly and monthly leaders

```bash
# Trader of the day:
npm run research:leaderboard -- --from 2026-09-30 --to 2026-10-01 --limit 20

# One week:
npm run research:leaderboard -- --from 2026-09-24 --to 2026-10-01 --limit 20

# June:
npm run research:leaderboard -- --from 2026-06-01 --to 2026-07-01 --limit 20
```

Each result row has `wallet`, `profit_usdc`, `markets` and `trades`. Every observed
wallet is eligible; no reconciliation flag excludes it. The requested market
coverage must exist. Profit follows the [same calculation](./accounting) for
every period. Unresolved final payouts produce null profit, not a fabricated zero.

## Wallet history and local SQL

```bash
npm run research:wallet -- --wallet 0x... --from 2026-06-01 --to 2026-07-01 --limit 200
npm run research:sql -- --sql 'SELECT count(*) FROM trades'
npm run research:sql -- --sql-file docs/datasets/polymarket-research/sql/monthly-rankings.sql
npm run research:sql -- --sql-file docs/datasets/polymarket-research/sql/june-candidates-across-months.sql
```

These commands read local Parquet only. Wallet reports return all selected market
rows and a limited activity list. Use SQL for a full timeline or other aggregates.
The activity limit does not limit the wallet's calculated market results.

`monthly-rankings.sql` ranks all observed wallets for June through September.
`june-candidates-across-months.sql` selects June's top 20 once, then follows those
same wallets through the later months, including losses and inactive months.
Edit the dates in the SQL to use another period. See the [schema guide](./schema).

## Coverage and maintenance diagnostics

```bash
npm run research:coverage -- --from 2026-06-01 --to 2026-07-01
npm run research:verify -- --from 2026-06-01 --to 2026-07-01
npm run research:leaderboard -- --from 2026-06-01 --to 2026-07-01 --strict
npm run research:wallet -- --wallet 0x... --from 2026-06-01 --to 2026-07-01 --audit
```

Coverage distinguishes missing downloads from internal accounting differences.
`--strict`, `--audit`, `wallet_months_audit` and the `audit-*.sql` files are explicit
maintenance tools. They preserve the historical reconciliation methodology;
they are not the normal research workflow.

## Timing

```bash
npm run research:benchmark -- --from 2026-09-01 --to 2026-10-01 --project-days 7
```

This measures local query time and summarizes historical day download reports.
Fresh independent days can be projected; resumed attempts and days sharing an
update queue are excluded from those projections. Use `update-state.json` and
`logs/updates/` for the whole nightly run's timing, request counts and retries.
See [performance](./performance) for measured examples.
