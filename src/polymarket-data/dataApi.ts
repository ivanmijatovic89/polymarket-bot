/**
 * Polymarket Data API client for the polymarket-data pipeline.
 *
 * Behaviour verified against the live API (2026-07-14) — this endpoint ignores
 * several documented params, so nothing here is assumed:
 *
 *   GET /trades
 *     - Public, no auth. `takerOnly=false` is REQUIRED to get maker rows
 *       (default true returns taker rows only).
 *     - `user` + `market` is the escape hatch for a capped market: partitioning
 *       the same endpoint by the complete position-participant set reproduced
 *       Gamma volume exactly on two large BTC daily markets.
 *     - `limit` up to 1000 works.
 *     - `start` / `end` / `before` / `after` / `sortDirection` are SILENTLY
 *       IGNORED when querying by market. Paging is offset-only, newest-first.
 *     - `offset` is hard-capped at 3000 on closed markets ("max historical
 *       activity offset of 3000 exceeded"), so one query combo can reach at most
 *       4000 rows. `side=BUY` / `side=SELL` are separate combos → 8000/market.
 *     - Rows carry no unique id, so callers must write a market's rows whole
 *       (delete + insert in one transaction) rather than dedupe row-by-row.
 *
 *   GET /v1/market-positions
 *     - Returns [{ token, positions[] }] — one entry per outcome token.
 *     - `limit` is capped at 500 per token; `offset` pages within a token.
 *     - Complete even when /trades is capped, and a strict SUPERSET of the
 *       wallets seen in /trades (verified on two markets: every trading wallet
 *       appears, plus wallets that only ever split/merged/redeemed). This is why
 *       positions runs BEFORE trades and drives participant discovery.
 */

import { POLYMARKET_DATA_API_URL } from '../config/polymarketData.js'
import { fetchJson } from './http.js'
import type { RateLimiter } from './rateLimiter.js'

const TRADES_PAGE_LIMIT = 1000
/** The API rejects offsets above 3000; the last usable page starts at 3000. */
export const TRADES_MAX_OFFSET = 3000
/** Rows reachable by a single query combo (offset 0..3000 + limit 1000). */
export const TRADES_COMBO_CEILING = TRADES_MAX_OFFSET + TRADES_PAGE_LIMIT

const POSITIONS_PAGE_LIMIT = 500

export type ApiTrade = {
  proxyWallet: string
  side: 'BUY' | 'SELL'
  asset: string
  conditionId: string
  size: number
  price: number
  timestamp: number
  outcomeIndex: number
  transactionHash: string
  name?: string
  pseudonym?: string
}

export type ApiPosition = {
  proxyWallet: string
  asset: string
  conditionId: string
  outcomeIndex: number
  size: number
  avgPrice: number
  totalBought: number
  realizedPnl: number
  cashPnl: number
  name?: string
  pseudonym?: string
}

export type FetchOptions = {
  limiter: RateLimiter
  signal?: AbortSignal
  label?: string
}

function requestOptions(opts: FetchOptions) {
  return {
    limiter: opts.limiter,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.label ? { label: opts.label } : {}),
  }
}

/**
 * Page one `/trades` query combo (a market, optionally narrowed to one side)
 * until it runs out of rows or hits the offset cap.
 *
 * `capped` = the combo still had full pages when the cap was reached, i.e. rows
 * exist that this combo cannot reach.
 */
async function fetchTradesCombo(
  conditionId: string,
  side: 'BUY' | 'SELL' | null,
  scope: { wallet?: string; takerOnly: boolean },
  opts: FetchOptions,
): Promise<{ trades: ApiTrade[]; capped: boolean }> {
  const trades: ApiTrade[] = []
  const sideParam = side ? `&side=${side}` : ''
  const walletParam = scope.wallet ? `&user=${encodeURIComponent(scope.wallet)}` : ''

  for (let offset = 0; ; offset += TRADES_PAGE_LIMIT) {
    const url =
      `${POLYMARKET_DATA_API_URL}/trades` +
      `?market=${encodeURIComponent(conditionId)}` +
      `&takerOnly=${scope.takerOnly}&limit=${TRADES_PAGE_LIMIT}&offset=${offset}` +
      `${walletParam}${sideParam}`

    const page = await fetchJson<ApiTrade[]>(url, requestOptions(opts))
    if (!Array.isArray(page) || page.length === 0) return { trades, capped: false }
    trades.push(...page)
    if (page.length < TRADES_PAGE_LIMIT) return { trades, capped: false }

    if (offset >= TRADES_MAX_OFFSET) {
      // Full page at the last reachable offset: there is more we cannot see.
      return { trades, capped: true }
    }
  }
}

