---
title: Recorder v3 — BTC 5m and 15m
description: Mixed-feed capture, crash recovery, verified R2 archival, deterministic replay, and operational monitoring.
---

# Recorder v3 — BTC 5m and 15m

Recorder v3 collects both BTC market durations on one host and writes **one self-contained mixed-feed Parquet per market**. Shared feed observations are intentionally copied into overlapping markets. The copies retain identical event IDs, receipt times, and sequence numbers.

The recorder runs independently of backtest workers and the trading bot. It does not initialize a wallet, an execution adapter, or order submission. Its default output is an R2 archive; local storage is a durable spool for active recordings and uploads awaiting verification.

## What is recorded

| Source | Observations |
| --- | --- |
| Polymarket market WebSocket | Raw book snapshots, price changes, trades, lifecycle messages, arrays, and other received frames for subscribed markets |
| Binance BTCUSDT | Aggregate trades and best bid/ask (`aggTrade`, `bookTicker`) |
| Chainlink through Polymarket PolyBolt | BTC/USD spot and 60-second TWAP, including provider and sequence metadata |
| Price to beat | Raw HTTP responses, availability time, request parameters, status, and later corrections |
| Market metadata | Discovery responses, token/outcome mapping, boundaries, and reference-price configuration |
| Capture control | Connection changes, detected gaps, initial state, and shutdown/recovery information |
| Official resolution | Observed Gamma status, winner/token, payout vector, PTB/final price when present, and raw source response |

Full Binance order-book depth, other symbols, and 1h/4h/daily markets are outside the first version.

### Current Chainlink and price-to-beat behavior

The implementation was checked against Polymarket's October 2026 APIs. Current BTC 5m and 15m markets expose an explicit 60-second TWAP configuration. The recorder reads and validates each market's actual configuration rather than inferring it from its duration. Unsupported or missing reference-price configuration is a visible failure.

PolyBolt uses `price.crypto` for spot and `price.crypto.twap` for TWAP. The recorder requests Chainlink, verifies the acknowledged/actual provider, and preserves provider sequence/drop information. A returned provider mismatch is a data-quality problem even if the socket remains connected. See Polymarket's [RTDS migration guide](https://docs.polymarket.com/migrate/rtds-to-polybolt), [live-data overview](https://docs.polymarket.com/api-reference/live-data/overview), and [changelog](https://docs.polymarket.com/changelog/predictions).

The website's `/api/crypto/crypto-price` endpoint is used to observe the published price to beat. Its request includes the market start/end, duration variant, and TWAP configuration. This website endpoint is not a stable documented public API. Its raw responses are preserved, and unavailable/invalid responses remain visible. A locally calculated average is never silently substituted for an official value.

## Receipt order and initial state

Every envelope has `captureId`, `sessionId`, `sequence`, `eventId`, `receivedAtMs`, `monotonicNs`, `source`, `connectionId`, `eventType`, `rawJson`, and optional request details. Decimal sequence numbers are stored losslessly. Provider timestamps and decimal prices remain in the original payload; they do not reorder the capture.

The global sequence establishes the order in which this Node process handled observations. Wall-clock receipt time assigns observations to the half-open interval `[market start, market end)`. Monotonic time measures local elapsed time and helps detect clock discontinuities. A restart reserves a new sequence range; unused sequence numbers are expected and do not imply provider packet loss.

The recorder discovers and subscribes to upcoming markets before they begin. It retains only the necessary current book/feed state for their bootstrap, with the original observation times. There is no five-minute prehistory added to every file. Bootstrap restores state without emitting historical strategy ticks. Subscriptions stay active across boundaries.

There is a 60-second finalization grace after market end for connection diagnostics and targeted metadata/resolution responses. Ordinary post-end price and book updates do not become strategy ticks for the ended market. This grace is not a guarantee against arbitrarily late upstream corrections.

This dataset represents receipt at the recorder process. It avoids estimating relative arrival delays between independently collected feeds, but cannot reproduce exchange matching, fills, or the network timing of another machine.

