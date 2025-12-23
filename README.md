# polymarket-bot

Polymarket trading bot + backtesting engine (work in progress).

Right now the repo is primarily a **live data recorder** that:

- Resolves the current **15-minute Up/Down** market for a symbol via **Gamma**
- Subscribes to the **CLOB market WebSocket** for that market’s token ids
- Persists every incoming message as a **raw JSON event row** into **rotating Parquet files**

The goal is to use these exact raw ticks for both:

- **Live trading** (consume WS stream directly)
- **Backtests** (replay the recorded Parquet row-by-row, tick-by-tick)

## Table of Contents

- [What exists today](#what-exists-today)
  - [Live recording entrypoint](#live-recording-entrypoint)
  - [Trading bot entrypoint (stub)](#trading-bot-entrypoint-stub)
  - [Backtesting entrypoint (Parquet replay)](#backtesting-entrypoint-parquet-replay)
  - [Parquet format (the persisted unit)](#parquet-format-the-persisted-unit)
  - [Output directory layout](#output-directory-layout)
- [Orderbook](#orderbook)
- [Setup](#setup)
- [Usage](#usage)
  - [Record live events](#record-live-events)
  - [Run the trading bot (stub)](#run-the-trading-bot-stub)
  - [Backtest (replay recorded Parquet)](#backtest-replay-recorded-parquet)
  - [Backtest (orderbook reconstruction)](#backtest-orderbook-reconstruction)
  - [Verify a parquet file](#verify-a-parquet-file)
- [Code map](#code-map)
- [Notes / current limitations](#notes--current-limitations)
- [References / Docs used](#references--docs-used)

## What exists today

### Live recording entrypoint

- Script: `src/scripts/record-live.ts`
- Main command(s):
  - `npm run record:live:btc`
  - `npm run record:live:eth`
  - `npm run record:live:sol`
  - `npm run record:live:xrp`

### Trading bot entrypoint (stub)

- Script: `src/scripts/trading-bot.ts`
- Main command(s):
  - `npm run trade:bot:btc`
  - `npm run trade:bot:eth`
  - `npm run trade:bot:sol`
  - `npm run trade:bot:xrp`

This currently connects + subscribes + logs basic stats. Strategy/order logic will plug into the same raw event pipeline as backtests.

### Backtesting entrypoint (Parquet replay)

- Script: `src/scripts/backtest.ts`
- Main command:
  - `npm run backtest -- <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]`
  - Orderbook replay mode:
    - `npm run backtest -- --mode orderbook <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time]`

Backtest (fast/event-driven):
`npm run backtest -- data/events/btc/<file>.parquet --order recorded`

Backtest (time-driven):
`npm run backtest -- data/events/btc/<file>.parquet --time-driven --order exchange_time`

Backtest (orderbook reconstruction):
`npm run backtest -- --mode orderbook data/events/btc/<file>.parquet --order recorded`

High-level flow:

1. **Pick the current market (Gamma)**
   - We compute the expected slug format:
     - `<symbol>-updown-15m-<epochSecondsOfWindowStart>`
   - We ask Gamma for that slug (and also the previous 15m window as a fallback around boundaries):
     - `GET {GAMMA_API_BASE_URL}/markets?slug=<slug>`
   - We extract the first two outcomes + their `clobTokenIds` (the Up/Down tokens).

2. **Subscribe to the CLOB WS market channel**
   - Default WS URL:
     - `wss://ws-subscriptions-clob.polymarket.com/ws/market`
   - Subscribe message sent on open:

```json
{ "type": "market", "assets_ids": ["<tokenId1>", "<tokenId2>"], "auth": { "...": "..." } }
```

3. **Persist raw events into Parquet**
   - Every inbound message is kept as `raw_json` and we only extract a few index fields
     (`event_type`, `market`, `asset_id`, `timestamp` -> `ts_exchange_ms` when available).
   - Writes are **sequenced per market** (so ordering is deterministic per market id).
   - Parquet is written using `@dsnp/parquetjs` (parquetjs-compatible API).

4. **Rotate on every 15-minute boundary**
   - On each 15m boundary we:
     - close the current parquet writers (write footer + rename `*.tmp` to `*.parquet`)
     - reconnect the WebSocket
     - re-resolve the current market + token ids from Gamma

5. **Disconnect markers**
   - On WS disconnect, we write a synthetic `event_type="disconnect"` row per market observed
     on that connection (best-effort) so replay/backtests can detect gaps.

### Parquet format (the persisted unit)

The persisted row type is `RawMarketEventRow` (`src/types/rawEvent.ts`):

- `ingest_seq` (**INT64**): monotonically increasing per market (assigned locally)
- `ts_local_ms` (**INT64**): `Date.now()` at ingestion time
- `ts_exchange_ms` (**INT64, optional**): parsed from the message `timestamp` field (unix ms)
- `event_type` (**UTF8**): taken from the message `event_type` (or `"disconnect"`)
- `raw_json` (**UTF8**): the full original WS message string

Schema definition: `src/io/parquet/eventSchema.ts` (all columns GZIP-compressed).

### Output directory layout

By default, recorded files are written under:

- `data/events/<symbol>/`

Each file is named using the **Gamma slug** (preferred) or `market-<marketId>` fallback:

- `data/events/btc/btc-updown-15m-<epoch>.parquet`

Important behavior:

- A Parquet file is only opened once we observe the first `event_type === "book"` for that market.
  (Pre-book events are dropped to keep each file self-contained.)
- Files are written as `*.parquet.tmp` and only renamed to `*.parquet` on close/rotation/shutdown.

## Orderbook

This repo now includes a shared order book reconstructor for **Polymarket CLOB Market channel** events.

- **Module**: `src/orderbook/OrderBookEngine.ts`
- **Message types supported** (per Polymarket docs):
  - `book` (snapshot, source-of-truth)
  - `price_change` (delta: new aggregate size at a price level)
  - `tick_size_change` (tracked for validation; does not mutate levels)
  - `last_trade_price` (does not mutate the book; book changes come from `book`/`price_change`)

Two engine layers:

- **`OrderBookEngine`**: maintains the full order book for a single `(market, assetId)` (one CLOB token id)
  - `snapshot()` returns **all levels** (`bids` sorted DESC, `asks` sorted ASC) plus `bestBid/bestAsk/mid/spread`
- **`MarketOrderBookEngine`**: maintains **all token books** for a single `market`
  - `snapshot()` returns `{ byAssetId: { [assetId]: OrderBookSnapshot } }`
  - This is useful for strategies that need both tokens at once (e.g. arbitrage between YES/NO).

Implementation notes:

- Internally uses `number` for prices/sizes (with a TODO to move to integer ticks later for precision).
- `tick_size_change.side` is treated as optional (docs/examples can omit it); when missing, the engine stores the tick size for both BUY/SELL.

## Setup

Requirements:

- Node.js **v20**

Note: if your terminal is on an older Node (e.g. v10), `tsx` and ESLint will fail. Use Node 20 (e.g. via `nvm use 20`).

Install:

```bash
npm install
```

Environment variables (optional unless noted):

- **Required**
  - `RECORD_SYMBOL`: `BTC|ETH|SOL|XRP` (the `npm run record:live:*` scripts set this for you)
  - `TRADING_SYMBOL`: `BTC|ETH|SOL|XRP` (optional; `trading-bot` uses `TRADING_SYMBOL` and falls back to `RECORD_SYMBOL`)
- **Gamma**
  - `GAMMA_API_BASE_URL` (default: `https://gamma-api.polymarket.com`)
- **WebSocket**
  - `POLYMARKET_WS_URL` (default: `wss://ws-subscriptions-clob.polymarket.com/ws/market`)
- **Optional auth (sent in subscribe payload if all are present)**
  - `POLYMARKET_API_KEY`
  - `POLYMARKET_API_SECRET`
  - `POLYMARKET_API_PASSPHRASE`
- **Recorder tuning**
  - `RECORD_BASE_DIR` (default: `data/events`)
  - `RECORD_STATS_INTERVAL_MS` (default: `10000`)
  - `RECORD_MAX_INFLIGHT_APPENDS` (default: `10000`)
  - `RECORD_SKIP_IF_OLDER_MS` (default: `10000`)

Tip: create a local `.env` file (there is a `.env.example` in the repo) and export vars via your shell.

## Usage

### Record live events

Record BTC 15m Up/Down market:

```bash
npm run record:live:btc
```

Or choose symbol explicitly:

```bash
RECORD_SYMBOL=ETH npm run record:live
```

What you’ll see:

- Connection + subscription logs
- Periodic stats (in-flight writes, total appended rows, drops, disconnects)
- Rotation logs on each 15m boundary

### Run the trading bot (stub)

```bash
npm run trade:bot:btc
```

Or choose symbol explicitly:

```bash
TRADING_SYMBOL=ETH npm run trade:bot
```

### Backtest (replay recorded Parquet)

Fast (event-driven), in recorded-time order:

```bash
npm run backtest -- "data/events/btc/<slug>.parquet" --order recorded
```

Time-driven (sleeps based on timestamps), in exchange-time order:

```bash
npm run backtest -- "data/events/btc/<slug>.parquet" --order exchange_time --time-driven
```

Notes:

- `--order recorded` uses the original recorded local timestamps (`ts_local_ms`) as the replay clock.
- `--order exchange_time` uses exchange timestamps when present (`ts_exchange_ms`, falling back to `ts_local_ms`).
- You can pass multiple files; replay merges deterministically using `(order_timestamp, ingest_seq, file_index)` so runs are reproducible.

### Backtest (orderbook reconstruction)

This mode reconstructs the order book tick-by-tick from the persisted WS events.

```bash
npm run backtest -- --mode orderbook "data/events/btc/<slug>.parquet" --order recorded
```

Behavior:

- Events are merged deterministically and applied to `MarketOrderBookEngine`
- Logs print:
  - periodic summaries
  - full `byAssetId` books on each `book` snapshot (for inspection/debugging)

### Verify a parquet file

The verifier checks:

- File size
- Schema metadata (and codecs-by-column when present)
- Optionally iterates rows to ensure the file is readable end-to-end

```bash
npm run verify:parquet -- "data/events/btc/<slug>.parquet"
```

Options:

```bash
# read only metadata (fast)
npm run verify:parquet -- "data/events/btc/<slug>.parquet" --metadata-only

# sanity-read N rows
npm run verify:parquet -- "data/events/btc/<slug>.parquet" --limit 10000
```

## Code map

- **Market selection (Gamma)**
  - `src/polymarket/gamma.ts`: fetch market by slug
  - `src/polymarket/upDown15m.ts`: compute candidate slugs + select current market
  - `src/utils/timeWindows.ts`: 15m window helpers + slug format
- **Event stream (shared by live + replay)**
  - `src/ingest/marketEventSource.ts`: `MarketEvent` + `MarketEventSource` interface
  - `src/polymarket/marketEventIndex.ts`: tolerant JSON indexer (`event_type`, `market`, timestamps)
  - `src/engine/marketEventHandler.ts`: shared pipeline entrypoint (indexing + counters today)
- **WebSocket (live)**
  - `src/polymarket/marketWs.ts`: minimal `ws` client (subscribe + ping/pong heartbeat)
  - `src/polymarket/liveMarketEventSource.ts`: session runner (connect/reconnect) emitting `MarketEvent`
- **Parquet output**
  - `src/io/parquet/eventSchema.ts`: Parquet schema
  - `src/io/parquet/eventWriter.ts`: per-market ordered writer + 15m rotation support
- **Backtesting / replay**
  - `src/ingest/replay/parquetReplaySource.ts`: reads Parquet and emits `MarketEvent` deterministically
- **Orderbook reconstruction**
  - `src/orderbook/OrderBookEngine.ts`: `OrderBookEngine` (per token) and `MarketOrderBookEngine` (per market)
- **Time/window helpers**
  - `src/utils/windowBoundary.ts`: 15m boundary scheduler used by `record-live` and `trading-bot`
- **Scripts**
  - `src/scripts/record-live.ts`: live ingest → Parquet
  - `src/scripts/trading-bot.ts`: live ingest → strategy pipeline (stub)
  - `src/scripts/backtest.ts`: Parquet replay → raw stats OR orderbook reconstruction (`--mode orderbook`)
  - `src/scripts/verify-parquet.ts`: Parquet validator

## Notes / current limitations

- `src/index.ts` is currently a placeholder.
- Backtesting supports both:
  - raw event replay (existing counters/indexing), and
  - orderbook reconstruction (`--mode orderbook`), which is the basis for strategy simulation.
- For safety, the recorder will disconnect if disk can’t keep up (controlled by `RECORD_MAX_INFLIGHT_APPENDS`) to prevent unbounded memory growth.

## References / Docs used

### Polymarket

- **Gamma API (market metadata / slug lookup)**:
  - https://docs.polymarket.com/developers/gamma-markets-api/overview

- **CLOB WebSocket (market channel)**:
  - https://docs.polymarket.com/developers/CLOB/websocket/market-channel
- **Price change schema migration guide**:
  - https://docs.polymarket.com/developers/CLOB/websocket/market-channel-migration-guide

- **CLOB REST / Trading API (orders, cancels, fills, balances)**:
  - https://docs.polymarket.com/developers/CLOB/introduction

- **Price to Beat** - endpoint not in docs
  - https://polymarket.com/api/crypto/crypto-price?symbol=BTC&eventStartTime=2025-12-23T11:00:00Z&variant=fifteen&endDate=2025-12-23T11:15:00Z

- **Real Time Data Stream** - RTDS Crypto Prices
  - https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices

### Libraries used by this repo

- **ws (WebSocket client)**: https://github.com/websockets/ws
- **@dsnp/parquetjs (Parquet writer/reader)**: https://github.com/ironSource/parquetjs