type TradesResult = {
  trades: ApiTrade[]
  capped: boolean
  usedSideSplit: boolean
}

/**
 * Fetch one market/user/taker scope. An unsided scope reaches 4,000 rows; if it
 * fills that window, BUY and SELL are independent query combinations and raise
 * the reachable ceiling to 8,000 rows. Identical-looking rows are preserved.
 */
async function fetchTradesScope(
  conditionId: string,
  scope: { wallet?: string; takerOnly: boolean },
  opts: FetchOptions,
): Promise<TradesResult> {
  const unsided = await fetchTradesCombo(conditionId, null, scope, opts)
  if (!unsided.capped) {
    return { trades: unsided.trades, capped: false, usedSideSplit: false }
  }

  const [buys, sells] = await Promise.all([
    fetchTradesCombo(conditionId, 'BUY', scope, opts),
    fetchTradesCombo(conditionId, 'SELL', scope, opts),
  ])
  return {
    trades: [...buys.trades, ...sells.trades],
    capped: buys.capped || sells.capped,
    usedSideSplit: true,
  }
}

/**
 * All trade rows (maker + taker) for a market.
 *
 * Strategy: one unsided query first. If it hits the offset cap, retry split by
 * side — two combos reach 8000 rows where one reaches 4000. If a side is STILL
 * capped, return what we have with `capped: true`; the caller marks the market
 * `partial` and the deep-backfill stage reconstructs it per-wallet. We never
 * silently return a truncated set as if it were complete.
 */
export async function fetchMarketTrades(
  conditionId: string,
  opts: FetchOptions,
): Promise<{ trades: ApiTrade[]; capped: boolean; usedSideSplit: boolean }> {
  return fetchTradesScope(conditionId, { takerOnly: false }, opts)
}

/** Every maker + taker fill row belonging to one participant in one market. */
export async function fetchWalletTrades(
  conditionId: string,
  wallet: string,
  opts: FetchOptions,
): Promise<TradesResult> {
  return fetchTradesScope(conditionId, { wallet, takerOnly: false }, opts)
}

/**
 * The taker-only subset of a market's trades. Used to flag which rows of the
 * full set were the taker side of their match.
 */
export async function fetchMarketTakerTrades(
  conditionId: string,
  opts: FetchOptions,
): Promise<{ trades: ApiTrade[]; capped: boolean }> {
  const result = await fetchTradesScope(conditionId, { takerOnly: true }, opts)
  return { trades: result.trades, capped: result.capped }
}

/** The taker-only subset for one participant, used only if market-wide takers cap. */
export async function fetchWalletTakerTrades(
  conditionId: string,
  wallet: string,
  opts: FetchOptions,
): Promise<TradesResult> {
  return fetchTradesScope(conditionId, { wallet, takerOnly: true }, opts)
}

type PositionsResponse = Array<{ token?: string; positions?: ApiPosition[] }>

/** Every wallet holding (or having held) either outcome of a market. */
export async function fetchMarketPositions(
  conditionId: string,
  opts: FetchOptions,
): Promise<ApiPosition[]> {
  const out: ApiPosition[] = []

  for (let offset = 0; ; offset += POSITIONS_PAGE_LIMIT) {
    const url =
      `${POLYMARKET_DATA_API_URL}/v1/market-positions` +
      `?market=${encodeURIComponent(conditionId)}` +
      `&limit=${POSITIONS_PAGE_LIMIT}&offset=${offset}`

    const groups = await fetchJson<PositionsResponse>(url, requestOptions(opts))
    if (!Array.isArray(groups)) return out

    // The response is grouped per outcome token, and `limit`/`offset` apply
    // *within* each group. A page is exhausted only when every token group is.
    let pageRows = 0
    let anyFullGroup = false
    for (const group of groups) {
      const positions = group.positions ?? []
      pageRows += positions.length
      if (positions.length >= POSITIONS_PAGE_LIMIT) anyFullGroup = true
      out.push(...positions)
    }
    if (pageRows === 0 || !anyFullGroup) return out
  }
}
