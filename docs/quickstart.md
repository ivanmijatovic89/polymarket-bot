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

## Step 1 — Record live market data

The bot trades on 15-minute UP/DOWN markets for BTC, ETH, SOL, and XRP. Before backtesting, you need recorded data.

```bash
RECORD_SYMBOL=BTC npm run record:live:btc
```

Data is written to `data/events/btc/` as `.parquet` files, one per 15-minute window. Let it run for at least one full window (15 minutes) to capture a complete episode.

::: tip
Press `Ctrl+C` to stop the recorder cleanly. The current file is renamed to `*-terminated.parquet` and is valid for backtesting.
:::

## Step 2 — Seed the database

After recording, register the new files in the database so the backtest runner can find them:

```bash
npm run db:insert-parquet
```

## Step 3 — Run a backtest

```bash
npm run backtest -- --strategy basicFak.v1 --symbol btc --limit 5 --latest
```

This replays the 5 most recent BTC recordings with the `basicFak.v1` strategy and prints per-market and aggregate statistics.

::: tip
`DRY_RUN` has no effect in backtests — execution is always simulated. Safe to run at any time.
:::

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
- [ ] `npm run record:live:btc` writes valid `.parquet` files
- [ ] `npm run backtest` runs at least one file end-to-end without errors
- [ ] `npm run trade:bot:btc` starts, connects to market WebSocket, and logs ticks in dry-run mode
- [ ] `npm run check:balances` shows sufficient USDC and correct approvals
