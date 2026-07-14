/**
 * Selecting and keying activity rows for `polymarket_activity`.
 *
 * Pure, so the two rules that actually bit us in production are unit-testable:
 * which rows we keep, and how a row is identified across re-reads.
 */

import { createHash } from 'node:crypto'
import type { ApiActivity } from './activityApi.js'

/** Trades are owned by `polymarket_trades`; storing them here would double-count. */
export const EXCLUDED_TYPES = new Set(['TRADE'])

/**
 * Everything about a row that makes it *that* row — but nothing about where it
 * appeared in a response.
 */
export function identityOf(row: ApiActivity): string {
  return [
    row.proxyWallet.toLowerCase(),
    row.type,
    row.conditionId,
    row.transactionHash ?? '',
    row.timestamp,
    row.size ?? '',
    row.usdcSize ?? '',
  ].join('|')
}

/**
 * `occurrence` is how many byte-identical rows precede this one — NOT its index
 * in the fetched page.
 *
 * Page position moves with the cursor, so keying on it mints fresh keys on every
 * re-run and re-inserts the whole history (a re-run of 8 wallets doubled the
 * table). Counting within the identity group is cursor-independent, while still
 * letting two genuinely identical events — the same split twice in one
 * transaction — both survive.
 */
export function dedupKey(identity: string, occurrence: number): string {
  return createHash('sha1').update(`${identity}|${occurrence}`).digest('hex').slice(0, 40)
}

export type KeptRow = {
  row: ApiActivity
  marketId: number | null
  key: string
}

/**
 * Keep the non-trade rows that touch our markets (or everything, with `full`),
 * each with a stable dedup key.
 *
 * The occurrence counter deliberately runs over ALL non-trade rows, before the
 * market filter — so a row's key never depends on which markets happen to be in
 * the catalog when it is synced.
 */
export function selectActivityRows(
  activities: ApiActivity[],
  marketIndex: Map<string, number>,
  full: boolean,
): KeptRow[] {
  const kept: KeptRow[] = []
  const seen = new Map<string, number>()

  for (const row of activities) {
    if (EXCLUDED_TYPES.has(row.type)) continue

    const identity = identityOf(row)
    const occurrence = seen.get(identity) ?? 0
    seen.set(identity, occurrence + 1)

    const marketId = marketIndex.get(row.conditionId) ?? null
    if (marketId === null && !full) continue

    kept.push({ row, marketId, key: dedupKey(identity, occurrence) })
  }

  return kept
}
