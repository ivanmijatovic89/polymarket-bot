import type { AnyMarketMessage } from './OrderBookEngine.js'

export const SYNTHETIC_EVENT_TYPES = new Set<string>([
  // Synthetic markers recorded by record-live.ts
  'disconnect',
  'window_end',
  'writer_lag_disconnect',
])

/**
 * Decode a raw JSON string into a Polymarket Market-channel message union.
 *
 * Notes:
 * - This intentionally does NOT validate every field; engines will parse numeric strings and throw
 *   only when they need to consume a value.
 * - `tick_size_change.side` is optional in our types (docs/examples can omit it).
 */
export function decodeMarketChannelMessage(rawJson: string): AnyMarketMessage | null {
  let obj: unknown
  try {
    obj = JSON.parse(rawJson)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null

  const rec = obj as Record<string, unknown>
  const t = rec.event_type
  if (typeof t !== 'string') return null

  if (SYNTHETIC_EVENT_TYPES.has(t)) return null

  if (
    t === 'book' ||
    t === 'price_change' ||
    t === 'tick_size_change' ||
    t === 'last_trade_price'
  ) {
    return obj as AnyMarketMessage
  }

  return null
}
