---
title: Running the Live Trading Bot
description: Step-by-step guide to launching the Polymarket live trading bot, configuring execution modes, selecting strategies, and monitoring operation.
---

# Running the Live Trading Bot

The trading bot connects to the Polymarket market WebSocket, resolves the current 15-minute UP/DOWN market for the selected symbol, and runs your chosen strategy against a live order book. All orders are dry-run by default — real order placement requires explicit opt-in.

## Prerequisites

Before starting, ensure your `.env` file is populated with the required credentials:

```bash
# Wallet
PRIVATE_KEY=0x...

# Polymarket CLOB API credentials
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...

# Symbol to trade (BTC | ETH | SOL | XRP)
TRADING_SYMBOL=BTC
```

::: warning Dry-run is the default
`DRY_RUN` defaults to `true`. In this mode the bot resolves markets, processes the order book, and calls strategy logic normally — but no orders are sent to the exchange. Set `DRY_RUN=false` only when you are ready for live execution.
:::

## Quick-start commands

The package provides symbol-specific npm shortcuts:

```bash
npm run trade:bot:btc   # BTC/USD UP-DOWN 15m
npm run trade:bot:eth   # ETH/USD UP-DOWN 15m
npm run trade:bot:sol   # SOL/USD UP-DOWN 15m
npm run trade:bot:xrp   # XRP/USD UP-DOWN 15m
```

All shortcuts call the same entry point (`src/cli/trading-bot.ts`) with `TRADING_SYMBOL` set accordingly.

For full control, invoke the script directly:

```bash
tsx src/cli/trading-bot.ts --strategy <id> [--param key=value ...]
```

## Selecting a strategy

Pass `--strategy` followed by the strategy's registered ID:

```bash
tsx src/cli/trading-bot.ts --strategy my-strategy
```

Strategy IDs come from each strategy's `definition.id`, auto-discovered from `src/strategies/` into `strategyRegistry`. An invalid or missing ID causes the process to exit with code 2 and print usage information.

### Passing parameters

Strategy-specific parameters are supplied via `--param key=value` pairs. Each value is validated against the strategy's Zod schema:

```bash
tsx src/cli/trading-bot.ts \
  --strategy my-strategy \
  --param maxPositionUsdc=50 \
  --param spread=0.02
```

JSON values must be quoted at the shell level:

```bash
--param assetIds='["0xabc","0xdef"]'
```

Unknown keys or values that fail Zod validation cause an immediate exit with a descriptive error.

## Execution modes: EOA vs Relayer

### EOA (default)

The bot signs orders directly with `PRIVATE_KEY`. No additional configuration is required beyond the credentials above.

```bash
# .env
CLOB_SIGNATURE_TYPE=0   # optional — 0 is the default
```

### Relayer / SAFE

Orders are funded from a SAFE wallet while the EOA signs. This mode requires:

```bash
CLOB_FUNDER=0x<safeAddress>
CLOB_SIGNATURE_TYPE=2
POLYMARKET_BUILDER_API_KEY=...
POLYMARKET_BUILDER_API_SECRET=...
POLYMARKET_BUILDER_API_PASSPHRASE=...
POLYMARKET_TX_MODE_SPLIT=relayer   # or: direct
```

When `POLYMARKET_TX_MODE_SPLIT=relayer` is set, the bot checks EOA and SAFE balances and approvals on startup. If either check fails, the process aborts before any market connection is attempted.

::: danger Relayer startup abort
If the startup balance/approval check fails in relayer mode, the bot exits with code 1. Fix EOA and SAFE approvals (using the `eoa:approve` and `relayer:approve` scripts) before restarting.
:::

## Environment variable reference

