/**
 * `/activity` client — the per-wallet view of Polymarket.
 *
 * Unlike `/trades`, this endpoint REQUIRES `user` (400 without it), but in
 * exchange it honours everything `/trades` ignores: `start` / `end` (epoch
 * seconds), `sortBy=TIMESTAMP&sortDirection=ASC`, and an optional `market`
 * filter. That makes it cursor-friendly and, crucially, escapable from the
 * offset cap: when a page walk approaches the cap we simply advance `start` past
 * the last row we saw and reset the offset.
 *
 * It is also the reconstruction path for markets whose `/trades` pages are
 * capped: per-wallet TRADE rows were verified to reproduce `/trades` exactly for
 * the same market — same row count, same USDC, maker fills included (checked
 * against a fully-synced market, including a wallet with zero taker fills).
 *
 * The one thing activity rows do NOT carry is a maker/taker flag.
 */

import { POLYMARKET_DATA_API_URL } from '../config/polymarketData.js'
import { fetchJson } from './http.js'
import type { RateLimiter } from './rateLimiter.js'

const PAGE_LIMIT = 500

/**
 * The real offset cap is 3000 — NOT the 10000 the OpenAPI spec advertises.
 * Measured: `offset=3500` returns 400 "max historical activity offset of 3000
 * exceeded", exactly like `/trades`. A busy wallet blows through 3500 rows
 * easily, so this is load-bearing, not a corner case: past this point we
 * advance the `start` window instead of the offset.
 */
const MAX_OFFSET = 3000

export type ApiActivity = {
  proxyWallet: string
  type: string
  timestamp: number
  conditionId: string
  side?: 'BUY' | 'SELL'
  size?: number
  price?: number
  usdcSize?: number
  asset?: string
  outcomeIndex?: number
  transactionHash?: string
  name?: string
  pseudonym?: string
}

export type ActivityQuery = {
  wallet: string
  /** Restrict to one market (condition id). Omit for the wallet's whole history. */
  conditionId?: string
  types?: string[]
  /** Epoch SECONDS. `1` means "all history" (0 selects the API's default window). */
  startSec?: number
  endSec?: number
}

export type ActivityFetchOptions = {
  limiter: RateLimiter
  signal?: AbortSignal
  label?: string
}

function buildUrl(q: ActivityQuery, offset: number, startSec: number): string {
  const params = new URLSearchParams({
    user: q.wallet,
    limit: String(PAGE_LIMIT),
    offset: String(offset),
    sortBy: 'TIMESTAMP',
    sortDirection: 'ASC',
    // `start=0` is not "from the beginning" — it selects the API's default
    // (~3 year) window. `1` is the documented way to ask for full history.
    start: String(Math.max(1, startSec)),
  })
  if (q.conditionId) params.set('market', q.conditionId)
  if (q.types && q.types.length > 0) params.set('type', q.types.join(','))
  if (q.endSec !== undefined) params.set('end', String(q.endSec))
  return `${POLYMARKET_DATA_API_URL}/activity?${params.toString()}`
}

/**
 * Every activity row matching `q`, ascending by timestamp.
 *
 * Paging walks offsets inside a `start` window and, on approaching the offset
 * cap, advances `start` to the last timestamp seen and resets the offset. Rows
 * sharing that boundary second are re-fetched and de-duplicated here, so no row
 * is lost or double-counted at a window edge.
 */
export function activityRowKey(row: ApiActivity): string {
  return [
    row.type,
    row.conditionId,
    row.timestamp,
    row.transactionHash ?? '',
    row.asset ?? '',
    row.side ?? '',
    row.size ?? '',
    row.price ?? '',
  ].join('|')
}

export async function fetchActivity(
  q: ActivityQuery,
  opts: ActivityFetchOptions,
): Promise<ApiActivity[]> {
  const out: ApiActivity[] = []

  let startSec = q.startSec ?? 1
  let offset = 0
  // After a window advance we re-read the boundary second. `carryOver` counts
  // how many rows of each key we already emitted AT that second, so the re-read
  // can skip exactly those — and no more. A plain Set would be wrong here: two
  // genuinely identical fills can exist, and dropping one would lose real data.
  let carryOver: Map<string, number> | null = null

  for (;;) {
    const url = buildUrl(q, offset, startSec)
    const page = await fetchJson<ApiActivity[]>(url, {
      limiter: opts.limiter,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.label ? { label: opts.label } : {}),
    })
    if (!Array.isArray(page) || page.length === 0) return out

    for (const row of page) {
      if (carryOver !== null && row.timestamp === startSec) {
        const key = activityRowKey(row)
        const remaining = carryOver.get(key) ?? 0
        if (remaining > 0) {
          carryOver.set(key, remaining - 1)
          continue
        }
      }
      out.push(row)
    }
    // Rows past the boundary second mean the overlap is behind us.
    if (carryOver !== null && page.some((r) => r.timestamp > startSec)) carryOver = null

    if (page.length < PAGE_LIMIT) return out

    offset += PAGE_LIMIT
    if (offset > MAX_OFFSET) {
      const lastTs = page[page.length - 1]!.timestamp
      // The window advances by re-entering AT `lastTs`. If the entire reachable
      // window (MAX_OFFSET + PAGE_LIMIT rows) sits in a single second, `lastTs`
      // equals the current `startSec`, so advancing would not move forward — the
      // walk would re-read the same capped pages forever. That means more rows
      // share this second than the offset cap can expose, and this API offers no
      // finer key to page them. Fail loudly rather than hang.
      if (lastTs === startSec) {
        const scope = q.conditionId ? ` on ${q.conditionId}` : ''
        throw new Error(
          `activity pagination cannot advance past ${startSec}s for ${q.wallet}${scope}: ` +
            `more than ${MAX_OFFSET + PAGE_LIMIT} rows share this second and exceed the offset cap`,
        )
      }
      // Re-enter AT the last timestamp (not after it) so rows sharing that
      // second are not skipped; the carry-over above removes the ones we have.
      carryOver = new Map()
      for (const row of out) {
        if (row.timestamp !== lastTs) continue
        const key = activityRowKey(row)
        carryOver.set(key, (carryOver.get(key) ?? 0) + 1)
      }
      startSec = lastTs
      offset = 0
    }
  }
}
