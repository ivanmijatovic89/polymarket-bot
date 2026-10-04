---
title: Recorder v3 second audit — October 2026
description: Independent code review, failure injection, real backtest CLI results, and a second simultaneous capture before deployment.
---

# Recorder v3 second audit — October 2026

This follow-up tests implementation commits `76a2913a` and `521eb946` on Node.js 20.19.6. The latter adds only the PTB retry improvement and its tests after the longer capture exposed repeated rate limits. Three independent reviewers covered ingestion/replay, storage/resolution, and the real backtest pipeline, then cross-reviewed the fixes. The [initial validation report](./recorder-v3-validation) remains a record of the earlier candidate; the [operating guide](./recorder-v3) describes current commands and R2 layout.

Testing used an isolated local checkout, private MySQL and Redis instances, and separate R2 validation prefixes. No worker-2 service was changed or started. Live capture used market/feed authentication without wallet signing or order submission. Backtest execution was simulated.

## Automated verification

The final candidate passed all 131 recorder tests, including the new PTB retry cases. All 256 trading/shared-runtime tests passed after the shared clock fix; root TypeScript and ESLint also passed. Validation of the new Polymarket frame checker streamed 732,016 rows from four existing real packages, including 679,103 Polymarket frames, with no false rejection. The resolution validator accepted 18 preserved official observations, a fresh Gamma response, and 90 controlled lifecycle, token-order, and payout variants, including split resolutions.

