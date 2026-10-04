---
title: Recorder v3 validation — October 2026
description: Measured local capture, archival, replay, and recovery evidence before worker-2 deployment.
---

# Recorder v3 validation — October 2026

This report records the local validation performed on October 4, 2026, with Node.js 20.19.6. The implementation under test is commit `24fd3bfc78385fb0ef46d3ccb8f2f002f1f4a965`. Later changes to this report do not change that implementation. See the [operating guide](./recorder-v3) for configuration and commands.

The subsequent [second audit](./recorder-v3-second-audit) found and fixed additional recovery, resolution-integrity, and replay-clock issues. It also tests the actual sequential and queued backtest CLI with persisted results. Use that follow-up when assessing the current candidate; this page preserves the original measurements.

The recorder was tested in an isolated checkout on a MacBook Pro with an Apple M1 Pro and 16 GiB RAM. No recorder service was installed or started on worker-2. Capture used public market observations and authenticated feed access; it did not initialize wallet signing or order submission. R2 writes used a separate `recorder-v3-validation/2026-10-04-final` namespace; an earlier round-trip test used its sibling `2026-10-04` prefix.

## Automated checks

The following suites passed locally on Node 20:

| Suite | Passing tests |
| --- | ---: |
| Recorder v3 | 94 |
| Trading and shared runtime behavior | 249 |
| Runtime regressions | 107 |
| Artifact handling | 34 |
| External-feed coverage | 18 |
| Dashboard | 57 |

Root TypeScript, ESLint, Prettier, strategy-research checks/index, WebUI typecheck/build, the VitePress documentation build, and the Next dashboard production build also passed. All four jobs in the implementation's [GitHub quality run](https://github.com/ivanmijatovic89/polymarket-bot/actions/runs/37222623054) succeeded with clean dependency installation.

Recorder tests exercise crash recovery, exclusive spool ownership, durable sequence allocation, malformed/torn journals, disk guards, reconnect and stale-feed handling, bounded network cancellation, R2 read-back corruption/failures, resolution revisions, and replay ordering. These simulated failure tests complement the live observations below; they are not evidence of every possible production failure.

## Final simultaneous capture and archive

The final candidate ran from approximately 17:56:05 to 18:16:57 UTC, covering one entire scheduled 15-minute interval and three entire five-minute intervals. Markets already underway at startup were retained as partial recordings. The four full-duration packages were automatically uploaded, fully read back for SHA-256 verification, and removed from the local event spool. The catalog CLI then downloaded all four into a fresh cache with no failures.

| Market interval (UTC) | Duration | Rows | Parquet bytes | Coverage |
| --- | --- | ---: | ---: | --- |
| 18:00–18:15 | 15m | 298,868 | 31,084,246 | Two book-feed gaps |
| 18:00–18:05 | 5m | 143,539 | 14,840,801 | One PTB gap |
| 18:05–18:10 | 5m | 145,041 | 15,403,891 | Two book-feed gaps |
| 18:10–18:15 | 5m | 144,568 | 15,393,233 | Complete; no detected gaps |

Streaming comparisons against the overlapping 15-minute file found 4,585 identical shared feed frames in the last five-minute interval and 9,878 in the preceding interval. There were zero missing or different copies. Every envelope field matched, including original payload, event ID, global sequence, wall-clock receipt time, and monotonic receipt time. Both Parquet files' byte counts and SHA-256 values were verified before each comparison.

`SIGTERM` stopped intake and finalized the remaining partial recordings with exit code zero. Restarting with the same spool retained `captureId`, allocated a new `sessionId` and a strictly newer sequence range, and uploaded and deleted both pending event files before resuming capture. The bounded restart also exited cleanly. A final archive-only maintenance pass verified and removed its two partial event files without opening more feeds. All finalized test event files were deleted from the capture spool; explicit replay-download caches were retained. Resolution follow-up records survived event-file deletion.

### Measured local resource use

The test used 5 GiB spool and free-space guards, overriding the documented 20 GiB defaults for this development machine. Five-second status samples from 18:02:01 through shutdown recorded a maximum ingestion RSS of 141.4 MiB, mean ingestion CPU of 8.7% of one core, and a maximum sampled event-loop delay of 23 ms. The maximum sampled spool size was 588.9 MiB.

A separate one-second process-tree sampler from 18:07:32 through shutdown included Parquet compression. Its maximum combined RSS was 298.1 MiB and maximum combined CPU was 128.8% of one core. These are sampled observations, not guaranteed upper bounds; native memory, short bursts, provider traffic, and the host workload can change them.

