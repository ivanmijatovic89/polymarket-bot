// Fixed V4 wire shapes. Extra/missing fields use raw fallback, never silent truncation.
export type WireShape =
  | 'string'
  | 'integer'
  | 'boolean'
  | readonly WireShape[]
  | { readonly [key: string]: WireShape }
export const wireShapes: Readonly<Record<string, WireShape>> = {
  price_change: {
    market: 'string',
    price_changes: [
      {
        asset_id: 'string',
        price: 'string',
        size: 'string',
        side: 'string',
        hash: 'string',
        best_bid: 'string',
        best_ask: 'string',
      },
    ],
    timestamp: 'string',
    event_type: 'string',
  },
  'btcusdt@bookTicker': {
    stream: 'string',
    data: {
      u: 'integer',
      s: 'string',
      b: 'string',
      B: 'string',
      a: 'string',
      A: 'string',
    },
  },
  best_bid_ask: {
    market: 'string',
    asset_id: 'string',
    best_bid: 'string',
    best_ask: 'string',
    spread: 'string',
    timestamp: 'string',
    event_type: 'string',
  },
  book: {
    market: 'string',
    asset_id: 'string',
    bids: [
      {
        price: 'string',
        size: 'string',
      },
    ],
    asks: [
      {
        price: 'string',
        size: 'string',
      },
    ],
    hash: 'string',
    timestamp: 'string',
    event_type: 'string',
  },
  'btcusdt@aggTrade': {
    stream: 'string',
    data: {
      e: 'string',
      E: 'integer',
      s: 'string',
      a: 'integer',
      p: 'string',
      q: 'string',
      f: 'integer',
      l: 'integer',
      T: 'integer',
      m: 'boolean',
      M: 'boolean',
    },
  },
  last_trade_price: {
    market: 'string',
    asset_id: 'string',
    price: 'string',
    size: 'string',
    fee_rate_bps: 'string',
    side: 'string',
    timestamp: 'string',
    event_type: 'string',
    transaction_hash: 'string',
  },
}

