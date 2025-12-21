export type PolymarketMarketChannelEventType = string

/**
 * This is the persisted unit for live recording + backtest replay.
 *
 * We record the **raw JSON message** and only extract a few index fields.
 * Replay: raw_json -> decoder -> orderbook -> Tick -> strategy.
 */
export type RawMarketEventRow = {
  ingest_seq: bigint
  ts_local_ms: bigint
  ts_exchange_ms?: bigint
  event_type: PolymarketMarketChannelEventType
  market?: string
  asset_id?: string
  raw_json: string
}

