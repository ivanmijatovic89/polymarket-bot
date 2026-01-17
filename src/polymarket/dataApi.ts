/**
 * Polymarket Data API client
 * https://data-api.polymarket.com
 *
 * Provides user-specific data: positions, activity, portfolio summary, etc.
 */

const DATA_API_BASE_URL = 'https://data-api.polymarket.com'

export type Position = {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  percentRealizedPnl: number
  curPrice: number
  redeemable: boolean
  mergeable: boolean
  title: string
  slug: string
  icon: string
  eventId: string
  eventSlug: string
  outcome: string
  outcomeIndex: number
  oppositeOutcome: string
  oppositeAsset: string
  endDate: string | null
  negativeRisk: boolean | null
}

export type PositionsQuery = {
  user: string
  limit?: number
  offset?: number
  sortBy?: 'SIZE' | 'VALUE' | 'PNL'
  sortDirection?: 'ASC' | 'DESC'
}

export type FetchPositionsOptions = PositionsQuery & {
  redeemable?: boolean
  mergeable?: boolean
  sizeThreshold?: number
  market?: string // conditionId, can be CSV
  eventId?: string // can be CSV
  title?: string
}

/**
 * Fetch positions for a user.
 * https://docs.polymarket.com/developers/misc-endpoints/data-api-get-positions
 */
export async function fetchPositions(query: FetchPositionsOptions): Promise<Position[]> {
  const params = new URLSearchParams({ user: query.user })
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDirection) params.set('sortDirection', query.sortDirection)
  if (query.redeemable !== undefined) params.set('redeemable', String(query.redeemable))
  if (query.mergeable !== undefined) params.set('mergeable', String(query.mergeable))
  if (query.sizeThreshold !== undefined) params.set('sizeThreshold', String(query.sizeThreshold))
  if (query.market) params.set('market', query.market)
  if (query.eventId) params.set('eventId', query.eventId)
  if (query.title) params.set('title', query.title)

  const url = `${DATA_API_BASE_URL}/positions?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[dataApi] fetchPositions failed: HTTP ${res.status} - ${await res.text()}`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error(`[dataApi] fetchPositions: expected array, got ${typeof data}`)
  }
  return data as Position[]
}

/**
 * Fetch only redeemable positions for a user.
 * Uses the API's native redeemable=true filter.
 */
export async function fetchRedeemablePositions(user: string): Promise<Position[]> {
  return fetchPositions({ user, redeemable: true, limit: 1000 })
}

/**
 * Fetch all positions for a user (no filters).
 */
export async function fetchAllPositions(user: string, limit = 1000): Promise<Position[]> {
  return fetchPositions({ user, limit })
}

/**
 * Fetch total portfolio value for a user.
 * https://docs.polymarket.com/api-reference/core/get-total-value-of-a-users-positions
 */
export async function fetchPortfolioValue(user: string): Promise<number> {
  const url = `${DATA_API_BASE_URL}/value?user=${user}`
  const res = await fetch(url)
  if (!res.ok) return 0
  const data: unknown = await res.json()
  if (Array.isArray(data) && data.length > 0 && typeof data[0]?.value === 'number') {
    return data[0].value
  }
  return 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Closed Positions (historical/resolved)
// ─────────────────────────────────────────────────────────────────────────────

export type ClosedPosition = {
  oditionId?: string
  conditionId?: string
  title?: string
  slug?: string
  icon?: string
  eventSlug?: string
  outcome?: string
  outcomeIndex?: number
  oppositeOutcome?: string
  // PnL fields - API returns these as the main PnL indicator
  realizedPnl?: number
  pnl?: number // Alternative field name
  percentRealizedPnl?: number
  percentPnl?: number
  // Position info
  size?: number
  avgPrice?: number
  totalBought?: number
  initialValue?: number
  // Resolution info
  resolvedAt?: string
  winningOutcome?: string
  resolutionOutcome?: string
  // Raw data for debugging
  [key: string]: unknown
}

export type FetchClosedPositionsOptions = {
  user: string
  limit?: number
  offset?: number
  sortBy?: 'RESOLVED_AT' | 'REALIZED_PNL'
  sortDirection?: 'ASC' | 'DESC'
}

/**
 * Fetch closed/resolved positions for a user.
 * https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user
 */
export async function fetchClosedPositions(query: FetchClosedPositionsOptions): Promise<ClosedPosition[]> {
  const params = new URLSearchParams({ user: query.user })
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDirection) params.set('sortDirection', query.sortDirection)

  const url = `${DATA_API_BASE_URL}/closed-positions?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    // API may return 404 if no closed positions exist
    if (res.status === 404) return []
    throw new Error(`[dataApi] fetchClosedPositions failed: HTTP ${res.status} - ${await res.text()}`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error(`[dataApi] fetchClosedPositions: expected array, got ${typeof data}`)
  }
  return data as ClosedPosition[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity (trade history, splits, merges, redeems)
// https://docs.polymarket.com/api-reference/core/get-user-activity
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityType = 'TRADE' | 'SPLIT' | 'MERGE' | 'REDEEM' | 'REWARD' | 'CONVERSION' | 'MAKER_REBATE'

export type Activity = {
  proxyWallet: string
  timestamp: number // unix timestamp
  conditionId: string
  type: ActivityType
  // Size info
  size: number // number of shares
  usdcSize: number // USDC amount
  // Trade details
  price?: number
  side?: 'BUY' | 'SELL'
  asset?: string
  outcomeIndex?: number
  // Market info
  title?: string
  slug?: string
  icon?: string
  eventSlug?: string
  outcome?: string
  // Transaction
  transactionHash?: string
  // Profile (optional)
  name?: string
  pseudonym?: string
}

export type FetchActivityOptions = {
  user: string
  limit?: number
  offset?: number
  type?: ActivityType | ActivityType[]
  market?: string // conditionId, comma-separated
  start?: number // unix timestamp
  end?: number // unix timestamp
  sortBy?: 'TIMESTAMP' | 'TOKENS' | 'CASH'
  sortDirection?: 'ASC' | 'DESC'
  side?: 'BUY' | 'SELL'
}

/**
 * Fetch user activity (trades, splits, merges, redeems).
 * https://docs.polymarket.com/api-reference/core/get-user-activity
 */
export async function fetchActivity(query: FetchActivityOptions): Promise<Activity[]> {
  const params = new URLSearchParams({ user: query.user })
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type]
    for (const t of types) params.append('type', t)
  }
  if (query.market) params.set('market', query.market)
  if (query.start !== undefined) params.set('start', String(query.start))
  if (query.end !== undefined) params.set('end', String(query.end))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDirection) params.set('sortDirection', query.sortDirection)
  if (query.side) params.set('side', query.side)

  const url = `${DATA_API_BASE_URL}/activity?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 404) return []
    throw new Error(`[dataApi] fetchActivity failed: HTTP ${res.status} - ${await res.text()}`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error(`[dataApi] fetchActivity: expected array, got ${typeof data}`)
  }
  return data as Activity[]
}
