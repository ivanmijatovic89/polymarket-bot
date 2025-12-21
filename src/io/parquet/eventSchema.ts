import * as parquet from '@dsnp/parquetjs'

/**
 * Parquet schema for RawMarketEventRow.
 *
 * Notes:
 * - We keep timestamps and seq as INT64 (BigInt) for safety.
 * - We store the whole event payload as a JSON string in `raw_json`.
 */
export const rawMarketEventParquetSchema = new parquet.ParquetSchema({
  ingest_seq: { type: 'INT64' },
  ts_local_ms: { type: 'INT64' },
  ts_exchange_ms: { type: 'INT64', optional: true },
  event_type: { type: 'UTF8' },
  market: { type: 'UTF8', optional: true },
  market_slug: { type: 'UTF8', optional: true },
  asset_id: { type: 'UTF8', optional: true },
  raw_json: { type: 'UTF8' },
})
