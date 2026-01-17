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

Backtest random Parquet files from the database for a symbol (use `--limit` to control how many, and `--random` to randomize selection):

```bash
npm run backtest -- \
  --strategy example_taker_flip \
  --param size=5 \
  --param maxSpread=0.02 \
  --param cooldownMs=5000 \
  --symbol btc \
  --limit 100 \
  --random
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

## Measure Latency (`measureLatency.v1`)

`measureLatency.v1` is a test strategy that measures **end-to-end live execution latency** (place + cancel) on your current environment (local machine or server/droplet). The measured latency can then be added to `.env` so backtests can simulate the same latency and better match live behavior.

Docs: [`docs/MeasureLatency.md`](docs/MeasureLatency.md)

## Backtest latency simulation (intent → exchange-visible)

Backtests can simulate **order/ack latency** (roughly: when your system emits an intent → when you can be confident the order/cancel “arrived” at the exchange and is visible/acknowledged) using env vars:

- `BACKTEST_LATENCY_DELAY` (ms): base delay (example `140`)
- `BACKTEST_LATENCY_JITTER` (ms): symmetric jitter range (uniform in `[-jitter, +jitter]`)

Behavior (backtest-only):

- **Placement/cancel are delayed** in the backtest execution adapter (`src/trading/execution/BacktestExecution.ts`).
  - This affects: `placeLimit`, `placeBatch`, `cancelOrder`, `cancelAll`.
  - Cancels are also delayed, so an order may fill before the cancel “arrives” (more realistic).
- **Maker fills use a conservative “worst-queue” model**:
  - BUY resting @ price `P` fills only when `bestAsk < P` (price trades *through* your level)
  - SELL resting @ price `P` fills only when `bestBid > P`

Setup:

- Copy `env.example` → `.env` and edit values (the backtest CLI loads `.env`).

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

## Warmup: `warmupMarket()` (live-only)

The Polymarket client library (`@polymarket/clob-client`) does extra per-token metadata fetches the **first time** you place an order for a token in a fresh process (or a fresh market window), including:
- tick size
- fee rate
- negRisk flag

That makes the **first order** noticeably slower than subsequent orders (caches + keep-alive warm up).

To avoid that cold-start cost impacting the first real order, the trading bot performs a **market warmup**:
- **Implementation**: `LiveExecution.warmupMarket()` (`src/trading/execution/LiveExecution.ts`)
- **When it runs**: on trading-bot startup and whenever the 15m market rotates/changes (`src/cli/trading-bot.ts`)
- **What it does**: pre-fetches and caches token metadata for the market’s UP+DOWN token IDs so later order placement is faster.

### Strategy gating (optional)

The trading bot also exposes warmup state to strategies via `ctx.warmup`. Strategies that place orders can gate like:
- `if (!isWarmed(ctx)) return []` (helper in `src/strategy/strategyToolkit.ts`)

In backtests, `ctx.warmup` is typically absent, and `isWarmed(ctx)` returns true (no warmup concept in backtests).

## Scripts

- **Live recording**: `src/cli/record-live.ts`
  - `npm run record:live:btc|eth|sol|xrp`
  - or `RECORD_SYMBOL=BTC npm run record:live`
- **Trading bot (strategy runner)**: `src/cli/trading-bot.ts`
  - `npm run trade:bot:btc|eth|sol|xrp`
  - or `TRADING_SYMBOL=BTC npm run trade:bot`
- **Web UI (build/dev)**:
  - `npm run webui:build` (builds the UI into `webui/dist/`)
  - `npm run webui:dev` (runs the Vite dev server for UI development)
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

### Run many backtests in parallel (GNU `parallel`)

This repo supports running many backtests concurrently by putting one command per line in a jobs file (example: `src/strategies/split/backtest-jobs.txt`) and executing them with GNU `parallel`:

```bash
parallel -j 6 --bar --eta --joblog logs/parallel.log > /dev/null < src/strategies/split/backtest-jobs.txt
```

See: [`docs/ParallelBacktestRunner.md`](docs/ParallelBacktestRunner.md)

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

### File logs (per-run JSONL)

For debugging and post-mortems you can persist logs to a per-run JSONL file:

- `LOG_TO_FILE` (default: `false`)
  - `true`: write a JSONL log file under `logs/trading-bot/`

Filename format:

- `logs/trading-bot/<YYYYMMDD-HHMMSS-mmm>-<strategy>.jsonl`

Example:

```bash
LOG_TO_FILE=true \
TRADING_SYMBOL=BTC DRY_RUN=true \
ENABLE_WEB_UI=true WEB_UI_PORT=3001 \
  npm run trade:bot:btc -- --strategy readExternalFeedsExample.v1 --param logEveryMs=1000
