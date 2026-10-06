---
title: Recorder v4 — BTC 5m and 15m
description: Mixed-feed capture, crash recovery, verified R2 archival, deterministic replay, and operational monitoring.
---

# Recorder v4 — BTC 5m and 15m

Recorder v4 collects both BTC market durations on one host and writes **one self-contained mixed-feed Parquet per market**. Shared feed observations are intentionally copied into overlapping markets. The copies retain identical event IDs, receipt times, and sequence numbers.

The recorder runs independently of backtest workers and the trading bot. It does not initialize a wallet, an execution adapter, or order submission. Its default output is an R2 archive; local storage is a durable spool for active recordings and uploads awaiting verification.

## What is recorded

| Source                                | Observations                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Polymarket market WebSocket           | Book snapshots, price changes, trades, lifecycle messages, arrays, and other received frames; see the compact field contract below |
| Binance BTCUSDT                       | Aggregate trades and best bid/ask (`aggTrade`, `bookTicker`)                                                            |
| Chainlink through Polymarket PolyBolt | BTC/USD spot and 60-second TWAP, including provider and sequence metadata                                               |
| Price to beat                         | Raw HTTP responses, availability time, request parameters, status, and later corrections                                |
| Market metadata                       | Discovery responses, token/outcome mapping, boundaries, and reference-price configuration                               |
| Capture control                       | Connection changes, detected gaps, initial state, and shutdown/recovery information                                     |
| Official resolution                   | Observed Gamma status, winner/token, payout vector, PTB/final price when present, and raw source response               |

Full Binance order-book depth, other symbols, and 1h/4h/daily markets are outside the first version.

### Current Chainlink and price-to-beat behavior

The implementation was checked against Polymarket's October 2026 APIs. Current BTC 5m and 15m markets expose an explicit 60-second TWAP configuration. The recorder reads and validates each market's actual configuration rather than inferring it from its duration. Unsupported or missing reference-price configuration is a visible failure.

PolyBolt uses `price.crypto` for spot and `price.crypto.twap` for TWAP. The recorder requests Chainlink, verifies the acknowledged/actual provider, and preserves provider sequence/drop information. A returned provider mismatch is a data-quality problem even if the socket remains connected. See Polymarket's [RTDS migration guide](https://docs.polymarket.com/migrate/rtds-to-polybolt), [live-data overview](https://docs.polymarket.com/api-reference/live-data/overview), and [changelog](https://docs.polymarket.com/changelog/predictions).

The website's `/api/crypto/crypto-price` endpoint is used to observe the published price to beat. Its request includes the market start/end, duration variant, and TWAP configuration. Requests reuse that exact URL without a unique timestamp parameter so the provider's edge cache can serve and refresh it. Cached responses may delay visible corrections; each response retains its actual local receipt time and any provider timestamp. This avoids unnecessary cache bypass but does not guarantee availability or establish a supported quota. This website endpoint is not a stable documented public API. Its raw responses are preserved, and unavailable/invalid responses remain visible. A locally calculated average is never silently substituted for an official value.

Healthy polling checks every second until a price is available, then every 30 seconds for corrections. Errors back off exponentially with a five-minute local cap; a valid `Retry-After` can require a longer wait. An observed rate limit retains a slower polling floor for that market, even after an isolated success. The recorder preserves the error response, retry details, and coverage gap. Corrections during the wait are unobservable; backoff does not manufacture complete coverage. Separate 5m and 15m requests remain necessary because their market parameters differ.

An initial `openPrice: null` can mean the opening reference has not been published yet. After a valid price has been observed, a null response means correction coverage is uncertain: it opens a PTB gap and backs off retries. The last valid value remains available with its original receipt time. Only a new valid price restores availability; an HTTP 200 status alone does not close the gap.

### Selecting the opening Chainlink TWAP

Recorder v4 also derives an explicitly named `chainlink-opening-twap` reference from the captured stream. It requires a valid Chainlink 60-second TWAP whose provider timestamp equals the market's exact opening timestamp. It examines every point in a snapshot, including an opening point delivered in a later snapshot. It never substitutes a nearby point, spot price, locally calculated average, or later Gamma value.

