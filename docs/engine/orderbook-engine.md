---
title: Orderbook Engine
description: How the two-layer orderbook engine builds and maintains per-asset order books from Polymarket market-channel deltas, and why deterministic Map ordering is central to the design.
---

# Orderbook Engine

The orderbook subsystem is composed of two classes with distinct scopes: `MarketOrderBookEngine` manages the collection of per-token books for a single condition market, and `OrderBookEngine` owns the bid/ask state for a single asset (CLOB token). Together they transform raw Polymarket market-channel messages into the `MarketOrderBooksSnapshot` that strategies consume on every tick.

## Two-Layer Architecture

A Polymarket binary-outcome market has two tokens — conventionally YES and NO — each with its own CLOB token ID (`asset_id`). Strategies such as spread arbitrage need simultaneous access to both books on every tick.

`MarketOrderBookEngine` solves this by maintaining a `Map<assetId, OrderBookEngine>`. When a `price_change` message arrives with updates for multiple asset IDs, it routes each set of changes to the correct `OrderBookEngine`. When `snapshot()` is called, it collects snapshots from all engines into a single `MarketOrderBooksSnapshot`:

```typescript
byAssetId: Record<string, OrderBookSnapshot>
```

`OrderBookEngine` is the single-asset state machine. It holds `bids` and `asks` as `Map<number, OrderLevel>` (keyed by price as a `number`) and applies the four message types from the Polymarket market channel.

## Message Handling

### `book` — Full Snapshot Replacement

A `book` message is a complete replacement of the resting orderbook for a single asset. The engine discards all prior state and rebuilds both sides from scratch:

```typescript
applyBook(msg: BookMessage): void {
  const bids = toSortedLevelsFromBookSide('bids', msg.bids)
  const asks = toSortedLevelsFromBookSide('asks', msg.asks)
  this.state.bids = rebuildMapSorted(bids)
  this.state.asks = rebuildMapSorted(asks)
  this.state.lastUpdateTs = parseTsMs(msg.timestamp)
  this.state.lastBookHash = msg.hash
}
```

The `lastBookHash` is stored but not currently used for validation; it is available for future integrity checks.

### `price_change` — Level-by-Level Deltas

A `price_change` message carries one or more `PriceChange` entries, each specifying an asset ID, side, price level, and a **new aggregate size** at that level. Critically, the size is not a delta — it is the complete new quantity:

> `size` — NEW aggregate size at that level

If size is `0`, the level is removed. Otherwise the level is upserted.

Insertion order preservation is the key complexity here. The `bids` map must iterate in descending price order; `asks` must iterate in ascending price order. When an update merely changes the size of an existing level, the insertion order is preserved and no resorting is needed. When a new level is introduced, the entire affected side is rebuilt in sorted order:

```typescript
if (insertedBid) this.state.bids = this.resortSide(this.state.bids, 'bids')
if (insertedAsk) this.state.asks = this.resortSide(this.state.asks, 'asks')
```

This design avoids sorting on every tick for the common case (delta to an existing level) while maintaining deterministic iteration order for the less common case (new level introduced).

### `tick_size_change` — Metadata Update

Updates `tickSizeBuy` and/or `tickSizeSell` on the engine state. Does not touch the bid/ask book. The `side` field is optional in the Polymarket specification, so the engine applies to both sides when it is absent.

### `last_trade_price` — Trade Recording Only

Appends to the engine's `recentTrades` ring buffer (capped at 200 trades). Does **not** mutate `bids` or `asks`. The comment in the source is explicit:

> DO NOT mutate the order book here. Book impact comes via `book` and/or `price_change`.

## Determinism and Map Ordering

The engine uses JavaScript's `Map` rather than a plain object for price levels because `Map` preserves insertion order. By constructing `bids` in descending price order and `asks` in ascending price order at build/resort time, snapshot consumers can iterate levels in the correct book order without re-sorting on every read.

::: tip
This is why `snapshot().bids` returns an `OrderLevel[]` sorted DESC and `snapshot().asks` sorted ASC — the order is guaranteed by construction, not by a sort call at snapshot time.
:::

Determinism matters equally in live and backtest modes. The Parquet replay replays messages in the exact original `ingest_seq` order. Because `OrderBookEngine` is a pure function of the message stream (no wall-clock randomness, no async side effects), running the same message sequence always produces bit-identical orderbook state.

## `OrderBookSnapshot` Structure

Each `OrderBookEngine.snapshot()` call returns:

| Field              | Type             | Description                                           |
| ------------------ | ---------------- | ----------------------------------------------------- |
| `market`           | `string`         | Condition market ID                                   |
| `assetId`          | `string`         | CLOB token ID                                         |
| `timestamp`        | `number`         | Unix ms of last applied message                       |
| `bestBid`          | `number \| null` | Top bid price                                         |
| `bestAsk`          | `number \| null` | Top ask price                                         |
| `mid`              | `number \| null` | Midpoint `(bestBid + bestAsk) / 2`                    |
| `spread`           | `number \| null` | `bestAsk - bestBid`                                   |
| `bids`             | `OrderLevel[]`   | All bid levels, DESC by price                         |
| `asks`             | `OrderLevel[]`   | All ask levels, ASC by price                          |
| `depthLevels`      | `number`         | Number of levels used for depth arrays (hardcoded 10) |
| `bidsDepthByLevel` | `number[]`       | Cumulative size at each of the top N bid levels       |
| `asksDepthByLevel` | `number[]`       | Cumulative size at each of the top N ask levels       |

The cumulative depth arrays are computed at snapshot time and are intended for the web UI; strategies should access `bestBid`, `bestAsk`, `bids`, and `asks` directly.

## Warm-State Detection

`MarketOrderBookEngine` tracks which asset IDs have received at least one `book` message via `sawBookByAssetId`. The `isWarm()` method returns `true` only when all `expectedAssetIds` have been seen:

```typescript
isWarm(): boolean {
  if (!this.expectedAssetIds) return this.sawBookByAssetId.size > 0
  return this.expectedAssetIds.every((id) => this.sawBookByAssetId.has(id))
}
```

Until the engine is warm, strategies that rely on a complete two-sided book should not place orders. The `StrategyRunner` exposes this via `ctx.warmup`.

## Validation Mode

`MarketOrderBookEngine` has an optional validation mode (disabled by default in production) that emits `MarketOrderBookWarning` events for two conditions:

- `delta_before_book` — a `price_change`, `tick_size_change`, or `last_trade_price` arrived before the initial `book` snapshot for an asset.
- `non_monotonic_book_timestamp` — a `book` message has an exchange timestamp earlier than the previous one for the same asset.

These warnings are used during development and in the Parquet verification CLI to detect malformed recordings.
