# Architecture

## Core Design Goal

This repository is built around parity:

- live and backtest both use the same market processing,
- the same strategy interface,
- the same order intent flow,
- the same portfolio state model.

## Main Layers

1. **Data Source Layer**
- Live: Polymarket market WS + user WS, optional REST poll fallback
- Replay: Parquet files
- Market metadata: Gamma API

2. **Market Layer** (`src/market/*`)
- decode raw WS JSON (`marketChannelDecoder`)
- apply messages to market order books (`MarketOrderBookEngine` / `OrderBookEngine`)
- emit ticks via `MarketEngine`

3. **Strategy Layer** (`src/strategy/*`, `src/strategies/*`)
- strategy interface: `onMarketTick`, `onAccountEvent`
- registry-driven strategy selection + strict param parsing (Zod)
- optional per-tick plugin snapshots

4. **Execution Layer** (`src/trading/*`)
- `OrderManager`: validates + queues/intents execution mode
- adapters:
  - `LiveExecution` for CLOB
  - `BacktestExecution` for simulated fills
- `Portfolio`: canonical order/position/fill state

5. **Persistence & Analytics Layer**
- Parquet recording/replay (`src/parquet/*`)
- MySQL via Drizzle (`src/db/*`)
- per-market and per-batch backtest stats (`src/backtest/stats/*`)

6. **Operator/UI Layer**
- CLI entry points in `src/cli/*`
- embedded bot UI server + React dashboard in `webui/`
- queue runner in `queue/`

## Mode Entry Points

- Live Trading: `src/cli/trading-bot.ts`
- Backtest: `src/cli/backtest.ts`
- Recording: `src/cli/record-live.ts`

## Tick and Event Semantics

- Market ticks are strategy-driving only on `book` and `price_change` events.
- Account events may arrive asynchronously and can cascade into further intents.
- `StrategyRunner` drains account event queue with guard limits (`maxEventsPerDrain`).

## Invariants to Keep

- Do not introduce strategy behavior that differs between live and backtest unless explicitly intended and documented.
- Keep order/fill event semantics deterministic and idempotent.
- Preserve episode boundaries (15m up/down market windows, slug-driven rotation).
