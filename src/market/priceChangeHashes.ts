import type { AnyMarketMessage } from './orderbook/types.js'

const messageKeys = ['market', 'price_changes', 'timestamp', 'event_type']
const changeKeys = ['asset_id', 'price', 'size', 'side', 'hash', 'best_bid', 'best_ask']

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

/** Only this closed wire shape may omit its unused per-change hashes in V4. */
export function isCompactPriceChange(value: unknown): boolean {
  if (
    !exactObject(value, messageKeys) ||
    value.event_type !== 'price_change' ||
    typeof value.market !== 'string' ||
    typeof value.timestamp !== 'string' ||
    !Array.isArray(value.price_changes)
  )
    return false
  return value.price_changes.every(
    (change) =>
      exactObject(change, changeKeys) &&
      changeKeys.every((key) => typeof change[key] === 'string') &&
      (change.hash === '' || /^[a-f0-9]{40}$/.test(change.hash as string)),
  )
}

/** Shared by live, Telonex and recorder replay before any strategy sees a message. */
export function normalizePriceChangeHashes(message: AnyMarketMessage): AnyMarketMessage {
  if (message.event_type !== 'price_change') return message
  if (
    Array.isArray(message.price_changes) &&
    message.price_changes.every((change) => change?.hash === '')
  )
    return message
  if (!isCompactPriceChange(message)) return message
  return {
    ...message,
    price_changes: message.price_changes.map((change) => ({ ...change, hash: '' })),
  }
}
