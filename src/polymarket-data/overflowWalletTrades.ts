import type { ApiActivity } from './activityApi.js'
import type { ApiTrade } from './dataApi.js'

function takerGroupKey(parts: {
  wallet: string
  transactionHash: string
  asset: string
  side: string
}): string {
  return [parts.wallet.toLowerCase(), parts.transactionHash, parts.asset, parts.side].join('|')
}

export function tradeFillKey(row: ApiTrade): string {
  return [
    row.proxyWallet.toLowerCase(),
    row.asset,
    row.side,
    row.price,
    row.size,
    row.timestamp,
    row.transactionHash,
  ].join('|')
}

function activityAsTrade(row: ApiActivity, wallet: string, conditionId: string): ApiTrade {
  if (row.type !== 'TRADE')
    throw new Error(`overflow activity contains ${row.type}, expected TRADE`)
  if (row.proxyWallet.toLowerCase() !== wallet) {
    throw new Error(`overflow activity wallet mismatch: ${row.proxyWallet} != ${wallet}`)
  }
  if (row.conditionId !== conditionId) {
    throw new Error(`overflow activity condition mismatch: ${row.conditionId} != ${conditionId}`)
  }
  if (
    row.side === undefined ||
    row.asset === undefined ||
    row.size === undefined ||
    row.price === undefined ||
    row.outcomeIndex === undefined ||
    row.transactionHash === undefined
  ) {
    throw new Error('overflow TRADE activity is missing a per-fill field')
  }
  return {
    proxyWallet: wallet,
    side: row.side,
    asset: row.asset,
    conditionId,
    size: row.size,
    price: row.price,
    timestamp: row.timestamp,
    outcomeIndex: row.outcomeIndex,
    transactionHash: row.transactionHash,
    ...(row.name ? { name: row.name } : {}),
    ...(row.pseudonym ? { pseudonym: row.pseudonym } : {}),
  }
}

/**
 * Recover a wallet whose `/trades?user=...&market=...` scope is itself capped.
 *
 * Activity maker rows are per-fill. Taker activity may aggregate a sweep, so
 * every activity group known to be taker is removed and replaced by the
 * per-fill `takerOnly=true` rows. The visible capped `/trades` prefix is then
 * required to be a multiset subset and is retained verbatim; only the rows
 * beyond that prefix come from activity.
 */
export function reconstructOverflowWalletTrades(input: {
  wallet: string
  conditionId: string
  activities: ApiActivity[]
  visibleTrades: ApiTrade[]
  takerTrades: ApiTrade[]
}): ApiTrade[] {
  const wallet = input.wallet.toLowerCase()
  const takerGroups = new Set(
    input.takerTrades.map((row) =>
      takerGroupKey({
        wallet: row.proxyWallet,
        transactionHash: row.transactionHash,
        asset: row.asset,
        side: row.side,
      }),
    ),
  )

  const candidates: ApiTrade[] = []
  for (const activity of input.activities) {
    const row = activityAsTrade(activity, wallet, input.conditionId)
    const group = takerGroupKey({
      wallet: row.proxyWallet,
      transactionHash: row.transactionHash,
      asset: row.asset,
      side: row.side,
    })
    if (!takerGroups.has(group)) candidates.push(row)
  }
  candidates.push(...input.takerTrades)

  const byKey = new Map<string, ApiTrade[]>()
  for (const row of candidates) {
    const key = tradeFillKey(row)
    const rows = byKey.get(key) ?? []
    rows.push(row)
    byKey.set(key, rows)
  }

  for (const visible of input.visibleTrades) {
    const key = tradeFillKey(visible)
    const rows = byKey.get(key)
    if (!rows || rows.length === 0) {
      throw new Error(
        `time-sliced activity does not contain visible /trades row ${visible.transactionHash}`,
      )
    }
    rows.pop()
  }

  const hidden = [...byKey.values()].flat()
  return [...input.visibleTrades, ...hidden]
}
