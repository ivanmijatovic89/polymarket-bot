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