```

### Web UI (Phase 1, read-only)

The trading bot can optionally expose a **local-only** Web UI (HTTP + WebSocket) per bot process.

- `ENABLE_WEB_UI` (default: `false`)
  - `true`: start the embedded UI server
- `WEB_UI_HOST` (default: `127.0.0.1`)
  - keep this as `127.0.0.1` while developing; later you can switch to `0.0.0.0` behind auth/reverse proxy
- `WEB_UI_PORT` (required when enabled)
  - example: `3001`, `3002`, ...
- `WEB_UI_REFRESH_MS` (default: `250`)
  - UI push cadence (snapshot + log deltas)
- `WEB_UI_ORDERBOOK_LEVELS` (default: `8`)
  - how many levels per side to include in the snapshot
- `BOT_INSTANCE_ID` (optional)
  - free-form identifier shown in the UI title; useful when running multiple bots

Run example:

```bash
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

Open: `http://127.0.0.1:3001/`

Multi-bot (separate processes, different ports):

```bash
ENABLE_WEB_UI=true WEB_UI_PORT=3001 BOT_INSTANCE_ID=botA \
  npm run trade:bot:btc -- --strategy readVolatilityIndicator.v1 --param logEveryMs=500

ENABLE_WEB_UI=true WEB_UI_PORT=3002 BOT_INSTANCE_ID=botB \
  npm run trade:bot:btc -- --strategy readVolatilityIndicator.v1 --param logEveryMs=1500
```

See also: `webui/README.md`

Live trading keys:

- `PRIVATE_KEY` (or `POLYMARKET_PRIVATE_KEY`): wallet private key used to sign orders (required when `DRY_RUN=false`)
- Optional CLOB client envs:
  - `CLOB_API_URL` (default `https://clob.polymarket.com`)
  - `CLOB_CHAIN_ID` (default `137`)
  - `CLOB_SIGNATURE_TYPE` (default `0`)
  - `CLOB_FUNDER` (optional; required for some wallet types)

### Relayer (SAFE) gasless split setup

This repo supports **gasless split** via Polymarket’s Relayer Client using a **SAFE wallet**. The SAFE becomes the **funding wallet** (USDC + outcome tokens live there), while your EOA key still signs.

Relayer env vars (builder credentials):

- `POLYMARKET_BUILDER_API_KEY`
- `POLYMARKET_BUILDER_API_SECRET`
- `POLYMARKET_BUILDER_API_PASSPHRASE`
- `POLYMARKET_RELAYER_URL` (default `https://relayer-v2.polymarket.com/`)
- `POLYMARKET_RELAYER_CHAIN_ID` (default `137`)
- `POLYMARKET_RELAYER_TX_TYPE` (default `SAFE`)
- `POLYMARKET_TX_MODE_SPLIT` = `relayer` or `direct`
- `POLYMARKET_TX_MODE_MERGE` = `relayer` or `direct`
- `POLYMARKET_EOA_GAS_MULTIPLIER` (default `2`, direct EOA split/merge/redeem)

Redeem watcher (background):

- `npm run redeem-watcher`
- `npm run redeem-watcher:relayer`
- `npm run redeem-watcher:direct`
- Optional envs:
  - `REDEEM_WATCH_INTERVAL_MS` (default `30000`)
  - `REDEEM_LOOKBACK_HOURS` (default `48`)
  - `REDEEM_MAX_MARKETS_PER_TICK` (default `20`)
  - `REDEEM_STATE_PATH` (default `data/redeem/redeemed.json`)
  - `POLYMARKET_TX_MODE_REDEEM` (default `relayer`)

