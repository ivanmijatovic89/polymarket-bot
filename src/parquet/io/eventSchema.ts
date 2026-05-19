import * as parquet from '@dsnp/parquetjs'

/**
 * Parquet schema for RawMarketEventRow.
 *
 * Notes:
 * - We keep timestamps and seq as INT64 (BigInt) for safety.
 * - We store the whole event payload as a JSON string in `raw_json`.
 */
export const rawMarketEventParquetSchema = new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64', compression: 'GZIP' },
  ts_local_ms: { type: 'INT64', compression: 'GZIP' },
  ts_exchange_ms: { type: 'INT64', optional: true, compression: 'GZIP' },
  event_type: { type: 'UTF8', compression: 'GZIP' },
  raw_json: { type: 'UTF8', compression: 'GZIP' },
})

/**
 * Typed schema for merged Telonex paired frames.
 *
 * Avoids a large per-row top-level raw_json parse during replay.
 * Depth arrays are compactly encoded as "price@size;price@size;...".
 */
export const pairedOrderbookParquetSchema = new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64', compression: 'GZIP' },
  ts_local_ms: { type: 'INT64', compression: 'GZIP' },
  ts_exchange_ms: { type: 'INT64', optional: true, compression: 'GZIP' },
  event_type: { type: 'UTF8', compression: 'GZIP' },
  market: { type: 'UTF8', compression: 'GZIP' },
  slug: { type: 'UTF8', optional: true, compression: 'GZIP' },
  up_asset_id: { type: 'UTF8', compression: 'GZIP' },
  down_asset_id: { type: 'UTF8', compression: 'GZIP' },
  up_bids: { type: 'UTF8', compression: 'GZIP' },
  up_asks: { type: 'UTF8', compression: 'GZIP' },
  down_bids: { type: 'UTF8', compression: 'GZIP' },
  down_asks: { type: 'UTF8', compression: 'GZIP' },
})

/**
 * Typed schema for Telonex delta replay.
 *
 * This keeps the live-style `book` / `price_change` tick cadence, but avoids
 * storing a full raw_json payload. Each parquet row is one strategy-visible
 * event. Full book depth and price changes are stored as flat typed repeated
 * primitive columns so replay can avoid JSON parsing and nested object
 * materialization.
 *
 * Prices and sizes are kept as the original UTF8 strings (e.g. "0.567", "100")
 * rather than DOUBLE. This preserves the exact source formatting and avoids
 * a number→string→number round-trip on the replay path. GZIP-compressed
 * repeated UTF8 columns compress well for tick-aligned values.
 */
export const typedDeltaMarketEventParquetSchema = new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64', compression: 'GZIP' },
  ts_local_ms: { type: 'INT64', compression: 'GZIP' },
  ts_exchange_ms: { type: 'INT64', optional: true, compression: 'GZIP' },
  event_type: { type: 'UTF8', compression: 'GZIP' },
  market: { type: 'UTF8', compression: 'GZIP' },
  asset0_id: { type: 'UTF8', optional: true, compression: 'GZIP' },
  asset1_id: { type: 'UTF8', optional: true, compression: 'GZIP' },
  asset_index: { type: 'INT32', optional: true, compression: 'GZIP' },
  bid_prices: { type: 'UTF8', repeated: true, compression: 'GZIP' },
  bid_sizes: { type: 'UTF8', repeated: true, compression: 'GZIP' },
  ask_prices: { type: 'UTF8', repeated: true, compression: 'GZIP' },
  ask_sizes: { type: 'UTF8', repeated: true, compression: 'GZIP' },
  change_asset_indexes: { type: 'INT32', repeated: true, compression: 'GZIP' },
  change_side_codes: { type: 'INT32', repeated: true, compression: 'GZIP' },
  change_prices: { type: 'UTF8', repeated: true, compression: 'GZIP' },
  change_sizes: { type: 'UTF8', repeated: true, compression: 'GZIP' },
})
