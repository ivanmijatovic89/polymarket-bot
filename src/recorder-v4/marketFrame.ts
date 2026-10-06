import type { AnyMarketMessage } from '../market/orderbook/types.js'
import type { RecordedMarket } from './types.js'
import { object } from './replay/feedState.js'

type MarketFrame = {
  messages: AnyMarketMessage[]
  addressedMarkets: Set<string>
  invalidMarkets: Set<string>
  unscopedInvalid: boolean
}

function numeric(value: unknown, minimum: number, maximum = Infinity): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  if (typeof value === 'string' && value.trim() === '') return false
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum
}

function level(value: unknown): boolean {
  const item = object(value)
  return !!item && numeric(item.price, 0, 1) && numeric(item.size, 0)
}

const side = (value: unknown) => value === 'BUY' || value === 'SELL'
const asset = (value: unknown) => typeof value === 'string' && value.length > 0

function validMessage(message: Record<string, unknown>): boolean {
  if (!numeric(message.timestamp, 0) || !Number.isSafeInteger(Number(message.timestamp)))
    return false
  if (message.event_type === 'price_change')
    return (
      Array.isArray(message.price_changes) &&
      message.price_changes.length > 0 &&
      message.price_changes.every((value) => {
        const change = object(value)
        return !!change && asset(change.asset_id) && side(change.side) && level(change)
      })
    )
  if (!asset(message.asset_id)) return false
  if (message.event_type === 'book')
    return (
      Array.isArray(message.bids) &&
      Array.isArray(message.asks) &&
      message.bids.every(level) &&
      message.asks.every(level)
    )
  if (message.event_type === 'last_trade_price') return side(message.side) && level(message)
  return (
    message.event_type === 'tick_size_change' &&
    numeric(message.new_tick_size, Number.MIN_VALUE, 1) &&
    (message.side === undefined || side(message.side))
  )
}

/** Validate recorder books before the permissive shared engine can mutate state. */
export function inspectMarketFrame(rawJson: unknown): MarketFrame {
  const result: MarketFrame = {
    messages: [],
    addressedMarkets: new Set(),
    invalidMarkets: new Set(),
    unscopedInvalid: false,
  }
  if (typeof rawJson === 'string' && (rawJson.trim() === 'PING' || rawJson.trim() === 'PONG'))
    return result
  let parsed: unknown
  try {
    parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
  } catch {
    result.unscopedInvalid = true
    return result
  }
  for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
    const message = object(value)
    if (message?.transport === 'ping' || message?.transport === 'pong') continue
    const payload = object(message?.payload)
    const condition = message?.market ?? message?.condition_id ?? payload?.market
    const market = typeof condition === 'string' && condition.length > 0 ? condition : null
    if (market) result.addressedMarkets.add(market)
    const kind = message?.event_type ?? message?.type
    if (['best_bid_ask', 'new_market', 'market_resolved'].includes(String(kind))) continue
    if (
      message &&
      market &&
      message.market === market &&
      ['book', 'price_change', 'tick_size_change', 'last_trade_price'].includes(String(kind)) &&
      validMessage(message)
    ) {
      result.messages.push(message as unknown as AnyMarketMessage)
    } else if (market) result.invalidMarkets.add(market)
    else result.unscopedInvalid = true
  }
  return result
}

/** A malformed member invalidates its whole market frame; other markets remain independent. */
export function marketFrameMessages(frame: MarketFrame, market: RecordedMarket) {
  const messages = frame.messages.filter((message) => message.market === market.conditionId)
  const invalid =
    frame.unscopedInvalid ||
    frame.invalidMarkets.has(market.conditionId) ||
    messages.some((message) =>
      (message.event_type === 'price_change'
        ? message.price_changes.map((change) => change.asset_id)
        : [message.asset_id]
      ).some((id) => !market.tokenIds.includes(id)),
    )
  return { messages: invalid ? [] : messages, invalid }
}
