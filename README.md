# polymarket-bot

Polymarket **live recorder + tick-by-tick backtesting engine**.

The core constraint of this repo is: **live trading and backtests must run the exact same strategy logic, on the exact same tick stream**. To enable that, we persist the raw WebSocket messages into Parquet and replay them deterministically.

## What this repo does today

- **Selects the current 15-minute Up/Down market** for a symbol (BTC/ETH/SOL/XRP) using **Gamma**
- **Subscribes to the Polymarket CLOB “market” WebSocket channel** for that market’s 2 token ids
- **Persists every market-channel message as raw JSON** into **rotating Parquet** files
- **Replays Parquet back tick-by-tick** and can reconstruct order books from the captured market-channel events
- **Runs the exact same Strategy code in live trading and backtests** using a shared `MarketEngine` tick stream + a shared `StrategyRunner`
- **Supports order placement + lifecycle** (FOK/GTC/GTD) with live execution via `@polymarket/clob-client` and backtest execution via a simple simulator
- **Consumes account updates** via authenticated **User WebSocket** (preferred) with **REST polling fallback** (fills/trades)

## Quickstart

Requirements:

- Node.js **v20** (repo enforces `>=20 <21`)

Install:

```bash
npm install
```

Record live BTC ticks (writes under `data/events/btc/` by default):

```bash
npm run record:live:btc
```

Replay a captured Parquet file and reconstruct order books:

```bash
npm run backtest -- "data/events/btc/<slug>.parquet"
# or multiple files
npm run backtest -- data/events/btc/<slug>.parquet data/events/btc/<slug-2>.parquet
```

Run a backtest strategy (example):

```bash
npm run backtest -- \
  --strategy example_taker_flip \
  --param size=5 \
  --param maxSpread=0.02 \
  --param cooldownMs=5000 \
  "data/events/btc/<slug>.parquet"
```

## Examples

Backtest (maker quotes; may produce 0 fills with current simulator):

```bash
npm run backtest -- \
  --strategy example_maker_quote \
  --param size=5 \
  --param improveBy=0.001 \
  --param maxSpread=0.05 \
  "data/events/btc/<slug>.parquet"
```

Backtest (taker flip; should produce fills, usually negative due to spread):

```bash
npm run backtest -- \
  --strategy example_taker_flip \
  --param size=5 \
  --param maxSpread=0.02 \
  --param cooldownMs=5000 \
  "data/events/btc/<slug>.parquet"
```

Trading bot (dry-run, safe default; no real orders):

```bash
TRADING_SYMBOL=BTC DRY_RUN=true npm run trade:bot -- \
  --strategy example_maker_quote \
  --param size=5 \
  --param improveBy=0.001 \
  --param maxSpread=0.05
```

Trading bot (live trading enabled; real orders):

```bash
DRY_RUN=false LOG_TRADES=true \
POLYMARKET_API_KEY=... POLYMARKET_API_SECRET=... POLYMARKET_API_PASSPHRASE=... \
PRIVATE_KEY=... \
npm run trade:bot:btc -- \
  --strategy example_maker_quote \
  --param size=5 \
  --param improveBy=0.001 \
  --param maxSpread=0.05
```

## Strategy selection and params

Strategies are selected and configured via CLI args (shared by `backtest` and `trading-bot`):

- `--strategy <id>` (required)
- repeated `--param key=value` (strict: unknown keys / invalid values error out)

Some params are JSON (pass JSON as a string), e.g.:

```bash
--param assetIds='["tokenA","tokenB"]'
```

Internally we validate/coerce params with **Zod**.

## Indicators

Indicators are **optional, reusable computations** that are updated on every market tick and exposed to strategies via a `ctx` argument.

Key properties in this repo:
- **Same in live + backtest**: indicators receive the same `MarketTick` stream (from `MarketEngine` → `StrategyRunner`).
- **Zero cost when unused**: a strategy only constructs an `IndicatorSet` if it needs indicators.