## Configuration

Use Node.js 20 and install root workspace dependencies with `npm ci`. Create a dedicated configuration file outside Git, for example `/absolute/path/to/.env.recorder`:

```dotenv
RECORDER_ID=worker-2-btc
RECORDER_SPOOL_DIR=/absolute/path/to/recorder-spool
RECORDER_TIMEFRAMES=5m,15m
RECORDER_R2_PREFIX=recorder-v3

POLYMARKET_API_KEY=replace-me
POLYMARKET_API_SECRET=replace-me
POLYMARKET_API_PASSPHRASE=replace-me

R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=replace-me
R2_ACCESS_KEY_ID=replace-me
R2_SECRET_ACCESS_KEY=replace-me

# Optional: the Redis used by the existing dashboard.
RECORDER_REDIS_URL=redis://host:6379
```

PolyBolt requires existing CLOB API credentials. These credentials are not scoped as read-only, although this recorder only uses them for feed authentication. No private key is needed. Use a dedicated file containing just the required credentials/settings; the recorder never imports the trading `.env` loader or changes `process.env`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `RECORDER_ENV_FILE` / `--env-file` | `.env.recorder` | Explicit configuration file |
| `RECORDER_ID` | Sanitized hostname plus `-btc` | Stable dashboard identity |
| `RECORDER_SPOOL_DIR` / `--spool-dir` | `data/recorder-v3` | Active journals, pending packages, operational state |
| `RECORDER_TIMEFRAMES` / `--timeframes` | `5m,15m` | Either or both BTC durations |
| `RECORDER_UPLOAD` | `true` | Enable R2 archival; `--no-upload` overrides it |
| `RECORDER_R2_PREFIX` | `recorder-v3` | Namespace for immutable R2 objects |
| `RECORDER_MAX_SPOOL_BYTES` | `21474836480` (20 GiB) | Local spool limit |
| `RECORDER_MIN_FREE_BYTES` | `21474836480` (20 GiB) | Minimum filesystem free space |
| `RECORDER_MAX_PENDING_BYTES` | `16777216` (16 MiB) | Pending capture-write memory allowance |
| `RECORDER_REDIS_URL` | `REDIS_URL`, if present | Optional dashboard connection |
| `RECORDER_STATUS_ENABLED` | Whether Redis is configured | Publish dashboard status; `--no-dashboard` overrides it |
| `RECORDER_DURATION_SECONDS` / `--duration-seconds` | Unset | Optional bounded validation run |

Exported environment variables override the selected file; command-line settings override both. `BOT_ENV` does not affect the recorder. Existing `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASSPHRASE`, and `CLOB_PASS_PHRASE` aliases are accepted.

## Start and stop

First perform a bounded local validation run:

```bash
npm run record:v3 -- \
  --env-file /absolute/path/to/.env.recorder \
  --spool-dir /absolute/path/to/test-spool \
  --no-upload --no-dashboard --duration-seconds 2100
```

A run of 35 minutes can include a complete 15-minute market regardless of its start time, plus several 5-minute markets and finalization grace. The market already in progress at startup is retained and marked incomplete.

For regular recording:

```bash
npm run record:v3 -- --env-file /absolute/path/to/.env.recorder
```

Use `Ctrl+C` or `SIGTERM` to stop. The recorder stops feed intake, cancels network maintenance, drains writes, and finalizes partial markets with coverage gaps. Pending or interrupted uploads remain for retry on the next run; shutdown does not wait through a long upload backlog. If physical free space is below the floor, it seals the journals for later recovery without starting compression. Do not remove the spool to recover from an error.

Use a separate deployed checkout pinned to the tested commit on worker-2. Keep the spool and environment file outside that checkout so a code update cannot replace them. Validate locally before installing or starting a worker-2 service. Backtest workers can use other checkouts; they do not own recorder state. Disable automatic sleep on the recording host and keep its clock synchronized.

