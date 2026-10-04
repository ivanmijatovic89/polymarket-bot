---
title: Recorder v3 — archive layout and feed coverage hardening
description: Follow-up review, PTB source research, and pre-deployment validation of the structured R2 archive.
---

# Recorder v3 — archive layout and feed coverage hardening

This follow-up addresses the findings from the additional read-only review after the [second audit](./recorder-v3-second-audit). Runtime changes are frozen at `cb539c8c`. Worker-2 deployment is separate from this local validation.

The subsequent [opening-reference implementation](./recorder-v3-opening-reference) adds an explicit exact-boundary TWAP source and re-verifies these immutable recordings. This page preserves the earlier website-mode results and source investigation.

## Changes

- New R2 packages use `<prefix>/btc/<5m|15m>/<market-slug>/<recording-id>/`. An optional `archiveLayout: "symbol-timeframe"` field identifies the new layout without changing the event schema. The writer, catalog, direct manifest reader, and downloader validate its identity and digest-bearing path. Existing flat packages retain their original object keys and bytes. Catalog prefixes select the configured archive root; local cache paths remain unchanged.
- Undecodable Binance text now opens uncertain coverage gaps for both streams on that socket. An identifiable malformed payload affects its own feed. Raw data remains in the recording, and ordinary backtests requiring the affected feed reject the market. Valid control replies and protocol heartbeats neither invent gaps nor restore price availability.
- A null PTB response after a previously observed price opens an uncertainty interval and backs off retries. Replay retains the previous value and original receipt time. Recovery requires a valid new price. Initial publication delay remains distinct from a price disappearing later.
- PTB requests reuse one URL per exact market and reference configuration. Removing the unique `ts` query parameter allows the website edge cache to serve and refresh those requests. Correction polling, response receipts, failure backoff, and `Retry-After` handling remain intact.

## PTB source investigation