How it works (high-level):
- A strategy can return `{ strategy, indicatorSet }` from its `definition.create(...)`.
- `StrategyRunner` updates `indicatorSet` once per tick and passes `ctx.indicators` into `onMarketTick` and `onAccountEvent`.

### Full list of indicators

- [`TimeWindowVolatility`](src/indicators/volatility/TimeWindowVolatility.md)

### Example strategy using an indicator

- [`readVolatilityIndicator.v1`](src/strategies/readVolatilityIndicator.v1.ts)

## External Feeds

External feeds are **live-only** data sources (not available in backtests) exposed to strategies via `ctx.feeds`.

### Available feeds

- **Polymarket RTDS crypto prices**: `ctx.feeds.rtdsPolymarketCryptoPrices`
  - backed by Polymarket RTDS (Binance source + Chainlink source)
- **Direct Binance spot price (aggTrade)**: `ctx.feeds.binanceWsSpotPrice`
  - backed by Binance Spot WebSocket `aggTrade` (last trade price)

### How to enable

Strategies opt-in by setting `strategy.requiredFeeds` (see [`src/strategy/Strategy.ts`](src/strategy/Strategy.ts)).
`src/cli/trading-bot.ts` will only start feed clients that are requested by the selected strategy.

Read more: [`src/trading/feeds/README.md`](src/trading/feeds/README.md)
Example strategy: [`readExternalFeedBinanceAndChainlinkBitcoinPrice.v1`](src/strategies/readExternalFeedsExample.v1.ts)

## Scripts

- **Live recording**: `src/cli/record-live.ts`
  - `npm run record:live:btc|eth|sol|xrp`
  - or `RECORD_SYMBOL=BTC npm run record:live`
- **Trading bot (strategy runner)**: `src/cli/trading-bot.ts`
  - `npm run trade:bot:btc|eth|sol|xrp`
  - or `TRADING_SYMBOL=BTC npm run trade:bot`
- **Backtest / replay**: `src/cli/backtest.ts`
  - `npm run backtest -- <file1.parquet> [file2.parquet ...]`
  - Ordering: `--order recorded|exchange_time`
  - Realtime-ish: `--time-driven` (caps large sleeps)
- **Verify a Parquet file**: `src/parquet/cli/verify-parquet.ts`
  - `npm run verify:parquet -- <file.parquet> [--metadata-only] [--limit N] [--print N]`

## How recording works (live → Parquet)

High-level flow:

1. **Pick the current market (Gamma)**
   - Slug format: `<symbol>-updown-15m-<epochSecondsOfWindowStart>`
   - We try the current window and (defensively) the previous window around boundaries.
2. **Subscribe to the CLOB WS market channel**
   - Default WS URL: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
3. **Persist raw events into Parquet**
   - Every inbound message is kept as `raw_json`.
   - We also persist a minimal index: `event_type`, `ts_local_ms`, optional `ts_exchange_ms`, and a per-market `ingest_seq`.
4. **Rotate on every 15-minute boundary**
   - On boundary, we stop WS, close Parquet writers (footer), and reconnect (which re-resolves the next market).

### Synthetic gap markers

On **unexpected WebSocket disconnects**, we write a synthetic marker row with:

- `event_type = "disconnect"`
- `raw_json` containing a small JSON object including `ws_close_code`, `ws_close_reason`, and `market`

This lets replays/backtests detect gaps.

### Parquet format (the persisted unit)

Persisted row type: `RawMarketEventRow` (`src/types/rawEvent.ts`)

- `ingest_seq` (**INT64**): monotonically increasing per market id (assigned locally)
- `ts_local_ms` (**INT64**): `Date.now()` at ingestion time
- `ts_exchange_ms` (**INT64, optional**): parsed from message `timestamp` when available (unix ms)
- `event_type` (**UTF8**): message `event_type` (or `"disconnect"` for synthetic markers)
- `raw_json` (**UTF8**): full original WS message string

Schema: `src/parquet/io/eventSchema.ts` (all columns GZIP-compressed).

### Output directory layout & file finalization

Recorded files are written under:

- `data/events/<symbol>/` (override with `RECORD_BASE_DIR`)

Files are named using the **Gamma slug** (sanitized for filesystem safety), e.g.:

- `data/events/btc/btc-updown-15m-<epoch>.parquet`

Important behavior:

- A file is generally opened only after the first `event_type === "book"` (to keep each file self-contained).
  - Exception: synthetic markers may open a file so gaps are still persisted.
- Files are written as `*.parquet.tmp` and renamed to `*.parquet` only on close.
- If you terminate manually (SIGINT/SIGTERM), finalized files are renamed to `*-terminated.parquet` to mark incomplete recordings.

## Backtesting / replay

### Order book reconstruction (tick-by-tick)

This uses the shared engine (`src/market/MarketEngine.ts`) which does:

`raw_json → decodeMarketChannelMessage → MarketOrderBookEngine → onTick()`

Notes:

- The decoder ignores synthetic marker rows (`event_type="disconnect"`).
- Strategy ticks are emitted only on **`book` and `price_change`** (by design).
- In orderbook backtests, files are processed **sequentially** (each file is a single 15m market episode).

Run (default for `npm run backtest`):

```bash
npm run backtest -- "data/events/btc/<slug>.parquet" --order recorded
```

### Backtest a whole folder (avoid listing every file)

The backtest script accepts multiple positional parquet paths, so you can let your shell expand them:

```bash
npm run backtest -- \
  --strategy winnerLimit \
  --param size=5 \
  --param triggerPrice=0.88 \
  --param limitPrice=0.88 \
  --param minDelayMs=600000 \
  data/events/btc/*.parquet
```

If you want a deterministic sorted list (by the epoch suffix in the filename), use:

```bash
npm run backtest -- \
  --strategy winnerLimit \
  --param size=5 \
  --param triggerPrice=0.88 \
  --param limitPrice=0.88 \
  --param minDelayMs=600000 \
  $(npm run -s list:backtest-files -- --symbol btc)
```

Notes:

- `--` is required to forward args through `npm run`.
- If you have many files and hit "argument list too long", add a directory-reading option to the backtest CLI (not implemented yet).

Backtest output:

- prints `[trade] ...` for every simulated fill (AccountEvent `fill`)
- prints a final `[backtest] portfolio ...` summary (fills, positions, open orders, realized PnL)

## Order book module

Order book reconstruction is implemented for Polymarket CLOB market-channel events:

- **Module**: `src/orderbook/OrderBookEngine.ts`
- **Supported event types**:
  - `book` (snapshot, source of truth)
  - `price_change` (delta: set NEW aggregate size at a level)
  - `tick_size_change` (tracked)
  - `last_trade_price` (does not mutate book)

Engines:

- **`OrderBookEngine`**: one `(market, assetId)` token book
- **`MarketOrderBookEngine`**: a market-wide view (`byAssetId`) for strategies that need both tokens

## Environment variables

Required (depending on script):

- `RECORD_SYMBOL`: `BTC|ETH|SOL|XRP` (for `record-live`)
- `TRADING_SYMBOL`: `BTC|ETH|SOL|XRP` (for `trading-bot`, falls back to `RECORD_SYMBOL`)

Gamma:

- `GAMMA_API_BASE_URL` (default: `https://gamma-api.polymarket.com`)

WebSocket:

- `POLYMARKET_WS_URL` (default: `wss://ws-subscriptions-clob.polymarket.com/ws/market`)

Optional auth (if all present, included in subscribe payload):

- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`

Trading / strategies:

- Strategy selection/config is **NOT** done via env vars anymore.
  - Use `--strategy <id>` and repeated `--param key=value` (see “Strategy selection and params” above).
- `DRY_RUN` (default: `true`)
  - `true`: do NOT place real orders (safe default)
  - `false`: enable real order placement (requires `PRIVATE_KEY` and API creds)
- `LOG_TRADES` (default: `false` for trading-bot)
  - `true`: print `[trade] ...` for each fill event (live fills from user WS/polling)

Live trading keys:

- `PRIVATE_KEY` (or `POLYMARKET_PRIVATE_KEY`): wallet private key used to sign orders (required when `DRY_RUN=false`)
- Optional CLOB client envs:
  - `CLOB_API_URL` (default `https://clob.polymarket.com`)
  - `CLOB_CHAIN_ID` (default `137`)
  - `CLOB_SIGNATURE_TYPE` (default `0`)
  - `CLOB_FUNDER` (optional; required for some wallet types)

