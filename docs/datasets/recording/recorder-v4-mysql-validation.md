# Recorder V4 MySQL catalog rollout validation

The catalog implementation was merged in PR [#302](https://github.com/ivanmijatovic89/polymarket-bot/pull/302)
as `a31b1dff97575cdfd9dd0e4a1a60f49cf4a7ef8d` on October 8, 2026. Worker-2's separate catalog
release is pinned to the tested PR head `f4d970ac8fc2a0c44f17cc394bb14b117249cff7`.
The capture daemon remains at `a94e9a6a3d151546b56fcf4572858fe518f2f0ca`; its supervisor
PID remained 95492 throughout installation. Capture was not restarted.

## Code and migration checks

- 231 Recorder V4 tests passed; the opt-in MySQL test also passed separately on a temporary
  local MySQL 8.4 instance and in CI. It covers additive DDL, concurrent insertion,
  immutable metadata, JSON roundtrips, monotonic resolution updates, database-only discovery,
  and stale/uninitialized-catalog guards. Temporary MySQL files were removed afterward.
- 296 trading/backtest tests and 66 dashboard tests passed. Root typecheck, ESLint,
  formatting, dashboard typecheck, and catalog service template guards passed locally.
- All four required CI jobs passed: root, WebUI, dashboard, and docs, including the real
  MySQL integration test and dashboard production build.
- Worker-2's isolated catalog checkout passed typecheck, eight catalog tests, and two service
  guard tests with Node 20.20.2 and its native Parquet dependencies.
- Production migration 0040 created only `recorder_v4_recordings` and
  `recorder_v4_catalog_syncs`. The ledger SHA-256 is
  `ef143bcf3300e08bf2ad82eeba8dfa0a137be735f5409e18780f3c50a85a04a3`.
  The migration preflight confirmed it was the only pending migration and that neither
  catalog table existed.

The repository's older Drizzle snapshot 0008 is malformed and prevents its current generator
from reading the full historical snapshot chain. Only the two new tables were generated in
an isolated temporary schema output, then registered as migration 0040, following the
existing SQL-only migration history after 0008. This does not change historical migrations.

## Archive and replay checks

The first bounded import verified 100 of 776 discovered recordings without failures. Each
new Parquet was downloaded once into an owned temporary directory, checksum-verified,
inspected for reference availability, inserted in MySQL, and removed. No R2 objects were
created, changed, or deleted by the catalog rollout.

Two actual MySQL-selected complete packages were independently downloaded and fully replayed.
Catalog eligibility matched eligibility recomputed from each downloaded recording:

| Duration | Market | Rows | Strategy ticks | Bytes | Replay SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| 5m | `btc-updown-5m-1791292800` | 152,616 | 125,485 | 2,789,852 | `1b580c37563c43c14897b90ee15337be84951ef4f1717595d56d95c014f11b90` |
| 15m | `btc-updown-15m-1791457200` | 413,787 | 243,653 | 6,514,466 | `436a91f05873b0eb4910aba2c2593ae559227a26ea070852a4627d387e5e3fa1` |

Both contained Polymarket events plus Binance aggregate trades and book ticker, Chainlink
spot and TWAP, and website PTB observations. Their temporary validation downloads were
removed. The small report is retained at
`/Users/worker-2/Services/polymarket-recorder-v4-catalog/package-verification.json`.

## Completed initial import and consumer checks

At 11:38 UTC on October 8, MySQL contained 780 recordings: 584 BTC 5m and 196 BTC 15m.
The remaining 677-package import completed with zero failures; a catch-up pass then added
three recordings and refreshed four resolution histories, with no pending imports or errors.
Two recently closed recordings were still awaiting their official result at that snapshot.
All 780 had recorded website PTB evidence. Gapped recordings remain indexed and retain their
original exclusion reasons.

Production `--list-eligible` checks ran for both durations in an environment containing only
MySQL configuration and `R2_BUCKET`, with no R2 endpoint/access keys. Both returned ten selected
markets successfully. On the 777-recording snapshot before catch-up, the unchanged
`SplitSellRedeem.v5` rules admitted 406 of 582 five-minute recordings and 137 of 195
fifteen-minute recordings. The selector continued rejecting required-feed gaps and duplicate
recordings rather than relaxing admission to increase counts.

Two normal queued `SplitSellRedeem.v5` backtests then selected through MySQL and completed on
the fleet, each with one persisted market and zero failures:

| Duration | Run ID | Market | End-to-end CLI time |
| --- | ---: | --- | ---: |
| 5m | 9660 | `btc-updown-5m-1791458400` | 8.82 seconds |
| 15m | 9661 | `btc-updown-15m-1791457200` | 5.23 seconds |

These are functional rollout checks, not controlled performance benchmarks. Their comments
identify them as catalog validation runs. No live order execution was enabled.

The ordinary fleet prefetch command downloaded both duration packages for the 14:30 UTC
October 7 boundary into an owned temporary worker-2 cache. Both download steps passed;
the cache was removed afterward. The live dashboard API returned October 7 coverage for all
288 five-minute and 96 fifteen-minute recordings, including reference-availability fields
and catalog scan status. Its orderbook-only eligibility counts were 212 and 64 respectively;
strategy-specific selection applies the requested feed requirements separately.

## Consumer and service rollout

The primary checkout was fast-forwarded with the user's unrelated untracked document
preserved. Backtest market/aggregation queues were checked and were empty before the normal
fleet update. Worker-1, worker-2, and milan-m1 updated to the merged code successfully; no
active backtest was interrupted. V4 fleet `--plan` resolves one database-selected download
step for each requested duration into the normal replay cache.

The catalog configuration contains only nine database/R2 keys, mode 0600, separate from the
capture configuration. Worker-2 can reach MySQL. Its new service template uses nice level 10
and bounded logs (8 MiB × four files). The prepared plist checksum is
`a6e2d6cc7b90c66dd0145af585cdd54078b703922f706847e6f7eb687259f812`.
The checksum-guarded activation wrapper is
`/Users/worker-2/Services/polymarket-recorder-v4-catalog/activate-catalog.zsh`.

Administrator installation requires an interactive password; noninteractive sudo reported
that a password is required. Preparation is not proof of a running LaunchDaemon. Verify its
actual activation separately using the [worker-2 operations guide](./recorder-v4-worker-2#independent-mysql-catalog-service).
