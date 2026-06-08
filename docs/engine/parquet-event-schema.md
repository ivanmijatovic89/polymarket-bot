---
title: Parquet Event Schema
description: Reference for the rawMarketEventParquetSchema — every column, its type, encoding, and the synthetic event_type values recorded alongside real Polymarket market-channel messages.
---

# Parquet Event Schema

Every Parquet file produced by the recorder contains rows conforming to `rawMarketEventParquetSchema`, defined in `src/parquet/io/eventSchema.ts`. The schema has five columns, all GZIP-compressed.

## Schema Definition

```typescript
new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64', compression: 'GZIP' },
  ts_local_ms: { type: 'INT64', compression: 'GZIP' },
  ts_exchange_ms: { type: 'INT64', optional: true, compression: 'GZIP' },
  event_type: { type: 'UTF8', compression: 'GZIP' },
  raw_json: { type: 'UTF8', compression: 'GZIP' },
})
```

## Column Reference

### `ingest_seq`

| Property     | Value    |
| ------------ | -------- |
| Parquet type | `INT64`  |
| Nullability  | Required |
| Compression  | GZIP     |

A per-market monotonically increasing integer assigned by the recorder at ingest time. The sequence starts at 0 for each market writer instance and increments by 1 for every row appended, including synthetic rows.

`ingest_seq` is the primary sort key used by the backtest replay engine. When replaying multiple Parquet files for a multi-asset market, the heap-merge is performed over `ingest_seq` values to reconstruct the exact original interleaving of events from the recording session.

::: warning
`ingest_seq` is local to a single recording session. If a market reconnects and opens a new writer, the sequence restarts from 0 in the new file. Do not compare `ingest_seq` values across different files — use `ts_local_ms` or `ts_exchange_ms` for cross-file ordering.
:::

### `ts_local_ms`

| Property     | Value    |
| ------------ | -------- |
| Parquet type | `INT64`  |
| Nullability  | Required |
| Compression  | GZIP     |

The value of `Date.now()` at the moment the raw WebSocket message was received by the recorder process. This is a wall-clock timestamp from the recording machine's system clock.

`ts_local_ms` is used for:

- Determining event age for the `RECORD_SKIP_IF_OLDER_MS` drop policy.
- Display and analysis in the web UI and research tools.
- Coarse cross-file ordering when `ingest_seq` is not comparable.

### `ts_exchange_ms`

| Property     | Value                    |
| ------------ | ------------------------ |
| Parquet type | `INT64`                  |
| Nullability  | Optional (may be `null`) |
| Compression  | GZIP                     |

The exchange-side timestamp parsed from the `timestamp` field of the Polymarket WebSocket message, converted to Unix milliseconds. Not all message types include a `timestamp` field; when absent, this column is `null`.

`ts_exchange_ms` reflects when the event was generated on the Polymarket exchange side, not when it was received locally. The difference `ts_local_ms - ts_exchange_ms` is an approximation of network + processing latency and is used in latency measurement tooling (see `/other/MeasureLatency`).

### `event_type`

| Property     | Value    |
| ------------ | -------- |
| Parquet type | `UTF8`   |
| Nullability  | Required |
| Compression  | GZIP     |

The `event_type` string from the original WebSocket message, or a synthetic type injected by the recorder. The complete set of values:

**Real Polymarket market-channel event types:**

| Value              | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `book`             | Full orderbook snapshot for a single token            |
| `price_change`     | Delta update to one or more price levels              |
| `tick_size_change` | Tick size change for a token                          |
| `last_trade_price` | Most recent trade (does not directly mutate the book) |

**Synthetic event types (recorder-injected):**

| Value                   | Description                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `disconnect`            | WebSocket disconnection gap marker. `raw_json` contains `ws_close_code` and `reason`.        |
| `window_end`            | End-of-window marker inserted by the scheduler before closing the writer.                    |
| `writer_lag_disconnect` | Forced disconnect because the recorder's write queue exceeded `RECORD_MAX_INFLIGHT_APPENDS`. |

::: tip
The `decodeMarketChannelMessage` function in `marketChannelDecoder.ts` returns `null` for all three synthetic event types. They are never applied to the orderbook and never produce strategy ticks during backtest replay.
:::

The recorder creates files even for markets where only synthetic events were recorded (e.g., a connection that dropped before the first `book`). These files are valid Parquet but contain no orderbook data.

### `raw_json`

| Property     | Value    |
| ------------ | -------- |
| Parquet type | `UTF8`   |
| Nullability  | Required |
| Compression  | GZIP     |

The verbatim JSON string of the original WebSocket message payload, preserved without modification. For synthetic events, this field contains a JSON object with context-specific fields:

**`disconnect` row:**

```json
{
  "event_type": "disconnect",
  "ws_close_code": 1006,
  "reason": "Connection reset by peer",
  "ts_local_ms": 1700000000000
}
```

**`window_end` row:**

```json
{
  "event_type": "window_end",
  "ts_local_ms": 1700000900000
}
```

**`writer_lag_disconnect` row:**

```json
{
  "event_type": "writer_lag_disconnect",
  "inflightCount": 150,
  "ts_local_ms": 1700000000000
}
```

Storing the complete raw payload rather than parsed fields is a deliberate design choice: the schema does not need to change when Polymarket adds new fields to existing message types, and the replay engine can re-parse messages with the latest decoder without needing a schema migration.

## Compression

All columns use GZIP compression. The UTF8 columns (`event_type`, `raw_json`) benefit substantially from compression due to repeated JSON structure patterns across rows. INT64 columns benefit less but remain compressed for consistency.

## File Integrity

A `.parquet` file (without the `.tmp` suffix) always has a complete Parquet footer, written atomically via the `.tmp` → `.parquet` rename. DuckDB and other readers can be safely pointed at directories of `.parquet` files without risking partial-read errors.

`.parquet.tmp` files indicate an in-progress or abandoned write and should not be read by consumers. The recorder attempts to remove orphaned `.tmp` files when opening a new writer for the same market.