The value becomes available only when that frame was received locally. Its snapshot preserves the full decimal string, provider timestamp, receipt time, and event/session/connection identity. Duplicate confirmations keep the original receipt; a correction in a later frame becomes visible at that frame's receipt. Conflicting values for the same boundary within one frame withhold the reference. A subsequent unambiguous observation can restore it during explicit outage replay, but ordinary admission rejects the market if any such conflict occurred.

This is a selectable stream-derived reference, not a promise that Polymarket will never apply another publication or correction rule. In the local comparison, the exact opening TWAP matched later website PTB in seven full-duration recordings and all six available official Gamma PTBs. Some initial website values differed before being corrected. A website mismatch therefore stays visible as a diagnostic; it neither changes the selected source nor invalidates TWAP mode by itself. See the [opening-reference validation report](./recorder-v3-opening-reference).

Website polling and raw responses continue regardless of the strategy's selection. Existing strategies default to website PTB. A strategy opts in through its external-feed request:

```ts
new ExternalFeedsRequestPlugin({
  polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
})
```

`ctx.plugins.externalFeeds.polymarketPriceToBeat` then holds the selected reference. `openingReference` supplies provenance and comparison diagnostics; `websitePriceToBeat` preserves the independent website observation when available. Before receipt, or during a conflict, the selected PTB is absent. Strategies must tolerate that absence. A process restart resets volatile reference state; replay restores only observations actually included in the new bootstrap or received afterward.

Ordinary backtests in this mode require complete Polymarket coverage, complete Chainlink TWAP coverage for the market, and exact opening-reference evidence. They do not require successful website PTB polling. The preflight scan checks eligibility without injecting its final value into earlier ticks. Other requested feeds retain their own coverage requirements. `--allow-capture-gaps` permits missing/conflicting evidence for outage experiments and does not manufacture a reference.

The V4 format requires new recordings. V3 trial archives are deliberately unsupported; historical Telonex modes remain available. The example strategy exposes the reference choice as a parameter:

```bash
npm run backtest -- --strategy readExternalFeedsExample.v1 \
  --input-mode recorder-v4 --dir /absolute/path/to/recorder-cache \
  --timeframe 15m --latest --limit 1 --sequential \
  --param priceToBeatSource=chainlink-opening-twap
```

This example observes/logs feeds and emits no orders, so `no_activity` is expected. The legacy live trading command and historical input modes explicitly reject this source because they cannot yet supply matching stream semantics. Use `website` to retain their existing behavior.

## Receipt order and initial state

Every envelope has `captureId`, `sessionId`, `sequence`, `eventId`, `receivedAtMs`, `monotonicNs`, `source`, `connectionId`, `eventType`, `rawJson`, and optional request details. Decimal sequence numbers are stored losslessly. Provider timestamps and decimal prices remain in the original payload; they do not reorder the capture.

The global sequence establishes the order in which this Node process handled observations. Wall-clock receipt time assigns observations to the half-open interval `[market start, market end)`. Monotonic time measures local elapsed time and helps detect clock discontinuities. A restart reserves a new sequence range; unused sequence numbers are expected and do not imply provider packet loss.

The recorder discovers and subscribes to upcoming markets before they begin. It retains only the necessary current book/feed state for their bootstrap, with the original observation times. There is no five-minute prehistory added to every file. Bootstrap restores state without emitting historical strategy ticks. Subscriptions stay active across boundaries.

Polymarket uses one persistent socket per configured timeframe: 5m and 15m each carry their current, upcoming, and grace-period subscriptions. Both sockets feed the same synchronous capture sequencer alongside Binance and Chainlink. This reduces traffic per Polymarket connection without changing the per-market file layout or ordering by provider timestamps. It does not reduce total subscribed market traffic or guarantee that peer disconnects stop.

There is a 60-second finalization grace after market end for connection diagnostics and targeted metadata/resolution responses. Ordinary post-end price and book updates do not become strategy ticks for the ended market. This grace is not a guarantee against arbitrarily late upstream corrections.

