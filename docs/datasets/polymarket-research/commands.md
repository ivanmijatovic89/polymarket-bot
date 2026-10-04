---
title: Research Commands
description: Sync, refresh, verify and query the local Polymarket research dataset.
---

# Research commands

Use Node 20 and install the repository dependencies. Select a permanent root:

```bash
export POLYMARKET_RESEARCH_DATA_DIR=/absolute/path/to/polymarket-research-v2
```

## Sync one day

```bash
npm run research:sync -- --market btc:15m --from 2026-06-01 --to 2026-06-02
```

Dates are UTC market-window starts; `--from` is inclusive and `--to` exclusive.
Without `--to`, the endpoint is today's UTC midnight, so only full days are
selected. BTC 15-minute is currently the only supported family.

The downloader discovers 96 scheduled windows, downloads all-side and taker-only
trades, checks aggregate taker volume, discovers trading wallets and fetches
activity plus open/closed positions. OPEN positions use the market-wide superset;
CLOSED positions use wallet anchors because the market-wide CLOSED population is
incomplete. Wallet requests group up to 20 conditions.
Source feed filters remain identical on every cursor page. If an empty market is
omitted from the volume response, a separate single-event request must explicitly
report zero aggregate volume; that evidence is saved. A missing volume row for a
non-empty market stops publication. A small, corroborated opening-burst aggregate
disagreement may be published with an explicit source warning only under the
[documented exception rule](./api-limitations#june-16-taker-volume-disagreement).
Its trades are retained and wallet-accounting checks remain mandatory.

Options include `--root`, `--concurrency` (default 12), `--rps` (default 32,
maximum 60), `--keep-raw`, and `--min-free-gib` (default 5). Concurrency shares one
request budget. Per-endpoint caps also apply: 18 requests/second for activity
and positions, 27 for trades and Gamma listings, and 9 for status. These leave
headroom under the [documented limits](https://docs.polymarket.com/api-reference/rate-limits);
`Retry-After` pauses the shared client. The disk guard applies to the dataset filesystem; it never deletes
unrelated data. Progress is written to stderr, structured results to stdout.

## Resume and refresh

Repeat an interrupted command. Committed pages are reused and the unfinished
cursor walk resumes. A published day is a no-op unless `--refresh` is supplied.
Use refresh for late redemptions, newer position snapshots and API corrections:

```bash
npm run research:sync -- --from 2026-06-01 --to 2026-06-02 --refresh
```

A refreshed day gets a new immutable generation. Older generations are retained
for existing readers and audit. Include their size when planning disk capacity.

One sync writer may own the root at a time. The lock records its PID and host.
A stale local lock is recovered only after checking that its process no longer
exists. A failed command exits nonzero; its checkpoints remain available.

## Coverage and leaderboards

```bash
npm run research:coverage -- --from 2026-06-01 --to 2026-07-01
npm run research:leaderboard -- --from 2026-06-01 --to 2026-07-01 --limit 100
```

Coverage lists missing days/windows, unresolved wallet/markets and issue counts.
The strict leaderboard requires full catalog coverage and excludes wallets with
any unresolved market result in the requested range. It reports the excluded
population instead of treating partial profit as complete.

## Wallet history and SQL

```bash
npm run research:wallet -- --wallet 0x... --from 2026-06-01 --to 2026-07-01 --limit 200
npm run research:sql -- --sql 'SELECT count(*) FROM trades'
npm run research:sql -- --sql-file /absolute/path/to/query.sql
```

These commands read local Parquet only. SQL runs in a private in-memory DuckDB
connection with views over the published generations. The schema is documented
[in the SQL guide](./schema). Wallet reports include an explicit activity limit;
use SQL when the complete history is needed.

## Verification and reports

```bash
npm run research:data:test
npm run research:verify -- --from 2026-06-01 --to 2026-06-02
npm run research:rebuild -- --from 2026-06-01 --to 2026-06-02
```

`verify` checks SHA-256 file digests and independent SQL identities: window and
participant counts, cash arithmetic, trade/activity occurrences, accounting
statuses, and saved taker-volume totals. Integrity failures exit nonzero. The
separate `all_wallet_accounting_complete` field distinguishes structurally valid
data from a dataset with unresolved accounting or missing market coverage.
`all_source_aggregates_reconciled` is independently false when an accepted source
warning remains. Inspect `warnings` and `source_warnings`; successful integrity
verification does not mean every upstream aggregate agrees.

`rebuild` recomputes accounting entirely from saved raw API facts. It creates a
new immutable generation, preserves the original source timestamps and download
metrics, and hard-links unchanged source Parquet files. It makes no API requests
and cannot recover facts missing upstream. Use `sync --refresh` for new facts.
Both commands require the explicit date range; rebuilding acquires the same
writer lock as sync.

Each published day contains `report.json`: source freshness, completed query
counts, volume comparisons, accounting issue counts, download duration, request
counts, retries, compressed Parquet size and measured working-disk usage. Resumed
runs are labeled and must not be mistaken for fresh-download benchmarks.

`as_of` is the activity cutoff chosen at the start of a download. Market trades,
resolutions and positions are current API observations gathered during that run,
not an atomic historical database snapshot. Reports retain start/finish times and
API freshness. If late changes make these sources disagree, the affected result
remains unresolved and a refresh obtains newer observations.

A successful ingestion can still publish unresolved accounting results for
inspection. Consult coverage before research; process success is not a claim
that every wallet is rankable.

## Benchmark and estimate a backfill

```bash
npm run research:benchmark -- --from 2026-06-01 --to 2026-06-02 --project-days 122
```

The command reads download reports and measures trade scans, wallet rankings and
an activity timeline locally. It reports database-open time, first-query time and
two repeat timings. It does not flush the operating-system disk cache or claim a
cold-disk benchmark. The projection uses fresh, uninterrupted day reports only;
resumed runs are excluded. Its low/high values reflect observed days, not a
statistical confidence interval. Sample different months and check downloader
version and position request scope before extrapolating.