The investigation used Context7, current primary documentation, the current public frontend request builder, and bounded public endpoint probes on October 4, 2026. Context7 returned older 30-second examples for 5m markets; the current [Polymarket changelog](https://docs.polymarket.com/changelog/predictions) explicitly supersedes that rule on August 14. Both supported market durations now use 60 seconds, and the recorder validates actual Gamma reference configuration.

The supported [PolyBolt reference stream](https://docs.polymarket.com/api-reference/live-data/overview) supplies Chainlink spot/TWAP observations. Its documentation does not establish the exact market-specific PTB boundary-report selection or correction policy. Direct [Chainlink timestamp semantics](https://docs.chain.link/data-streams/how-report-timestamps-work) also require care around validity intervals and missing observations. A nearby streamed TWAP sample is therefore not substituted for official PTB.

Gamma market/event probes for the active 20:00 BTC 5m and 15m markets returned `eventMetadata: null` at 20:01:47 UTC and again at 20:04:49. The latter 15m response had a CDN age of 16 seconds, so it was not simply an unchanged pre-opening cache entry. The [event endpoint documentation](https://docs.polymarket.com/api-reference/events/get-event-by-slug) does not guarantee active-window PTB publication. This evidence does not prove Gamma never publishes early; it does rule out treating it as a dependable immediate replacement.

The observed [frontend bundle](https://polymarket.com/_next/static/immutable/chunks/1zn9zo98a2cgl.js) constructs its PTB request from symbol, start/end, duration variant, and TWAP configuration, without `ts`. Its client-side 15-second stale setting is not a documented server cache TTL.

For the active 20:00–20:15 market, the public endpoint showed:

| Observation (UTC) | Request | Edge cache | Age | Result |
| --- | --- | --- | --- | --- |
| 20:02:12.152 | Stable market URL | STALE | 10 s | PTB 85411.9999740108 |
| 20:02:12.691 | Same parameters plus unique `ts` | MISS | 0 s | Same PTB |
| 20:02:51.159 | Stable URL again | STALE | 14 s | Same PTB, newer body timestamp |
| 20:07:18.436 / 20:07:19.744 | Stable URL twice | HIT / HIT | 7 / 8 s | Same PTB and body timestamp |

This establishes avoidable edge-cache bypass and subsequent refresh with a stable URL. It does not establish fewer upstream Chainlink calls, an exact cache TTL, a supported quota, or uninterrupted PTB availability. Cached corrections can become visible later. No alternative source was silently added.

## Automated checks and independent review

The local recorder suite passed 160 tests; the trading suite passed 256. The final stable-URL adjustment passed all 55 focused feed tests, and the final root TypeScript and ESLint checks passed. Tests cover malformed raw frames through coordinator coverage and ordinary admission, PTB disappearance through outage replay, new and legacy catalog layouts, direct downloads, invalid layout/identity combinations, and cache conflicts.

The two implementation agents cross-reviewed each other's changes without editing them. No further actionable defects were found. Independent compatibility checks also parsed four retained real legacy manifests with the new schema. These results supplement the earlier audit; they do not replace observation of actual upstream behavior.

## Local integration procedure

The frozen source ran locally with both durations, a separate validation R2 prefix, a 2 GiB spool ceiling, and a 10 GiB filesystem free-space floor. A temporary configuration copied only the required feed and storage fields; no wallet was initialized. The first process started at 20:07:55 UTC and was deliberately terminated with `SIGKILL` at 20:09:10. A new process immediately reopened the same spool for a 35-minute run.

The interrupted 20:05–20:10 recording retained one recording ID and capture ID across two sessions. Its sequence moved from 22507 to 1000000000002, avoiding reuse of the crashed process's reserved range. Its 17 startup/restart gaps correctly caused an ordinary backtest to reject it before processing ticks, even after an official Down resolution became available.

The real archive CLI listed the old 18:45–19:00 flat-layout recording under its original validation prefix. New packages were listed by timeframe/date, downloaded into a separate cache, and verified through every row and the shared replay dispatcher. Local event deletion was checked against each verified archive receipt. Resolution observations were checked as siblings of their package's event and manifest objects.

Actual backtest CLI checks used isolated MySQL on port 13316 and Redis on port 16386, including a guarded market worker with an initially empty R2 cache. The existing 46 audit runs were retained. Saved results, execution revision, admission reasons, and settlement were inspected; shell exit status alone was not treated as success.

The clean 20:10–20:15 recording contained 128,350 rows, ten valid PTB responses, and no recorded coverage gaps. Its first valid PTB arrived 953 ms after opening. Sequential and R2-worker runs matched at 112,919 market ticks, one simulated fill, fees of 0.09, and official Up settlement. Five Down shares bought at 0.47 produced the same -2.4400 PnL in both runs.

The 20:15–20:20 recording received a wrapped Chainlink 429 as HTTP 400 at 20:15:00.935. PTB became available at 20:16:01.252 after the 60-second backoff. A focused replay observed 26,861 strategy ticks before that response without PTB and 42,847 afterward with PTB; the first tick carrying the value was at 20:16:01.253. No snapshot contained a price received in the future. An actual PTB-dependent CLI backtest rejected the market at zero ticks, while the Polymarket-only strategy admitted its 69,708 ticks. Its first execution preceded official resolution and correctly reported an unresolved outcome rather than inventing final PnL.

The following 20:20–20:25 recording also received an opening PTB rate error before recovery. Stable URLs therefore did not eliminate upstream failures. These recordings preserve those gaps and remain unsuitable for ordinary PTB-dependent backtests.

The full 20:15–20:30 recording contained 222,388 rows, 19 valid PTB observations, and one PTB-only uncertainty interval. Its three overlapping five-minute files contained 18,599, 7,675, and 9,112 shared Binance/Chainlink observations respectively. All 35,386 copies matched by complete decoded event, including identity, sequence, session, connection, both receipt clocks, and raw payload. No shared observations were missing or different.

This market also supplied real PTB correction evidence:

| Observed value | HTTP response receipt (UTC) | First strategy tick exposing it (UTC) |
| --- | --- | --- |
| 85410.22444561795 | 20:15:01.143 | 20:15:01.144 |
| 85412.3265875627 | 20:15:31.245 | 20:15:31.249 |

The dispatcher check covered 184,489 market ticks with zero future-snapshot or value/receipt mismatches. The overlapping five-minute market first observed only the second value at 20:16:01.252 after its own rate error; it did not inherit the fifteen-minute market's earlier observation. These actual timelines demonstrate why PTB requests remain market-specific and why later corrections must not be applied to earlier strategy ticks.

The full fifteen-minute sequential and R2-worker runs then matched at 184,489 market ticks, one simulated fill, official Up settlement, and -2.3900 PnL, with correct 15m run metadata. They used ordinary admission because their strategy did not require the affected PTB feed. The PTB-gap five-minute market also settled after refreshing its official Up sidecar, with 69,708 ticks and -1.9300 PnL. Explicit outage replay of the interrupted five-minute recording processed 9,385 ticks and settled against official Down; its ordinary admission still rejected it.

There were nine new actual CLI runs, including two matching full-window sequential/R2 comparisons and three expected failures: interrupted-capture rejection, required-PTB rejection, and the initial unresolved outcome. The isolated SQL evidence preserves all 46 earlier runs plus these nine. Temporary workers, MySQL, and Redis stopped at 20:38:27 UTC, and ports 13316/16386 were confirmed closed. The network guard recorded no wallet/live imports or unauthorized network operations.

## Shutdown and local resource measurements

The restarted recorder exited successfully at 20:44:21.538 UTC after its 35-minute run and graceful shutdown. A guarded maintenance pass first confirmed that the recorder was stopped, then archived the two shutdown partials and refreshed resolution observations. It reported no failures. Verified archive deletion left only two unfinalized journals for the future 20:45 markets, totaling 411,724 bytes; these were retained because they had not been archived. Small manifests, receipts, and resolution tracking state also remain intentionally.

The final remote-read-only pass completed at 20:48:30 UTC. It listed 39 objects under `recorder-v3-validation/hardening-e977c605-6c72-4f7d-b194-c768dc2f0215` and refreshed all eleven downloads. Every package passed full hash, row, and replay verification on its first download, including both shutdown partials in this final pass.

| Final archive result | Count |
| --- | --- |
| Five-minute / fifteen-minute packages | 8 / 3 |
| Stored package rows, including intentional shared-feed copies | 1,431,965 |
| Compressed Parquet bytes | 140,552,867 |
| Matching verified archive receipts | 11 |
| Archived event files remaining in the recorder spool | 0 |
| Full-duration recordings | 7 |
| Full-duration recordings with all-feed coverage | 3 |
| Full-duration recordings with PTB-only uncertainty | 4 |
| Startup/crash or shutdown partial recordings | 4 |
| Verification errors | 0 |

All seven full-duration recordings passed Polymarket-only admission; three passed admission requiring PTB or all feeds. The four partials remain available for explicit outage replay and are excluded from ordinary backtests. These short-run counts describe the captured dataset, not an estimate of long-term feed reliability.

Eight packages had an official resolved sidecar. The 20:35–20:40 package still had a pending observation, and neither shutdown partial had an observation yet; no winner was inferred. All eleven resolution trackers were retained for further checks, including the later confirmation cycle. The stopped local validation process will not perform those future checks by itself.

Detailed local evidence remains in `.tmp/recorder-hardening/`: `storage-report.json`, `backtest-report.json`, `metrics-report.json`, `maintenance-report.json`, test logs, and the private SQL export. The SQL export contains 55 runs and has SHA-256 `0aef5d4a15170d8b603d456beba337442bdc8d82d857a7860577ba27479be8fc`. Explicit verification/download caches are separate from the recorder spool. Temporary scoped credentials were removed after the final R2 verification; the project's original environment file was unchanged.

The harness collected 438 samples at approximately five-second intervals, covering the original process and its replacement:

| Measurement | Observed value |
| --- | --- |
| Mean ingestion CPU | 7.99% of one core |
| Peak sampled ingestion CPU | 77.25% of one core |
| Peak sampled ingestion RSS | 171.61 MiB |
| Peak sampled recorder process-tree RSS | 271.55 MiB |
| Peak sampled process-tree CPU | 137% of one core |
| Largest measured event-loop lag | 552.67 ms |
| Peak sampled local spool | 467.22 MiB |
| Archive / resolution error samples | 0 / 0 |

Process-tree measurements include recorder child processes, not independent verification or backtest processes. The process reported `recording` in 411 samples, `degraded` in 26, and `stopped` in one. These are sampled local observations, not resource upper bounds, an availability estimate, or worker-2 measurements.

## Operational limits

Recorder availability and dataset usefulness are different measurements. A connected process can still receive rate-limit responses or miss required observations. Ordinary backtests reject markets according to the feeds each strategy requires. Explicit outage replay preserves uncertainty instead of filling missing observations with later knowledge.

The local soak does not establish worker-2 service supervision, dashboard connectivity from that machine, resource coexistence with its intended workloads, or a real 24-hour resolution-confirmation cycle. Those remain deployment checks. Monitoring is dashboard-only as requested; there are no Slack notifications.
