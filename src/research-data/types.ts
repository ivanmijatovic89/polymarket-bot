export type ApiRow = Record<string, unknown>

export interface Market {
  slug: string
  condition_id: string
  event_id: string
  symbol: 'btc' | 'eth'
  timeframe: '15m' | '5m'
  market_start: number
  market_end: number
  token_ids: string[]
  outcomes: string[]
  payouts: string[]
  resolved: boolean
  raw_json: string
  source_warnings?: string[]
  resolution_json: string
}

export interface FeedRow extends ApiRow {
  proxy_wallet: string
  condition_id: string
  token_id: string
  transaction_hash: string
  timestamp: number
  side: string
  size: number | string
  price: number | string
  is_taker?: boolean
}

export interface Activity extends FeedRow {
  type: string
  usdc_size: number | string
}

export interface Position extends ApiRow {
  proxy_wallet: string
  condition_id: string
  token_id: string
  current_size: number | string
  realized_pnl: number | string
  unrealized_pnl: number | string
  total_pnl: number | string
  entry_fees_usdc: number | string
}

export interface WalletMarket {
  wallet: string
  condition_id: string
  slug: string
  market_start: number
  trade_count: number
  activity_count: number
  buy_usdc: string
  sell_usdc: string
  split_usdc: string
  merge_usdc: string
  redeem_usdc: string
  cash_pnl_usdc: string
  unredeemed_value_usdc: string | null
  economic_pnl_usdc: string | null
  rewards_usdc: string
  pnl_with_rewards_usdc: string | null
  api_position_pnl_usdc: string | null
  api_pnl_difference_usdc: string | null
  modeled_api_pnl_usdc: string | null
  api_pnl_status: string
  quality: 'complete' | 'unresolved' | 'pending_resolution'
  issues: string[]
  notes: string[]
}

export function feedRow(row: ApiRow): FeedRow {
  for (const key of ['proxy_wallet', 'condition_id', 'token_id', 'transaction_hash', 'side']) {
    if (typeof row[key] !== 'string') throw new Error(`Missing feed field ${key}`)
  }
  if (!Number.isSafeInteger(row.timestamp)) throw new Error('Invalid feed timestamp')
  for (const key of ['size', 'price']) {
    if (typeof row[key] !== 'number' && typeof row[key] !== 'string') {
      throw new Error(`Missing feed amount ${key}`)
    }
  }
  return row as FeedRow
}

export function activityRow(row: ApiRow): Activity {
  feedRow(row)
  if (typeof row.type !== 'string') throw new Error('Missing activity type')
  if (typeof row.usdc_size !== 'number' && typeof row.usdc_size !== 'string') {
    throw new Error('Missing activity cash amount')
  }
  return row as Activity
}

export function positionRow(row: ApiRow): Position {
  for (const key of ['proxy_wallet', 'condition_id', 'token_id']) {
    if (typeof row[key] !== 'string') throw new Error(`Missing position field ${key}`)
  }
  for (const key of ['current_size', 'realized_pnl', 'unrealized_pnl', 'total_pnl']) {
    if (typeof row[key] !== 'number' && typeof row[key] !== 'string') {
      throw new Error(`Unavailable position field ${key}`)
    }
  }
  return row as Position
}
