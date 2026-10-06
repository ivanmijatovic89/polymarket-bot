---
title: How It Works
description: The core architecture of the Polymarket Bot — three operating modes, deterministic replay, and the shared engine that powers both live trading and backtesting.
---

# How It Works

## The core invariant

The bot's most important design property is this: **live trading and backtesting run the exact same strategy code over the exact same event stream.**

Recorder V4 captures market and external-feed observations with their local receipt order and times. Backtests replay supported observations through the shared `MarketEngine → StrategyRunner → OrderManager` pipeline. Execution uses a simulator; it cannot reproduce actual exchange fills. A separate live connection can receive different observations or receive them at different times.

The live trading CLI rejects requests for V4-only feed capabilities it cannot supply. Sharing strategy logic does not make an unsupported live feed available. See the [V4 replay contract](/datasets/recording/recorder-v4#coverage-and-backtests).

## Three operating modes

```mermaid
%%{init: {"htmlLabels": false}}%%
graph LR
    subgraph Record
        WS[Polymarket, Binance, Chainlink and PTB] --> REC[record-v4.ts]
        REC --> WAL[Durable journals]
        WAL --> PQ[Compact Parquet and manifest in R2]
    end

    subgraph Backtest
        PQ --> BR[backtest.ts]
        BR --> ENG[MarketEngine]
    end

    subgraph Live
        WS2[Polymarket WebSocket] --> LT[trading-bot.ts]
        LT --> ENG
    end

    ENG --> SR[StrategyRunner]
    SR --> OM[OrderManager]
    OM --> BE[BacktestExecution\nsimulator]
    OM --> LE[LiveExecution\nCLOB API]
```

| Mode         | Entry point      | Data source          | Execution         |
| ------------ | ---------------- | -------------------- | ----------------- |
| **Record** | `record-v4.ts` | Polymarket, Binance, Chainlink, PTB | Verified Parquet/R2 packages |
| **Backtest** | `backtest.ts`    | Parquet replay       | Simulated fills   |
| **Live**     | `trading-bot.ts` | Polymarket WebSocket | Real CLOB orders  |

## Data flow

Every market event — whether from a live WebSocket or a Parquet replay — flows through the same pipeline:

```mermaid
graph TD
    A[Raw WS message / Parquet row] --> B[MarketEngine]
    B --> C{event type?}
    C -->|book / price_change| D[OrderBookEngine\nper asset]
    C -->|other| E[discard]
    D --> F[EngineTick emitted]
    F --> G[StrategyRunner]
    G --> H[Strategy.onMarketTick]
    H --> I[Intent array]
    I --> J[OrderManager\nvalidate · deduplicate · gate]
    J --> K[Execution\nlive or simulated]
    K --> L[AccountEvent\nfill / cancel / status]
    L --> M[Strategy.onAccountEvent]
    M --> I
```

The loop from `AccountEvent` back to `Strategy.onAccountEvent` is the **cascade**: when a fill arrives, the strategy can immediately react by placing the next order within the same tick.

## The 15-minute market structure

Polymarket's BTC/ETH/SOL/XRP UP/DOWN markets resolve every 15 minutes. Each window has:

- A unique **slug** — `btc-updown-15m-<epochSeconds>` — that identifies the episode
- Two conditional tokens — **YES** (UP) and **NO** (DOWN) — each trading between 0¢ and 100¢
- A **resolution** at window close: the winning token redeems at 100¢, the losing token at 0¢

The bot subscribes to the current window's tokens at startup and rotates automatically when the window expires.

## Strategy execution model

Strategies receive two hooks:

- `onMarketTick(tick, portfolio, ctx?)` — fires on every `book` or `price_change` event; the orderbook snapshot is at `tick.snapshot`
- `onAccountEvent(event, portfolio, lastMarket?, ctx?)` — fires on fills, cancels, and order status changes

Both hooks return an array of **Intents** — typed instructions like `place_limit`, `cancel_order`, or `split_positions`. The `OrderManager` validates and executes them, enforcing risk limits, deduplication, and dry-run gating.

Plugins provide optional per-tick data (technical indicators, volatility, external price feeds) that strategies access through `ctx.plugins`. Plugin snapshots are computed once per tick and cached for the entire cascade.

## Execution modes

The bot supports two wallet configurations:

- **EOA** — the private key signs orders directly. Simpler setup, lower overhead.
- **Relayer / SAFE** — a SAFE multisig wallet holds funds; the EOA signs on its behalf. Required for larger positions where on-chain settlement and access control matter.

Both modes use the same strategy and engine code. The difference is only in how `LiveExecution` submits transactions.