This dataset represents receipt at the recorder process. It avoids estimating relative arrival delays between independently collected feeds, but cannot reproduce exchange matching, fills, or the network timing of another machine.

## Configuration

Use Node.js 20 and install root workspace dependencies with `npm ci`. Create a dedicated configuration file outside Git, for example `/absolute/path/to/.env.recorder-v4`:

```dotenv
RECORDER_ID=worker-2-btc
RECORDER_SPOOL_DIR=/absolute/path/to/recorder-spool
RECORDER_TIMEFRAMES=5m,15m
RECORDER_R2_PREFIX=recorder-v4

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

| Setting                                            | Default                        | Meaning                                                 |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| `RECORDER_ENV_FILE` / `--env-file`                 | `.env.recorder-v4`                | Explicit configuration file                             |
| `RECORDER_ID`                                      | Sanitized hostname plus `-btc` | Stable dashboard identity                               |
| `RECORDER_SPOOL_DIR` / `--spool-dir`               | `data/recorder-v4`             | Active journals, pending packages, operational state    |
| `RECORDER_TIMEFRAMES` / `--timeframes`             | `5m,15m`                       | Either or both BTC durations                            |
| `RECORDER_UPLOAD`                                  | `true`                         | Enable R2 archival; `--no-upload` overrides it          |
| `RECORDER_R2_PREFIX`                               | `recorder-v4`                  | Namespace for immutable R2 objects                      |
| `RECORDER_MAX_SPOOL_BYTES`                         | `21474836480` (20 GiB)         | Local spool limit                                       |
| `RECORDER_MIN_FREE_BYTES`                          | `21474836480` (20 GiB)         | Minimum filesystem free space                           |
| `RECORDER_MAX_PENDING_BYTES`                       | `16777216` (16 MiB)            | Pending capture-write memory allowance                  |
| `RECORDER_REDIS_URL`                               | `REDIS_URL`, if present        | Optional dashboard connection                           |
| `RECORDER_STATUS_ENABLED`                          | Whether Redis is configured    | Publish dashboard status; `--no-dashboard` overrides it |
| `RECORDER_DURATION_SECONDS` / `--duration-seconds` | Unset                          | Optional bounded validation run                         |

Exported environment variables override the selected file; command-line settings override both. `BOT_ENV` does not affect the recorder. Existing `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASSPHRASE`, and `CLOB_PASS_PHRASE` aliases are accepted.

## Start and stop

First perform a bounded local validation run:

```bash
npm run record:v4 -- \
  --env-file /absolute/path/to/.env.recorder-v4 \
  --spool-dir /absolute/path/to/test-spool \
  --no-upload --no-dashboard --duration-seconds 2100
