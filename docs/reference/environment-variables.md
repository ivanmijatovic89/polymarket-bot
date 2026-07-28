---
title: Environment Variables
description: Complete reference for all environment variables recognised by the Polymarket Bot, grouped by functional category.
---

# Environment Variables

All configuration is supplied through environment variables. The bot loads `.env` from the project root at startup. When `BOT_ENV` is set, a second file `.env.<BOT_ENV>` is also loaded with **override semantics** — values in the bot-specific file win over both `.env` and the shell environment.

## BOT_ENV Multi-Bot Override

| Variable  | Type     | Default   | Description                                                                                                                                                                                                                                                              |
| --------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BOT_ENV` | `string` | _(unset)_ | When set to a name such as `botA`, the loader reads `.env` first, then `.env.botA` with `override: true`. The named file must exist or startup throws. Use this to run multiple bot processes with distinct keys, ports, and symbols without touching the shared `.env`. |

::: warning
The bot-specific file overrides the shell environment as well as `.env`. Set only the variables that differ between instances in `.env.<BOT_ENV>`.
:::

::: details Example — two bots on the same host

```bash
# .env.botA
BOT_INSTANCE_ID=btc-bot
TRADING_SYMBOL=BTC
WEB_UI_PORT=3001

# .env.botB
BOT_INSTANCE_ID=eth-bot
TRADING_SYMBOL=ETH
WEB_UI_PORT=3002
```

Launch each with `BOT_ENV=botA npm run trade:bot` and `BOT_ENV=botB npm run trade:bot`.
:::

---

## Discovery and WebSocket

| Variable                 | Type                       | Default                                                | Description                                                                        |
| ------------------------ | -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `TRADING_SYMBOL`         | `BTC \| ETH \| SOL \| XRP` | _(required)_                                           | Symbol the live trading bot subscribes to. Falls back to `RECORD_SYMBOL` if unset. |
| `RECORD_SYMBOL`          | `BTC \| ETH \| SOL \| XRP` | _(required for recorder)_                              | Symbol the recorder subscribes to.                                                 |
| `GAMMA_API_BASE_URL`     | `string`                   | `https://gamma-api.polymarket.com`                     | Base URL for the Gamma REST API used to resolve market metadata.                   |
| `POLYMARKET_WS_URL`      | `string`                   | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | WebSocket endpoint for the market orderbook feed.                                  |
| `POLYMARKET_USER_WS_URL` | `string`                   | `wss://ws-subscriptions-clob.polymarket.com/ws/user`   | WebSocket endpoint for the authenticated user feed (fills, order status).          |
| `POLYGON_RPC_URL`        | `string`                   | `https://polygon-rpc.com`                              | Polygon JSON-RPC endpoint used for on-chain operations (splits, merges, redeems).  |

---

## Authentication and Wallet

| Variable                    | Type      | Default                       | Description                                                                                                                |
| --------------------------- | --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PRIVATE_KEY`               | `string`  | _(required for live trading)_ | EOA private key in hex format (with or without `0x` prefix). Alias: `POLYMARKET_PRIVATE_KEY`.                              |
| `POLYMARKET_PRIVATE_KEY`    | `string`  | _(alias)_                     | Alternate name for `PRIVATE_KEY`. `PRIVATE_KEY` takes precedence.                                                          |
| `POLYMARKET_API_KEY`        | `string`  | _(required)_                  | CLOB API key. Alias: `CLOB_API_KEY`.                                                                                       |
| `POLYMARKET_API_SECRET`     | `string`  | _(required)_                  | CLOB API secret. Alias: `CLOB_SECRET`.                                                                                     |
| `POLYMARKET_API_PASSPHRASE` | `string`  | _(required)_                  | CLOB API passphrase. Aliases: `CLOB_PASSPHRASE`, `CLOB_PASS_PHRASE`.                                                       |
| `CLOB_API_URL`              | `string`  | `https://clob.polymarket.com` | CLOB REST API base URL.                                                                                                    |
| `CLOB_CHAIN_ID`             | `integer` | `137`                         | EVM chain ID. `137` = Polygon mainnet.                                                                                     |
| `CLOB_SIGNATURE_TYPE`       | `integer` | `0`                           | Signature type for order signing. `0` = EOA, `2` = SAFE/relayer.                                                           |
| `CLOB_FUNDER`               | `string`  | _(unset)_                     | SAFE wallet address. Required when `CLOB_SIGNATURE_TYPE=2`. Used as the funding account for position tracking and redeems. |
| `CLOB_POLL_INTERVAL_MS`     | `integer` | `1000`                        | Interval in milliseconds between REST poll cycles for account data when the user WebSocket is unavailable.                 |

::: tip CLOB*\* aliases
All `CLOB_API_KEY`, `CLOB_SECRET`, and `CLOB_PASSPHRASE` values are accepted as fallbacks when the `POLYMARKET*_`equivalents are absent. Set only the`POLYMARKET\__` names in new deployments.
:::

