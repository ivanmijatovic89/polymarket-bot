---
title: Running the Live Trading Bot
description: Step-by-step guide to launching the Polymarket live trading bot, configuring execution modes, selecting strategies, and monitoring operation.
---

# Running the Live Trading Bot

The trading bot connects to the Polymarket market WebSocket, resolves the current UP/DOWN market for the selected symbol (15m by default; V4 also supports BTC 5m), and runs your chosen strategy against a live order book. Dry-run is the default — set `DRY_RUN=false` explicitly to place real orders.

::: danger Live execution requires migration
The current implementation still uses the legacy CLOB SDK. Polymarket's [CLOB V2 migration guide](https://docs.polymarket.com/v2-migration) states that V1-signed orders are no longer supported in production. Keep live trading disabled until the signing and collateral migration in [issue #249](https://github.com/ivanmijatovic89/polymarket-bot/issues/249) is complete and verified. Post-only support does not resolve this compatibility blocker.
:::

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

::: tip Dry-run is the default
`DRY_RUN` defaults to `true` — the bot resolves markets, processes the order book, and calls strategy logic normally without sending any orders. Set `DRY_RUN=false` explicitly to place real orders; startup then logs a loud LIVE MODE warning.
:::

Dry-run synthesizes accepted/open order events after shared validation. It does not simulate fills or post-only crossing rejection. Use backtests for those checks; neither mode establishes current production exchange compatibility.

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

## V4 receipt-ordered live feeds

Set `TRADING_FEED_MODE=recorder-v4` to use the same transport adapters, bootstrap
coordinator, market decoder and feed dispatcher as Recorder V4 replay. A strategy
requesting `binanceBookTicker`, `chainlinkTwap` or the opening Chainlink TWAP
reference selects this mode automatically. Existing strategies remain on the
legacy feed runtime unless explicitly opted in. `TRADING_FEED_MODE=legacy` rejects
these new requests instead of silently substituting another feed.

The V4 runtime supports one BTC timeframe per bot: `TRADING_TIMEFRAME=5m` or `15m`
(default). It discovers and subscribes to the next market before its boundary,
restores the observed book/feed state without synthetic history, and changes
strategy context after the preceding tick has completed. Missing data remains
absent; a Polymarket disconnect resets the books while preserving the independent
feed observations and their actual receipt times.

```bash
DRY_RUN=true TRADING_FEED_MODE=recorder-v4 TRADING_TIMEFRAME=5m \
  npm run trade:bot:btc -- --strategy readExternalFeedsExample.v1 \
  --param priceToBeatSource=chainlink-opening-twap
```

Use `TRADING_TIMEFRAME=15m` for 15-minute markets, or
`--param priceToBeatSource=website` for independent website PTB observations.
The opening TWAP is available only from an exact boundary observation under an
explicit 60-second TWAP market configuration. There is no nearest-price fallback.
The website observation continues to populate comparison diagnostics when the
opening TWAP is selected.

Request feeds using [`ExternalFeedsRequestPlugin`](/plugins/plugin-external-feeds):
Binance aggregate trades and best bid/ask, PolyBolt Chainlink spot and 60-second
TWAP, plus PTB. Chainlink subscriptions require the three CLOB API credentials;
dry-run does not require a private key. The legacy RTDS Binance subfeed is not
supplied by V4: use `binanceWsSpotPrice`. Other symbols and timeframes fail explicitly.

Each strategy tick carries its receipt timestamp and sequence. The runtime binds
feed snapshots to that tick before asynchronous strategy/account processing.
A 16 MiB input-queue limit stops the bot with an error if it cannot keep up; it
never continues after silently dropping observations. This runtime writes no
recordings or R2 objects. Run the recorder separately for durable captures.
Separate bot and recorder connections can still receive different real-world
streams; shared processing guarantees equivalent results for identical inputs,
not identical delivery on independent sockets.

