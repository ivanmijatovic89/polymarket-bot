---
title: Key Concepts
description: Definitions of the core terms and abstractions used throughout the Polymarket Bot — markets, strategies, intents, plugins, and more.
---

# Key Concepts

## Prediction markets

A prediction market is a contract that resolves to one of several outcomes. Participants buy shares in outcomes they believe will happen. If correct, shares pay out at full value; if wrong, they expire worthless.

Polymarket implements this with **conditional tokens** — ERC-1155 tokens on Polygon. Each outcome has a YES token and a NO token. At resolution, YES tokens for the winning outcome pay 100¢ each; all others pay 0¢.

## UP/DOWN markets

The bot trades Polymarket's 15-minute UP/DOWN markets for BTC, ETH, SOL, and XRP. Each market asks: will the asset price be higher or lower at the end of the 15-minute window than at the start?

- **YES token** — pays 100¢ if the asset ends UP
- **NO token** — pays 100¢ if the asset ends DOWN

Because YES + NO always resolves to exactly 100¢, there is a hard pricing constraint: `YES_price + NO_price = 100¢`. Deviations from this create arbitrage opportunities that strategies can exploit.

## Slug

A **slug** is the unique identifier for a single 15-minute market window:

```
btc-updown-15m-1714000000
```

The suffix is the Unix epoch in seconds at which the window opened. Slugs appear in Parquet filenames, database records, and API responses.

## Strategy

A **strategy** is a TypeScript class that implements two hooks:

- `onMarketTick(ctx, snapshot)` — called on every orderbook update
- `onAccountEvent(ctx, event)` — called when a fill, cancel, or order status change arrives

Both return an array of **Intents**. Strategies are stateless across ticks — all episode state must be held in the closure created by the strategy's `create()` factory.

## Intent

An **Intent** is a typed instruction returned by a strategy. Available kinds:

| Kind              | Effect                                      |
| ----------------- | ------------------------------------------- |
| `place_limit`     | Place a single GTC/GTD/FOK limit order      |
| `place_batch`     | Place up to 15 orders in one API call       |
| `cancel_order`    | Cancel a specific open order                |
| `cancel_all`      | Cancel all open orders for an asset         |
| `split_positions` | Split USDC collateral into YES + NO shares  |
| `merge_positions` | Merge equal YES + NO positions back to USDC |

The `OrderManager` validates, deduplicates, and forwards intents to the execution layer.

## Plugin

A **plugin** is an optional per-tick computation registered in a `PluginSet`. Strategies access plugin data through `ctx.plugins`. Plugins are evaluated lazily and cached for the duration of a tick — including all cascaded `onAccountEvent` calls.

Available plugins: `TechnicalIndicators`, `DeribitVolatilityIndex`, `TimeWindowVolatility`, `DwellGate`, `TimeWindowGate`, `ExternalFeeds`.

## External feeds

**External feeds** are live-only data sources that provide market context beyond the Polymarket orderbook: Binance spot prices, Deribit implied volatility, RTDS crypto prices, and Polymarket's own price-to-beat feed. Strategies opt in by declaring `requiredFeeds`. Feeds are not available during backtests.

## Parquet recording

The recorder captures every raw WebSocket message from Polymarket and writes it to a **Parquet** file. One file per 15-minute window, stored at:

```
data/events/<symbol>/<slug>.parquet
```

These files are the source of truth for backtesting. Every column is GZIP-compressed. A synthetic `disconnect` row is inserted when the WebSocket connection drops.

## Tick

A **tick** is a single `EngineTick` event emitted by `MarketEngine` when it processes a `book` or `price_change` message. Only these two event types advance strategy execution — all other WS messages (like `last_trade_price`) are processed internally but do not trigger `onMarketTick`.

## Fill status

Order fills progress through a status sequence. Two statuses are important for strategy logic:

- **MATCHED** — the exchange has matched the order. Position data updates quickly, but the transaction is not yet on-chain.
- **MINED** — the transaction is confirmed on Polygon. Safe to use shares for a subsequent sell or merge.

::: warning
You must wait for `MINED` status before selling shares you just bought or merging positions. Using `MATCHED` for these actions will result in a failed transaction.
:::

## EOA vs Relayer

The bot supports two execution modes:

- **EOA (Externally Owned Account)** — your private key signs orders directly via `CLOB_SIGNATURE_TYPE=0`. Simpler, lower latency, suitable for most use cases.
- **Relayer / SAFE** — a SAFE multisig wallet holds the funds. Your EOA signs on behalf of the SAFE via `CLOB_SIGNATURE_TYPE=2`. Required when you want on-chain access control or to separate custody from signing.

## Dry-run mode

When `DRY_RUN=true` (the default), the bot processes ticks and generates intents normally, but `OrderManager` blocks all execution — no orders are placed, no transactions sent. Logs show what _would_ have happened. Safe for testing strategy logic in a live environment.