---

## Trading Behavior

| Variable                                   | Type                             | Default       | Description                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRY_RUN`                                  | `boolean`                        | `false`       | When set to any value other than the string `false`, orders are validated and logged but never submitted to the CLOB. Unset or `false` enables real order placement.                                                                          |
| `LOG_TRADES`                               | `boolean`                        | `false`       | When `true`, each filled trade is written to the log in addition to the standard account-event output.                                                                                                                                        |
| `LOG_TO_FILE`                              | `boolean`                        | `false`       | When `true`, log output is written to a file in addition to stdout.                                                                                                                                                                           |
| `LOG_LEVEL`                                | `debug \| info \| warn \| error` | `info`        | Minimum log severity level.                                                                                                                                                                                                                   |
| `USER_WS_FILL_AT_STATUS`                   | `MATCHED \| MINED \| CONFIRMED`  | _(empty)_     | Controls which status event triggers a fill update in the Portfolio. `MATCHED` is faster; `MINED` is required before selling or merging shares received in a buy. See [Fill-status semantics](/live-trading/live-trading-bot#account-stream). |
| `INTENT_EXECUTION_MODE`                    | `immediate \| deferred`          | `immediate`   | Controls when intents are submitted to the order manager relative to the current tick.                                                                                                                                                        |
| `MAX_EVENTS_PER_DRAIN`                     | `integer`                        | _(unlimited)_ | Maximum number of account events processed in a single drain cycle. Useful for throttling high-throughput fills.                                                                                                                              |
| `SKIP_MARKET_IF_BOT_STARTED_AFTER_SECONDS` | `integer`                        | `15`          | On startup, skips any 15-minute market window that is already more than N seconds old. Prevents placing orders into a nearly-expired window.                                                                                                  |
| `BALANCE_REFRESH_COOLDOWN_MS`              | `integer`                        | `5000`        | Minimum milliseconds between on-chain balance refresh calls.                                                                                                                                                                                  |
| `INITIAL_CAPITAL`                          | `number`                         | `1000`        | Starting capital (USDC) assumed by the backtest stats engine for return-on-capital calculations.                                                                                                                                              |

---

## Backtest

| Variable                                 | Type            | Default   | Description                                                                                                                                                                                      |
| ---------------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKTEST_LATENCY_DELAY`                 | `integer (ms)`  | `0`       | Simulated round-trip latency in milliseconds applied to all order operations (place, cancel).                                                                                                    |
| `BACKTEST_LATENCY_JITTER`                | `integer (ms)`  | `0`       | Symmetric random jitter added to `BACKTEST_LATENCY_DELAY`. Actual delay is drawn uniformly from `[delay - jitter, delay + jitter]`.                                                              |
| `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS` | `1 \| (unset)`  | _(unset)_ | When set to `1`, the backtest runner waits for the `TechnicalIndicators` plugin to warm up before processing the first tick. Required when strategies depend on TA values from the first candle. |
| `BACKTEST_TECH_IND_TIMEOUT_MS`           | `integer (ms)`  | `3000`    | Maximum time to wait for technical indicator warmup before proceeding.                                                                                                                           |
| `BACKTEST_TECH_IND_POLL_MS`              | `integer (ms)`  | `10`      | Poll interval during technical indicator warmup wait.                                                                                                                                            |

---

## Database

All four variables are required when any command that reads from or writes to MySQL is executed.

| Variable            | Type      | Default      | Description                                              |
| ------------------- | --------- | ------------ | -------------------------------------------------------- |
| `DATABASE_HOST`     | `string`  | _(required)_ | MySQL host name or IP address.                           |
| `DATABASE_PORT`     | `integer` | _(required)_ | MySQL port number. Typically `3306`.                     |
| `DATABASE_USERNAME` | `string`  | _(required)_ | MySQL user name.                                         |
| `DATABASE_PASSWORD` | `string`  | _(optional)_ | MySQL password. Omit for passwordless local connections. |
| `DATABASE_NAME`     | `string`  | _(required)_ | MySQL database (schema) name.                            |

---

## Recorder