```

A run of 35 minutes can include a complete 15-minute market regardless of its start time, plus several 5-minute markets and finalization grace. The market already in progress at startup is retained and marked incomplete.

For regular recording:

```bash
npm run record:v4 -- --env-file /absolute/path/to/.env.recorder-v4
```

Use `Ctrl+C` or `SIGTERM` to stop. The recorder stops feed intake, cancels network maintenance, drains writes, and finalizes partial markets with coverage gaps. Pending or interrupted uploads remain for retry on the next run; shutdown does not wait through a long upload backlog. If physical free space is below the floor, it seals the journals for later recovery without starting compression. Do not remove the spool to recover from an error.

Use a separate deployed checkout pinned to the tested commit on worker-2. Keep the spool and environment file outside that checkout so a code update cannot replace them. Validate locally before installing or starting a worker-2 service. Backtest workers can use other checkouts; they do not own recorder state. Disable automatic sleep on the recording host and keep its clock synchronized.

The [worker-2 installation guide](./recorder-v4-worker-2) explains which existing fleet setup to reuse, why the recorder keeps its own checkout, the observed host load, exact release/configuration paths, validation gates, and service installation/update commands.

### Prepared macOS service

`ops/macos/recorder-v4/com.polymarket.recorder-v4.plist.template` is a separate LaunchDaemon template. Preparing this file does not install or start a recorder. At deployment, replace `__USER__`, `__NODE20__` (absolute Node 20 executable), `__CHECKOUT__` (pinned recorder checkout), `__ENV_FILE__`, and `__LOG_DIR__`. Create the log/spool directories with ownership for that user, restrict the environment file to that user, and validate the rendered file with `plutil -lint` before installation.

The service runs the Node process directly, preserves the existing backtest service, and retries failed exits with a 60-second throttle. A clean stop does not immediately relaunch. Stop/unload the service before changing its pinned checkout or configuration. A forced timeout during shutdown leaves journals for recovery. Check `/recorders` after startup and after any update. The template does not manage log rotation; rotate `recorder.log` separately without deleting spool state.

## Durability, resource use, and R2 lifecycle

1. Received envelopes enter a bounded, durably flushed journal per market.
2. After market end and the diagnostic grace, a separate memory-limited process builds `events.parquet`. Compression does not block the capture event loop.
3. The package manifest records market identity, schema version, coverage, row count, byte count, and the SHA-256 of the Parquet.
4. The uploader writes the event object and reads the entire object back to verify bytes and SHA-256. It then publishes and verifies a content-addressed manifest.
5. Only after a durable archive receipt exists are the local Parquet and journals deleted.
6. Small resolution tasks/receipts remain locally until resolution follow-up and verified metadata upload are complete. They are then cleaned up.

An R2 object without a published manifest is not a discoverable completed package. Retrying an ambiguous upload verifies the existing object before deciding whether more work is needed. The downloader repeats integrity verification before replay. R2 uses its [S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/).

### R2 object layout

The production prefix defaults to `recorder-v4`. New packages group markets by asset and timeframe before the slug. Each market slug encodes its duration and opening time as Unix seconds in UTC. Each separate recording gets its own ID. Crash recovery resumes an unfinished recording's journal and ID; starting again after a finalized partial recording creates a new recording rather than overwriting it:

```text
recorder-v4/
  btc/
    5m/
      btc-updown-5m-<opening-unix-seconds>/
        <recording-id>/
          events-<sha256>.parquet
          manifest-<sha256>.json
          resolutions/
            <observed-at-ms>-<sha256>.json
    15m/
      btc-updown-15m-<opening-unix-seconds>/
        <recording-id>/
          events-<sha256>.parquet
          manifest-<sha256>.json
          resolutions/
            <observed-at-ms>-<sha256>.json