Polling fallback:

- `CLOB_POLL_INTERVAL_MS` (default `1000`): REST polling interval for trades when user WS is down

Recorder tuning:

- `RECORD_BASE_DIR` (default: `data/events`)
- `RECORD_STATS_INTERVAL_MS` (default: `10000`)
- `RECORD_MAX_INFLIGHT_APPENDS` (default: `10000`)
- `RECORD_SKIP_IF_OLDER_MS` (default: `10000`)

Tip: use a local `.env` (see `.env.example`) and export vars in your shell.

## Live execution: fill status vs on-chain settlement (important)

We deliberately use **two different notions of “done”**:

- **Position updates (fast)**:
  - We use `USER_WS_FILL_AT_STATUS=MATCHED` to update positions as soon as a fill is *matched* (user WS).
- **Actions that require on-chain state (safe)**:
  - To **sell shares you just bought**, you must wait until the buy is **`MINED`**.
  - To **merge shares**, you must wait until the relevant buys are **`MINED`**.

### Buy-both-sides strategies

- For **buy both sides** strategies you can run with `USER_WS_FILL_AT_STATUS=MATCHED`.
- For **leg 2**, you can also use **`MATCHED`** (positions update quickly), but any subsequent **sell/merge** must still wait for **`MINED`**.

## Code map

- **Market selection (Gamma)**:
  - `src/polymarket/gamma.ts`: fetch market by slug
  - `src/polymarket/upDown15m.ts`: compute candidate slugs + select current market
  - `src/utils/timeWindows.ts`: 15m window helpers + slug format
- **Event stream (shared shape)**:
  - `src/types/marketEventSource.ts`: `MarketEvent` + `MarketEventSource` interface
  - `src/market/polymarketEventIndex.ts`: tolerant indexer (`event_type`, `market`, timestamps)
  - `src/parquet/indexer/rawEventIndexer.ts`: recording-focused indexer (indexing + counters)
- **WebSocket (live)**:
  - `src/polymarket/marketWs.ts`: minimal `ws` client (subscribe + heartbeat)
  - `src/polymarket/liveMarketEventSource.ts`: connect/reconnect loop emitting `MarketEvent`
- **Parquet output**:
  - `src/parquet/io/eventSchema.ts`: schema
  - `src/parquet/io/eventWriter.ts`: per-market ordered writer + rotation + tmp→final rename
- **Replay**:
  - `src/cli/backtest.ts`: orderbook reconstruction mode (tick-by-tick)
- **Orderbook / shared engine**:
  - `src/market/orderbook/*`: orderbook engines (OrderBookEngine, MarketOrderBookEngine)
  - `src/market/marketChannelDecoder.ts`: decode raw JSON → Polymarket market-channel messages
  - `src/market/MarketEngine.ts`: shared “raw_json → orderbook → ticks” engine
- **Strategy / trading**
  - `src/strategy/Strategy.ts`: shared types (`Strategy`, `Intent`, `AccountEvent`, `PortfolioSnapshot`)
  - `src/trading/StrategyRunner.ts`: shared event loop (market ticks + account events)
  - `src/trading/OrderManager.ts`: order lifecycle + validation (GTD min expiry) + dry-run support
  - `src/trading/Portfolio.ts`: positions + realized PnL driven by fills
  - `src/trading/execution/BacktestExecution.ts`: simple backtest fill simulator (FOK/GTC/GTD)
  - `src/trading/execution/LiveExecution.ts`: real order placement via `@polymarket/clob-client`
  - `src/polymarket/userWsAccountSource.ts`: authenticated user WS → AccountEvents (fills)
  - `src/polymarket/restPollAccountSource.ts`: REST polling fallback → AccountEvents (fills)
