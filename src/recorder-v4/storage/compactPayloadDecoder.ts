// Static V4 payload decoding: no JSON parsing or runtime code generation.
export type ColumnValues = Record<string, ArrayLike<unknown>>

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid compact payload string')
  return value
}
function integer(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number))
    throw new Error('Invalid compact payload integer')
  return number
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid compact payload boolean')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Invalid compact string list')
  return value as string[]
}
function sameLength(lists: readonly string[][]): void {
  if (lists.some((list) => list.length !== lists[0]!.length))
    throw new Error('Invalid compact parallel lists')
}
export function decodeCompactPayload(kind: string, c: ColumnValues, i: number): unknown {
  switch (kind) {
    case 'price_change': {
      const c1 = strings(c.pc_asset_id![i])
      const c2 = strings(c.pc_price![i])
      const c3 = strings(c.pc_size![i])
      const c4 = strings(c.pc_side![i])
      const c6 = strings(c.pc_best_bid![i])
      const c7 = strings(c.pc_best_ask![i])
      sameLength([c1, c2, c3, c4, c6, c7])
      return {
        market: text(c.pc_market![i]),
        price_changes: c1.map((_, j) => ({
          asset_id: c1[j]!,
          price: c2[j]!,
          size: c3[j]!,
          side: c4[j]!,
          hash: '',
          best_bid: c6[j]!,
          best_ask: c7[j]!,
        })),
        timestamp: text(c.pc_timestamp![i]),
        event_type: text(c.pc_event_type![i]),
      }
    }
    case 'btcusdt@bookTicker': {
      return {
        stream: text(c.bt_stream![i]),
        data: {
          u: integer(c.bt_u![i]),
          s: text(c.bt_s![i]),
          b: text(c.bt_b![i]),
          B: text(c.bt_bid_quantity![i]),
          a: text(c.bt_a![i]),
          A: text(c.bt_ask_quantity![i]),
        },
      }
    }
    case 'best_bid_ask': {
      return {
        market: text(c.bba_market![i]),
        asset_id: text(c.bba_asset_id![i]),
        best_bid: text(c.bba_best_bid![i]),
        best_ask: text(c.bba_best_ask![i]),
        spread: text(c.bba_spread![i]),
        timestamp: text(c.bba_timestamp![i]),
        event_type: text(c.bba_event_type![i]),
      }
    }
    case 'book': {
      const c26 = strings(c.book_bids_price![i])
      const c27 = strings(c.book_bids_size![i])
      const c28 = strings(c.book_asks_price![i])
      const c29 = strings(c.book_asks_size![i])
      sameLength([c26, c27])
      sameLength([c28, c29])
      return {
        market: text(c.book_market![i]),
        asset_id: text(c.book_asset_id![i]),
        bids: c26.map((_, j) => ({ price: c26[j]!, size: c27[j]! })),
        asks: c28.map((_, j) => ({ price: c28[j]!, size: c29[j]! })),
        hash: text(c.book_hash![i]),
        timestamp: text(c.book_timestamp![i]),
        event_type: text(c.book_event_type![i]),
      }
    }
    case 'btcusdt@aggTrade': {
      return {
        stream: text(c.at_stream![i]),
        data: {
          e: text(c.at_e![i]),
          E: integer(c.at_event_time![i]),
          s: text(c.at_s![i]),
          a: integer(c.at_a![i]),
          p: text(c.at_p![i]),
          q: text(c.at_q![i]),
          f: integer(c.at_f![i]),
          l: integer(c.at_l![i]),
          T: integer(c.at_trade_time![i]),
          m: bool(c.at_m![i]),
          M: bool(c.at_ignore![i]),
        },
      }
    }
    case 'last_trade_price': {
      return {
        market: text(c.lt_market![i]),
        asset_id: text(c.lt_asset_id![i]),
        price: text(c.lt_price![i]),
        size: text(c.lt_size![i]),
        fee_rate_bps: text(c.lt_fee_rate_bps![i]),
        side: text(c.lt_side![i]),
        timestamp: text(c.lt_timestamp![i]),
        event_type: text(c.lt_event_type![i]),
        transaction_hash: text(c.lt_transaction_hash![i]),
      }
    }
    default:
      throw new Error('Unknown compact payload kind')
  }
}