```

Every V4 manifest requires `schemaVersion: 4` and `archiveLayout: "symbol-timeframe"`. Local download caches retain `<output>/<slug>/<recording-id>/`. The hierarchy leaves room for future assets; the recorder currently supports BTC 5m and 15m.

All event feeds for a recording are in its single Parquet. The manifest contains identity, coverage, and integrity information. Later resolution updates are separate because an official result or correction can arrive after the immutable event file has been archived. Shared Binance/Chainlink observations are intentionally repeated in overlapping market files with identical receipt sequence and timestamps.

### Compact field contract

V4 uses Parquet V2 with Zstandard level 9 and an 8192-row group target. The finalizer runs separately with one DuckDB thread, a 256 MiB DuckDB memory limit, a 512 MiB JavaScript heap limit, and a 1 GiB temporary spill limit. These limits do not include every native allocation. Its temporary JSONL conversion input and durable journals remain local; the uploaded event file has typed columns.

Strictly recognized Polymarket price changes, books, best bid/ask, last trades, and Binance aggregate trades/book tickers use flat typed columns and parallel lists. Prices and quantities stay exact decimal strings. Replay consumes the decoded objects directly without parsing JSON for those rows. Chainlink spot/TWAP, PTB, bootstrap, controls, metadata, arrays, and unfamiliar message shapes remain exact raw JSON fallback in the same file. New or missing fields force fallback; they are not silently discarded. Strings that cannot be represented losslessly by the typed writer also fall back.

Only `price_change.price_changes[].hash` in the recognized shape is deliberately omitted. Strategy messages normalize those unused hashes to an empty string through the shared live/backtest market engine. Book-snapshot hashes, transaction hashes, and archive SHA-256 checksums are retained. The `event_id` column is redundant: the writer first verifies `eventId === captureId + ':' + sequence`; replay reconstructs it exactly. No timestamp, sequence, ID value, price, quantity, or event is sampled or rounded away. Known typed rows preserve parsed values, not JSON whitespace, key order, or numeric spelling. Unknown fallback retains its original text.

The manifest version and explicit Parquet `recorder_format=recorder-v4-compact-1` metadata identify the format. A filename does not select a decoder. Readers reject unsupported formats, invalid types, unequal parallel lists, non-increasing sequences, and incompatible metadata. The selected production decoder is JavaScript; no optional WASM decoder is required.

### R2 isolation

The adapter has no remote delete operation. Every GET, PUT and LIST is restricted to `recorder-v4/`; sibling prefixes, V3 paths, traversal components and unbounded listings are rejected before any network request. A PUT uses `If-None-Match: *`, so it cannot overwrite an existing object. An existing object is accepted only after a complete checksum/size read-back.

`RECORDER_R2_PREFIX` accepts `recorder-v4` or a child namespace, such as `recorder-v4/validation/<run-id>`. The production catalog excludes child namespaces; select a validation prefix explicitly when inspecting its data. No rollout command deletes, migrates, renames, or rewrites existing R2 objects, changes bucket settings, or changes lifecycle rules. Old V3 trials remain untouched. Any later cleanup is a separate operation with its own exact scope.

Use a fresh V4 spool and configuration. V4 refuses V3's unversioned sequence state and version-3 manifests rather than attempting an in-place migration. Local event deletion still requires the exact manifest's verified archive receipt.

There is no separate per-feed directory and no database required to discover these packages. `record:v4:data` filters the catalog by timeframe and opening date. If a market has multiple recordings after a restart, select one explicit manifest for a backtest; partial recordings are not silently stitched together.

On restart, already finalized uploads are retried before opening live feeds. This lets a full spool recover after an R2 outage. New capture starts only after disk allowance is available; a disk read error or remaining exhaustion is reported and preserves pending data.

At runtime, the recorder checks spool size, filesystem free space, pending writes, event-loop delays, and clock discontinuities. Resource exhaustion causes a visible controlled stop and preserves unuploaded data. A disk limit is an operating guard, not a reserved disk partition; other processes can still consume free space between checks. CPU and memory measurements should be checked under the intended backtest load before leaving the machine unattended.

After a crash, restart with the **same spool**. Recovery reads the durable journals, ignores an incomplete final journal line, resumes or finalizes the affected package, and marks the outage. It does not fabricate missed observations. A single-owner spool lock prevents two recorder processes from writing the same capture state. Keep each independent recorder on its own spool.

## Resolution and later corrections

Resolution polling starts after market end and survives recorder restarts and event-file deletion. Closed/proposed/disputed states are distinguished from a verified final payout. The recorder preserves changed observations and rechecks a stable resolved result after 24 hours before retiring its local task. A revised terminal result restarts confirmation.

Resolution observations are small immutable sidecars under the same R2 package. They can arrive after `events.parquet` has been uploaded. Refresh/download the package to obtain newer observations. The latest official outcome is used for settlement reporting; later PTB, final prices, and outcome fields are not injected into earlier strategy snapshots.

## Find and download archived markets

The archive catalog is derived from verified R2 manifests; it does not depend on a database or files remaining on the recorder. List a duration and UTC date range:

```bash
npm run record:v4:data -- list \
  --env-file /absolute/path/to/.env.recorder-v4 \
  --timeframe 15m --from 2026-10-01 --to 2026-11-01
```

Download that selection onto the machine running backtests:

```bash
npm run record:v4:data -- download \
  --env-file /absolute/path/to/.env.recorder-v4 \
  --timeframe 15m --from 2026-10-01 --to 2026-11-01 \
  --output /absolute/path/to/recorder-cache/btc-15m