All four jobs passed in the [quality run for `521eb946`](https://github.com/ivanmijatovic89/polymarket-bot/actions/runs/37226490141): root checks/regressions, WebUI, dashboard, and documentation, using clean CI dependency installation.

## Defects found and fixed

| Finding | Result after the fix |
| --- | --- |
| Malformed Polymarket JSON or an invalid book side could retain complete coverage or mutate an order book | A shared validator preserves the raw frame, records a gap, clears affected books, and requests fresh snapshots. Explicit outage replay skips the invalid mutation and applies the same reset semantics. |
| A malformed archive receipt could authorize local event deletion | Receipt validation binds deletion to the exact local manifest hash and recorded verification time. Invalid receipts preserve the event files. |
| A changed resolution outbox payload could be uploaded or used by local replay under its old checksum name | Local replay, upload, download, and recovery verify the sidecar hash and validate market identity, lifecycle status, winner mapping, and payouts. |
| A crash during a revised final outcome could reuse the previous outcome's confirmation clock | The revised observation starts a fresh 24-hour confirmation period. Completion markers are validated before task retirement or metadata cleanup. |
| An early failed archive batch or the first eight resolution tasks could starve later work | Bounded archive passes continue through unvisited packages when disk recovery needs them; resolution polling advances fairly through tasks. |
| Download failure could expose a manifest before its resolution sidecars were verified | Sidecars are verified before publication. Failed refreshes preserve the prior verified cache; conflicting manifests for one recording identity are rejected. |
| Newly created directory entries lacked parent-directory durability; orphan temporary files could prevent final cleanup | New directory entries are synced. Cleanup removes only recognized temporary files after validated archive and resolution completion; unknown or committed files still block deletion. |
| Five-minute backtests could save the legacy 15-minute default in run metadata | Both sequential and queued paths save the actual selected duration, or null for a mixed batch. |
| Historical strategy order IDs could depend on the current machine clock | The shared portfolio clock initializes from the first observed tick/account event. Live and replay use the same implementation, preserving snapshot caching and out-of-order account handling. |
| CLI configuration failures concealed useful argument errors | Known safe configuration messages are actionable; runtime/SDK errors remain sanitized to avoid exposing credentials or URLs. |
| The longer live run exposed alternating successful PTB responses and rate limits without slower retries | PTB polling now backs off on failure, honors `Retry-After`, and retains a learned cooldown after rate limiting. Ordinary initial failures retain faster recovery. Raw responses and coverage gaps remain visible. |

## Actual backtest CLI and worker pipeline

Tests invoked the real CLI, persisted runs into an isolated migrated MySQL database, and exercised both `--sequential` and BullMQ producer → forked market worker → aggregation worker. Comparisons included strategy results, event counts, simulated fills, shares, cost, fees, settlement, and PnL; run IDs and execution duration were excluded.

| Recording and strategy | Market ticks | Simulated fills | Official outcome | PnL | Sequential/queued results |
| --- | ---: | ---: | --- | ---: | --- |
| 17:50–17:55, `placeLimitOrderAndCancelAfterFewSec.v1` | 87,577 | 1 | Down | -2.1300 | Equal |
| 18:10–18:15, same strategy | 135,432 | 1 | Up | +2.9700 | Equal |
| 18:10–18:15, `basicFak.v1` after the shared clock fix | 135,432 | 2 | Up | +0.1000 | Equal |
| 18:00–18:15, `basicFak.v1`, explicit outage replay after resolution refresh | 265,397 | 2 | Down | +0.1000 | Equal |
| 18:00–18:15, limit strategy holding through settlement, explicit outage replay on `521eb946` | 265,397 | 1 | Down | +2.4100 | Equal |

These are pipeline fixtures, not strategy-performance claims. Earlier runs used the candidate changes before they were committed; the final R2 worker check below records the committed revision explicitly.

On committed revision `76a2913a`, the CLI also selected an actual R2 manifest URL. A forked worker downloaded its package into an empty private cache, verified it, ran `basicFak.v1`, and persisted the completed batch. Its 135,432 ticks, two fills, official Up settlement, and +0.1000 PnL matched a local sequential replay on that same revision. A network guard permitted only the private database/Redis and the selected R2 host; wallet/live execution imports were blocked by the validation harness.

On final source revision `521eb946`, a 15-minute held-position test also matched between local sequential and R2-manifest queued execution. It bought five Down shares at 0.50, paid 0.09 fees, and held them through official Down settlement: cost 2.59, payout 5.00, PnL +2.4100. This exercises settlement of an open position as well as intramarket fills.

The external-feed example strategy observed Binance, Chainlink, and PTB; the first tick correctly had no PTB before its recorded arrival. A mixed batch completed its clean five-minute market and persisted the gapped 15-minute market as skipped/failed, leaving the batch partial. Explicit outage replay initially reported unresolved settlement while its downloaded sidecar was pending. After a verified resolution refresh, that same file completed both replay paths with official Down settlement; normal admission still rejected its gaps with zero ticks. No winner was inferred from the last quoted price. Timeframe selection, `--latest`, `--limit`, and mismatched-duration rejection were also exercised.

## R2 integrity and failure injection

A copied real recording with 144,568 rows and 15,393,233 Parquet bytes was used under `recorder-v3-validation/2026-10-04-audit-faults`. Corrupting its local archive receipt preserved its WAL and Parquet with no remote calls. Restoring the test fixture allowed a real upload, complete remote read-back, verification, and local event deletion. A corrupt resolution sidecar was retained before any PUT; the repaired fixture uploaded, verified, and was removed locally.

A fresh download matched SHA-256 `fb97ec87e72bcc4c71ee5e200bca66b816d482c5ae530e6e5f86a5dd2d8727b3` and its official resolved sidecar. Injecting a sidecar GET failure preserved the existing verified cache and left a fresh destination unpublished. Original recordings were not modified by these fault injections.

## Second simultaneous capture

The recorder restarted on `76a2913a` at approximately 18:44:18 UTC using the same validation spool, preserved its capture identity, and archived the preceding run's pending event files before new intake. Both upcoming 18:45 markets had fresh books before opening. Their bootstrap boundaries were exactly 18:45:00.000; the two book observations were 167 ms old, and all shared feed bootstrap values had original preboundary receipt times. The first PTB arrived at 18:45:00.756 for 15m and 18:45:00.757 for 5m and was correctly absent earlier.

All four full-duration packages uploaded, passed complete R2 read-back verification, and had their local event files removed. Fresh downloaded copies passed the verifier for every row, file digest, sequence boundary, and replay state. The resumed 15-minute journal retains 40 earlier pre-open metadata rows; its bootstrap and actual trading window were recorded by `76a2913a`.

| Market interval (UTC) | Duration | Rows | Parquet bytes | Recorded gaps |
| --- | --- | ---: | ---: | --- |
| 18:45–19:00 | 15m | 263,745 | 27,773,850 | Nine PTB intervals; two book interruptions |
| 18:45–18:50 | 5m | 102,602 | 10,991,657 | Four PTB intervals; one book interruption |
| 18:50–18:55 | 5m | 100,053 | 10,817,460 | Five PTB intervals; one book interruption |
| 18:55–19:00 | 5m | 114,364 | 12,024,847 | One PTB interval; book coverage complete |

Shared-feed comparisons found 8,933, 6,836, and 9,012 matching frames across the respective five-minute overlaps with the 15-minute file: 24,781 total, with zero missing or different copies. Original payloads, event IDs, sequence, connection/session identity, wall-clock receipts, and monotonic receipts matched exactly. The comparator verified each file's byte count and SHA-256 before reading it.

The live endpoint repeatedly alternated successful PTB responses and HTTP 429 responses at the original 30-second cadence. It also returned HTTP 400 with a body identifying a Chainlink 429. Each market had one poller with nonoverlapping requests; there was no duplicate same-market polling. The retry change in `521eb946` follows this evidence. The website endpoint has no listed quota in Polymarket's [public API rate-limit page](https://docs.polymarket.com/api-reference/rate-limits), so the observed cadence is not treated as a guaranteed provider limit.

Polymarket remotely closed the book WebSocket with code `1013` at 18:48:51.679 and 18:51:38.681. Both markets recorded gaps starting at the last received data, followed by fresh books after 1,103 ms and 1,540 ms. Neither interruption was preceded by a malformed-frame or local watchdog reconnect. The server's internal reason remains unknown.

The fresh 18:45–18:50 package also completed real local sequential, queued, and R2-manifest outage backtests: 89,790 market ticks, two simulated fills, official Down settlement, and +0.1000 PnL, with matching persisted results. Normal admission rejected it with zero ticks. An independent PTB observer saw 185 initial ticks without PTB and three recoveries at recorded publication times; failed requests retained the last known observation without advancing its receipt time or leaking future data. One cold-book tick and its recovery were reproduced.

After official resolution arrived, the fresh 18:45–19:00 file completed sequential, local queued, and R2-manifest queued outage runs on `521eb946`: 231,224 market ticks, two simulated fills, official Down, and +0.1000 PnL, with identical persisted results. Its ordinary admission still rejected the book gaps. The 18:55–19:00 file completed ordinary Polymarket-only sequential and queued runs with 99,312 ticks, two fills, Down, and +0.1000 PnL. A PTB-requiring strategy rejected that same file's PTB gap before any ticks, confirming that coverage admission depends on the strategy's required feeds.

### Measured resources

Across 193 five-second status samples from 18:45:04 through 19:01:13, ingestion averaged 8.48% of one CPU core, with sampled maxima of 15.58% CPU, 124.42 MiB RSS, and 14.45 ms event-loop delay. A separate startup observation reached 154.2 MiB ingestion RSS. Including the compression child, sampled maxima were 315.80 MiB RSS and 166.1% CPU. The spool reached 539.27 MiB. These are local sampled measurements, not upper bounds or measurements of worker-2 under load.

## Live verification of the final retry change

The recorder restarted on frozen `521eb946` at 19:01:34, using the same spool and separate validation R2 prefix. It drained three pending packages before opening feeds. This additional run tested both duration pollers concurrently and a full 19:05–19:10 five-minute market; its 19:00–19:15 recording is partial because the process started after opening and stopped before closing. The full 15-minute capture above belongs to `76a2913a`; the only subsequent runtime change is PTB retry scheduling.

Real 429 responses produced measured waits of 60,001 ms and 120,001 ms before later requests. A 15-minute poller retained its slower floor after success, while healthy polling initially continued every approximately 30 seconds. Raw failures and retry details remained in the journal. This demonstrates reduced retry pressure and correct scheduling, not restored provider availability.

The full final five-minute package contains 169,354 rows and 17,640,098 Parquet bytes. Both books were ready at its bootstrap, 24 ms after the boundary. All three PTB requests returned 429; no official PTB value was obtained for that window. A separate remote book close with code `1013` produced a 422 ms gap, after which both books recovered. Both gaps remain in the manifest. Its next backed-off PTB attempt would fall after market end and was not sent. The package uploaded and was verified before local event deletion at 19:11:14.

Its fresh R2 download passed full-row verification with SHA-256 `43702e06953be93d474a18fae5bfbd60ca6f539cbdfd1cc3c6a1ac5de37fec68`. Actual sequential and R2-worker outage replays processed 148,992 market ticks; a feed observer confirmed PTB absent on every tick and reproduced one cold-book tick and recovery. Ordinary admission rejected the book gap before replay. Official settlement remained pending at shutdown, so these runs reported unresolved outcome rather than invented PnL. The settled final-source comparisons above provide the separate settlement evidence.

Across 108 five-second samples from 19:02:23 through 19:11:22, this run averaged 10.22% ingestion CPU with sampled maxima of 16.55% CPU, 169.17 MiB ingestion RSS, and 5.54 ms event-loop delay. Including compression, sampled peaks were 259.23 MiB RSS and 117.7% CPU. The spool peaked at 395.59 MiB.

## Shutdown and retained test state

Both validation recorder processes stopped cleanly with `SIGTERM` and exit zero. Guarded maintenance then verified and archived the two finalized partial packages produced by the final shutdown. The spool has no Parquet or temporary Parquet files and no committed resolution outbox entries. Three unfinalized future-market prefetch journals, totaling 284,822 bytes, remain because they were never archived; sixteen pending resolution tasks remain for later official updates and 24-hour confirmation. No unverified data was deleted, and maintenance reported no archive or resolution errors. Downloaded replay caches are separate intentional test artifacts.

The private backtest evidence records 46 actual CLI runs, including 11 matching settled-result comparisons. Expected failures cover missing official outcomes and required-feed gaps; they are not counted as completed backtests. Temporary workers, MySQL, and Redis were shut down after evidence export. No worker-2 service was touched.

## Limits and deployment

These checks establish specific functional and integration results, not a guarantee of uninterrupted external feeds. Required-feed gaps still disqualify the whole affected market in ordinary backtests. Local recordings preserve what this process observed; simulated fills do not establish real exchange execution.

The 24-hour confirmation and crash cases use controlled tests. A real 24-hour confirmation soak, worker-2 service installation, dashboard connectivity from that host, and resource measurement alongside its intended backtest workload remain deployment checks.

The first unattended soak should also measure how many markets are usable for each strategy's required feeds. Recorder uptime and successful R2 uploads alone do not establish a useful PTB dataset when the upstream endpoint is rate limiting requests.