## Observed provider behavior

The final candidate captured an actual price-to-beat correction for the 18:00 UTC market opening. Both durations initially received `85302.26417473964`, then received `85302.18795109465` about 31 seconds later. The boundary PolyBolt TWAP carried `full_accuracy_value=85302.187951094652469248`. The recording preserves the initially available value and the correction as separate observations; it does not overwrite earlier history with hindsight.

The 18:00–18:05 market also encountered an upstream HTTP 400 response with body `{"error":"Chainlink API error 429"}` at 18:04:37.943 UTC. Its package contains exactly one uncertain PTB gap through market close. The concurrent 15-minute PTB request succeeded. This is recorded data-quality loss, not file corruption; it must remain visible when choosing backtest inputs.

The real downloaded package passed three shared-strategy pipeline checks: a strategy requiring PTB was skipped by default with zero ticks; explicit outage replay processed 126,090 market ticks; and a Polymarket-only strategy processed the same market normally because its required feed was unaffected. These checks made zero network attempts. Additional external-feed synthetic ticks are opt-in and explain why the full verifier reports a larger tick count for this package.

Polymarket also closed its book WebSocket twice with remote code `1013`. The recorder restored fresh snapshots for both outcome tokens after gaps of 1.339 seconds (18:06:49.195–18:06:50.534 UTC) and 2.556 seconds (18:07:10.239–18:07:12.795 UTC). Both overlapping market packages recorded the same intervals. No local watchdog or clock error preceded these closes; the server's internal cause is unknown. The other feeds continued receiving. These intervals disqualify affected markets from ordinary backtests that require Polymarket books, while explicit outage replay remains available.

The downloaded 18:05–18:10 package contained 145,041 rows. Two full-feed outage replays produced the same 130,611 ticks and the same digest, with exactly two observed cold-book ticks and two recoveries. Normal admission rejected the package. No future feed/settlement leakage or network attempts occurred.

## Strategy replay

An earlier complete five-minute recording contained 100,997 rows and produced 88,904 strategy ticks through `runSingleMarket` and the shared strategy runner. A private observer strategy requested every recorded feed, including Binance/Chainlink synthetic update ticks, and submitted no intents.

Two independent passes produced the same strategy-observation SHA-256:

```text
2fe9dcd19de7c06c868409d17eaa0129829f87de431a8d57d9e03366b47b9c8f
```

Every available feed snapshot had a receipt timestamp no later than its consuming tick. Official price to beat was naturally absent for the first 355 ticks: it was observed 917 ms after market start. Replay preserved that absence. Final settlement fields were excluded from strategy metadata, all requested feeds became available, normal coverage admission succeeded, and the offline harness made zero network attempts.

That package also completed a real R2 upload/read-back, event-file deletion, independent fresh-cache download, and equal file/replay hashes. The downloaded resolution observations included an official resolved outcome.

The final candidate's clean 18:10–18:15 R2 download also passed two normal-admission strategy replays: 144,568 rows produced 136,309 ticks, with every requested feed observed and no cold-book ticks, future-data leakage, or network attempts. Its strategy-observation digest was `e27a2c8479dc220a3bfdb750d40a086df367cb1f927bddbc49889421ecd726c8`.

The final 18:00–18:15 download was rejected under normal admission because of its two book-feed gaps. Two explicit outage replays produced the same 268,449 strategy ticks and two book recoveries from 298,868 rows. All feeds appeared without future-data leakage or network attempts. Its strategy-observation digest was `8a9dd67a6088536528adbd3aa8ade1a430aebb58dc0a9a0c8877f82824bdaefe`.

## Dashboard checks

The production dashboard was opened against a temporary local Redis instance carrying real recorder status. Feed activity, market rows/gaps, archive/resolution progress, and resource measurements rendered correctly. Stopping heartbeats changed the recorder to offline while preserving clearly labeled last-reported data. Stopping Redis displayed monitoring unavailability and unknown current state without presenting stale values as live. The temporary dashboard and Redis processes were stopped after validation.

## Remaining deployment checks

This is local functional and short-duration integration evidence. It does not establish days of uptime, the behavior of a future provider API revision, or recorder load alongside saturated worker-2 backtests. The 24-hour resolution confirmation policy was covered with controlled-time tests; this session did not wait 24 hours for a real confirmation.

Before unattended recording, deploy a pinned checkout and dedicated configuration on worker-2, confirm actual dashboard connectivity, and measure combined ingestion/compression load under the intended backtest workload. Keep the recorder's spool and configuration outside its checkout. The prepared macOS service template has not been installed.
