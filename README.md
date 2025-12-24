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
STRATEGY=example_taker_flip npm run backtest -- "data/events/btc/<slug>.parquet"
```

## Examples

Backtest (maker quotes; may produce 0 fills with current simulator):

```bash
STRATEGY=example_maker_quote STRAT_SIZE=5 STRAT_IMPROVE_BY=0.001 STRAT_MAX_SPREAD=0.05 \
npm run backtest -- "data/events/btc/<slug>.parquet"
```

Backtest (taker flip; should produce fills, usually negative due to spread):

```bash
STRATEGY=example_taker_flip STRAT_SIZE=5 STRAT_MAX_SPREAD=0.02 STRAT_COOLDOWN_MS=5000 \
npm run backtest -- "data/events/btc/<slug>.parquet"
```

Trading bot (dry-run, safe default; no real orders):

```bash
TRADING_SYMBOL=BTC DRY_RUN=true STRATEGY=example_maker_quote npm run trade:bot
```

Trading bot (live trading enabled; real orders):

```bash
DRY_RUN=false LOG_TRADES=true STRATEGY=example_maker_quote \
POLYMARKET_API_KEY=... POLYMARKET_API_SECRET=... POLYMARKET_API_PASSPHRASE=... \
PRIVATE_KEY=... \
npm run trade:bot:btc
```

## Scripts

- **Live recording**: `src/cli/record-live.ts`
  - `npm run record:live:btc|eth|sol|xrp`
  - or `RECORD_SYMBOL=BTC npm run record:live`
- **Trading bot (strategy runner)**: `src/cli/trading-bot.ts`
  - `npm run trade:bot:btc|eth|sol|xrp`
  - or `TRADING_SYMBOL=BTC npm run trade:bot`
- **Backtest / replay**: `src/cli/backtest.ts`
  - `npm run backtest -- <file1.parquet> [file2.parquet ...]`
  - Override mode: `npm run backtest -- --mode raw <file.parquet>`
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

This repo has two replay paths:

### 1) Raw replay (counts & indexing)

This uses `createParquetReplaySource` (`src/parquet/replay/parquetReplaySource.ts`) to emit the same `MarketEvent` shape used by live ingestion:

- `--order recorded`: merge deterministically by `(ts_local_ms, ingest_seq, file_index)`
- `--order exchange_time`: merge deterministically by `(ts_exchange_ms ?? ts_local_ms, ingest_seq, file_index)`

Run:

```bash
npm run backtest -- --mode raw "data/events/btc/<slug>.parquet" --order recorded
```

### 2) Order book reconstruction (tick-by-tick)

This uses the shared engine (`src/engine/MarketEngine.ts`) which does:

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
STRATEGY=winnerLimit STRAT_SIZE=5 STRAT_TRIGGER_PRICE=0.88 STRAT_LIMIT_PRICE=0.88 STRAT_MIN_DELAY_MS=600000 \
npm run backtest -- data/events/btc/*.parquet
```

If you want a deterministic sorted list (by the epoch suffix in the filename), use:

```bash
STRATEGY=winnerLimit STRAT_SIZE=5 STRAT_TRIGGER_PRICE=0.88 STRAT_LIMIT_PRICE=0.88 STRAT_MIN_DELAY_MS=600000 \
npm run backtest -- $(npm run -s list:backtest-files -- --symbol btc)
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

- `STRATEGY` (default: `example_maker_quote`)
  - `example_maker_quote`: places resting limit quotes (maker-style)
  - `example_taker_flip`: places FOK taker orders to validate end-to-end plumbing (will usually lose spread; not a profitable strategy)
- `DRY_RUN` (default: `true`)
  - `true`: do NOT place real orders (safe default)
  - `false`: enable real order placement (requires `PRIVATE_KEY` and API creds)
- `LOG_TRADES` (default: `false` for trading-bot)
  - `true`: print `[trade] ...` for each fill event (live fills from user WS/polling)

Strategy config envs (examples):

- `STRAT_ASSET_ID`: explicit token id to trade (otherwise picks the first available from the snapshot)
- `STRAT_SIZE`: order size (shares)
- `STRAT_MAX_SPREAD`: max spread threshold
- `STRAT_IMPROVE_BY`: quote improvement inside spread (`example_maker_quote`)
- `STRAT_ORDER_TYPE`: `GTC|GTD` for maker quotes
- `STRAT_GTD_TTL_MS`: GTD TTL in ms (maker quotes)
- `STRAT_COOLDOWN_MS`: cooldown between actions (`example_taker_flip`)

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

## Code map

- **Market selection (Gamma)**:
  - `src/polymarket/gamma.ts`: fetch market by slug
  - `src/polymarket/upDown15m.ts`: compute candidate slugs + select current market
  - `src/utils/timeWindows.ts`: 15m window helpers + slug format
- **Event stream (shared shape)**:
  - `src/types/marketEventSource.ts`: `MarketEvent` + `MarketEventSource` interface
  - `src/polymarket/marketEventIndex.ts`: tolerant indexer (`event_type`, `market`, timestamps)
  - `src/engine/marketEventHandler.ts`: shared pipeline entrypoint (indexing + counters)
- **WebSocket (live)**:
  - `src/polymarket/marketWs.ts`: minimal `ws` client (subscribe + heartbeat)
  - `src/polymarket/liveMarketEventSource.ts`: connect/reconnect loop emitting `MarketEvent`
- **Parquet output**:
  - `src/parquet/io/eventSchema.ts`: schema
  - `src/parquet/io/eventWriter.ts`: per-market ordered writer + rotation + tmp→final rename
- **Replay**:
  - `src/parquet/replay/parquetReplaySource.ts`: deterministic Parquet merge + replay
  - `src/cli/backtest.ts`: raw replay + orderbook reconstruction modes
- **Orderbook / shared engine**:
  - `src/orderbook/*`: decoding + orderbook engines
  - `src/engine/MarketEngine.ts`: shared “raw_json → orderbook → ticks” engine
- **Strategy / trading**
  - `src/strategy/Strategy.ts`: shared types (`Strategy`, `Intent`, `AccountEvent`, `PortfolioSnapshot`)
  - `src/trading/StrategyRunner.ts`: shared event loop (market ticks + account events)
  - `src/trading/OrderManager.ts`: order lifecycle + validation (GTD min expiry) + dry-run support
  - `src/trading/Portfolio.ts`: positions + realized PnL driven by fills
  - `src/trading/execution/BacktestExecution.ts`: simple backtest fill simulator (FOK/GTC/GTD)
  - `src/trading/execution/LiveExecution.ts`: real order placement via `@polymarket/clob-client`
  - `src/polymarket/userWsAccountSource.ts`: authenticated user WS → AccountEvents (fills)
  - `src/polymarket/restPollAccountSource.ts`: REST polling fallback → AccountEvents (fills)
  - `src/strategies/*`: example strategies + env strategy loader
- **Scripts**:
  - `src/cli/record-live.ts`: live ingest → Parquet
  - `src/cli/trading-bot.ts`: live ingest → `MarketEngine` → `StrategyRunner` (dry-run by default)
  - `src/cli/backtest.ts`: Parquet replay (raw or orderbook)
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
