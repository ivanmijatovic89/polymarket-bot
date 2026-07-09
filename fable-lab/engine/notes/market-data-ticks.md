# Raw study notes — market data / tick subsystem

_Source: fresh-context Explore subagent, session 1. Input notes for
`engine/CAPABILITIES.md`; the synthesized doc is authoritative._

## 1. Tick semantics

- EngineTick fires only for `book` / `price_change` (`src/market/MarketEngine.ts:76-78`; replay: `replayOrderBookForMarket.ts:110-117`; docs `market-engine.md:16, 55-70`, `strategy-runner.md:12`). `tick_size_change` / `last_trade_price` update state, no tick.
- Tick payload `{ source, msg, snapshot }` (`MarketEngine.ts:9-13`). Snapshot = `MarketOrderBooksSnapshot` with `byAssetId: Record<assetId, OrderBookSnapshot>` — **both token books per tick** (`orderbook/types.ts:133-145`, `MarketOrderBookEngine.ts:33-42`).
- Per-asset snapshot: `bestBid`, `bestAsk`, `mid`, `spread`, `bids` (ALL levels DESC), `asks` (ALL ASC), `depthLevels` hardcoded 10, cumulative `bidsDepthByLevel`/`asksDepthByLevel` (`orderbook/types.ts:27-53`, `OrderBookEngine.ts:50-70`).
- **Last trade NOT in snapshot** — `recentTrades` ring buffer private to `OrderBookEngine` (`:26, 46-48, 138-158`), excluded from `snapshot()`.
- Timestamps: `snapshot.timestamp` = exchange timestamp of last applied message (`OrderBookEngine.ts:59, 82, 88`; `orderbook-engine.md:86`). `ts_local_ms` NOT propagated into ticks (`MarketEngine.ts:5-7`). Backtest `nowMs` for fills/GTD = exchange timestamp of current tick (`backtest-execution.md:119-124`).

## 2. Orderbook state model

- Full depth held as `Map<price, level>` (`orderbook/types.ts:25, 115-124`; `OrderBookEngine.ts:34-37`); snapshot returns ALL levels; top-10 arrays are conveniences.
- `price_change` size = new aggregate at level; `size <= 0` deletes (code, `OrderBookEngine.ts:104-113`; doc says "0" — negatives also delete). New level → full resort of that side (`:110-117, 184-189`). `book` replaces both sides (`:72-84`).
- **No hash/sequence integrity checks at runtime**: `lastBookHash` stored, unused (`orderbook-engine.md:39`); telonex-delta replay blanks `hash`/`best_bid`/`best_ask` (`replayTelonexDeltaParquetForMarket.ts:109, 131-134`). Optional validation mode disabled by default (`MarketOrderBookEngine.ts:29`), soft warnings only (`:71-145`); backtests run validation off (`replayOrderBookForMarket.ts:67`). Hard throws only for market/asset-id mismatch (`OrderBookEngine.ts:191-206`).
- Disconnects: synthetic rows dropped by decoder (`marketChannelDecoder.ts:3-8, 31`); book NOT reset/flagged across the gap — carries stale state. No sequence-gap detection. Reset only on market rotation (`MarketEngine.ts:49-53`). Backtest: fresh MarketEngine per file (`replayOrderBookForMarket.ts:67`).

## 3. Parquet replay

- Multi-file heap merge, comparator: `keySeq` (= `ingest_seq`) primary, `keyTs`, `fileIdx` (`minHeap.ts:16-21`; `replayOrderBookForMarket.ts:46-63, 122-129`).
- **`--order exchange_time` only changes the tie-breaker** — no primary effect. `ingest_seq` restarts at 0 per file (`parquet-event-schema.md:32-38` warns not to compare across files, yet merge does). Moot for the standard single-file-per-market backtest (`runSingleMarket.ts:295-296`).
- Episode = one file = one 15m window (`runSingleMarket.ts:164-302`); filename carries window epoch.
- Event types: real `book`, `price_change`, `tick_size_change`, `last_trade_price`; synthetic `disconnect`, `window_end`, `writer_lag_disconnect` (`eventSchema.ts:10-16`; `parquet-event-schema.md:78-139`). Files may be synthetic-only if connection dropped before first `book` (`parquet-event-schema.md:99`).
- `--time-driven`: wall-clock pacing only, recorded mode only (`replayOrderBookForMarket.ts:75-82`; `runSingleMarket.ts:60-61, 298`).
- telonex-delta / telonex-paired bypass this replayer (`runSingleMarket.ts:282-302`) and ignore `order`/`timeDriven`.

## 4. Derivable features / what is NOT available

- Recorded mode `raw_json`: book bids/asks; price_change per-level `asset_id, side, price, size, hash, best_bid, best_ask, timestamp` (engine ignores hash/best_*); last_trade_price `price, side, size, fee_rate_bps, timestamp` (recorded but never in tick snapshot); tick_size_change.
- **telonex-delta carries ONLY `book` + `price_change`** — no `last_trade_price`, no `tick_size_change` (`eventSchema.ts:53-70`; `replayTelonexDeltaParquetForMarket.ts:91-147`). telonex-paired: synthetic paired books only; missing side carried forward one event stale (`overview.md:146-154`).
- NOT available anywhere: own order flow (simulated only), trades stream in telonex modes, funding, external prices (Binance/Chainlink/Deribit/price-to-beat), queue position, maker/taker identity of book changes.

## 5. Reference price ("price to beat") — NOT AVAILABLE in backtest

- Not in parquet schemas (`eventSchema.ts:10-70`), not in WS payloads (`orderbook/types.ts:55-107`).
- Live-only HTTP feed: `createPolymarketPriceToBeatClient` polls `polymarket.com/api/crypto/crypto-price` for `openPrice` (`polymarketPriceToBeatClient.ts:23-30, 70-86`), started only in `trading-bot.ts:334-371`.
- Backtests do not fulfill it (`ExternalFeedsRequestPlugin.ts:24-25, 46-49`); `runSingleMarket` wires no feed provider (`:110-150, 199-204`).
- Strategies could reconstruct window end time from slug epoch (idiom exists in research strategies), but NOT the strike price. Any strategy needing price-to-beat must infer proxies from the book itself (e.g., UP/DOWN mid ≈ market-implied probability).
- Metadata available in replay: `GammaMarketMeta` via `getMarket()` — `slug, outcomes, clobTokenIds, outcomeTokenMap, upAssetId/downAssetId, question` (`gammaMarketMeta.ts:11-22`; `runSingleMarket.ts:203`). Resolution outcome from DB after the fact, not in stream (`marketResolution.ts:90-140`).

## 6. Episode timing structure

- File opens at first `book` (pre-book deltas dropped) — possible late-start gap after true window open (`eventWriter.ts:68-74, 214-241`; `parquet-event-writer.md:36-43`).
- Mid-window gaps: `disconnect` markers, no data during gap, book not reset in-stream.
- End: `window_end` synthetic marker; rotation on slug change (`eventWriter.ts:223-231`). SIGINT → `-terminated.parquet`, possibly missing tail.
- No resolution/settlement event in stream.

## 7. Determinism

- Engine pure function of message stream (`orderbook-engine.md:68-76`); deterministic resort (`OrderBookEngine.ts:184-189`).
- Replay ordering deterministic (total order via fileIdx tie-break).
- Conditional overall determinism: jitter=0 + no strategy randomness (`runSingleMarket.ts:160-163`).
- FP caveat: levels keyed by decimal price; TODO to move to integer ticks (`orderbook/types.ts:9-16`).