- `src/strategy/strategyRegistry.ts`: strategy registry (definitions + Zod schemas)
- `src/cli/strategyArgs.ts`: shared `--strategy` / `--param` parser + Zod validation
- `src/strategies/*`: strategies (each exports a `definition` with a Zod schema)
- **Scripts**:
  - `src/cli/record-live.ts`: live ingest → Parquet
  - `src/cli/trading-bot.ts`: live ingest → `MarketEngine` → `StrategyRunner` (dry-run by default)
  - `src/cli/backtest.ts`: Parquet replay (orderbook)
  - `src/parquet/cli/verify-parquet.ts`: validator / reader

## Notes / current limitations

- `src/index.ts` is currently a placeholder.
- Maker backtests are conservative right now: the backtest simulator fills orders when they are **marketable** against the current book. Resting maker orders will usually not fill unless you implement a maker-fill approximation.

## References / docs

- Gamma API: `https://docs.polymarket.com/developers/gamma-markets-api/overview`
- CLOB WS market channel: `https://docs.polymarket.com/developers/CLOB/websocket/market-channel`
- Market-channel migration guide: `https://docs.polymarket.com/developers/CLOB/websocket/market-channel-migration-guide`
- CLOB REST / trading API: `https://docs.polymarket.com/developers/CLOB/introduction`

Libraries used:

- `ws`: `https://github.com/websockets/ws`
- `@dsnp/parquetjs`: `https://github.com/ironSource/parquetjs`
- `@polymarket/clob-client`: `https://www.npmjs.com/package/@polymarket/clob-client`
- `ethers`: `https://www.npmjs.com/package/ethers`

# Database

## MySQL Setup

Install and start MySQL:

```bash
brew install mysql
brew services start mysql
brew services stop mysql
```

Create the database:

```bash
mysql -u root -p
CREATE DATABASE polymarket_bot;
```

Or using Docker:

```bash
docker run --name drizzle-mysql -e MYSQL_ROOT_PASSWORD=mypassword -d -p 3306:3306 mysql
```

## Drizzle ORM

This project uses [Drizzle ORM](https://orm.drizzle.team/) for database access and migrations.

### Environment Variables

- `DATABASE_HOST` - MySQL host (required)
  - Example: `localhost`
- `DATABASE_PORT` - MySQL port (required)
  - Example: `3306`
- `DATABASE_USERNAME` - MySQL username (required)
  - Example: `root`
- `DATABASE_PASSWORD` - MySQL password (optional)
  - Example: `password`
- `DATABASE_NAME` - MySQL database name (required)
  - Example: `polymarket_bot`

### Database Scripts

- `npm run db:generate` - Generate migration files from schema changes
- `npm run db:migrate` - Apply migrations to the database
- `npm run db:push` - Push schema changes directly to database (useful for development)
- `npm run db:studio` - Open Drizzle Studio (visual database browser)

### Usage

Import the database instance:

```typescript
import { getDb } from './db/index.js'

const db = getDb()
// Use db to query tables defined in src/db/schema.ts
```

### Schema Definitions

Schema definitions are located in `src/db/schema.ts`. Schemas will be added manually in a future step.

### Migrations

Migration files are stored in the `drizzle/` directory. After modifying schemas:

1. Generate migrations: `npm run db:generate`
2. Review the generated SQL in `drizzle/` directory
3. Apply migrations: `npm run db:migrate`

For rapid development, you can use `npm run db:push` to sync schema changes directly without generating migration files.

```
# create tables
npm run db:generate; npm run db:migrate
# insert markets to database from filenames + gama
npm run db:insert-parquet
```


# Polymarket Server Infrastructure

https://docs.polymarket.com/developers/CLOB/geoblock#server-infrastructure

Primary Servers: eu-west-2
Closest Non-Georestricted Region: eu-west-1