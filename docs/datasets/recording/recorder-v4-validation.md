---
title: Recorder v4 validation
description: Compact-format parity, namespace protection and rollout evidence.
---

# Recorder v4 validation

This report covers the October 6, 2026 V4 implementation. The [format guide](./recorder-v4) defines the archive contract; the [worker-2 guide](./recorder-v4-worker-2) defines the isolated installation. Earlier V3 reports are historical evidence, not proof of a V4 deployment.

## Archive safety

The rollout creates new objects only beneath `recorder-v4/`. Local validation uses `recorder-v4/validation/local-2ec6ad8d-f63d-4b64-8ec1-6eae8c606fa3/`. No existing R2 object is deleted, migrated, renamed or overwritten, and no bucket or lifecycle configuration is changed.

After the completed rollout, the operator reported manually deleting `recorder-v3/` and `recorder-v3-validation/` on October 6. This was a separate retirement of the old trial recordings, not an action of the V4 installer or recorder. V4 uses neither prefix. The historical preservation statements below describe the deployment itself; keep the old V3 service disabled so its retained local backlog cannot recreate retired data. Current operating commands are in the [worker-2 guide](./recorder-v4-worker-2#routine-status-stop-and-start).

The network adapter rejects operations outside the V4 namespace before making a request. Conditional PUT prevents replacement of an existing object. Publication and local event cleanup still require complete read-back with matching SHA-256 and byte count. Tests cover prefix escapes, sibling prefixes, conflicting objects, interrupted uploads, corrupted manifests and mismatched local receipts. The catalog excludes child validation namespaces unless explicitly selected.

A live R2 test created one new 47-byte object under this run's `safety-probe/` child, then attempted a conditional replacement of that test object only. R2 returned HTTP 412 and a fresh GET matched the original checksum. The original test object remains; no deletion was attempted. This tests actual endpoint behavior in addition to mocked SDK requests.

V4 requires a separate spool and rejects V3 sequence state. Interrupted compact intermediates are removed only under the spool lock or from a verified archived package, with schema, filename and entry-type guards. Durable journals, V3 state, unrelated files and symlinks are preserved.

## Retained data and strategy parity

Two real V3 trial fixtures were downloaded read-only and converted privately for comparison. The retired reader is not shipped in V4. The comparison checks every envelope field and every parsed payload field, except the explicitly omitted recognized per-change hashes and the schema version change. Unknown payload text remains byte-exact. Both files preserve their original row counts and receive sequence.

| Fixture | Event rows | Original V3 bytes | V4 compact bytes | Reduction |
| --- | ---: | ---: | ---: | ---: |
| BTC 5m, `btc-updown-5m-1791151800` | 240,595 | 22,243,511 | 4,382,552 | 80.3% |
| BTC 15m, `btc-updown-15m-1791153900` | 409,674 | 39,338,307 | 6,894,018 | 82.5% |

These compare the same captured events. They are not an average storage forecast. Only 703 and 2,108 rows respectively require raw fallback. The format uses JavaScript Zstandard decoding, not an optional WASM path.

The unchanged `SplitSellRedeem.v5` strategy ran through production `runSingleMarket` on the 15m fixture. All 315,796 market callbacks, order books, strategy contexts, decisions, account events and final statistics match the previously verified compact experiment. Binance snapshots were present at all callbacks and website PTB at 315,668. This strategy does not request Chainlink; a separate observer explicitly requested every supported external feed on both durations.

| Proof | SHA-256 |
| --- | --- |
| V5 normalized ticks | `f45306cd71368818b1bef0f9cfae57b50237cfa82846b3ba36137764cc61925b` |
| V5 order books | `c532cad2ab9857625372db22f5f8d8c17204e2df3fcad69d2af7fb09c44cde21` |
| V5 contexts, decisions and account flow | `e62460962195ac0f2d7c0ce3b4e32f740a643b514926b25b89bf35135a7dce55` |
| V5 final statistics | `25b923b3126f2a06caa50ad323248521a6e65173709e972b24d1f1ee6071ed82` |
| All-feed 5m replay, 183,027 callbacks | `b2e2077ff7a9c42885b460b6b2c7bae5a3185d3340a34225ac29b62f4f5e89d4` |
| All-feed 15m replay, 321,831 callbacks | `135eeb0fc422df44040a4530e567cf1a05c4aeb3add1940b1b64dcd5e8fd381d` |

All-feed snapshots include Binance aggregate trades, Binance best bid/ask, Chainlink spot, Chainlink TWAP, website PTB and the selected opening reference. The clean 5m fixture passes ordinary admission; the known incomplete 15m fixture uses explicit outage replay. Diagnostic hashing is deliberately excluded from performance timings.

The final production reader was timed separately against the same August 25 Telonex reference used in earlier experiments. One warm-up per case was discarded, then three fresh processes per case were interleaved with correctness instrumentation disabled. Builds and other replay tests had finished; the bounded local recorder remained running in the background.

| 15m workload | Market-file size | Median replay time | Range |
| --- | ---: | ---: | ---: |
| Telonex reference plus its ordinary Binance/PTB inputs | 4.68 MB, excluding separate feed files | 5.33 s | 5.25–5.35 s |
| V4 production compact reader, all captured feeds in its file | 6.89 MB | 6.96 s | 6.90–7.07 s |

The unchanged V5 strategy requests Binance and website PTB in both cases; it does not request Chainlink. Timing includes integrity/admission, feed loading, replay and strategy/execution work, but excludes process imports, downloads and database persistence. These are different markets, so the approximately 31% longer V4 run is a workload comparison, not an equal-data codec penalty or a fleet throughput forecast. Production timing must not be replaced with the faster earlier scratch-decoder measurements. The all-feed correctness tests above cover the additional feeds separately.

Offline proof processes block network connections, environment-file reads and live execution imports. These tests place no real orders and do not access trading credentials. The shared `MarketEngine` normalizes only the recognized unused change hashes, so live and backtest strategy messages remain aligned. The dashboard market simulator remains unsupported for recorder input; this work validates the normal backtest runner and CLI package path.

## Tests and review

The local test suites passed 822 tests: 204 recorder, 260 trading, 58 dashboard, 107 global runtime, 34 strategy artifacts, 18 feed coverage and 41 research dataset tests. Root TypeScript/ESLint, formatting, WebUI typecheck/build, dashboard typecheck/build, docs build and research protocol/index checks passed.

Two independent reviews covered storage/R2 safety and replay semantics. Findings fixed before release included child-prefix catalog handling, stale V3 jobs falling through to another replay mode, unpaired Unicode handling, and interrupted intermediate cleanup. A repeated malformed-journal test exposed an asynchronous file-open cleanup race; the writer now opens its temporary file before consuming the input generator and closes it before cleanup.

An initial full-size conversion using a global SQL sort exceeded the finalizer's 256 MiB DuckDB limit. The writer now streams the journal in its already validated sequence order. DuckDB documents order preservation for `read_json`, single-table `SELECT` and `COPY` with `preserve_insertion_order=true`; the V4 reader independently rejects any non-increasing sequence. See [DuckDB's order-preservation documentation](https://duckdb.org/docs/current/sql/dialect/order_preservation).

## Deployment boundary

Local controlled capture receives both durations and all six feeds. Startup partials and Polymarket reconnects are retained with coverage gaps. Validation uploads have passed read-back and local event cleanup under the dedicated validation prefix. The local test uses a 15 GiB free-space floor and 2 GiB spool limit because this laptop had less than the production 20 GiB floor available; production defaults remain unchanged.

Fresh downloads of the following complete live captures passed every-row verification and ordinary all-feed backtest admission. The no-order observer returns `no_activity` after replay; that is not a coverage rejection. Recorded official outcomes were available before these final checks.

| Live market | Rows | Bytes | Replay callbacks | Official outcome |
| --- | ---: | ---: | ---: | --- |
| `btc-updown-15m-1791281700` | 337,241 | 5,383,590 | 256,980 | Down |
| `btc-updown-5m-1791282000` | 158,970 | 2,904,008 | 129,391 | Up |

Their deterministic replay hashes are `558399e83e1b303764a43cb8bda608b01cf878806d3e35e97acef034eeda05b4` and `0f2b2767479cd7e32dc2717f07846debcfcf4c40364acf44d78cb677cdcc49fb`. An independently captured 5m market, `btc-updown-5m-1791281700`, has one recorded gap: ordinary replay produced zero callbacks and `incomplete_capture`; explicit outage replay processed 105,776 callbacks. A later clean market replayed its ticks but reported `unresolved_outcome` while the official resolution was still pending. The recorder does not invent a settlement to make a validation run pass.

The unchanged `SplitSellRedeem.v5` also completed ordinary backtests on the two settled complete live files: 248,044 and 126,218 market callbacks respectively. Both executed the expected 10-share split and received Binance and website PTB snapshots. These are additional live-file integration checks, not a profitability evaluation.

Local validation stopped cleanly. Two partial packages whose upload was aborted by shutdown were subsequently uploaded and verified through a bounded maintenance pass on the stopped validation spool. The event files and journals were removed only after matching archive receipts; remote objects remain. That pass also continued the independent resolution outbox.

Worker-2 switched from its separately pinned V3 release to V4 at 10:55 UTC after controlled host validation. Existing V3 configuration, spool, release and archives are preserved. The stopped V3 service no longer advances its old resolution backlog. No long-term reliability or gap-free-provider guarantee follows from these bounded tests.

The implementation merged in [PR #290](https://github.com/ivanmijatovic89/polymarket-bot/pull/290), with all four required CI jobs passing. The reviewed release is `c90ac75dcdf3f5c4d113c9b2a69eca7268bcca05`, included by merge commit `c4deb7416d3b6908901e40b446aab8250a108770`. Its lockfile SHA-256 is `7f6808f6e5218cfff7ec4c79469108c0dde85be0ec5c6235a64d7b160d40e002`. Worker-2 installed that exact checkout with Node 20.20.2 and passed its compact/R2 boundary tests. No fleet checkout or backtest worker was updated.

The service switch persistently disables V3 before unloading it, preserving its plist for rollback. Error and HUP/INT/TERM handlers attempt to restore the prior service while preserving both spools and all R2 objects. Six mocked-command tests cover command failure, each signal, failure before the switch and failure after a committed switch. The rendered plist and shell syntax were checked locally and on worker-2. The operator subsequently completed administrator activation.

## Worker-2 controlled validation

The pinned V4 release completed a 10-second no-upload smoke test, followed by a bounded capture from 10:29:22 to 10:48:03 UTC. Both exited with code zero. The continuous V3 service remained running during this test. V4 used only `recorder-v4/validation/worker-2-f6c9d9a3-fcc3-4610-9540-a9865e3d6cf7/`, a separate spool, and a separate dashboard identity. A maintenance pass on the stopped validation spool completed two partial uploads and continued resolution tracking.

All four full-duration archives below passed every-row verification on worker-2. Independent downloads and offline replay on the control Mac produced identical bytes, sequence bounds, row counts, tick counts and deterministic replay hashes.

| Worker-2 market | Rows | Parquet bytes | Coverage | Ordinary all-feed replay |
| --- | ---: | ---: | --- | --- |
| `btc-updown-15m-1791282600` | 356,196 | 6,275,499 | Complete | 279,381 callbacks; settled Up |
| `btc-updown-5m-1791282600` | 167,869 | 3,084,638 | Two Polymarket disconnect gaps | Rejected with zero callbacks; explicit outage replay processes 139,859 |
| `btc-updown-5m-1791282900` | 144,254 | 2,707,664 | Complete | 115,904 callbacks; settled Down |
| `btc-updown-5m-1791283200` | 73,048 | 1,320,803 | Complete | 52,557 callbacks; official outcome still pending at download |

The complete 15m and selected complete 5m replay hashes are `9167f1e84dab39ff68658a2f0db3e8116e6b105e6caf52535fbd4ff7db11b23c` and `6512074c8ebd47f9088ba82abb5a8e10920306fbe21f1f9d1f4176145604c6fa`. Archive receipts were present and the corresponding local Parquet, WAL and conversion intermediates were absent after verified upload. Separate validation download caches were used only for replay verification.

Across 209 samples taken every 2.5 seconds near the end of collection, peak observed ingestion RSS was 183.3 MiB and finalizer RSS 263.0 MiB. Median ingestion CPU was 15.2% of one core, maximum sampled event-loop lag 11.6 ms, and free space remained above 90.4 GiB. Sampling can miss brief peaks; these figures do not establish performance under every future market or concurrent backtest load. The production dashboard reader successfully read the validation identity from Redis, classified it online, and showed all six feeds receiving data.

The validation-approved marker identifies the tested release. These bounded tests preceded the administrator activation documented below. The stopped validation identity was removed only from the Redis dashboard membership set after confirming its stopped status and PID; its local status, Redis status record and R2 data remain.

## Continuous production activation

The operator ran `/Users/worker-2/Services/polymarket-recorder-v4/activate-recorder-v4.zsh` with administrator privileges. V4 started at 10:55:00 UTC on October 6, with PID 43225, using the exact tested release. Inspection confirmed `com.polymarket.recorder-v4` running as `worker-2`, V4 persistently enabled, and V3 unloaded and persistently disabled. Both old configuration and spool remain. V3 stopped with two pending partial uploads and 503 scheduled resolution/confirmation follow-ups; those retained tasks are not processed by V4.

All six production feeds were receiving data, and the V4 dashboard reader successfully consumed the production Redis status. At this activation check, the primary control-Mac checkout, its running dashboard and fleet checkouts were left unchanged for a separate rollout. Those consumers need the merged V4 code to display the new namespace or dispatch V4 backtests. Active backtest jobs were not changed during recorder activation.

The first production archives use `recorder-v4/btc/<timeframe>/<slug>/<recording-id>/`. Both startup markets are incomplete because observation began after their required boundaries. Downloads on worker-2 and the control Mac passed every-row verification with identical bytes, receive-sequence bounds, replay callback counts and deterministic hashes. Ordinary all-feed backtests rejected both with `incomplete_capture` and zero callbacks; explicit outage replay read the captured feeds using the recorded website PTB. Their exact Chainlink opening reference is unavailable, as expected for these startup partials.

| Production startup market | Rows | Parquet bytes | Outage replay callbacks | Replay SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `btc-updown-15m-1791283500` | 144,563 | 2,348,462 | 118,845 | `777bc3fb48a9d5420e089152f49cf829842a98e024a7d50539ed7dca86fe93d4` |
| `btc-updown-5m-1791284100` | 164,158 | 3,018,708 | 135,592 | `1b543cfd09be85150d17391ce4d698f0339bd2e818fd4e55d0ac2fe9e41c7cb4` |

Matching archive receipts were present on worker-2, and these packages' local event Parquet, WAL and conversion intermediates had been removed after verified upload. Their metadata and resolution tasks remain. Official outcomes were still pending at the first independent download; resolution tracking continues separately. Existing R2 objects were neither deleted nor overwritten.

The first complete production 5m market, `btc-updown-5m-1791284400` (11:00–11:05 UTC), subsequently uploaded with zero coverage gaps: 132,119 rows and 2,509,534 Parquet bytes. Independent verification on both Macs matched 109,076 replay callbacks and hash `ce0bb61e26bff834e0997cca35694f38d30700a34e3a536085253c9b6e20fbe1`; its verified local event files were cleaned up. Ordinary all-feed replay admitted the capture and exposed the recorded Chainlink opening reference, Chainlink spot/TWAP, Binance trades/book ticker and PTB. It returned `unresolved_outcome` after replay because official settlement was still pending in that download. The complete 15m controlled capture above establishes full-duration validation; the first full 15m continuous-service market was still recording at this check.


## Dashboard and backtest fleet rollout completed (October 6)

After the operator confirmed that no backtests were active, the primary checkout and all fleet checkouts were updated to `476f6949e735143cb9e1a65b4841edf998e487c4` (PR #293, including the V4 runtime from PR #290). The dashboard was restarted and its API and Recorders page showed V4 online with all six feeds and opening-reference diagnostics. The existing Global Runtime stayed running.

All 17 market-worker processes reported the loaded V4-capable commit: worker-1 retained six workers, worker-2 three, milan-m1 four, and the control Mac four. Worker-1 retained the aggregation queue. Node 20 was verified; remote shell commands explicitly put the selected NVM binary directory first where a user-local Node shim otherwise took precedence. No recorder service restart was needed; worker-2's pinned V4 PID remained 43225.

A queued production-package smoke test used `readExternalFeedsExample.v1`, `--input-mode recorder-v4`, `--timeframe 5m`, and `priceToBeatSource=chainlink-opening-twap` on `btc-updown-5m-1791284400`. Batch `823dec91-d929-448f-84e3-fb03bbe96db1` ran on milan-m1 and completed aggregation with **1 succeeded, 0 failed, 0 skipped**, in 8.04 seconds. Official settlement was available by this run. The observer strategy emits no orders; this verifies fleet download/admission/replay/result persistence, not strategy profitability.

The recorder continued capturing throughout the consumer rollout. At its final check it had 20 archived packages, zero pending uploads, and no archive errors. Provider disconnects can still mark later markets incomplete; these rollout results do not imply future gap-free coverage.
