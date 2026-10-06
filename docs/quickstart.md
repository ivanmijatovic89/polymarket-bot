---
title: Quickstart
description: Get the bot recording, backtesting, and trading in under 10 minutes.
---

# Quickstart

## Prerequisites

- Node.js v20 (`node --version` should print `v20.x.x`)
- MySQL 8+ running locally or remotely
- A Polymarket account with an EOA private key and CLOB API credentials

## Install

```bash
git clone https://github.com/ivanmijatovic89/polymarket-bot.git
cd polymarket-bot
npm install
npm --prefix webui install
```

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Minimum required variables to get started:

```bash
# .env
PRIVATE_KEY=0x...
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...

DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USERNAME=root
DATABASE_PASSWORD=...
DATABASE_NAME=polymarket_bot
```

Set up the database:

```bash
npm run db:migrate
```

## Step 1 — Record BTC 5m and 15m market data

Use [Recorder V4](/datasets/recording/recorder-v4#configuration) with its dedicated configuration file. It requires feed credentials and, for archival, R2 credentials; it does not require a wallet private key or load the trading `.env`.

```bash
npm run record:v4 -- --env-file /absolute/path/to/.env.recorder-v4
```

The recorder captures both durations, including Binance, Chainlink, and price-to-beat observations. It archives self-contained packages to R2 and removes recorder-local event files only after upload verification. Let it run long enough for a complete market and the finalization grace. The market already in progress at startup is marked incomplete.

For the existing deployment, use the [worker-2 service commands](/datasets/recording/recorder-v4-worker-2) rather than starting a second instance. `Ctrl+C` stops a foreground instance cleanly and preserves unfinished work for recovery.

## Step 2 — Download and verify a package

Use the [V4 list/download commands](/datasets/recording/recorder-v4#r2-object-layout) to select a timeframe/date range or an exact R2 manifest. A downloaded cache is separate from the recorder spool. Verify a selected package:

```bash
npm run record:v4:verify -- /absolute/path/to/downloaded-package
```

V4 packages carry their own market metadata and resolution sidecars. They do not need `db:insert-parquet` registration.

## Step 3 — Run a backtest

```bash
npm run backtest -- --strategy basicFak.v1 \
  --input-mode recorder-v4 --dir /absolute/path/to/recorder-cache \
  --timeframe 15m --latest --limit 5 --sequential
```

This replays up to five selected 15-minute packages locally and saves results to MySQL. Check the saved market statuses: incomplete required-feed coverage is skipped, and missing official resolution is reported. Omit `--sequential` to use the [backtest fleet](/backtest/fleet/overview); workers must have access to the package path, or receive an R2 manifest input they can download.

`DRY_RUN` has no effect in backtests — execution is always simulated. For older data, use the [Telonex workflow](/datasets/telonex/backtest).

## Step 4 — Run the live trading bot

::: danger Production migration is required
The current bot uses the legacy CLOB SDK. Polymarket no longer supports V1-signed orders in production; signing and collateral migration remains open in [issue #249](https://github.com/ivanmijatovic89/polymarket-bot/issues/249). Keep live execution disabled until that work is complete and verified. See [Live Execution](./engine/live-execution.md) for details.
:::

By default, `DRY_RUN=true`. The bot connects to live markets, runs strategy logic, and logs what it _would_ do — but places no real orders.

```bash
TRADING_SYMBOL=BTC npm run trade:bot:btc -- --strategy basicFak.v1
```

After production compatibility is restored and verified, real execution is enabled with `DRY_RUN=false`:

```bash
TRADING_SYMBOL=BTC DRY_RUN=false npm run trade:bot:btc -- --strategy basicFak.v1
```

::: danger
Real orders move real money. Backtests verify behavior within the simulator; dry-run only synthesizes accepted/open orders and does not test fills or post-only crossing rejection. Neither establishes production exchange compatibility.
:::

## Validation checklist

Before going live, confirm:

- [ ] The CLOB V2/signing and collateral migration in #249 is complete and verified
- [ ] `npm run code:eslint` passes
- [ ] `npm run record:v4:verify -- <package>` verifies a complete V4 package
- [ ] `npm run backtest` runs at least one file end-to-end without errors
- [ ] `npm run trade:bot:btc` starts, connects to market WebSocket, and logs ticks in dry-run mode
- [ ] `npm run check:balances` shows sufficient USDC and correct approvals