| Variable                                   | Default                   | Description                                                                       |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| `DRY_RUN`                                  | `true`                    | Set to `false` to enable real order placement                                     |
| `TRADING_SYMBOL`                           | —                         | Required. `BTC`, `ETH`, `SOL`, or `XRP`                                           |
| `RECORD_SYMBOL`                            | —                         | Fallback if `TRADING_SYMBOL` is unset                                             |
| `BOT_ENV`                                  | —                         | If set, loads `.env.<BOT_ENV>` with override priority over `.env`                 |
| `LOG_LEVEL`                                | `info`                    | `debug`, `info`, `warn`, or `error`                                               |
| `LOG_TRADES`                               | `false`                   | Log every intent dispatch to the console                                          |
| `LOG_TO_FILE`                              | `false`                   | Write structured JSONL logs to `logs/trading-bot/`                                |
| `ENABLE_WEB_UI`                            | `false`                   | Enable the built-in browser dashboard                                             |
| `WEB_UI_HOST`                              | `0.0.0.0`                 | Interface the web UI listens on                                                   |
| `WEB_UI_PORT`                              | —                         | Required when `ENABLE_WEB_UI=true`                                                |
| `WEB_UI_REFRESH_MS`                        | `250`                     | UI polling interval in ms (minimum 50)                                            |
| `WEB_UI_ORDERBOOK_LEVELS`                  | `8`                       | Order book depth levels shown in the UI                                           |
| `BOT_INSTANCE_ID`                          | —                         | Arbitrary label shown in the web UI title bar                                     |
| `USER_WS_FILL_AT_STATUS`                   | —                         | `MATCHED`, `MINED`, or `CONFIRMED` — controls when fills trigger `onAccountEvent` |
| `SKIP_MARKET_IF_BOT_STARTED_AFTER_SECONDS` | `15`                      | Skip the current window if the bot started this many seconds after the boundary   |
| `INTENT_EXECUTION_MODE`                    | `immediate`               | `immediate` or `queued`                                                           |
| `MAX_EVENTS_PER_DRAIN`                     | `100`                     | Max account events processed per drain cycle in queued mode                       |
| `BALANCE_REFRESH_COOLDOWN_MS`              | `5000`                    | Minimum interval between on-chain balance polls                                   |
| `POLYGON_RPC_URL`                          | `https://polygon-rpc.com` | RPC endpoint for balance and approval checks                                      |

## Enabling the web UI

Set `ENABLE_WEB_UI=true` and a port number before starting:

```bash
ENABLE_WEB_UI=true WEB_UI_PORT=3000 npm run trade:bot:btc -- --strategy my-strategy
```

The UI is served at `http://<WEB_UI_HOST>:<WEB_UI_PORT>`. It shows the live order book, portfolio state, plugin snapshots, balance, and a scrolling log buffer. You can cancel individual orders or all open orders directly from the UI.

::: tip Local-only access
For local development the default `WEB_UI_HOST=0.0.0.0` allows LAN access. Set `WEB_UI_HOST=127.0.0.1` to restrict the UI to localhost only.
:::

## Multi-bot configuration

Running multiple bot instances on the same machine is supported via per-bot env files:

```bash
BOT_ENV=botA tsx src/cli/trading-bot.ts --strategy my-strategy
```

With `BOT_ENV=botA`, the loader reads `.env` first, then `.env.botA` with override priority. The bot-specific file wins over both `.env` and shell environment variables. Use this to assign distinct `WEB_UI_PORT`, `TRADING_SYMBOL`, `BOT_INSTANCE_ID`, and API keys per instance.

## What to watch in logs

On startup the bot logs a configuration summary:

```
[trading-bot][⚙️] symbol=BTC
[trading-bot][⚙️] wsUrl=wss://ws-subscriptions-clob.polymarket.com/ws/market
[trading-bot][⚙️] dryRun=true
[trading-bot][⚙️] strategy=my-strategy
```

After connecting to the market WebSocket:

```
[trading-bot] 🟢 connected (ws)
[trading-bot][🔄] market changed { from: null, to: "btc-updown-15m-1234567890" }
[trading-bot][warmup-market][🟢] warmed { slug: "...", durationMs: 120 }
```

Every 10 seconds (when the web UI is disabled) a stats line is emitted:

```
[trading-bot] stats ws_events_total=4200 candle_left_ms=312000 slug=btc-updown-15m-1234567890
```

At each 15-minute boundary the bot rotates automatically: it disconnects from the old market WebSocket, resolves the new market from the Gamma API, and reconnects.

### Account stream

The bot subscribes to the Polymarket user WebSocket for real-time fill events. If the user WebSocket disconnects after being stably connected for at least 10 seconds, the bot automatically enables a REST polling fallback and re-disables it once the WebSocket reconnects.

::: tip Fill-status semantics
`USER_WS_FILL_AT_STATUS=MATCHED` processes fills immediately on match, before on-chain confirmation. Use this with care: you must wait for `MINED` status before selling shares you just bought, or before merging positions.
:::