SAFE funding + CLOB:

- Set `CLOB_FUNDER=<safeAddress>`
- Set `CLOB_SIGNATURE_TYPE=2` for SAFE funder (Polymarket docs: Safe signature type)

Helper commands:

- Deploy SAFE and print its address:
  - `npm run relayer:deploy-safe`
- Show current SAFE (from `CLOB_FUNDER`):
  - `npm run relayer:show-safe`
- Approve USDC + CTF (SAFE → CTF + Exchange) via relayer:
  - `npm run relayer:approve`
- Deposit USDC from your EOA to SAFE (EOA pays gas):
  - `npm run relayer:deposit-usdc -- --to <safeAddress> --amount <usdc>`
  - Example (send 5 USDC to SAFE):
    - `npm run relayer:deposit-usdc -- --to 0xYourSafeAddressHere --amount 5`
- Withdraw USDC from SAFE to your EOA (gasless via relayer):
  - `npm run relayer:withdraw-usdc -- --to <eoaAddress> --amount <usdc>`
  - Example (withdraw 5 USDC to EOA):
    - `npm run relayer:withdraw-usdc -- --to 0xYourEoaAddressHere --amount 5`
- Approve USDC → CTF from your EOA (needed for direct split/redeem):
  - `npm run eoa:approve-ctf`
- Check balances/approvals (logs EOA + SAFE):
  - `npm run check:balances`

Startup checks (testing):

- The trading bot logs **both** EOA and SAFE balances/approvals.
- If `POLYMARKET_TX_MODE_SPLIT=relayer`, startup fails unless **both** wallets have required balance/approvals.

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


## PnL Report

Generate a PnL report from your Polymarket activity (trades, splits, merges, redeems) using the [Activity API](https://docs.polymarket.com/api-reference/core/get-user-activity):

```bash
# Basic usage (shows last 50 markets)
npx tsx src/cli/pnl-report.ts

# Filter by symbol
npx tsx src/cli/pnl-report.ts --symbol btc

# Filter by slug pattern
npx tsx src/cli/pnl-report.ts --slug btc-updown-15m

# Limit number of markets
npx tsx src/cli/pnl-report.ts --symbol btc --limit 100

# Output as JSON
npx tsx src/cli/pnl-report.ts --json

# Debug mode (shows raw API response)
npx tsx src/cli/pnl-report.ts --debug
```

The report shows:
- **Bought**: USDC spent on BUY trades
- **Sold**: USDC received from SELL trades
- **Split**: USDC spent on SPLIT operations
- **Merge**: USDC received from MERGE operations
- **Redeem**: USDC received from REDEEM (after market resolution)
- **Net PnL**: Total profit/loss = (Sold + Merge + Redeem) - (Bought + Split)

Market status:
- **open**: Still holding shares
- **closed**: Position exited via SELL or MERGE
- **redeemed**: Market resolved and shares redeemed

Wallet selection:
- Uses `CLOB_FUNDER` (SAFE address) if set in `.env`
- Otherwise uses EOA address derived from `PRIVATE_KEY`

API calls: **2 requests** per run (`/activity` + `/value`)

# Polymarket Server Infrastructure

https://docs.polymarket.com/developers/CLOB/geoblock#server-infrastructure

Primary Servers: eu-west-2
Closest Non-Georestricted Region: eu-west-1


# FIX
// inside createTradingBotWebUiServer({ getState: () => { ... } })

// before
const market = runner.getLastMarketSnapshot()

// after
const market = marketEngine.snapshot()

# RECORD FROM WINDOWS
```
npx cross-env RECORD_SYMBOL=ETH npx tsx src/cli/record-live.ts
```

# Running Multiple Bots

See [`docs/MultipleBots.md`](docs/MultipleBots.md) for instructions on running multiple bot instances and accessing them from different machines (Mac and Windows).