---
title: Polymarket Research Data
description: Local API v2 trade, activity and accounting data for wallet research.
---

# Polymarket research data

This dataset supports local research into wallets trading BTC 15-minute markets.
Parquet holds the facts and accounting results; DuckDB provides SQL access. It is
separate from the orderbook datasets replayed by the trading/backtest engine.

The initial acceptance scope is June–September 2026, selected by the UTC start of
each market's 15-minute window. This is 122 days and 11,712 scheduled windows.
Market discovery records absent windows explicitly. Do not assume that every
scheduled window has an available market.

A market cohort includes its entire observed lifecycle: trading before the
15-minute window, subsequent settlement and later redemption. The Gamma
`startDate` can describe creation of the listing; the slug-derived trading-window
start is the cohort key. The sync reports its activity cutoff and snapshot time.

## Sources and local storage

The downloader uses Polymarket Data API v2 plus Gamma metadata. It does not use
blockchain downloading, verification or enrichment. Public reads need no trading
credentials. Dependencies already exist in the project: Node 20, TypeScript and
`@duckdb/node-api`.

Choose a permanent data directory with `--root` or
`POLYMARKET_RESEARCH_DATA_DIR`. Keep it outside disposable worktrees. No database
server or R2 bucket is required.

Each published day contains six Parquet tables and a verification report. A small
`index.json` selects the active immutable generation of each day. New generations
are prepared separately and become visible together by atomic index replacement.
Existing readers retain the generation they opened. Older published generations
are retained, so a refresh does not remove files under an active reader.

Compressed API pages and cursor checkpoints make interrupted downloads resumable.
After publication, these temporary pages are removed by default; original row
payloads remain in Parquet `raw_json` columns. `--keep-raw` retains the page cache.

## Research workflow

1. [Sync and inspect coverage](./commands).
2. Read the [accounting definitions](./accounting) before comparing profit.
3. Use the local leaderboard or [SQL schema and examples](./schema).
4. Investigate a wallet's market-level results, trade roles and activity.
5. Report data coverage and accounting uncertainty alongside findings.

The [research analyst](./agents/analyst) and [data auditor](./agents/auditor)
instructions can be supplied to agents working in this project. They use local
commands and SQL; a new agent runtime is not required.

The [June and July studies](./monthly-wallet-study) demonstrate monthly rankings,
population exclusions and two detailed local wallet investigations. Later-month
comparisons remain in progress.

## Reliability boundary

A completed cursor walk is evidence that the API served its full result set for
that query. Cross-endpoint volume, trade occurrence and inventory checks provide
additional consistency evidence. These endpoints share Polymarket's upstream
indexing and cannot independently prove that no upstream event is missing.

The dataset preserves discrepancies and unsupported events. Strict rankings
exclude wallets with unresolved accounting in any selected market. Missing dates
or missing market windows prevent a strict cohort leaderboard entirely. Local SQL
still exposes the observed facts for diagnosis.

The progress log and benchmarks are [recorded here](./implementation-progress).
The implementation is not accepted until the full checklist and backfill pass.