Validation covers controlled dry-run live/replay feed snapshots, strategy decisions,
batched frames, reconnects, missing initial prices and rotation for both durations
and both PTB sources. It does not remove the CLOB execution migration blocker above
or establish real-money execution readiness.

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

## Per-Market Execution Allowance

The shared engine starts each market with a 500-USDC spending allowance. Set `--starting-capital <USDC>` or `STARTING_CAPITAL`; the CLI flag takes precedence. Amounts must be finite and non-negative.

```bash
DRY_RUN=true npm run trade:bot:btc -- --strategy winnerLimit.v1 --starting-capital 500
```

Live rotation creates fresh strategy/plugin state and a fresh Portfolio, requests cancellation of old resting orders, and drops undispatched old decisions. Delayed fills and operation results stay with their original market. A new allowance does not deposit funds: actual wallet balances remain in `ctx.balance`, and the exchange can reject an engine-affordable order if the wallet is underfunded. See [reservation and cancellation rules](../engine/portfolio.md#execution-capital).

## Environment variable reference

`STARTING_CAPITAL` defaults to `500` USDC per market; `--starting-capital` overrides it.

| Variable                                   | Default                   | Description                                                                         |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------- |
| `DRY_RUN`                                  | `true`                    | Real orders ONLY when set to exactly `false`; anything else (incl. unset) = dry-run |
| `TRADING_FEED_MODE`                        | Automatic                 | `legacy` or `recorder-v4`; new feed requests automatically select V4                |
| `TRADING_TIMEFRAME`                        | `15m`                     | V4 BTC: `5m` or `15m`; legacy runtime: `15m`                                        |
| `TRADING_SYMBOL`                           | —                         | Required. `BTC`, `ETH`, `SOL`, or `XRP`                                             |
| `RECORD_SYMBOL`                            | —                         | Fallback if `TRADING_SYMBOL` is unset                                               |
| `BOT_ENV`                                  | —                         | If set, loads `.env.<BOT_ENV>` with override priority over `.env`                   |
| `LOG_LEVEL`                                | `info`                    | `debug`, `info`, `warn`, or `error`                                                 |
| `LOG_TRADES`                               | `false`                   | Log every intent dispatch to the console                                            |
| `LOG_TO_FILE`                              | `false`                   | Write structured JSONL logs to `logs/trading-bot/`                                  |
| `ENABLE_WEB_UI`                            | `false`                   | Enable the built-in browser dashboard                                               |
| `WEB_UI_HOST`                              | `0.0.0.0`                 | Interface the web UI listens on                                                     |
| `WEB_UI_PORT`                              | —                         | Required when `ENABLE_WEB_UI=true`                                                  |
| `WEB_UI_REFRESH_MS`                        | `250`                     | UI polling interval in ms (minimum 50)                                              |
| `WEB_UI_ORDERBOOK_LEVELS`                  | `8`                       | Order book depth levels shown in the UI                                             |
| `BOT_INSTANCE_ID`                          | —                         | Arbitrary label shown in the web UI title bar                                       |
| `USER_WS_FILL_AT_STATUS`                   | —                         | `MATCHED`, `MINED`, or `CONFIRMED` — controls when fills trigger `onAccountEvent`   |
| `SKIP_MARKET_IF_BOT_STARTED_AFTER_SECONDS` | `15`                      | Skip the current window if the bot started this many seconds after the boundary     |
| `INTENT_EXECUTION_MODE`                    | `immediate`               | `immediate` or `queued`                                                             |
| `MAX_EVENTS_PER_DRAIN`                     | `4200`                    | Account-event limit per drain cycle in both execution modes; shared with backtests  |
| `BALANCE_REFRESH_COOLDOWN_MS`              | `5000`                    | Minimum interval between on-chain balance polls                                     |
| `POLYGON_RPC_URL`                          | `https://polygon-rpc.com` | RPC endpoint for balance and approval checks                                        |

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