| Variable                      | Type           | Default              | Description                                                                                                                                                            |
| ----------------------------- | -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RECORD_BASE_DIR`             | `string`       | `data/events`        | Root directory for Parquet output files. Symbol subdirectories are created automatically: `<RECORD_BASE_DIR>/<symbol>/`.                                               |
| `RECORD_STATS_INTERVAL_MS`    | `integer (ms)` | _(internal default)_ | Interval at which the recorder logs throughput statistics to stdout.                                                                                                   |
| `RECORD_MAX_INFLIGHT_APPENDS` | `integer`      | `10000`              | Maximum number of Parquet row-group appends queued before backpressure is applied.                                                                                     |
| `RECORD_SKIP_IF_OLDER_MS`     | `integer (ms)` | _(internal default)_ | Discard any incoming WebSocket message whose `ts_exchange_ms` timestamp is older than this threshold. Prevents stale data from polluting recordings during reconnects. |
| `RECORD_LIVE_INSERT_DB`       | `boolean`      | `false`              | When `true`, each newly opened Parquet file is also inserted into the `markets` database table via the Gamma API.                                                      |
| `RECORD_TEST_MODE`            | `boolean`      | `false`              | When `true`, the recorder runs in test mode (shorter rotation windows, reduced output). For development use only.                                                      |

---

## Relayer (SAFE Wallet)

These variables are required when `CLOB_SIGNATURE_TYPE=2` or when `POLYMARKET_TX_MODE_SPLIT|MERGE|REDEEM=relayer`.

| Variable                            | Type                | Default                  | Description                                                                                                                                   |
| ----------------------------------- | ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POLYMARKET_BUILDER_API_KEY`        | `string`            | _(required for relayer)_ | Builder API key for the Polymarket relayer service.                                                                                           |
| `POLYMARKET_BUILDER_API_SECRET`     | `string`            | _(required for relayer)_ | Builder API secret.                                                                                                                           |
| `POLYMARKET_BUILDER_API_PASSPHRASE` | `string`            | _(required for relayer)_ | Builder API passphrase.                                                                                                                       |
| `POLYMARKET_RELAYER_URL`            | `string`            | _(internal default)_     | Base URL for the Polymarket relayer REST API.                                                                                                 |
| `POLYMARKET_RELAYER_CHAIN_ID`       | `integer`           | _(internal default)_     | Chain ID sent to the relayer. Defaults to the same chain as `CLOB_CHAIN_ID`.                                                                  |
| `POLYMARKET_RELAYER_TX_TYPE`        | `SAFE \| EOA`       | `SAFE`                   | Transaction type submitted to the relayer.                                                                                                    |
| `POLYMARKET_TX_MODE_SPLIT`          | `relayer \| direct` | `direct`                 | Execution path for position-split transactions. `relayer` routes through the SAFE wallet; `direct` signs with the EOA.                        |
| `POLYMARKET_TX_MODE_MERGE`          | `relayer \| direct` | `direct`                 | Execution path for position-merge transactions.                                                                                               |
| `POLYMARKET_TX_MODE_REDEEM`         | `relayer \| direct` | `relayer`                | Execution path for position-redeem transactions in the redeem watcher.                                                                        |
| `POLYMARKET_EOA_GAS_MULTIPLIER`     | `number`            | `2`                      | Multiplier applied to the estimated gas limit for EOA-signed on-chain transactions. Increase if transactions are reverting due to out-of-gas. |
| `SPLIT_MAX_RETRY`                   | `integer`           | `2`                      | Maximum retry attempts for failed split transactions.                                                                                         |
| `SPLIT_RETRY_DELAY_MS`              | `integer (ms)`      | `3000`                   | Delay between split transaction retries.                                                                                                      |
| `MERGE_MAX_RETRY`                   | `integer`           | `2`                      | Maximum retry attempts for failed merge transactions.                                                                                         |
| `MERGE_RETRY_DELAY_MS`              | `integer (ms)`      | `3000`                   | Delay between merge transaction retries.                                                                                                      |

---

## Redeem Watcher

| Variable                   | Type           | Default                     | Description                                                                                    |
| -------------------------- | -------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `REDEEM_WATCH_INTERVAL_MS` | `integer (ms)` | `30000`                     | Polling interval for checking redeemable positions.                                            |
| `REDEEM_STATE_PATH`        | `string`       | `data/redeem/redeemed.json` | Path to the JSON file that persists the set of already-redeemed condition IDs across restarts. |

---

## Web UI

| Variable                  | Type           | Default                 | Description                                                                                             |
| ------------------------- | -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `ENABLE_WEB_UI`           | `boolean`      | `false`                 | When `true`, the trading bot starts the embedded Vite/React web server alongside the trading loop.      |
| `WEB_UI_HOST`             | `string`       | `0.0.0.0`               | Bind address for the web UI HTTP and WebSocket server. Use `127.0.0.1` to restrict access to localhost. |
| `WEB_UI_PORT`             | `integer`      | _(required if enabled)_ | TCP port for the web UI server.                                                                         |
| `WEB_UI_REFRESH_MS`       | `integer (ms)` | _(internal default)_    | Interval at which the server pushes updated state to connected browser clients.                         |
| `WEB_UI_ORDERBOOK_LEVELS` | `integer`      | _(internal default)_    | Number of price levels sent to the web UI orderbook display.                                            |
| `BOT_INSTANCE_ID`         | `string`       | _(empty)_               | Human-readable label shown in the web UI header. Useful when running multiple bots.                     |