### Prepared macOS service

`ops/macos/recorder-v3/com.polymarket.recorder-v3.plist.template` is a separate LaunchDaemon template. Preparing this file does not install or start a recorder. At deployment, replace `__USER__`, `__NODE20__` (absolute Node 20 executable), `__CHECKOUT__` (pinned recorder checkout), `__ENV_FILE__`, and `__LOG_DIR__`. Create the log/spool directories with ownership for that user, restrict the environment file to that user, and validate the rendered file with `plutil -lint` before installation.

The service runs the Node process directly, preserves the existing backtest service, and retries failed exits with a 60-second throttle. A clean stop does not immediately relaunch. Stop/unload the service before changing its pinned checkout or configuration. A forced timeout during shutdown leaves journals for recovery. Check `/recorders` after startup and after any update. The template does not manage log rotation; rotate `recorder.log` separately without deleting spool state.

## Durability, resource use, and R2 lifecycle

1. Received envelopes enter a bounded, durably flushed journal per market.
2. After market end and the diagnostic grace, a separate memory-limited process builds `events.parquet`. Compression does not block the capture event loop.
3. The package manifest records market identity, schema version, coverage, row count, byte count, and the SHA-256 of the Parquet.
4. The uploader writes the event object and reads the entire object back to verify bytes and SHA-256. It then publishes and verifies a content-addressed manifest.
5. Only after a durable archive receipt exists are the local Parquet and journals deleted.
6. Small resolution tasks/receipts remain locally until resolution follow-up and verified metadata upload are complete. They are then cleaned up.

An R2 object without a published manifest is not a discoverable completed package. Retrying an ambiguous upload verifies the existing object before deciding whether more work is needed. The downloader repeats integrity verification before replay. R2 uses its [S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/).

On restart, already finalized uploads are retried before opening live feeds. This lets a full spool recover after an R2 outage. New capture starts only after disk allowance is available; a disk read error or remaining exhaustion is reported and preserves pending data.

At runtime, the recorder checks spool size, filesystem free space, pending writes, event-loop delays, and clock discontinuities. Resource exhaustion causes a visible controlled stop and preserves unuploaded data. A disk limit is an operating guard, not a reserved disk partition; other processes can still consume free space between checks. CPU and memory measurements should be checked under the intended backtest load before leaving the machine unattended.

After a crash, restart with the **same spool**. Recovery reads the durable journals, ignores an incomplete final journal line, resumes or finalizes the affected package, and marks the outage. It does not fabricate missed observations. A single-owner spool lock prevents two recorder processes from writing the same capture state. Keep each independent recorder on its own spool.

## Resolution and later corrections

Resolution polling starts after market end and survives recorder restarts and event-file deletion. Closed/proposed/disputed states are distinguished from a verified final payout. The recorder preserves changed observations and rechecks a stable resolved result after 24 hours before retiring its local task. A revised terminal result restarts confirmation.

Resolution observations are small immutable sidecars under the same R2 package. They can arrive after `events.parquet` has been uploaded. Refresh/download the package to obtain newer observations. The latest official outcome is used for settlement reporting; later PTB, final prices, and outcome fields are not injected into earlier strategy snapshots.

## Find and download archived markets

The archive catalog is derived from verified R2 manifests; it does not depend on a database or files remaining on the recorder. List a duration and UTC date range:

```bash
npm run record:v3:data -- list \
  --env-file /absolute/path/to/.env.recorder \
  --timeframe 15m --from 2026-10-01 --to 2026-11-01
```

Download that selection onto the machine running backtests:

```bash
npm run record:v3:data -- download \
  --env-file /absolute/path/to/.env.recorder \
  --timeframe 15m --from 2026-10-01 --to 2026-11-01 \
  --output /absolute/path/to/recorder-cache/btc-15m
```