export type PayloadColumn = {
  name: string
  path: readonly string[]
  type: 'VARCHAR' | 'BIGINT' | 'BOOLEAN'
  list: boolean
}
export const payloadColumns: Readonly<Record<string, readonly PayloadColumn[]>> = {
  price_change: [
    { name: 'pc_market', path: ['market'], type: 'VARCHAR', list: false },
    { name: 'pc_asset_id', path: ['price_changes', '[]', 'asset_id'], type: 'VARCHAR', list: true },
    { name: 'pc_price', path: ['price_changes', '[]', 'price'], type: 'VARCHAR', list: true },
    { name: 'pc_size', path: ['price_changes', '[]', 'size'], type: 'VARCHAR', list: true },
    { name: 'pc_side', path: ['price_changes', '[]', 'side'], type: 'VARCHAR', list: true },
    { name: 'pc_best_bid', path: ['price_changes', '[]', 'best_bid'], type: 'VARCHAR', list: true },
    { name: 'pc_best_ask', path: ['price_changes', '[]', 'best_ask'], type: 'VARCHAR', list: true },
    { name: 'pc_timestamp', path: ['timestamp'], type: 'VARCHAR', list: false },
    { name: 'pc_event_type', path: ['event_type'], type: 'VARCHAR', list: false },
  ],
  'btcusdt@bookTicker': [
    { name: 'bt_stream', path: ['stream'], type: 'VARCHAR', list: false },
    { name: 'bt_u', path: ['data', 'u'], type: 'BIGINT', list: false },
    { name: 'bt_s', path: ['data', 's'], type: 'VARCHAR', list: false },
    { name: 'bt_b', path: ['data', 'b'], type: 'VARCHAR', list: false },
    { name: 'bt_bid_quantity', path: ['data', 'B'], type: 'VARCHAR', list: false },
    { name: 'bt_a', path: ['data', 'a'], type: 'VARCHAR', list: false },
    { name: 'bt_ask_quantity', path: ['data', 'A'], type: 'VARCHAR', list: false },
  ],
  best_bid_ask: [
    { name: 'bba_market', path: ['market'], type: 'VARCHAR', list: false },
    { name: 'bba_asset_id', path: ['asset_id'], type: 'VARCHAR', list: false },
    { name: 'bba_best_bid', path: ['best_bid'], type: 'VARCHAR', list: false },
    { name: 'bba_best_ask', path: ['best_ask'], type: 'VARCHAR', list: false },
    { name: 'bba_spread', path: ['spread'], type: 'VARCHAR', list: false },
    { name: 'bba_timestamp', path: ['timestamp'], type: 'VARCHAR', list: false },
    { name: 'bba_event_type', path: ['event_type'], type: 'VARCHAR', list: false },
  ],
  book: [
    { name: 'book_market', path: ['market'], type: 'VARCHAR', list: false },
    { name: 'book_asset_id', path: ['asset_id'], type: 'VARCHAR', list: false },
    { name: 'book_bids_price', path: ['bids', '[]', 'price'], type: 'VARCHAR', list: true },
    { name: 'book_bids_size', path: ['bids', '[]', 'size'], type: 'VARCHAR', list: true },
    { name: 'book_asks_price', path: ['asks', '[]', 'price'], type: 'VARCHAR', list: true },
    { name: 'book_asks_size', path: ['asks', '[]', 'size'], type: 'VARCHAR', list: true },
    { name: 'book_hash', path: ['hash'], type: 'VARCHAR', list: false },
    { name: 'book_timestamp', path: ['timestamp'], type: 'VARCHAR', list: false },
    { name: 'book_event_type', path: ['event_type'], type: 'VARCHAR', list: false },
  ],
  'btcusdt@aggTrade': [
    { name: 'at_stream', path: ['stream'], type: 'VARCHAR', list: false },
    { name: 'at_e', path: ['data', 'e'], type: 'VARCHAR', list: false },
    { name: 'at_event_time', path: ['data', 'E'], type: 'BIGINT', list: false },
    { name: 'at_s', path: ['data', 's'], type: 'VARCHAR', list: false },
    { name: 'at_a', path: ['data', 'a'], type: 'BIGINT', list: false },
    { name: 'at_p', path: ['data', 'p'], type: 'VARCHAR', list: false },
    { name: 'at_q', path: ['data', 'q'], type: 'VARCHAR', list: false },
    { name: 'at_f', path: ['data', 'f'], type: 'BIGINT', list: false },
    { name: 'at_l', path: ['data', 'l'], type: 'BIGINT', list: false },
    { name: 'at_trade_time', path: ['data', 'T'], type: 'BIGINT', list: false },
    { name: 'at_m', path: ['data', 'm'], type: 'BOOLEAN', list: false },
    { name: 'at_ignore', path: ['data', 'M'], type: 'BOOLEAN', list: false },
  ],
  last_trade_price: [
    { name: 'lt_market', path: ['market'], type: 'VARCHAR', list: false },
    { name: 'lt_asset_id', path: ['asset_id'], type: 'VARCHAR', list: false },
    { name: 'lt_price', path: ['price'], type: 'VARCHAR', list: false },
    { name: 'lt_size', path: ['size'], type: 'VARCHAR', list: false },
    { name: 'lt_fee_rate_bps', path: ['fee_rate_bps'], type: 'VARCHAR', list: false },
    { name: 'lt_side', path: ['side'], type: 'VARCHAR', list: false },
    { name: 'lt_timestamp', path: ['timestamp'], type: 'VARCHAR', list: false },
    { name: 'lt_event_type', path: ['event_type'], type: 'VARCHAR', list: false },
    { name: 'lt_transaction_hash', path: ['transaction_hash'], type: 'VARCHAR', list: false },
  ],
}
