# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- Node.js v20 (exactly `>=20 <21`)
- TypeScript, ES modules (`"type": "module"` in package.json)
- No framework like NestJS — plain Node + small helper modules
- Use Context7 MCP tools automatically when you need library/API docs, code generation, or setup steps

## Commands

```bash
# Run a single CLI script directly
tsx src/cli/trading-bot.ts --strategy <id> [--param key=value]
tsx src/cli/backtest.ts --strategy <id> [--param key=value]
tsx src/cli/record-live.ts

# npm shortcuts
npm run trade:bot          # live trading (uses TRADING_SYMBOL env)
npm run trade:bot:btc      # BTC symbol override
npm run backtest           # run backtest (uses RECORD_SYMBOL env)
npm run record:live:btc    # record live data for BTC

# Linting / formatting
npm run lint
npm run lint:fix
npm run format
npm run format:check

# Database (Drizzle + MySQL)
npm run db:generate        # generate migration files
npm run db:migrate         # apply migrations
npm run db:push            # push schema directly (dev only)
npm run db:studio          # open Drizzle Studio

# Parquet utilities
npm run verify:parquet
npm run list:backtest-files

# Web UI (Vite, separate package in webui/)
npm run webui:dev
npm run webui:build
```

No test suite is configured (`npm test` exits with an error).

## Architecture Overview

The central constraint is that **live trading and backtesting run the exact same strategy logic on the exact same tick stream**. Parquet files record raw WebSocket events; the backtest replays them deterministically.

### Three Operating Modes

| Mode | Entry Point | Data Source |
|------|-------------|-------------|
| Live trading | `src/cli/trading-bot.ts` | Polymarket WebSocket |
| Backtesting | `src/cli/backtest.ts` | Parquet replay |
| Data recording | `src/cli/record-live.ts` | Polymarket WebSocket → Parquet |

### Data Flow

```
Live WS / Parquet replay
    ↓
MarketEngine          ← shared between live + backtest
    ↓
MarketOrderBookEngine (per-market) → OrderBookEngine (per-asset)
    ↓
StrategyRunner        ← shared; manages plugin lifecycle per-tick
    ├─ Strategy.onMarketTick()   → Intents
    └─ Strategy.onAccountEvent() → Intents (cascading fills)
         ↓
    OrderManager      ← queues, validates, de-dupes intents
         ↓
    LiveExecution  (live)  |  BacktestExecution  (backtest)
         ↓
    Portfolio         ← canonical position/order/fill state machine
         ↑
    Account events (UserWS primary, REST poll fallback)
```

### Key Source Directories

| Path | Responsibility |
|------|----------------|
| `src/market/` | `MarketEngine` + orderbook engines; shared tick orchestration |
| `src/strategy/` | `Strategy` interface, `StrategyRunner`, `strategyRegistry`, plugins |
| `src/strategies/` | Concrete strategy implementations (30+) |
| `src/trading/` | `OrderManager`, `Portfolio`, `LiveExecution`, `BacktestExecution`, feeds |
| `src/parquet/` | Parquet recording (`io/`) and replay (`replay/`) |
| `src/polymarket/` | CLOB client, WebSocket clients, Gamma API, relayer |
| `src/cli/` | Entry points and CLI helpers |
| `src/db/` | Drizzle schema + MySQL helpers |

### Strategy System

Strategies implement two hooks in `src/strategy/Strategy.ts`:
- `onMarketTick(ctx, snapshot)` — called on every `book` or `price_change` event
- `onAccountEvent(ctx, event)` — called on fills / order status changes

Both return `Intent[]` (place order, cancel, split, merge, etc.). Intents flow to `OrderManager`.

Register strategies in `src/strategy/strategyRegistry.ts`. Strategy params are validated with Zod and passed via CLI: `--strategy <id> --param key=value`.

**Plugins** (`src/strategy/plugins/`) are optional per-tick computations (technical indicators, external feeds, time gates) exposed via `ctx.plugins`. They are declared in the strategy definition and managed by `StrategyRunner`.

### Parquet Files

Recorded files live under `data/events/<symbol>/<slug>.parquet`. Each file covers one 15-minute market window. Columns: `ingest_seq`, `ts_local_ms`, `ts_exchange_ms`, `event_type`, `raw_json`. The backtest heap-merges multiple files by `ingest_seq` for deterministic multi-asset replay.

### Environment / Config

`src/config/env.ts` loads `.env` via dotenv. Set `BOT_ENV=botA` to additionally load `.env.botA` (for running multiple bots). Key env vars: `TRADING_SYMBOL`, `RECORD_SYMBOL`, `PRIVATE_KEY`, `POLYMARKET_API_*`, `DATABASE_*`, `ENABLE_WEB_UI`.

### Execution Modes

- **EOA** — signs orders directly with `PRIVATE_KEY`
- **Relayer (SAFE)** — routes through a Gnosis Safe; configured via `POLYMARKET_BUILDER_*` env vars and `CLOB_SIGNATURE_TYPE`

Backtest latency simulation is controlled by `BACKTEST_LATENCY_DELAY` and `BACKTEST_LATENCY_JITTER`.

## Additional Docs

Detailed diagrams, multi-bot setup, latency calibration, and parallel backtest runner docs are in `docs/`.
