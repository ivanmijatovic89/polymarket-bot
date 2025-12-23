# polymarket-bot

Polymarket trading bot + backtesting engine (work in progress).

Right now the repo is primarily a **live data recorder** that:

- Resolves the current **15-minute Up/Down** market for a symbol via **Gamma**
- Subscribes to the **CLOB market WebSocket** for that market’s token ids
- Persists every incoming message as a **raw JSON event row** into **rotating Parquet files**

The goal is to use these exact raw ticks for both:

- **Live trading** (consume WS stream directly)
- **Backtests** (replay the recorded Parquet row-by-row, tick-by-tick)

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

Backtest (fast/event-driven):
`npm run backtest -- data/events/btc/<file>.parquet --order recorded`

Backtest (time-driven):
`npm run backtest -- data/events/btc/<file>.parquet --time-driven --order exchange_time`

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
- **Time/window helpers**
  - `src/utils/windowBoundary.ts`: 15m boundary scheduler used by `record-live` and `trading-bot`
- **Scripts**
  - `src/scripts/record-live.ts`: live ingest → Parquet
  - `src/scripts/trading-bot.ts`: live ingest → strategy pipeline (stub)
  - `src/scripts/backtest.ts`: Parquet replay → strategy pipeline (stub)
  - `src/scripts/verify-parquet.ts`: Parquet validator

## Notes / current limitations

- `src/index.ts` is currently a placeholder.
- Backtesting currently replays **raw WS JSON** from Parquet into a shared handler; the full decoder/orderbook/strategy pipeline is still WIP.
- For safety, the recorder will disconnect if disk can’t keep up (controlled by `RECORD_MAX_INFLIGHT_APPENDS`) to prevent unbounded memory growth.


## References / Docs used

### Polymarket
- **Gamma API (market metadata / slug lookup)**:
  - https://docs.polymarket.com/developers/gamma-markets-api/overview

- **CLOB WebSocket (market channel subscriptions)**:
  - https://docs.polymarket.com/api-reference/markets/get-market-by-slug

- **CLOB REST / Trading API (orders, cancels, fills, balances)**:
  - https://docs.polymarket.com/developers/CLOB/introduction

- **Price to Beat** - endpoint not in docs
  - https://polymarket.com/api/crypto/crypto-price?symbol=BTC&eventStartTime=2025-12-23T11:00:00Z&variant=fifteen&endDate=2025-12-23T11:15:00Z

- **Real Time Data Stream** - RTDS Crypto Prices
  - https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices

### Libraries used by this repo
- **ws (WebSocket client)**: https://github.com/websockets/ws
- **@dsnp/parquetjs (Parquet writer/reader)**: https://github.com/ironSource/parquetjs

