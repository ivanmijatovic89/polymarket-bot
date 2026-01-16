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
