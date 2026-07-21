---
title: Recording Live Market Events
description: How to capture live Polymarket WebSocket events to Parquet files for deterministic backtesting replay.
---

# Recording Live Market Events

The recorder subscribes to Polymarket's market WebSocket for a chosen symbol and writes every incoming event to Parquet files on disk. The resulting files are the primary input for the backtesting engine, which replays them through the exact same `MarketEngine` and strategy code that runs in live trading.

## Prerequisites

- `RECORD_SYMBOL` environment variable set to one of `BTC`, `ETH`, `SOL`, or `XRP`.
- A valid `.env` file (or the variables exported into the shell environment). The Polymarket WebSocket URL and Gamma API base URL are read from the standard environment — see [Environment Variables](/reference/environment-variables) for the full variable list.

## Starting the recorder

Use the symbol-specific npm shortcuts:

```bash
npm run record:live:btc
npm run record:live:eth
npm run record:live:sol
npm run record:live:xrp
```

Or set `RECORD_SYMBOL` directly and invoke the generic script:

```bash
RECORD_SYMBOL=BTC npm run record:live
```

The process logs its configuration at startup:

```
[record-live] symbol=BTC
[record-live] wsUrl=wss://ws-subscriptions-clob.polymarket.com/ws/market
[record-live] baseDir=data/events/btc
[record-live] maxInFlightAppends=10000
[record-live] insertDb=false
```

## Output location and file naming

Files are written under:

```
data/events/<symbol>/<slug>.parquet
```

For example, a BTC market that started at Unix epoch `1766523600` is stored as:

```
data/events/btc/btc-updown-15m-1766523600.parquet
```

The slug format is `<symbol>-updown-15m-<epochStart>`, where `<epochStart>` is the Unix timestamp (seconds) of the 15-minute window boundary.

### Overriding the base directory

Set `RECORD_BASE_DIR` to write files under a different root:

```bash
RECORD_BASE_DIR=/mnt/fast-ssd/recordings RECORD_SYMBOL=BTC npm run record:live
```

The symbol subdirectory is always appended automatically, so files land at `$RECORD_BASE_DIR/<symbol>/`.

## 15-minute window rotation

Polymarket's up/down markets run in 15-minute windows. The recorder tracks the wall-clock boundary and automatically rotates at each window edge:

1. The inbound WebSocket is stopped.
2. All in-flight disk appends are drained (up to a 10-second timeout).
3. Open Parquet writers flush their footers and rename `*.parquet.tmp` → `*.parquet`.
4. The recorder re-resolves the new window's slug and token IDs from the Gamma API, then reconnects.

While a file is being written it has a `.parquet.tmp` extension. Only successfully closed files carry the final `.parquet` extension.

::: warning Mid-window startup behaviour
On first startup the recorder checks whether the current 15-minute window is already more than `RECORD_SKIP_IF_OLDER_MS` milliseconds old (default `10 000` ms). If the window has already advanced past this threshold the recorder waits in place until the next boundary to avoid creating an incomplete file that would pollute backtesting data. This skip applies only to the very first connection; mid-session reconnects always resume immediately to prevent data gaps.
:::

## SIGINT and SIGTERM handling

Pressing `Ctrl+C` or sending `SIGTERM` triggers a graceful shutdown:

1. No new events are accepted.
2. In-flight appends drain (up to 10 seconds).
3. All open writers close and rename their temporary files to `*-terminated.parquet` instead of the normal `.parquet` extension.

The `-terminated` suffix signals to the backtest tooling that a file was not captured for the full window and may contain incomplete data.

::: danger Do not kill the process with SIGKILL
`SIGKILL` bypasses the shutdown handler. Any `*.parquet.tmp` files left on disk are unreadable as valid Parquet because the footer has not been written. Delete them before attempting to use the directory for backtesting.
:::

## Disconnect handling

The recorder classifies WebSocket close events into two categories:

| Category                                                                                                                   | Behaviour                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expected** — code `1000`/`1001`, or any close near a 15-minute boundary, or a server reason matching market-end keywords | No disconnect marker written; reconnect proceeds silently.                                                                                                                                |
| **Unexpected** — all other close codes                                                                                     | A synthetic `disconnect` row is appended to the current Parquet file for each subscribed market. The row carries the close code and reason so backtests can detect and measure data gaps. |

## Database insertion (optional)

Set `RECORD_LIVE_INSERT_DB=true` to have the recorder insert each finalised market into the `markets` table via Drizzle ORM. After insertion, a second update is scheduled 15 minutes later to refresh the market's resolution status from the Gamma API.

```bash
RECORD_LIVE_INSERT_DB=true RECORD_SYMBOL=BTC npm run record:live
```

This is disabled by default and requires the database environment variables (`DATABASE_HOST`, `DATABASE_NAME`, etc.) to be configured.

## Tuning environment variables

| Variable                      | Default       | Description                                                                               |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `RECORD_SYMBOL`               | _(required)_  | Symbol to record: `BTC`, `ETH`, `SOL`, or `XRP`.                                          |
| `RECORD_BASE_DIR`             | `data/events` | Root directory for Parquet output.                                                        |
| `RECORD_STATS_INTERVAL_MS`    | `10000`       | How often to print in-flight stats to stdout.                                             |
| `RECORD_MAX_INFLIGHT_APPENDS` | `10000`       | Maximum concurrent async writes before the recorder disconnects to prevent memory growth. |
| `RECORD_SKIP_IF_OLDER_MS`     | `10000`       | Age threshold for the first-connection window-age check.                                  |
| `RECORD_LIVE_INSERT_DB`       | `false`       | Insert finalised markets into the database.                                               |

## Stats output

Every `RECORD_STATS_INTERVAL_MS` milliseconds the recorder prints a stats line:

```
[record-live] stats in_flight_appends=3 total_appends=14821 append_errors=0
  candle_left=12:04 disconnects=0 expected_closes=1
  dropped_no_market=0 dropped_bad_json=0 dropped_unknown_type=0
```

| Field                  | Meaning                                                   |
| ---------------------- | --------------------------------------------------------- |
| `in_flight_appends`    | Async writes currently outstanding.                       |
| `total_appends`        | Total rows written for the current market slug.           |
| `append_errors`        | Disk write failures (should remain zero).                 |
| `candle_left`          | Remaining time in the current 15-minute window.           |
| `disconnects`          | Unexpected WebSocket disconnects this session.            |
| `expected_closes`      | Normal or market-boundary closes (not counted as errors). |
| `dropped_no_market`    | Messages without a recognisable market ID, discarded.     |
| `dropped_bad_json`     | Malformed JSON messages, discarded.                       |
| `dropped_unknown_type` | Messages with an unrecognised `event_type`, discarded.    |
