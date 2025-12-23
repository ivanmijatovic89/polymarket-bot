export type MarketEventIndex = {
  event_type: string
  market?: string
  asset_id?: string
  ts_exchange_ms?: bigint
}

/**
 * Extract a few routing/index fields from a Polymarket WS JSON message.
 *
 * We intentionally keep this tolerant: recorders and bots should be able to
 * handle provider quirks (e.g. timestamps encoded as strings).
 */
export function parseEventIndexFields(rawJson: string): MarketEventIndex {
  try {
    const obj: unknown = JSON.parse(rawJson)
    if (!obj || typeof obj !== 'object') return { event_type: 'unknown' }

    const rec = obj as Record<string, unknown>
    const event_type = typeof rec.event_type === 'string' ? rec.event_type : 'unknown'
    const market = typeof rec.market === 'string' ? rec.market : undefined
    const asset_id = typeof rec.asset_id === 'string' ? rec.asset_id : undefined

    let ts_exchange_ms: bigint | undefined
    const ts = rec.timestamp
    if (typeof ts === 'string' && ts.trim() !== '') {
      // Polymarket typically uses unix ms timestamps encoded as strings.
      try {
        ts_exchange_ms = BigInt(ts)
      } catch {
        // ignore
      }
    } else if (typeof ts === 'number' && Number.isFinite(ts)) {
      // Be tolerant if timestamp comes through as a number.
      try {
        ts_exchange_ms = BigInt(Math.trunc(ts))
      } catch {
        // ignore
      }
    }

    const out: MarketEventIndex = { event_type }
    if (market) out.market = market
    if (asset_id) out.asset_id = asset_id
    if (ts_exchange_ms) out.ts_exchange_ms = ts_exchange_ms
    return out
  } catch {
    return { event_type: 'invalid_json' }
  }
}