`--from` includes the opening timestamp; `--to` excludes it. Full timestamps must end in `Z`. `--prefix` selects a nondefault archive namespace. `--manifest` selects one exact committed manifest key or `r2://` URL instead of date/timeframe filters. This command needs only R2 credentials, never CLOB or wallet credentials.

Downloads are sequential and verified, refresh resolution observations, and reuse already verified local Parquet files. A failed download exits unsuccessfully and is safe to retry. Source objects in R2 are never deleted by these commands. Keep 5m and 15m download selections in separate cache directories when you want to backtest them independently.

## Coverage and backtests

Coverage records both confirmed loss and uncertainty: reconnect intervals, provider sequence gaps, missing initial books, stale feeds, late startup, interrupted capture, and observed clock/event-loop discontinuities. A connected socket alone does not prove complete upstream data. In particular, an unsequenced Polymarket stream cannot prove that no message was ever lost upstream.

Ordinary v3 backtests skip an entire market when a feed required by that strategy has an affected interval. A gap only in an unused optional feed does not automatically disqualify it. The recording remains available. Use `--allow-capture-gaps` explicitly to test outage behavior; this does not invent replacement data.

```bash
npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v3 --dir /absolute/path/to/downloaded-packages

npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v3 --dir /absolute/path/to/downloaded-packages \
  --allow-capture-gaps
```

The existing backtest queue/database configuration still applies. A package directory, its `manifest.json`, its `events.parquet`, or an `r2://bucket/.../manifest-SHA256.json` URL can select a recording. Workers download R2 inputs into a verified local cache. Selecting more than one recording of the same market is rejected; choose one capture explicitly.

Replay dispatches envelopes in recorded sequence through the shared market engine and strategy runner. Feed state is bound to the corresponding tick before asynchronous strategy work can run. Market snapshots at bootstrap do not trigger strategy history. Recorded receipt time replaces modeled historical feed-latency adjustments for this input mode.

The existing live trading command has not been migrated to PolyBolt or Binance book-ticker ingestion. Requests for newly recorded feed capabilities that it cannot supply fail explicitly. A future live strategy consuming those capabilities must use the same dispatcher/feed semantics; a successful v3 backtest alone does not establish live execution parity for an unsupported feed.

## Dashboard

Open **More → Recorders** in the existing dashboard. It shows recorder state, last heartbeat, feed ages and reconnects, active markets, gaps, spool/free space, archive progress, resolution backlog, CPU/RSS, and recent completed packages. An absent heartbeat becomes stale/offline rather than making a recorder disappear.

Redis is optional for recording. Local `status.json` is written in the spool. Redis/dashboard failure does not interrupt capture. There are no Slack messages or other notifications.

CPU/RSS metrics describe the ingestion process. The separate Parquet compression process is bounded to a 512 MiB JavaScript heap but consumes additional CPU and native memory while it runs; include it when measuring total host load.

## Verification and recovery checks

Inspect a local or downloaded package without starting a strategy, database, or network client:

```bash
npm run record:v3:verify -- /absolute/path/to/package-directory
```

This verifies file integrity, every row, sequence/receipt ordering, manifest row counts, and replay through the shared dispatcher. It reports source counts, feed counts, strategy-tick count, coverage, and a deterministic replay digest including order-book/feed snapshots. The digest excludes the cache path, so it can compare an original package with an independent R2 download. Incomplete coverage is reported separately from corruption.

`npm run record:v3:test` covers feed parsing, sequence ownership, recovery, archive integrity, resolution tracking, and deterministic replay. These tests run in CI alongside the existing strategy/trading regressions.

Before deployment, also validate real feed subscriptions, a complete market for each duration, correct current PTB, market transitions, clean shutdown/restart, actual R2 upload/read-back/deletion, fresh-cache download, and replay. Record the tested commit, elapsed capture time, CPU/memory/disk observations, and any detected gaps. A short connection smoke test is not evidence of long-term operational reliability.

See the [October 2026 validation report](./recorder-v3-validation) for the measured local results and remaining deployment checks.
