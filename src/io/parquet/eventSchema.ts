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