```

`--from` includes the opening timestamp; `--to` excludes it. Full timestamps must end in `Z`. `--prefix` selects an explicit child of `recorder-v4/`. `--manifest` selects one exact committed manifest key or `r2://` URL instead of date/timeframe filters. This command needs only R2 credentials, never CLOB or wallet credentials.

Downloads are sequential and verified, refresh resolution observations, and reuse already verified local Parquet files. A failed download exits unsuccessfully and is safe to retry. Source objects in R2 are never deleted by these commands. Keep 5m and 15m download selections in separate cache directories when you want to backtest them independently.

## Coverage and backtests

Coverage records both confirmed loss and uncertainty: reconnect intervals, provider sequence gaps, missing initial books, stale feeds, late startup, interrupted capture, and observed clock/event-loop discontinuities. A connected socket alone does not prove complete upstream data. In particular, an unsequenced Polymarket stream cannot prove that no message was ever lost upstream.

Polymarket disconnect control records include the peer's close code/reason and the connection's received message-frame/payload-byte counts. These aid diagnosis; the peer's `slow consumer: send buffer full` reason alone does not distinguish client processing, network delivery, and server buffering. Reconnecting restores current state from fresh books but cannot recover missing updates.

Malformed book frames remain in the raw recording. They invalidate affected books, open coverage gaps, and trigger a reconnect for fresh snapshots. Explicit outage replay preserves these resets and skips the invalid mutations.

Polymarket control records include the stable `channelId` and affected `marketSlugs`; `connectionId` still changes on every reconnect. Disconnects and undecodable frames affect only that socket's markets. A malformed frame reconnects its originating socket; a recorder-wide clock/event-loop problem still reconnects both. The healthy timeframe retains its books, and replay applies the same scoped resets. Legacy control records without a scope keep their original all-market behavior. Dashboard feed status remains degraded while either socket is unhealthy, and opening the second timeframe's first connection does not count as a reconnect.

Undecodable Binance text remains in the raw recording and opens uncertain gaps for both feeds sharing its connection. An identifiable invalid aggregate-trade or best-bid/ask payload affects its own feed. A later valid message restores that feed's availability but does not erase the recorded uncertainty interval.

Ordinary V4 backtests skip an entire market when a feed required by that strategy has an affected interval. A gap only in an unused optional feed does not automatically disqualify it. The recording remains available. Use `--allow-capture-gaps` explicitly to test outage behavior; this does not invent replacement data.

```bash
npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v4 --dir /absolute/path/to/downloaded-packages

npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v4 --dir /absolute/path/to/downloaded-packages \
  --allow-capture-gaps
```

The existing backtest queue/database configuration still applies. A package directory, its `manifest.json`, its `events.parquet`, or an `r2://bucket/.../manifest-SHA256.json` URL can select a recording. Workers download R2 inputs into a verified local cache. Selecting more than one recording of the same market is rejected; choose one capture explicitly.

For a mixed download directory, add `--timeframe 5m` or `--timeframe 15m`. This filters packages before `--latest` and `--limit`; a duration mismatch selects no markets. Without this option, both durations are eligible. Saved run metadata derives its timeframe from the selected manifests: `5m`, `15m`, or null for a mixed batch.

Use `--sequential` to execute in the CLI process without Redis. This still saves results to the configured MySQL database:

```bash
npm run backtest -- --strategy YOUR_STRATEGY \
  --input-mode recorder-v4 --dir /absolute/path/to/recorder-cache/btc-5m \
  --sequential
```

Without `--sequential`, the existing BullMQ producer, market workers, and aggregation worker are used. Workers must run the tested code revision and have access to the supplied local package path, or use an R2 manifest input with R2 download credentials. A directory on one machine is not automatically shared with another machine. The recorder archive downloader creates a deliberate local backtest cache; deleting uploaded files from the recorder spool does not delete this independent cache.

For a concrete pipeline check using an existing example strategy and one five-minute recording:

```bash
npm run backtest -- --strategy placeLimitOrderAndCancelAfterFewSec.v1 \
  --input-mode recorder-v4 --dir /absolute/path/to/recorder-cache \
  --timeframe 5m --latest --limit 1 --sequential \
  --param triggerPrice=1 --param orderPrice=0.9 --param size=5 \
  --latency-delay-ms 0 --latency-jitter-ms 0
```

This uses simulated execution and saves the resulting run. Whether it fills depends on the selected recording. Check the saved run status, market results, and skip/failure reasons: the existing backtest CLI can exit zero after persisting a failed or partial batch. A zero shell exit alone does not prove successful replay or settlement.

Refresh a downloaded selection with the same `record:v4:data download` command to pick up newer resolution observations. Verified Parquet files are reused. An unresolved official outcome is reported as unresolved; replay does not invent a winner or final PnL. The recorder configuration file supplies feed/archive settings, while the existing backtest environment supplies database/queue settings.

Replay dispatches envelopes in recorded sequence through the shared market engine and strategy runner. Feed state is bound to the corresponding tick before asynchronous strategy work can run. Market snapshots at bootstrap do not trigger strategy history. Recorded receipt time replaces modeled historical feed-latency adjustments for this input mode.

The existing live trading command has not been migrated to PolyBolt or Binance book-ticker ingestion. Requests for newly recorded feed capabilities that it cannot supply fail explicitly. A future live strategy consuming those capabilities must use the same dispatcher/feed semantics; a successful V4 backtest alone does not establish live execution parity for an unsupported feed.

## Dashboard

Open **More → Recorders** in the existing dashboard. It shows recorder state, last heartbeat, feed ages and reconnects, active markets, gaps, spool/free space, archive progress, resolution backlog, CPU/RSS, and recent completed packages. An absent heartbeat becomes stale/offline rather than making a recorder disappear.

Active markets also show the opening TWAP, its receipt/provenance, and comparison with website PTB. A missing observation, pending website comparison, website mismatch, and conflicting TWAP frame have distinct states. These diagnostics do not silently select a different strategy reference.

Redis is optional for recording. Local `status.json` is written in the spool. Redis/dashboard failure does not interrupt capture. There are no Slack messages or other notifications.

CPU/RSS metrics describe the ingestion process. Include the separate finalizer when measuring total host load; its bounds are described above.

## Verification and recovery checks

Inspect a local or downloaded package without starting a strategy, database, or network client:

```bash
npm run record:v4:verify -- /absolute/path/to/package-directory
```

This verifies file integrity, every row, sequence/receipt ordering, manifest row counts, and replay through the shared dispatcher. It reports source counts, feed counts, strategy-tick count, coverage, and a deterministic replay digest including order-book/feed snapshots. The digest excludes the cache path, so it can compare an original package with an independent R2 download. Incomplete coverage is reported separately from corruption.

The `openingReference` result separately reports exact-boundary observations, corrections, conflicts, the final comparison, and reasons that prevent ordinary TWAP-source admission. This diagnostic does not change the existing website-mode replay digest.

`npm run record:v4:test` covers feed parsing, sequence ownership, recovery, archive integrity, resolution tracking, and deterministic replay. These tests run in CI alongside the existing strategy/trading regressions.

Before deployment, also validate real feed subscriptions, a complete market for each duration, correct current PTB, market transitions, clean shutdown/restart, actual V4 R2 upload/read-back and subsequent recorder-local event cleanup, fresh-cache download, and replay. Record the tested commit, elapsed capture time, CPU/memory/disk observations, and any detected gaps. A short connection smoke test is not evidence of long-term operational reliability.

See the [V4 validation report](./recorder-v4-validation) for format parity, namespace protection and current rollout evidence.

These earlier reports document V3 behavior and compact-format experiments, not V4 deployment evidence: [initial validation report](./recorder-v3-validation), [second audit](./recorder-v3-second-audit), [archive/coverage hardening report](./recorder-v3-hardening), and [opening-reference validation](./recorder-v3-opening-reference) for measured local results and remaining deployment checks.
